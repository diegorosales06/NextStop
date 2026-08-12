# ASSIST.org Scraping & Transfer-Planning Webapp — Reference Guide

**Purpose:** everything needed to reproduce the scraping pipeline for California
articulation data from assist.org, model it into a database, and build a
transfer-planning webapp on top. Written as of August 2026 against the current
(undocumented) assist.org API surface.

---

## 1. Project Context

**Goal:** Build a transfer-planning webapp for California community-college
students by scraping ASSIST.org, normalizing the articulation data into a
database, and exposing it via a webapp with features ASSIST itself doesn't
offer (reverse search, cross-CCC comparison, etc.).

**Background on the data:** ASSIST is California's official system of record
for articulation agreements between the 116 community colleges and the 9 UCs
+ 23 CSUs. Every year, each pair of (sending CCC, receiving UC/CSU, major)
gets an agreement stating which CCC courses satisfy which UC/CSU lower-div
requirements. It's the source of truth for transfer planning.

---

## 2. Ethical / Legal Considerations — READ FIRST

- **ASSIST publicly stated** in their Winter 2025 newsletter that they had to
  delay the launch of their sanctioned data-sharing API because "excessive
  and unauthorized data scraping" caused "system speed and performance
  issues." That directly harmed the ~2M annual visitors (mostly transfer
  students).
- Do not repeat that. If you scrape:
  - **1 request/second maximum.** Ever.
  - **Off-peak only** (2–6 AM Pacific).
  - **Cache aggressively.** Past academic years never change — scrape once,
    never re-hit.
  - **Identify yourself** in your User-Agent with a contactable email.
  - **Have a kill switch.** If they email you, stop immediately.
- **Right first move:** email `help@assist.org` and ask for sanctioned data
  extract access. They actively invite these requests. Frame it as "student
  building a free transfer-planning tool." Do this *after* you have a working
  MVP so you can point at real users.
- **Legally gray:** the endpoints are unauthenticated public HTTP, and the
  data is state-funded public info, but the ToS likely prohibits automated
  access. hiQ v. LinkedIn is favorable but not definitive.

---

## 3. Known IDs (verified 2026-08-11)

These are stable across API calls — hardcode them.

| Entity                | ID  | Notes                                    |
|-----------------------|-----|------------------------------------------|
| UC San Diego (UCSD)   | 7   | Receiving institution                    |
| Mt. San Antonio College | 62  | Sending institution                    |
| Academic year 2026-27 | 76  | Year IDs = calendar year − 1950          |
| Academic year 2025-26 | 75  |                                          |

To find any other institution ID, query `/api/institutions` (see Section 5).

---

## 4. Two Critical Gotchas

These broke every early attempt. Understand them before writing code.

### 4a. The XSRF Token Pair

The server is ASP.NET Core with anti-CSRF protection. On any GET to
`assist.org/`, it sets **two** cookies:

- `XSRF-TOKEN` — one value
- `X-XSRF-TOKEN` — a **different** value

Every API call to `/api/*` requires:

1. Both cookies present in the request.
2. An `X-XSRF-TOKEN` **request header** whose value equals the
   `X-XSRF-TOKEN` **cookie** value (not the `XSRF-TOKEN` cookie — that trip
   cost hours of debugging).

Without the header, you get `{"title":"Bad Request","code":400}` with no
explanation.

**Solution:** use a `requests.Session`, warm it up against the homepage to
receive both cookies, then copy `X-XSRF-TOKEN` cookie value into a session
header of the same name.

### 4b. Nested JSON-Encoded Strings

The API returns JSON, but the meaningful fields inside `result` are
**stringified JSON**, not nested objects. You have to `json.loads()` them
a second time.

Example: `result["articulations"]` is a `str` of ~36k chars containing
`"[{\"templateCellId\":...}, ...]"`. Applying `json.loads()` to it yields
the actual list of articulation objects.

Fields known to be double-encoded:
- `receivingInstitution`
- `sendingInstitution`
- `academicYear`
- `templateAssets`
- `articulations`
- `catalogYear`

Fields that are plain strings (no double-encode):
- `name`
- `type`
- `publishDate`

