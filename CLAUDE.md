# JucoProduct

A California community-college → 4-year transfer planner. Scrapes [ASSIST.org](https://assist.org)
articulation agreements and loads them into Supabase Postgres for querying.

## Data pipeline

Four stages, run in order:

```
ASSIST.org  ──►  metadata/*.json  ──►  raw/*.json  ──►  Supabase Postgres
              (1) refresh          (3) scrape       (4) load-*
                                  ▲
              (2) build-index ────┘
```

1. **Refresh metadata** — pull the small reference tables (all institutions, all academic years).
2. **Build agreements index** — for a roster of `(sending, receiving, year)` pairs, list which majors have published agreements. No full articulation payloads yet.
3. **Scrape articulations** — for a chosen pair, fetch and cache the full articulation JSON per major.
4. **Load into Postgres** — upsert `metadata/*.json` (and, later, the scraped articulations) into Supabase tables.

Every step is resumable / re-runnable and skips work that's already done.

## Module layout

Each module owns one concern and uses a named logger so an error line self-identifies which layer produced it. Look for `[HH:MM:SS] LEVEL assist.<name>: message`.

| File | Logger | Responsibility |
|---|---|---|
| [assist_client.py](assist_client.py) | `assist.client` | ASSIST HTTP client — XSRF token pair, 1 req/sec rate limit, JSON decoding. No filesystem. |
| [metadata_store.py](metadata_store.py) | `assist.metadata` | Read/write `metadata/institutions.json` and `metadata/academic_years.json`. |
| [agreements_index.py](agreements_index.py) | `assist.index` | Build `metadata/agreements_index.json` (agreement list only, no full articulations). |
| [articulation_cache.py](articulation_cache.py) | `assist.cache` | Fetch and cache full articulation JSONs into `raw/`. |
| [articulation_format.py](articulation_format.py) | `assist.format` | Load and pretty-print one cached articulation. |
| [db.py](db.py) | `assist.db` | Postgres connection helper (Supabase). |
| [db_institutions.py](db_institutions.py) | `assist.db.institutions` | Upsert `institutions.json` → `institutions` table. |
| [db_academic_years.py](db_academic_years.py) | `assist.db.academic_years` | Upsert `academic_years.json` → `academic_years` table. |
| [mvp_config.py](mvp_config.py) | — | MVP roster constants (which schools, majors, year to scrape). |
| [logging_setup.py](logging_setup.py) | — | Single-call logging format setup. |
| [main.py](main.py) | `assist.main` | Argparse CLI (see below). |
| [sql/*.sql](sql/) | — | Reference DDL for each table (schema lives with the code). |

## CLI

```bash
python main.py refresh-metadata            # (1) fetch institutions + academic_years JSON
python main.py build-index                 # (2) build agreements_index.json for MVP roster
python main.py scrape --sending 62 --receiving 117   # (3) cache full articulations for one pair
python main.py show raw/<file>.json        # print human-readable summary of one articulation
python main.py load-institutions           # (4a) upsert institutions.json → Postgres
python main.py load-academic-years         # (4b) upsert academic_years.json → Postgres
```

`--log-level DEBUG` on any command turns on verbose logging.

## Database (Supabase Postgres)

Connection is configured via `.env.local` (gitignored). Two accepted forms:

```
# Option A — URL (password must be URL-encoded)
DATABASE_URL=postgresql://user:URL_ENCODED_PASS@host:port/db

# Option B — individual parts (raw password, no encoding needed)
DB_HOST=aws-0-<region>.pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres.<project-ref>
DB_PASSWORD=<raw password>
```

**Use Session pooler**, not direct or transaction pooler — direct/transaction default to IPv6 on Supabase and most networks can't reach it. Session pooler is IPv4 and behaves like a real Postgres session (prepared statements, per-session state).

`db.get_connection()` sets `prepare_threshold=None` so the code works with either pooler mode without change.

### Table schemas

Live in [sql/](sql/) as reference (the tables were created in Supabase directly). Key facts:

- `institutions.id` is stable; `institutions.code` is NOT unique (mergers leave two rows sharing a code — e.g. `COMPTON`, `SU`). Don't put a UNIQUE constraint on `code`.
- Category derivation: ASSIST `category` int → `0=CSU`, `1=UC`, `2=CCC`, anything else → `"private"`.
- Name selection for institutions with renames: pick the entry with the highest `fromYear` (most recent name).

## Conventions

- **One concern per module, one named logger per module.** Error lines carry `assist.<name>` so the layer is obvious from any traceback.
- **Loaders are idempotent** — all use `INSERT ... ON CONFLICT (id) DO UPDATE`.
- **Rate limit is 1 req/sec** in `assist_client._get_json` — do NOT lower it; ASSIST rate-limits aggressively.
- **`from __future__ import annotations`** in any module that uses `X | None` type syntax — the local venv is Python 3.9.
- Type hints throughout, minimal comments (only for non-obvious *why*).
- Reference SQL lives in `sql/`; the tables themselves are managed in the Supabase dashboard.

## MVP scope

Defined in [mvp_config.py](mvp_config.py):

- **Sending (community colleges):** Mt. SAC, Rio Hondo, Pasadena, De Anza, Santa Monica, Fullerton.
- **Receiving (4-year):** all 9 UCs + Cal Poly Pomona, CSU Fullerton, CSU Long Beach, Cal Poly SLO.
- **Majors (12):** EE, CE, CS, DS, Physics, Math, ME, ChemE, Civil, Bioengineering, Aerospace, Materials Science.
- **Year:** 2026-27 (ASSIST `academicYearId=76`).

## Not yet done

- `agreements` table + loader for `metadata/agreements_index.json`.
- `articulations` table (jsonb column) + loader for `raw/*.json`.
- Query helpers / API layer for the frontend.
