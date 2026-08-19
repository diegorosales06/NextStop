"""Load cached articulation JSONs from raw/ into Postgres.

For each file:
  1. Compute sha256 of the raw JSON. Skip if the existing agreement row has
     the same hash.
  2. Backfill institutions.term_type for sending + receiving (once per row).
  3. Upsert the agreement.
  4. Wipe and re-insert all children (template_sections, template_cells,
     articulation_entries + receiving-course join, sending_groups +
     sending_group_courses, denied_courses).
  5. On success, REFRESH MATERIALIZED VIEW course_articulates_to.

Runs in a transaction per file — a bad file aborts only itself.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from db import get_connection

log = logging.getLogger("assist.db.articulations")


@dataclass
class LoadStats:
    total: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    failed: int = 0
    failures: list[tuple[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _agreement_key(data: dict) -> str:
    """Reconstruct the ASSIST key ({year}/{sending}/to/{receiving}/{type}/{guid}).

    ASSIST doesn't include the key inside the payload, so we build it from the
    filename convention (see articulation_cache.py). Fall back to a
    payload-derived surrogate if the key can't be inferred.
    """
    year = data["academicYear"]["id"]
    send = data["sendingInstitution"]["id"]
    recv = data["receivingInstitution"]["id"]
    kind = data.get("type", "Major")
    # The GUID we stored in the filename isn't in the payload; use the first
    # articulation's cell id as a stable-per-payload surrogate. Uniqueness is
    # still enforced via (year_id, sending_id, receiving_id, major_name).
    surrogate = ""
    arts = data.get("articulations", [])
    if arts:
        surrogate = arts[0].get("templateCellId", "") or ""
    return f"{year}/{send}/to/{recv}/{kind}/{surrogate}"


def _units(course: dict) -> tuple[float | None, float | None]:
    return course.get("minUnits"), course.get("maxUnits")


def _catalog_year_display(cy) -> str | None:
    """catalogYear in the raw JSON is an object with begin/end years per side.
    Collapse to a display string; the full structure stays in raw_json."""
    if cy is None:
        return None
    if isinstance(cy, str):
        return cy
    if not isinstance(cy, dict):
        return str(cy)
    rb, re_ = cy.get("receivingCatalogYearBegin"), cy.get("receivingCatalogYearEnd")
    sb, se = cy.get("sendingCatalogYearBegin"), cy.get("sendingCatalogYearEnd")
    if (rb, re_) == (sb, se) and rb is not None:
        return f"{rb}-{re_}"
    parts = []
    if rb is not None:
        parts.append(f"recv:{rb}-{re_}")
    if sb is not None:
        parts.append(f"send:{sb}-{se}")
    return " ".join(parts) or None


# ---------------------------------------------------------------------------
# Upserts
# ---------------------------------------------------------------------------

_TERM_TYPE_SQL = """
UPDATE institutions
SET term_type = %s
WHERE id = %s AND (term_type IS DISTINCT FROM %s)
"""


def _upsert_term_types(cur, data: dict) -> None:
    for side in ("sendingInstitution", "receivingInstitution"):
        inst = data.get(side, {})
        tt = inst.get("termType")
        if inst.get("id") is not None and tt in ("Quarter", "Semester"):
            cur.execute(_TERM_TYPE_SQL, (tt, inst["id"], tt))


_AGREEMENT_UPSERT_SQL = """
INSERT INTO agreements
    (key, year_id, sending_id, receiving_id, major_name, category,
     publish_date, catalog_year, raw_json, content_hash)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
ON CONFLICT (year_id, sending_id, receiving_id, major_name) DO UPDATE SET
    key = EXCLUDED.key,
    category = EXCLUDED.category,
    publish_date = EXCLUDED.publish_date,
    catalog_year = EXCLUDED.catalog_year,
    raw_json = EXCLUDED.raw_json,
    content_hash = EXCLUDED.content_hash,
    scraped_at = now()