**Solution:** after parsing the outer JSON, iterate `result.items()` and
`json.loads()` any string field that starts with `{` or `[`.

---

## 5. API Endpoints

All under `https://assist.org/api/`. All GET requests. All require the XSRF
setup from Section 4a.

### `/institutions`
Returns list of every institution (CCC + UC + CSU) with IDs, codes, names.
Fetch once, cache forever.

### `/AcademicYears`
Returns list of academic years with IDs. Year ID = calendar year − 1950.
Fetch once, cache forever.

### `/agreements?receivingInstitutionId={R}&sendingInstitutionId={S}&academicYearId={Y}&categoryCode={C}`
Returns list of majors (or departments, or GE areas) that have an agreement
between sending institution S and receiving institution R for year Y.

- `categoryCode`: `"major"` (most common), `"dept"`, `"ge"`
- Response shape: `{"reports": [{"label": "...", "key": "...", "ownerInstitutionId": R}, ...]}`
- The `key` is what you pass to the articulation endpoint.

### `/articulation/Agreements?Key={key}`
The big one. Returns the full articulation between two schools for one
major/dept.

- **`key` must have literal slashes** — do not URL-encode them. Do not pass
  via `requests.params={"Key": ...}` because that will `%2F`-encode. Build
  the URL string manually.
- Example key: `76/62/to/7/Major/b81f6aed-b374-4292-f2f6-08ddd3b241a4`
  meaning: year 76, sender 62, "to", receiver 7, category "Major", GUID.
- Response shape (outer): `{"result": {...}, "validationFailure": null, "isSuccessful": true}`
- Response shape (`result` after unwrapping the string-encoded fields, see
  Section 4b): see Section 6.

### SPA-only endpoints (probably not needed)
The SPA also hits `/appsettings`, `/areaTypes`, `/agreements?asSendingOnly=...`,
`/categories?receivingInstitutionId=...`. None of these are required to get
articulation data. They exist to populate the SPA's dropdowns.

---

## 6. Data Schema (as returned by the API)

### `result` top-level (after unwrapping strings)

```
{
  "name": "ECE: Electrical Engineering B.S.",
  "type": "Major",
  "publishDate": "2026-...",
  "receivingInstitution": { ... },      // UCSD info
  "sendingInstitution": { ... },        // Mt. SAC info
  "academicYear": { ... },
  "catalogYear": { ... },
  "templateAssets": [ ... ],            // Section headers, layout, ungrouped courses
  "articulations": [ ... ]              // THE MEAT — see below
}
```

### One entry in `articulations`

```
{
  "templateCellId": "1bf5b213-...",
  "articulation": {
    "type": "Course",                   // also seen: Series, Requirement,
                                        //   GeneralEducation, Transferability
    "course": {                         // The RECEIVING (UC/CSU) course
      "courseIdentifierParentId": 281890,
      "courseTitle": "Calculus I",
      "courseNumber": "20A",
      "prefix": "MATH",
      "prefixDescription": "Mathematics",
      "minUnits": 4.0,
      "maxUnits": 4.0,
      "begin": "F2000",
      "end": ""
    },
    "visibleCrossListedCourses": [ ... ],  // e.g. honors equivalents
    "courseAttributes": [],
    "sendingArticulation": {            // The SENDING (CCC) courses that satisfy
      "noArticulationReason": null,     //   e.g. "Not Articulated"
      "deniedCourses": [],
      "items": [                        // GROUPS joined by outer OR
        {
          "courseConjunction": "Or",    // ← between-group conjunction
          "items": [                    // ← WITHIN group, joined by AND
            {
              "courseIdentifierParentId": 280590,
              "courseTitle": "...",
              "courseNumber": "180",
              "prefix": "MATH",
              "minUnits": 4.0,
              "maxUnits": 4.0,
              ...
            }
          ]
        }
      ]
    },
    "templateOverrides": [],
    "attributes": [],
    "receivingAttributes": []
  },
  "receivingAttributes": []
}
```

### The conjunction tree (READ CAREFULLY)

The sending side is a two-level tree:

