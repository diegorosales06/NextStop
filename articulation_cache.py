"""Fetch and cache the FULL articulation JSON for each agreement.

For one (sending, receiving, year) triple, lists the agreements and fetches
each one, writing to raw/{SEND}_to_{RECV}_{year}_{safe_key}.json. Files that
already exist are skipped so runs are resumable.
"""
import json
import logging
from pathlib import Path

from assist_client import list_agreements, fetch_articulation
from metadata_store import (
    load_institutions,
    load_academic_years,
    institution_summary,
    year_label,
)

log = logging.getLogger("assist.cache")


def scrape_and_cache(
    session,
    receiving_id: int,
    sending_id: int,
    year_id: int,
    cache_dir: str = "raw",
    major_filter: list[str] | None = None,
) -> None:
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    inst_by_id = load_institutions()
    years_by_id = load_academic_years()
    send_code = institution_summary(inst_by_id[sending_id])["code"]
    recv_code = institution_summary(inst_by_id[receiving_id])["code"]
    yr_label = year_label(years_by_id[year_id])
    prefix = f"{send_code}_to_{recv_code}_{yr_label}"

    agreements = list_agreements(session, receiving_id, sending_id, year_id)

    if major_filter:
        filters_lower = [f.lower() for f in major_filter]
        agreements = [
            a for a in agreements
            if any(f in a["label"].lower() for f in filters_lower)
        ]

    log.info("%s — %d majors to fetch", prefix, len(agreements))

    for i, a in enumerate(agreements, 1):
        key = a["key"]
        safe_key = key.replace("/", "_")
        outfile = cache / f"{prefix}_{safe_key}.json"
        if outfile.exists():
            log.debug("skip existing %s", outfile.name)
            continue
        log.info("[%d/%d] %s", i, len(agreements), a["label"])
        try:
            articulation = fetch_articulation(session, key)
        except Exception as e:
            log.error("failed to fetch key=%s: %s", key, e)
            continue
        outfile.write_text(json.dumps(articulation, indent=2))
