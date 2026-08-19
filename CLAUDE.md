# NextStop

California community-college → 4-year transfer planner. Python pipeline scrapes [ASSIST.org](https://assist.org) into Supabase Postgres; a Next.js web app queries it via server-side RPCs.

**Rename note:** the project was originally `JucoProduct` (folder + branding); renamed to `NextStop` on 2026-08-17. Filesystem parent was moved by the user (`Downloads/JucoProduct/` → `Downloads/NextStop/`); a stub `Downloads/JucoProduct/` still lives on disk with only `mvp_config.py` and an empty `sql/` — safe to delete. `git remote` may still point at a repo named JucoProduct — GitHub-side rename is a separate step.

**Stack:** Python 3.9 (in `.venv/`), `requests` + `psycopg[binary]` + `python-dotenv`, Supabase Postgres, Next.js 16 (App Router) + Tailwind 4 + `@supabase/ssr` in `web/`.

## Directory layout

```
NextStop/
├── *.py                 Python data pipeline (ASSIST → JSON → Postgres)
├── metadata/            JSON output of stages 1–2 (institutions, years, index)
├── raw/                 Cached articulation JSONs, one per agreement (gitignored)
├── sql/                 Reference DDL + one-off query files (applied via Supabase SQL editor)
│   ├── 001_institutions.sql        (181 rows loaded)
│   ├── 002_academic_years.sql      (79 rows loaded)
│   ├── 003_articulations.sql       (agreements + articulation tree + reverse-lookup view)
│   ├── 004_student_side.sql        (profiles + schedules + RLS + auth trigger)
│   ├── 005_requirement_engine.sql  (5 PL/pgSQL functions)
│   └── queries/                    Editable parameterized queries (paste + run)
├── design/              Design canvas mockup — see § Design mockup
├── web/                 Next.js web app — see web/CLAUDE.md for details
├── mvp_config.py        Roster constants (schools, majors, year) — keep in sync with web/src/lib/mvp.ts
├── main.py              Argparse CLI entry point
└── .env.local           DB credentials + (soon) Supabase URL/keys (gitignored)
```

## Pipeline

```
ASSIST.org  ──►  metadata/*.json  ──►  raw/*.json  ──►  Supabase Postgres
              (1) refresh          (3) scrape       (4) load-*
                                  ▲
              (2) build-index ────┘
```

Every stage is idempotent — no state files, "does the output already exist" is the check. Loaders use `INSERT ... ON CONFLICT (id) DO UPDATE`; the articulation loader uses SHA-256 content hashes to skip unchanged files.

## Python file map

Every module has one concern and one named logger (`assist.<name>`). Errors self-identify the layer.

| File | Logger | Concern |
|---|---|---|
| [assist_client.py](assist_client.py) | `assist.client` | ASSIST HTTP: XSRF pair, **1 req/sec hardcoded**, JSON decode. No filesystem. |
| [metadata_store.py](metadata_store.py) | `assist.metadata` | Read/write `metadata/institutions.json` & `academic_years.json`. |
| [agreements_index.py](agreements_index.py) | `assist.index` | Build `metadata/agreements_index.json` (list only, no articulation bodies). |
| [articulation_cache.py](articulation_cache.py) | `assist.cache` | Fetch full articulation JSONs into `raw/{SEND}_to_{RECV}_{year}_{safe_key}.json`. |
| [articulation_format.py](articulation_format.py) | `assist.format` | Pretty-print one cached articulation. |
| [db.py](db.py) | `assist.db` | Postgres connection helper. Loads `.env.local` then `.env`. |
| [db_institutions.py](db_institutions.py) | `assist.db.institutions` | Upsert `institutions.json` → `institutions`. |
| [db_academic_years.py](db_academic_years.py) | `assist.db.academic_years` | Upsert `academic_years.json` → `academic_years`. |
| [db_articulations.py](db_articulations.py) | `assist.db.articulations` | Walk `raw/*.json` → agreements + template + articulation tree + courses. SHA-256 dedup. Refreshes materialized view after load. |
| [mvp_config.py](mvp_config.py) | — | MVP roster constants. |
| [logging_setup.py](logging_setup.py) | — | `configure_logging(level)`. |
| [main.py](main.py) | `assist.main` | Argparse CLI. Every subcommand lazy-imports DB modules so ASSIST commands work without `psycopg`. |

## CLI

```bash
python main.py refresh-metadata            # (1) fetch institutions + academic_years JSON
python main.py build-index                 # (2) build agreements_index.json for MVP roster
python main.py scrape --sending 62 --receiving 117 [--year 76] [--majors "cs,ee"]
python main.py show raw/<file>.json        # print human-readable articulation
python main.py load-institutions           # (4a) upsert institutions.json → Postgres
python main.py load-academic-years         # (4b) upsert academic_years.json → Postgres
python main.py load-articulations [--no-refresh]  # (4c) upsert every raw/*.json → Postgres

python main.py --log-level DEBUG <cmd>     # verbose logging on any command
```

## Data state (2026-08-18)

- **Institutions:** 181 rows loaded (full catalog).
- **Academic years:** 79 rows loaded.
- **Agreements:** 12 loaded — **Mt. SAC (62) → UCSD (7) + UCLA (117) only**. Full MVP target is ~900 (6 CCs × 13 receiving × ~12 majors). Everything else needs `python main.py scrape ...` runs (a few hours at 1 req/sec).
- **Courses:** 108 deduped rows across sending + receiving sides.
- **`institutions.term_type`:** only 3 populated (Mt. SAC, UCSD, UCLA) because that's who appears in loaded raw JSONs. Fills in as scrape widens.
- **Reverse-lookup view:** `course_articulates_to` (270 rows) — refreshed by the articulation loader.

## SQL / DB (Supabase)

**Connection** via `.env.local` — checked in this order by `db.get_connection()`:

```
# Preferred: individual parts (raw password, no URL encoding).
DB_HOST=aws-0-<region>.pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres.<project-ref>          # postgres + DOT + project-ref for pooler
DB_PASSWORD=<raw password>

# Alt: URL (password must be URL-encoded — `?`, `@`, `#`, `!`, `/`, `:` all need it)
DATABASE_URL=postgresql://user:URL_ENCODED_PASS@host:port/db
```

**Always use Session pooler.** Direct + Transaction default to IPv6 → most networks (incl. Diego's) get DNS failures. Session pooler is IPv4 and behaves like a real Postgres session. `db.get_connection` sets `prepare_threshold=None` so the same code works with any pooler mode.

**Tables are managed in the Supabase dashboard** (created by pasting the `sql/*.sql` files into the SQL editor, in numeric order). The `sql/` files are the source of truth for schema, not the DB — if you make a schema change in the dashboard, update the file too. **All ASSIST tables have RLS enabled with public-read policies**; student-side tables are per-user private via `auth.uid()`.

### Schema summary (see individual files for full DDL)

- **001** `institutions` (id PK, code NOT unique — see gotchas, name, category enum, is_community, term_type)
- **002** `academic_years` (id PK, from_year, to_year)
- **003** the articulation tree (see § Articulation shape below)
- **004** `profiles`, `schedules`, `schedule_courses`, `saved_agreements` + RLS + `handle_new_user()` trigger on `auth.users`
- **005** requirement engine — 5 PL/pgSQL functions (see § Requirement engine)

### Articulation shape (from 003)

The receiving-side major sheet layout and the sending-side (CC) requirements are two parallel trees, joined by `template_cell_id` GUID:

```
agreements
├── template_sections → template_cells                  (receiving-side layout)
└── articulation_entries (joined to cells by GUID)
    ├── articulation_entry_receiving_courses            (N receiving courses per entry — Series support)
    ├── sending_groups                                  (OR-branches)
    │   └── sending_group_courses                       (AND-joined courses within a group)
    └── denied_courses                                  (used to articulate; no longer)
```

Plus `agreements.raw_json JSONB` preserves the full ASSIST payload (source of truth for re-parses).

### Requirement engine (005)

Five functions, all `STABLE`, `SECURITY INVOKER` (so RLS gates access):

| Function | Purpose |
|---|---|
| `is_entry_satisfied(entry_id, course_ids[])` | Boolean: does the course set satisfy one requirement? Walks sending_groups + folds via `group_conjunction`. |
| `check_agreement_for_courses(course_ids[], agreement_id)` | Per-requirement table for one agreement. **Public-safe.** |
| `check_agreement_for_schedule(schedule_id, agreement_id)` | Same, but reads courses from an owned schedule. RLS-gated. |
| `rank_agreements_for_courses(course_ids[], receiving_ids[]?, year_id?, category?, limit?)` | **Headline query** — rank majors by fraction-of-requirements-satisfied. Public-safe. |
| `rank_agreements_for_schedule(schedule_id, ...)` | Same, RLS-gated. |

Both `*_for_courses` variants power public-browse (no auth needed); `*_for_schedule` variants power signed-in flows. See file bottom for when to migrate this out of PL/pgSQL (n-of-m rules, IGETC overlays, etc.).

### `sql/queries/`

Ad-hoc parameterized queries. Paste into Supabase SQL editor, edit the `WITH params AS (...)` block at the top, run. Currently:

- `articulates_to.sql` — "what does this CC course transfer to?" (uses `course_articulates_to` materialized view)

## Design mockup

Published Artifact: **https://claude.ai/code/artifact/41b8188f-8558-41c9-b6ff-3c98251c57bf**

Four artboards laid out left-to-right on one canvas: Landing → Schedule → Matching majors → Major detail. Working files in [design/](design/):

- `Main.dc.html` (Landing), `Schedule.dc.html`, `Dashboard.dc.html`, `Detail.dc.html`
- `canvas.json` (layout + launch view)
- `nextstop-mockup.html` (seeded artifact — do not hand-edit; re-seed with the helper)

To update the mockup: edit the `.dc.html` files, then:

```bash
cd design && node "<design-skill-base>/seed-canvas.mjs" \
  --template "<design-skill-base>/payload.template.html" \
  --out nextstop-mockup.html --title "NextStop — Transfer Planner Mockup" \
  --artboard Main.dc.html --artboard Schedule.dc.html \
  --artboard Dashboard.dc.html --artboard Detail.dc.html \
  --canvas canvas.json
```

Then republish via the Artifact tool with `url=` set to the URL above (keeps the same URL). Alternatively, edits made in the visual canvas editor + Save persist without re-seeding.

## Web app

Next.js 16 + Supabase in [web/](web/). See [web/CLAUDE.md](web/CLAUDE.md) for the file map, wiring state, and next building moves. Run with `cd web && npm run dev` → http://localhost:3000.

## ASSIST API cheat sheet

Base: `https://assist.org/api`. All GETs.

| Endpoint | Purpose | Response shape |
|---|---|---|
| `GET /institutions` | All schools | `[ {id, code, names[], category, isCommunityCollege, ...} ]` |
| `GET /AcademicYears` | All years | `[ {id, fallYear} ]` |
| `GET /agreements?receivingInstitutionId=&sendingInstitutionId=&academicYearId=&categoryCode=major` | Majors between two schools | `{reports: [{label, key, ownerInstitutionId}]}` |
| `GET /articulation/Agreements?Key={key}` | Full articulation | `{result: {...}}` — several fields are **string-encoded JSON** decoded individually by `assist_client.fetch_articulation`. |

**Auth:** no login, but every request needs an XSRF cookie pair (`XSRF-TOKEN` + `X-XSRF-TOKEN` header). Hit `https://assist.org/` first; `bootstrap_session` handles this. Tokens expire — `_get_json` retries once on 400/401 after refreshing.

**Rate limit:** 1 req/sec hardcoded in `_get_json`'s `time.sleep(1.0)`. **DO NOT lower.** ASSIST rate-limits aggressively; getting 429'd invalidates the session.

**Articulation key format:** `{yearId}/{sendingId}/to/{receivingId}/Major/{guid}`. Slashes are literal — `fetch_articulation` builds the URL by hand instead of using `requests`' `params=`, which would URL-encode them and 404.

## Gotchas (already bit us — don't repeat)

- **`institutions.code` is NOT unique.** `COMPTON` (id=34, id=153) and `SU` (Simpson U id=228, Stanton U id=233) share codes. Never add a `UNIQUE` constraint on `code`.
- **`code` has trailing whitespace** in the source JSON (`"UCSD    "`). Always `.strip()`.
- **Category is derived from int**, not stored raw: `0→CSU, 1→UC, 2→CCC, else→"private"`. Handled in `db_institutions._category`.
- **Institution name renames**: use entry with highest `fromYear` (e.g. id=21 → "CSU East Bay", not "CSU Hayward"). Handled in `db_institutions._current_name`.
- **`fetch_articulation` builds URLs by hand.** Switching to `params=` URL-encodes the `/` in the key → API 404s.
- **`from __future__ import annotations`** in any module using `X | None` — venv is Python 3.9, no PEP 604 union at runtime.
- **XSRF cookies are two names**, only one goes in the header (`X-XSRF-TOKEN`). Homepage GET sets both.
- **DB password**: URL-encode `? @ # ! / :` if using `DATABASE_URL`. Or use `DB_PASSWORD` (raw). Diego's password contains `?` and `@`.
- **`urllib3` NotOpenSSLWarning** on macOS is harmless (LibreSSL vs OpenSSL). Silence with `pip install "urllib3<2"`.
- **`catalogYear` in raw JSON is an object**, not a string. `db_articulations._catalog_year_display()` collapses it to `"2025-2026"` for the TEXT column; full structure stays in `raw_json`.
- **`articulation_entries.template_cell_id` FK has no CASCADE.** The articulation loader wipes children in explicit dependency order (`_WIPE_SQL` in `db_articulations.py`).
- **Series receiving-side conjunctions are all "And"** in current data — the requirement engine's left-to-right group evaluation is safe today but assumes AND-heavy trees. Revisit if we ever load an agreement with mixed AND/OR at the group level.
- **Requirement-type entries have no linked courses.** They're prose ("English composition courses"). The web UI splits them into a "Verify with counselor" info block; the ranker excludes them from satisfied/unsatisfied counts.

## Conventions

- One concern per module, one named logger.
- Loaders use `INSERT ... ON CONFLICT (id) DO UPDATE`.
- Type hints yes; comments only for non-obvious *why*.
- SQL files are the source of truth for schema — update them alongside any dashboard-side change.
- Lazy-import DB modules inside CLI subcommand functions so ASSIST-only commands work without `psycopg`.
- MVP roster lives in `mvp_config.py` (Python) and `web/src/lib/mvp.ts` (TS) — keep them in sync manually.

## MVP scope (from mvp_config.py)

- **Sending (6 CCs):** Mt. SAC (62), Rio Hondo (64), Pasadena (49), De Anza (113), Santa Monica (137), Fullerton (134).
- **Receiving (13):** all 9 UCs — Berkeley (79), Davis (89), Irvine (120), UCLA (117), Merced (144), Riverside (46), San Diego (7), Santa Barbara (128), Santa Cruz (132) — plus Cal Poly Pomona (75), CSU Fullerton (129), CSU Long Beach (81), Cal Poly SLO (11).
- **Majors (12):** electrical / computer / civil / mechanical / chemical / aerospace engineering, computer science, data science, physics, mathematics, bioengineering, materials science.
- **Year:** `MVP_YEAR_ID=76` → 2026-27.

## What's done vs what's next

**Current status (2026-08-19):** MVP web app is **deployed live on Vercel** and browsable end-to-end signed-out — landing, the `/majors` umbrella-major picker → schools ranked against your coursework, the requirement checklist, and the localStorage-backed schedule editor all work. Every push to `main` auto-deploys to the same production URL. Blocking gaps: Google OAuth dashboard config (so sign-in/save works on the live site), the wider ASSIST scrape (~12 of ~900 agreements loaded), and star-to-save. _Future sessions: keep this line and the lists below current — this is the living status of the project._

**Done:**
- Full data pipeline (Python) with 4 loaders + CLI
- Full DB schema with RLS + auth trigger + requirement engine
- 12 agreements loaded end-to-end (Mt. SAC → UCSD/UCLA)
- Design mockup published as Artifact
- Next.js web app: Google OAuth wiring (needs Dashboard config), landing, requirement checklist, and the interactive schedule editor (localStorage-backed, works signed out)
- `/majors` two-step flow: pick an umbrella major (Computer Science / Electrical Engineering / Computer Engineering) → receiving schools ranked against your coursework. Umbrella buckets are hardcoded keyword filters in `web/src/app/majors/page.tsx` (`MAJOR_CATEGORIES`); see [web/CLAUDE.md](web/CLAUDE.md).
- **Deployed to Vercel** — root directory set to `web/`, the two `NEXT_PUBLIC_SUPABASE_*` env vars set in the Vercel dashboard, auto-deploy on push to `main`.
- **Refinement pass** (thermo-nuclear + architecture review): extracted `web/src/lib/requirements/classify.ts` (the satisfied/unsatisfied/notes + completion-% rule), `web/src/lib/courses/params.ts` (the `?courses=` URL codec), and `web/src/components/ui/QueryError.tsx` + `--danger`/`--danger-soft` tokens (replacing a hardcoded `#fee` that broke dark mode). Behavior-preserving; `tsc`, `eslint`, and `next build` all pass.

**Immediate next steps (in order):**
1. **Google OAuth config** — now the top gap: the live Vercel site can browse but can't sign in / save until this is done. ~10 min in Google Cloud Console + Supabase Dashboard; also add the production redirect URL `https://<vercel-domain>/auth/callback` to Supabase → Authentication → URL Configuration. Steps in [web/README.md](web/README.md).
2. **Scrape the rest** — background run, ~a few hours at 1 req/sec, gets to ~900 agreements. Run `python main.py scrape --sending <id> --receiving <id>` for each CC × 4-year pair, then `python main.py load-articulations`.
3. **Star-to-save on major detail** — the last remaining mutation flow (`saved_agreements` insert/delete); lets `/saved` graduate from a stub. The schedule editor and `/majors` flow are already wired.

**Deferred future work:**
- Major-requirement + gen-ed scrape (separate ASSIST endpoints — not yet implemented).
- Migration to backend requirement engine when we add n-of-m rules or IGETC overlays (SQL is fine for MVP; noted at the bottom of 005).
- Backfill `institutions.term_type` from the full metadata JSON (currently only 3 populated).

## Repo state

- Git: `main` branch. Recent commits: `3ec7f7c web: extract requirement-classification, ?courses= codec, QueryError`, `eb9f4d7 Add /majors umbrella flow, schedule editor, and pipeline updates`.
- **GitHub repo renamed** `JucoProduct` → `NextStop` (server-side): https://github.com/diegorosales06/NextStop. The old `origin` URL still redirects; run `git remote set-url origin https://github.com/diegorosales06/NextStop.git` to silence the "repository moved" notice.
- **Deployment:** live on Vercel, root directory `web/`, auto-deploys on every push to `main` (production URL is a stable alias — updates don't change the link). The two `NEXT_PUBLIC_SUPABASE_*` values are set in the Vercel dashboard, not committed (`.env.local` is gitignored).
- `.gitignore` covers `.env*`, `__pycache__/`, `.venv/`, `.DS_Store`, editor dirs, `raw/`, `web/node_modules/`, `web/.next/`.
- `test.py` at repo root is Diego's scratch file — not tracked, leave alone.
- **Vestigial:** `Downloads/JucoProduct/` (pre-rename stub) and `NextStop/JucoProduct/` (nested subfolder from an earlier scaffold) — both safe to delete on request.