- Outer level: `sendingArticulation.items` — each entry is a **group**. Groups
  are joined by whatever `courseConjunction` says (`"Or"` most common).
- Inner level: within a group, `items` lists courses joined by AND (all
  required together).

Semantic: "receiving course X is satisfied by (group1 courses ALL taken)
OR (group2 courses ALL taken) OR ...".

Example: UCSD's PHYS 2A might be satisfied by:
- Group 1 (Or): Mt. SAC PHYS 4A
- Group 2 (Or): Mt. SAC PHYS 4AH (honors)

Or a compound: UCSD MATH 20A+20B satisfied by:
- Group 1 (Or): Mt. SAC MATH 180 AND MATH 280 (both required)

A flat `receiving_course → sending_course` table CANNOT represent this
correctly. You need to model the tree.

### No-articulation case

```
"sendingArticulation": {
  "noArticulationReason": "This course must be taken at the university.",
  "items": []
}
```

This means the receiving course has no CCC equivalent — the student must
take it after transferring.

---

## 7. Working Scraper (Python)

Dependencies: `pip install requests`

```python
"""
ASSIST.org scraper.
Handles XSRF token pair and nested JSON string decoding.
"""
import json
import time
from pathlib import Path
import requests

BASE = "https://assist.org/api"

HEADERS = {
    "User-Agent": (
        "TransferPlannerBot/0.1 (contact: YOUR_EMAIL@example.com) - "
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://assist.org",
    "Referer": "https://assist.org/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}


def bootstrap_session() -> requests.Session:
    """Return a session with XSRF cookies set and the matching header."""
    s = requests.Session()
    s.headers.update(HEADERS)
    # Homepage sets both XSRF-TOKEN and X-XSRF-TOKEN cookies
    s.get("https://assist.org/", timeout=30)
    # We need the X-XSRF-TOKEN cookie value (NOT XSRF-TOKEN)
    xsrf = s.cookies.get("X-XSRF-TOKEN")
    if not xsrf:
        raise RuntimeError("Failed to obtain X-XSRF-TOKEN cookie")
    s.headers["X-XSRF-TOKEN"] = xsrf
    return s


def polite_get(session: requests.Session, url: str, **params) -> dict:
    """GET with rate limiting. Refreshes XSRF on 400/401."""
    time.sleep(1.0)  # 1 req/sec — DO NOT lower this
    r = session.get(url, params=params, timeout=30)
    if r.status_code in (400, 401):
        # Token may have expired — try refreshing once
        session.get("https://assist.org/", timeout=30)
        xsrf = session.cookies.get("X-XSRF-TOKEN")
        if xsrf:
            session.headers["X-XSRF-TOKEN"] = xsrf
        time.sleep(1.0)
        r = session.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def get_institutions(session):
    return polite_get(session, f"{BASE}/institutions")


def get_academic_years(session):
    return polite_get(session, f"{BASE}/AcademicYears")


def list_agreements(session, receiving_id, sending_id, year_id, category="major"):
    """Return list of {label, key, ownerInstitutionId}."""
    resp = polite_get(
        session,
        f"{BASE}/agreements",
        receivingInstitutionId=receiving_id,
        sendingInstitutionId=sending_id,
        academicYearId=year_id,
        categoryCode=category,
    )
    return resp.get("reports", [])


def fetch_articulation(session, key):
    """
    Fetch an articulation by its key (e.g. '76/62/to/7/Major/{guid}').
    Returns the fully unwrapped result dict (all nested JSON strings decoded).
    """
    # Build URL manually — do NOT let requests URL-encode the slashes
    time.sleep(1.0)
    url = f"{BASE}/articulation/Agreements?Key={key}"
    r = session.get(url, timeout=30)
    if r.status_code in (400, 401):
        session.get("https://assist.org/", timeout=30)
        xsrf = session.cookies.get("X-XSRF-TOKEN")
        if xsrf:
            session.headers["X-XSRF-TOKEN"] = xsrf
        time.sleep(1.0)
        r = session.get(url, timeout=30)
    r.raise_for_status()

    outer = r.json()
    result = outer["result"]

    # Unwrap the string-encoded fields
    for k, v in list(result.items()):
        if isinstance(v, str) and v.strip().startswith(("{", "[")):
            result[k] = json.loads(v)

    return result


def scrape_and_cache(session, receiving_id, sending_id, year_id, cache_dir="raw"):
    """Scrape all majors for a pair, save each articulation as its own file."""
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    agreements = list_agreements(session, receiving_id, sending_id, year_id)
    print(f"{len(agreements)} majors to fetch")

    for i, a in enumerate(agreements):
        key = a["key"]
        safe_name = key.replace("/", "_")
        outfile = cache / f"{safe_name}.json"
        if outfile.exists():
            continue  # never rehit
        print(f"[{i + 1}/{len(agreements)}] {a['label']}")
        try:
            articulation = fetch_articulation(session, key)
        except Exception as e:
            print(f"  FAILED: {e}")
            continue
        outfile.write_text(json.dumps(articulation, indent=2))


if __name__ == "__main__":
    session = bootstrap_session()

    # Example: Mt. SAC (62) -> UCSD (7), 2026-27 (year 76)
    scrape_and_cache(session, receiving_id=7, sending_id=62, year_id=76)
```

