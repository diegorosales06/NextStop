"""Load metadata/academic_years.json into the `academic_years` table.

Transform per row:
  id        <- id
  from_year <- fallYear
  to_year   <- fallYear + 1   (academic year spans fall N to spring N+1)

Re-runnable — uses INSERT ... ON CONFLICT DO UPDATE.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from db import get_connection

log = logging.getLogger("assist.db.academic_years")

UPSERT_SQL = """
INSERT INTO academic_years (id, from_year, to_year)
VALUES (%s, %s, %s)
ON CONFLICT (id) DO UPDATE SET
    from_year = EXCLUDED.from_year,
    to_year   = EXCLUDED.to_year
"""


def _row(year: dict) -> tuple:
    fy = year.get("fallYear")
    return (year["id"], fy, fy + 1 if fy is not None else None)


def load_academic_years(json_path: str | Path = "metadata/academic_years.json") -> int:
    data = json.loads(Path(json_path).read_text())
    rows = [_row(y) for y in data]
    log.info("Loading %d academic years from %s", len(rows), json_path)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()

    log.info("Upserted %d academic years", len(rows))
    return len(rows)
