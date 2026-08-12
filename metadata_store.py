"""Persistence for reference tables: institutions and academic years.

These live as JSON files under metadata/ and change rarely, so we fetch
them once and read from disk after that.
"""
import json
import logging
from pathlib import Path

from assist_client import get_institutions, get_academic_years

log = logging.getLogger("assist.metadata")

DEFAULT_DIR = Path("metadata")


def refresh_metadata(session, meta_dir: Path = DEFAULT_DIR) -> None:
    """Overwrite institutions.json and academic_years.json from the API."""
    meta_dir = Path(meta_dir)
    meta_dir.mkdir(parents=True, exist_ok=True)

    log.info("Fetching institutions…")
    institutions = get_institutions(session)
    (meta_dir / "institutions.json").write_text(json.dumps(institutions, indent=2))
    log.info("Wrote %d institutions", len(institutions))

    log.info("Fetching academic years…")
    years = get_academic_years(session)
    (meta_dir / "academic_years.json").write_text(json.dumps(years, indent=2))
    log.info("Wrote %d academic years", len(years))


def load_institutions(meta_dir: Path = DEFAULT_DIR) -> dict[int, dict]:
    """Return institutions indexed by numeric id."""
    path = Path(meta_dir) / "institutions.json"
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError as e:
        raise FileNotFoundError(
            f"{path} missing — run: python main.py refresh-metadata"
        ) from e
    return {i["id"]: i for i in data}


def load_academic_years(meta_dir: Path = DEFAULT_DIR) -> dict[int, dict]:
    """Return academic years indexed by id."""
    path = Path(meta_dir) / "academic_years.json"
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError as e:
        raise FileNotFoundError(
            f"{path} missing — run: python main.py refresh-metadata"
        ) from e
    return {y["id"]: y for y in data}


def institution_summary(inst: dict) -> dict:
    """Compact {id, code, name} used in generated files."""
    return {
        "id": inst["id"],
        "code": inst["code"].strip(),
        "name": inst["names"][0]["name"],
    }


def year_label(year: dict) -> str:
    """Short label like '2026-27' derived from fallYear."""
    fy = year.get("fallYear")
    if fy:
        return f"{fy}-{str(fy + 1)[-2:]}"
    return f"year{year.get('id')}"