RETURNING id, (xmax = 0) AS inserted
"""


def _upsert_agreement(cur, data: dict, raw_json: str, content_hash: str) -> tuple[int, bool]:
    """Return (agreement_id, was_inserted). If the row exists with the same
    content_hash we return (id, False) without touching it."""
    year_id = data["academicYear"]["id"]
    sending_id = data["sendingInstitution"]["id"]
    receiving_id = data["receivingInstitution"]["id"]
    major_name = data["name"]

    cur.execute(
        "SELECT id, content_hash FROM agreements "
        "WHERE year_id = %s AND sending_id = %s AND receiving_id = %s AND major_name = %s",
        (year_id, sending_id, receiving_id, major_name),
    )
    row = cur.fetchone()
    if row and row[1] == content_hash:
        return row[0], False  # unchanged

    cur.execute(
        _AGREEMENT_UPSERT_SQL,
        (
            _agreement_key(data),
            year_id,
            sending_id,
            receiving_id,
            major_name,
            data.get("type", "Major"),
            data.get("publishDate"),
            _catalog_year_display(data.get("catalogYear")),
            raw_json,
            content_hash,
        ),
    )
    agreement_id, inserted = cur.fetchone()
    return agreement_id, inserted


_COURSE_UPSERT_SQL = """
INSERT INTO courses
    (institution_id, course_identifier_parent_id, prefix, prefix_parent_id,
     course_number, title, department, department_parent_id,
     min_units, max_units, begin_term, end_term)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (institution_id, course_identifier_parent_id) DO UPDATE SET
    prefix = EXCLUDED.prefix,
    prefix_parent_id = EXCLUDED.prefix_parent_id,
    course_number = EXCLUDED.course_number,
    title = EXCLUDED.title,
    department = EXCLUDED.department,
    department_parent_id = EXCLUDED.department_parent_id,
    min_units = EXCLUDED.min_units,
    max_units = EXCLUDED.max_units,
    begin_term = EXCLUDED.begin_term,
    end_term = EXCLUDED.end_term
RETURNING id
"""


def _upsert_course(cur, institution_id: int, course: dict) -> int:
    min_u, max_u = _units(course)
    cur.execute(
        _COURSE_UPSERT_SQL,
        (
            institution_id,
            course["courseIdentifierParentId"],
            course.get("prefix", "").strip(),
            course.get("prefixParentId"),
            course.get("courseNumber", "").strip(),
            course.get("courseTitle", ""),
            course.get("department"),
            course.get("departmentParentId"),
            min_u,
            max_u,
            course.get("begin"),
            course.get("end"),
        ),
    )
    return cur.fetchone()[0]


# ---------------------------------------------------------------------------
# Wipe children (explicit-order deletes; the FK from articulation_entries to
# template_cells has no CASCADE, so we can't rely on ON DELETE CASCADE from
# the agreement alone).
# ---------------------------------------------------------------------------

_WIPE_SQL = [
    """DELETE FROM sending_group_courses WHERE group_id IN (
         SELECT sg.id FROM sending_groups sg
         JOIN articulation_entries ae ON ae.id = sg.articulation_entry_id
         WHERE ae.agreement_id = %s)""",
    """DELETE FROM denied_courses WHERE entry_id IN (
         SELECT id FROM articulation_entries WHERE agreement_id = %s)""",
    """DELETE FROM articulation_entry_receiving_courses WHERE entry_id IN (
         SELECT id FROM articulation_entries WHERE agreement_id = %s)""",
    """DELETE FROM sending_groups WHERE articulation_entry_id IN (
         SELECT id FROM articulation_entries WHERE agreement_id = %s)""",
    "DELETE FROM articulation_entries WHERE agreement_id = %s",
    """DELETE FROM template_cells WHERE section_id IN (
         SELECT id FROM template_sections WHERE agreement_id = %s)""",
    "DELETE FROM template_sections WHERE agreement_id = %s",
]


def _wipe_children(cur, agreement_id: int) -> None:
    for sql in _WIPE_SQL:
        cur.execute(sql, (agreement_id,))


# ---------------------------------------------------------------------------
# Template layout (templateAssets → sections + cells)
# ---------------------------------------------------------------------------

_SECTION_INSERT_SQL = """
INSERT INTO template_sections
    (agreement_id, asset_position, section_position, section_letter,
     hide_letters, instruction, attributes)
VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
RETURNING id
"""

_CELL_INSERT_SQL = """
INSERT INTO template_cells
    (section_id, template_cell_id, row_position, cell_position, cell_type)
VALUES (%s, %s, %s, %s, %s)
"""


def _load_template(cur, agreement_id: int, template_assets: list[dict]) -> set[str]:
    """Insert sections + cells; return the set of template_cell_ids inserted
    so we can validate articulation entries later."""
    inserted_cells: set[str] = set()
    for asset_pos, asset in enumerate(template_assets):
        hide = bool(asset.get("hideSectionLetters", False))
        for sec_pos, section in enumerate(asset.get("sections", [])):
            cur.execute(
                _SECTION_INSERT_SQL,
                (
                    agreement_id,
                    asset_pos,
                    sec_pos,
                    section.get("sectionLetter"),
                    hide,
                    section.get("instruction"),
                    json.dumps(section.get("attributes") or []),
                ),
            )
            section_id = cur.fetchone()[0]
            for row_pos, row in enumerate(section.get("rows", [])):
                for cell_pos, cell in enumerate(row.get("cells", [])):
                    cell_id = cell.get("id")
                    if not cell_id:
                        continue
                    cur.execute(
                        _CELL_INSERT_SQL,
                        (
                            section_id,
                            cell_id,
                            row_pos,
                            cell_pos,
                            cell.get("type", "Unknown"),
                        ),
                    )
                    inserted_cells.add(cell_id)
    return inserted_cells


# ---------------------------------------------------------------------------
# Articulations (per receiving requirement)
# ---------------------------------------------------------------------------

_ENTRY_INSERT_SQL = """
INSERT INTO articulation_entries
    (agreement_id, template_cell_id, entry_type, no_articulation_reason)
VALUES (%s, %s, %s, %s)
RETURNING id
"""

_ENTRY_RECV_INSERT_SQL = """
INSERT INTO articulation_entry_receiving_courses
    (entry_id, course_id, position, conjunction)
