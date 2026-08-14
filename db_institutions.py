"""Load metadata/institutions.json into the `institutions` table.

Transform per row:
  id           <- id
  code         <- code.strip()          (JSON pads with spaces)
  name         <- names[max fromYear]   (present-day name)
  category     <- ASSIST category int → "UC" | "CSU" | "CCC" | "private"
  is_community <- isCommunityCollege

Re-runnable — uses INSERT ... ON CONFLICT DO UPDATE.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from db import get_connection

log = logging.getLogger("assist.db.institutions")

CATEGORY_MAP = {
    0: "CSU",
    1: "UC",
    2: "CCC",
}
DEFAULT_CATEGORY = "private"

UPSERT_SQL = """
INSERT INTO institutions (id, code, name, category, is_community)
VALUES (%s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET
    code = EXCLUDED.code,
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    is_community = EXCLUDED.is_community
"""


def _current_name(names: list[dict]) -> str:
    # Pick the entry with the latest fromYear. Entries without fromYear are
    # treated as oldest (they're the original name).
    return max(names, key=lambda n: n.get("fromYear", -1))["name"]


def _category(inst: dict) -> str:
    return CATEGORY_MAP.get(inst.get("category"), DEFAULT_CATEGORY)


def _row(inst: dict) -> tuple:
    return (
        inst["id"],
        inst["code"].strip(),
        _current_name(inst["names"]),
        _category(inst),
        bool(inst.get("isCommunityCollege")),
    )


def load_institutions(json_path: str | Path = "metadata/institutions.json") -> int:
    """Upsert every institution from the JSON file. Returns the row count."""
    data = json.loads(Path(json_path).read_text())
    rows = [_row(inst) for inst in data]
    log.info("Loading %d institutions from %s", len(rows), json_path)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()

    log.info("Upserted %d institutions", len(rows))
    return len(rows)