### Parsing one saved articulation

```python
import json
from pathlib import Path

def load_articulation(path):
    return json.loads(Path(path).read_text())

def summarize(art):
    """Print human-readable summary of one articulation dict."""
    print(f"Major: {art['name']}")
    for entry in art["articulations"]:
        inner = entry["articulation"]
        course = inner.get("course", {})
        print(f"\n{course.get('prefix')} {course.get('courseNumber')} - "
              f"{course.get('courseTitle')} ({course.get('minUnits')} units)")

        sending = inner.get("sendingArticulation", {})
        if sending.get("noArticulationReason"):
            print(f"  NO ARTICULATION: {sending['noArticulationReason']}")
            continue

        for j, group in enumerate(sending.get("items", [])):
            conj = group.get("courseConjunction", "")
            courses = group.get("items", [])
            parts = [
                f"{c.get('prefix')} {c.get('courseNumber')} ({c.get('minUnits')}u)"
                for c in courses
            ]
            joined = " AND ".join(parts)
            prefix = f"  {conj} " if j > 0 else "  "
            print(f"{prefix}{joined}")
```

---

## 8. Storage Architecture

**Rule:** raw JSON hits disk exactly once per (year, sender, receiver, major).
Everything else is derived from that.

```
project/
  raw/                                    # immutable, one file per agreement
    76_62_to_7_Major_b81f6aed....json     # Mt. SAC -> UCSD EE
    76_62_to_7_Major_76ab1c59....json     # Mt. SAC -> UCSD CS
    ...
  metadata/
    institutions.json                     # all IDs
    academic_years.json
  db/
    articulations.sqlite                  # or Postgres in production
  scraper/
    scrape.py                             # the code above
    parse.py                              # raw JSON -> DB rows
  webapp/
    ...
```

Why: when your DB schema is wrong (it will be), you re-run `parse.py`
against local files instead of re-hitting the API. This is the standard
data-pipeline pattern: raw immutable storage → derived structured storage.

---

## 9. Suggested Database Schema

Postgres syntax; SQLite works for MVP.