VALUES (%s, %s, %s, %s)
"""

_GROUP_INSERT_SQL = """
INSERT INTO sending_groups (articulation_entry_id, group_order, group_conjunction)
VALUES (%s, %s, %s)
RETURNING id
"""

_GROUP_COURSE_INSERT_SQL = """
INSERT INTO sending_group_courses (group_id, course_id, course_order)
VALUES (%s, %s, %s)
"""

_DENIED_INSERT_SQL = """
INSERT INTO denied_courses (entry_id, course_id) VALUES (%s, %s)
ON CONFLICT DO NOTHING
"""


def _receiving_courses_from(art: dict) -> list[tuple[dict, str | None]]:
    """Return [(course_dict, conjunction), ...] for the receiving side.

    - Course: one course, no conjunction.
    - Series: N courses, all with the series' conjunction.
    - Requirement: no receiving courses (it's prose).
    """
    t = art.get("type")
    if t == "Course":
        course = art.get("course")
        return [(course, None)] if course else []
    if t == "Series":
        series = art.get("series") or {}
        conj = series.get("conjunction")
        return [(c, conj) for c in series.get("courses", [])]
    # "Requirement" and anything unknown: no linkable courses
    return []


def _load_articulations(
    cur,
    agreement_id: int,
    sending_id: int,
    receiving_id: int,
    articulations: list[dict],
    known_cell_ids: set[str],
) -> None:
    for entry in articulations:
        cell_id = entry.get("templateCellId")
        art = entry.get("articulation") or {}
        entry_type = art.get("type", "Unknown")

        if not cell_id or cell_id not in known_cell_ids:
            # Orphaned articulation — the templateAssets tree didn't declare
            # this cell. Skip rather than corrupt the FK graph.
            log.debug("Skipping orphan articulation (cell_id=%s) in agreement %s",
                      cell_id, agreement_id)
            continue

        sa = art.get("sendingArticulation") or {}
        no_reason = sa.get("noArticulationReason")

        cur.execute(_ENTRY_INSERT_SQL,
                    (agreement_id, cell_id, entry_type, no_reason))
        entry_id = cur.fetchone()[0]

        # Receiving-side courses
        for pos, (course, conj) in enumerate(_receiving_courses_from(art)):
            course_id = _upsert_course(cur, receiving_id, course)
            cur.execute(_ENTRY_RECV_INSERT_SQL,
                        (entry_id, course_id, pos, conj))

        # Sending-side groups (OR-of-ANDs)
        for g_order, group in enumerate(sa.get("items") or []):
            cur.execute(
                _GROUP_INSERT_SQL,
                (entry_id, g_order, group.get("courseConjunction")),
            )
            group_id = cur.fetchone()[0]
            for c_order, course in enumerate(group.get("items") or []):
                if course.get("type") != "Course":
                    continue  # nested CourseGroup — not seen in this dataset yet
                course_id = _upsert_course(cur, sending_id, course)
                cur.execute(_GROUP_COURSE_INSERT_SQL,
                            (group_id, course_id, c_order))

        # Denied courses (used to articulate; no longer)
        for course in sa.get("deniedCourses") or []:
            course_id = _upsert_course(cur, sending_id, course)
            cur.execute(_DENIED_INSERT_SQL, (entry_id, course_id))


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def load_articulation_file(path: Path, conn) -> str:
    """Load one raw articulation file. Returns 'inserted' | 'updated' |
    'unchanged'. Commits its own transaction on success."""
    raw_text = path.read_text()
    data = json.loads(raw_text)
    content_hash = _sha256(raw_text)

    with conn.cursor() as cur:
        _upsert_term_types(cur, data)

        # Pre-check: if hash matches, skip everything.
        cur.execute(
            "SELECT id, content_hash FROM agreements "
            "WHERE year_id = %s AND sending_id = %s AND receiving_id = %s AND major_name = %s",
            (
                data["academicYear"]["id"],
                data["sendingInstitution"]["id"],
                data["receivingInstitution"]["id"],
                data["name"],
            ),
        )
        existing = cur.fetchone()
        if existing and existing[1] == content_hash:
            conn.commit()
            return "unchanged"

        agreement_id, inserted = _upsert_agreement(cur, data, raw_text, content_hash)
        _wipe_children(cur, agreement_id)

        cell_ids = _load_template(cur, agreement_id,
                                  data.get("templateAssets") or [])
        _load_articulations(
            cur,
            agreement_id,
            sending_id=data["sendingInstitution"]["id"],
            receiving_id=data["receivingInstitution"]["id"],
            articulations=data.get("articulations") or [],
            known_cell_ids=cell_ids,
        )

    conn.commit()
    return "inserted" if inserted else "updated"


def load_articulations(
    paths: Iterable[Path] | None = None,
    raw_dir: str | Path = "raw",
    refresh_view: bool = True,
) -> LoadStats:
    if paths is None:
        paths = sorted(Path(raw_dir).glob("*.json"))
    paths = list(paths)

    stats = LoadStats(total=len(paths))
    log.info("Loading %d articulation files", stats.total)

    with get_connection() as conn:
        for i, path in enumerate(paths, 1):
            try:
                result = load_articulation_file(path, conn)
            except Exception as exc:
                conn.rollback()
                stats.failed += 1
                stats.failures.append((path.name, str(exc)))
                log.exception("Failed to load %s", path.name)
                continue

            if result == "inserted":
                stats.inserted += 1
            elif result == "updated":
                stats.updated += 1
            else:
                stats.unchanged += 1
            log.info("[%d/%d] %s: %s", i, stats.total, path.name, result)

        if refresh_view and (stats.inserted or stats.updated):
            log.info("Refreshing materialized view course_articulates_to")
            with conn.cursor() as cur:
                # CONCURRENTLY needs its own transaction and can't run inside
                # a multi-statement one. We're outside the per-file txn here.
                cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY course_articulates_to")
            conn.commit()

    log.info(
        "Done: %d inserted, %d updated, %d unchanged, %d failed",
        stats.inserted, stats.updated, stats.unchanged, stats.failed,
    )
    for name, err in stats.failures:
        log.warning("  failed: %s — %s", name, err)
    return stats
