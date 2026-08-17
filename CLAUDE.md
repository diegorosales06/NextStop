# JucoProduct

California community-college → 4-year transfer planner. Scrapes [ASSIST.org](https://assist.org)
articulation agreements, caches them as JSON, and loads them into Supabase Postgres.

**Stack:** Python 3.9 (in `.venv/`), `requests` + `psycopg[binary]` + `python-dotenv`. Supabase Postgres. No web layer yet.

---

## Pipeline

```
ASSIST.org  ──►  metadata/*.json  ──►  raw/*.json  ──►  Supabase Postgres
              (1) refresh          (3) scrape       (4) load-*
                                  ▲
              (2) build-index ────┘
```

Every stage is idempotent / resumable — no state files, just "does the output already exist."

## File map

Every module has one concern and one named logger. Errors carry `assist.<name>` so a traceback tells you the layer immediately.

| File | Logger | Concern |
|---|---|---|
| [assist_client.py](assist_client.py) | `assist.client` | ASSIST HTTP: XSRF pair, 1 req/sec, JSON decode. No filesystem. |
| [metadata_store.py](metadata_store.py) | `assist.metadata` | Read/write `metadata/institutions.json` & `academic_years.json` + helpers `institution_summary`, `year_label`. |
| [agreements_index.py](agreements_index.py) | `assist.index` | Build `metadata/agreements_index.json` (list only, no articulation bodies). |
| [articulation_cache.py](articulation_cache.py) | `assist.cache` | Fetch full articulation JSONs into `raw/{SEND}_to_{RECV}_{year}_{safe_key}.json`. |
| [articulation_format.py](articulation_format.py) | `assist.format` | Pretty-print one cached articulation. |
| [db.py](db.py) | `assist.db` | Postgres connection helper. Loads `.env.local` then `.env`. |
| [db_institutions.py](db_institutions.py) | `assist.db.institutions` | Upsert `institutions.json` → `institutions` table. |
| [db_academic_years.py](db_academic_years.py) | `assist.db.academic_years` | Upsert `academic_years.json` → `academic_years` table. |
| [mvp_config.py](mvp_config.py) | — | MVP roster constants (schools, majors, year). |
| [logging_setup.py](logging_setup.py) | — | `configure_logging(level)`. |
| [main.py](main.py) | `assist.main` | Argparse CLI. Every subcommand lazy-imports DB modules so ASSIST commands work without psycopg. |
| [sql/*.sql](sql/) | — | Reference DDL (tables live in Supabase, this is docs). |

## CLI

```bash
python main.py refresh-metadata            # (1) fetch institutions + academic_years JSON
python main.py build-index                 # (2) build agreements_index.json for MVP roster
python main.py scrape --sending 62 --receiving 117 [--year 76] [--majors "cs,ee"]
python main.py show raw/<file>.json        # print human-readable articulation
python main.py load-institutions           # (4a) upsert institutions.json → Postgres
python main.py load-academic-years         # (4b) upsert academic_years.json → Postgres

python main.py --log-level DEBUG <cmd>     # verbose logging on any command
```

## ASSIST API cheat sheet

Base: `https://assist.org/api`. All GETs.

| Endpoint | Purpose | Response shape |
|---|---|---|
| `GET /institutions` | All schools | `[ {id, code, names[], category, isCommunityCollege, ...} ]` |
| `GET /AcademicYears` | All years | `[ {id, fallYear} ]` |
| `GET /agreements?receivingInstitutionId=&sendingInstitutionId=&academicYearId=&categoryCode=major` | Majors with agreements between two schools | `{reports: [{label, key, ownerInstitutionId}]}` |
| `GET /articulation/Agreements?Key={key}` | Full articulation | `{result: {...}}` where several fields are **string-encoded JSON** that must be `json.loads`'d individually — `assist_client.fetch_articulation` handles this. |

**Auth**: no login. But every request needs an XSRF cookie pair (`XSRF-TOKEN` + `X-XSRF-TOKEN` header). Hit `https://assist.org/` first; the header value comes from the `X-XSRF-TOKEN` cookie. `bootstrap_session` does this. Tokens expire — `_get_json` retries once on 400/401 after refreshing.

**Rate limit**: 1 req/sec is hardcoded in `_get_json`'s `time.sleep(1.0)`. DO NOT lower. ASSIST rate-limits aggressively; getting 429'd invalidates the session.

**Articulation key format**: `{yearId}/{sendingId}/to/{receivingId}/Major/{guid}` (e.g. `76/62/to/117/Major/e64bd521-...`). The slashes are literal — `fetch_articulation` builds the URL by hand instead of using `requests`' params dict, because requests would URL-encode them.

## Data shapes (so you don't have to open files)

**`metadata/institutions.json`** — array of ~180 objects:

```jsonc
{
  "id": 117,
  "names": [
    {"name": "University of California, Los Angeles", "hideInList": false},
    {"name": "...", "fromYear": 2005, "hideInList": false}   // renames
  ],
  "code": "UCLA    ",                // trailing whitespace — always .strip()
  "isCommunityCollege": false,
  "category": 1                      // 0=CSU, 1=UC, 2=CCC, else=private
}
```

Name selection = `max(names, key=lambda n: n.get("fromYear", -1))` (present-day name).

**`metadata/academic_years.json`** — tiny:

```jsonc
{"id": 76, "fallYear": 2026}   // → academic year 2026-27
```

**`metadata/agreements_index.json`** — written by `build_agreements_index`. Grouped by matched filter:

```jsonc
{
  "generated_at": "...",
  "academic_year": {"id": 76, "label": "2026-27"},
  "sending_institutions": [{id, code, name}, ...],
  "receiving_institutions": [...],
  "by_filter": {
    "electrical engineering": [
      {"label": "Electrical Engineering, B.S.", "key": "76/...", "sending": {...}, "receiving": {...}}
    ]
  },
  "pairs_with_errors": []
}
```

**`raw/*.json`** — full articulation. Key nested path for parsing:

```
result.articulations[].articulation
  .type == "Course"                             // else it's a GE block; skip or dump
  .course = {prefix, courseNumber, courseTitle, minUnits}
  .sendingArticulation
    .noArticulationReason                       // if present, no equivalent exists
    .items[]                                    // OR groups (courseConjunction on 2nd+)
      .items[]                                  // AND-joined courses within a group
```

## Supabase / DB

**Connection** via `.env.local` (gitignored, see [.gitignore](.gitignore)). Two accepted forms — `db.get_connection` checks in order:

```
# Preferred: individual parts (raw password, no URL encoding).
DB_HOST=aws-0-<region>.pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres.<project-ref>          # NOTE: postgres + DOT + project-ref for pooler
DB_PASSWORD=<raw password>

# Or: URL (password must be URL-encoded — `?`, `@`, `#`, `!` all break it if raw)
DATABASE_URL=postgresql://user:URL_ENCODED_PASS@host:port/db
```

**Always use Session pooler.** Direct and Transaction poolers default to IPv6 → most networks (incl. Diego's) get DNS resolution failures. Session pooler is IPv4 and behaves like a real Postgres session. `db.get_connection` sets `prepare_threshold=None` so the same code works with any pooler mode.

**Tables live in Supabase** (created via the dashboard). SQL in [sql/](sql/) is reference only, not run by the app.

### Current tables

```sql
-- sql/001_institutions.sql — 181 rows currently loaded
institutions (
  id           INT PRIMARY KEY,   -- ASSIST id, stable
  code         TEXT NOT NULL,     -- NOT unique (see gotchas)
  name         TEXT NOT NULL,     -- present-day name
  category     TEXT NOT NULL,     -- "CCC" | "UC" | "CSU" | "private"
  is_community BOOLEAN NOT NULL
)

-- sql/002_academic_years.sql — 79 rows currently loaded
academic_years (
  id         INT PRIMARY KEY,     -- ASSIST id
  from_year  INT,                 -- ASSIST fallYear
  to_year    INT                  -- fallYear + 1
)
```

### Not yet built

- `agreements` table + loader for `metadata/agreements_index.json`.
- `articulations` table (jsonb column for the raw payload) + loader for `raw/*.json`.
- Query helpers / API layer for the frontend.

## Gotchas (already bit us — don't repeat)

- **`institutions.code` is NOT unique.** `COMPTON` (id=34, id=153) and `SU` (Simpson U id=228, Stanton U id=233) share codes. Never add a `UNIQUE` constraint on `code`.
- **`code` has trailing whitespace** in the source JSON (`"UCSD    "`). Always `.strip()`.
- **Category is derived, not stored raw.** `0→CSU, 1→UC, 2→CCC, anything else → "private"`. Handled in `db_institutions._category`.
- **Institution name renames**: use the entry with the highest `fromYear` (e.g. id=21 → "CSU East Bay", not "CSU Hayward"). Handled in `db_institutions._current_name`.
- **`fetch_articulation` builds the URL by hand.** If you switch it to `params=`, requests URL-encodes the `/` in the key and the API 404s.
- **`from __future__ import annotations`** in any module using `X | None` — the local venv is Python 3.9 which doesn't support PEP 604 union syntax at runtime.
- **XSRF cookies are two names**, only one goes in the header (`X-XSRF-TOKEN`). Homepage GET sets both.
- **DB password**: if using `DATABASE_URL`, URL-encode `? @ # ! / :` etc. Or use `DB_PASSWORD` (raw). Diego's password contains `?` and `@`.
- **`urllib3` NotOpenSSLWarning** on macOS is harmless (LibreSSL vs OpenSSL). Silence with `pip install "urllib3<2"` if it bothers you.

## Conventions

- One concern per module, one named logger (`assist.<x>`).
- Loaders use `INSERT ... ON CONFLICT (id) DO UPDATE`.
- Type hints yes; comments only for non-obvious *why*.
- Reference SQL lives in `sql/`; tables managed in Supabase dashboard.
- Lazy-import DB modules inside CLI subcommand functions so ASSIST-only commands work without `psycopg` installed.

## MVP scope

Defined in [mvp_config.py](mvp_config.py). **Note:** this file is often edited during dev to test a subset (e.g. just Mt. SAC → UCSD, EE only). The full roster is:

- **Sending (6 CCs):** Mt. SAC (62), Rio Hondo (64), Pasadena (49), De Anza (113), Santa Monica (137), Fullerton (134).
- **Receiving (13):** all 9 UCs — Berkeley (79), Davis (89), Irvine (120), UCLA (117), Merced (144), Riverside (46), San Diego (7), Santa Barbara (128), Santa Cruz (132) — plus Cal Poly Pomona (75), CSU Fullerton (129), CSU Long Beach (81), Cal Poly SLO (11).
- **Majors (12):** electrical/computer/civil/mechanical/chemical/aerospace engineering, computer science, data science, physics, mathematics, bioengineering, materials science.
- **Year:** `MVP_YEAR_ID=76` → 2026-27.

## Repo state

- Git: `main` branch. `assistTest.py` and `JsonFormat.py` are deleted (in git history if you need them back).
- `.gitignore` covers `.env*`, `__pycache__/`, `.venv/`, `.DS_Store`, editor dirs.
- Cached raw files live in `raw/` (not committed).
- `test.py` at repo root is a user scratch file — not tracked, leave alone.