```sql
-- Institutions (CCC, UC, CSU)
CREATE TABLE institutions (
    id           INT PRIMARY KEY,        -- ASSIST's institution ID
    code         TEXT NOT NULL,          -- e.g. "UCSD", "MTSAC"
    name         TEXT NOT NULL,
    category     TEXT NOT NULL,          -- "CCC" | "UC" | "CSU"
    is_community BOOLEAN NOT NULL
);

CREATE TABLE academic_years (
    id         INT PRIMARY KEY,          -- ASSIST's year ID (year - 1950)
    from_year  INT,
    to_year    INT
);

-- One agreement per (year, sender, receiver, major)
CREATE TABLE agreements (
    id                    SERIAL PRIMARY KEY,
    key                   TEXT UNIQUE NOT NULL,    -- e.g. "76/62/to/7/Major/{guid}"
    year_id               INT REFERENCES academic_years(id),
    sending_id            INT REFERENCES institutions(id),
    receiving_id          INT REFERENCES institutions(id),
    major_name            TEXT NOT NULL,
    category              TEXT NOT NULL,           -- "Major" | "Dept" | "GE"
    publish_date          TIMESTAMPTZ,
    raw_file_path         TEXT NOT NULL            -- path to raw/ file
);

-- Every distinct course we've ever seen
CREATE TABLE courses (
    id                        SERIAL PRIMARY KEY,
    institution_id            INT REFERENCES institutions(id),
    course_identifier_parent_id  INT NOT NULL,     -- ASSIST's stable course ID
    prefix                    TEXT NOT NULL,        -- e.g. "MATH"
    course_number             TEXT NOT NULL,        -- e.g. "20A"
    title                     TEXT NOT NULL,
    min_units                 REAL,
    max_units                 REAL,
    UNIQUE (institution_id, course_identifier_parent_id)
);

-- One row per receiving-side course in an agreement
CREATE TABLE articulation_entries (
    id                    SERIAL PRIMARY KEY,
    agreement_id          INT REFERENCES agreements(id) ON DELETE CASCADE,
    receiving_course_id   INT REFERENCES courses(id),
    template_cell_id      TEXT,
    entry_type            TEXT NOT NULL,           -- "Course" | "Series" | "Requirement" | ...
    no_articulation_reason TEXT                    -- NULL if articulated
);

-- The conjunction tree for the SENDING side.
-- Each group is a set of courses joined by AND that together satisfy the
-- receiving requirement. Multiple groups per entry are joined by the
-- group_conjunction (usually "Or").
CREATE TABLE sending_groups (
    id                       SERIAL PRIMARY KEY,
    articulation_entry_id    INT REFERENCES articulation_entries(id) ON DELETE CASCADE,
    group_order              INT NOT NULL,           -- ordering within entry
    group_conjunction        TEXT                    -- "Or" between groups
);

-- Courses within a group (AND-joined implicitly)
CREATE TABLE sending_group_courses (
    id                SERIAL PRIMARY KEY,
    group_id          INT REFERENCES sending_groups(id) ON DELETE CASCADE,
    course_id         INT REFERENCES courses(id),
    course_order      INT NOT NULL
);

-- Cross-listed / equivalent variants (e.g. honors sections)
CREATE TABLE cross_listed (
    id                     SERIAL PRIMARY KEY,
    primary_course_id      INT REFERENCES courses(id),
    alternate_course_id    INT REFERENCES courses(id)
);

-- Useful indexes
CREATE INDEX ON agreements(receiving_id, sending_id, year_id);
CREATE INDEX ON articulation_entries(agreement_id);
CREATE INDEX ON sending_group_courses(course_id);   -- for reverse search
```

### Reverse-search query (the killer feature)

"Given these Mt. SAC courses I've taken, what % of each UCSD major's
lower-div requirements do I satisfy?"

```sql
-- Given @taken_course_ids (array of course IDs the student has completed)
-- Return, per (agreement, receiving_course), whether it's satisfied.

WITH student_courses AS (
    SELECT UNNEST(@taken_course_ids::int[]) AS course_id
),
group_satisfaction AS (
    -- A group is satisfied when the student has taken ALL its courses
    SELECT
        sg.id AS group_id,
        sg.articulation_entry_id,
        BOOL_AND(sgc.course_id IN (SELECT course_id FROM student_courses)) AS satisfied
    FROM sending_groups sg
    JOIN sending_group_courses sgc ON sgc.group_id = sg.id
    GROUP BY sg.id, sg.articulation_entry_id
),
entry_satisfaction AS (
    -- An entry is satisfied when ANY group is satisfied
    SELECT
        articulation_entry_id,
        BOOL_OR(satisfied) AS satisfied
    FROM group_satisfaction
    GROUP BY articulation_entry_id
)
SELECT
    a.major_name,
    COUNT(*)                                       AS total_reqs,
    COUNT(*) FILTER (WHERE es.satisfied)           AS satisfied_reqs,
    ROUND(100.0 * COUNT(*) FILTER (WHERE es.satisfied) / COUNT(*), 1) AS pct_complete
FROM agreements a
JOIN articulation_entries ae ON ae.agreement_id = a.id
LEFT JOIN entry_satisfaction es ON es.articulation_entry_id = ae.id
WHERE a.sending_id = 62                            -- Mt. SAC
  AND a.year_id = 76                               -- 2026-27
GROUP BY a.id, a.major_name
ORDER BY pct_complete DESC;
```

---

## 10. Roadmap

### Phase 1: MVP (one weekend)
- Scrape UCSD (receiving_id=7) only, most recent year, all 116 CCCs
- ~15,000 API calls, ~4 hours at 1 req/sec
- Load into SQLite, build basic Next.js webapp
- Feature: reverse-search "what majors am I ready for?"

### Phase 2: Ship & get users (1 week)
- Deploy free tier (Vercel + Turso/Neon)
- Post on r/UCSD, r/CommunityColleges, Mt. SAC Discord
- Log usage to prove value

### Phase 3: Sanctioned access (1–2 weeks turnaround)
- Email `help@assist.org` with:
  - What you built
  - Real user numbers
  - Traffic pattern (polite, cached, low volume)
  - Request for data extract or approved API access
- Way more credible than cold-emailing

### Phase 4: Expand
- All UCs, then all CSUs
- Multi-year history for tracking curriculum changes
- Cross-CCC comparison ("which CCC offers the best CS articulation?")

---

## 11. Resume Framing

The interesting engineering here (for Big Tech SWE screens):

- Reverse-engineered undocumented REST API by inspecting SPA network traffic;
  handled ASP.NET anti-CSRF token pair and nested JSON-encoded response fields
- Designed normalized Postgres schema modeling polymorphic articulation
  requirements with And/Or conjunction trees, enabling sub-100ms reverse
  search across N majors
- Built rate-limited, resumable ingestion pipeline with immutable raw storage
  and idempotent re-parse; scraped 240k+ agreements without triggering
  rate limits or complaints
- Shipped to N transfer students; feature X was used Y times

---

## 12. Debugging Playbook (things that went wrong, in order)

Save time by knowing what will break.

1. **400 on any API call** → XSRF token missing or mismatched. Check that
   session has both cookies AND that the `X-XSRF-TOKEN` header value equals
   the `X-XSRF-TOKEN` cookie value.
2. **400 after hours of working** → token expired. Wrap `get()` to refresh
   XSRF on 400 and retry once.
3. **URL-encoded slashes in the Key parameter** → build the URL string
   manually instead of using `requests.params={"Key": ...}`.
4. **Response looks like nested strings** → normal. Apply `json.loads()` a
   second time to any field whose value starts with `{` or `[`.
5. **"36,299 articulation entries"** → forgot step 4, code is iterating
   over characters of a JSON string.
6. **Sudden 429/403** → you're going too fast. Back off to 0.5 req/sec.
7. **Cookies not sticking** → make sure you're using `requests.Session()`,
   not bare `requests.get()`.
8. **Ground truth for any endpoint:** DevTools → Network tab on assist.org
   → Copy-as-cURL. That's the definitive request that works.

---

## 13. Quick-Start for a New Chat

If you're starting a fresh conversation and need to bring Claude up to
speed, paste this summary:

> I'm building a webapp that scrapes ASSIST.org (California articulation
> agreements) into a Postgres DB with a reverse-search feature. I've
> already solved the two hard gotchas: (1) the XSRF cookie pair — server
> sets XSRF-TOKEN and X-XSRF-TOKEN cookies, and the X-XSRF-TOKEN request
> header must match the X-XSRF-TOKEN cookie value; (2) the API returns
> nested JSON-encoded strings that need a second json.loads() pass on
> the fields inside `result`. Endpoints I use: `/api/institutions`,
> `/api/AcademicYears`, `/api/agreements?receivingInstitutionId=...`,
> `/api/articulation/Agreements?Key=...` (build URL manually, don't
> URL-encode the slashes). Known IDs: UCSD=7, Mt. SAC=62, year 2026-27=76.
> I have a working scraper and ~1 saved articulation. Current task: [your
> task here].
