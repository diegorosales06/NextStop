"""Build a lightweight index of which (sending, receiving, major) agreements
exist for a given academic year, WITHOUT fetching full articulation payloads.

Output: metadata/agreements_index.json, grouped by matched major filter.
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from assist_client import list_agreements
from metadata_store import (
    load_institutions,
    load_academic_years,
    institution_summary,
    year_label,
)

log = logging.getLogger("assist.index")


def build_agreements_index(
    session,
    sending_ids: list[int],
    receiving_ids: list[int],
    year_id: int,
    major_filters: list[str],
    out_path: str = "metadata/agreements_index.json",
    category: str = "major",
) -> dict:
    inst_by_id = load_institutions()
    years_by_id = load_academic_years()
    filters_lower = [f.lower() for f in major_filters]

    by_filter: dict[str, list[dict]] = {f: [] for f in filters_lower}
    pairs_with_errors: list[dict] = []

    total_pairs = len(sending_ids) * len(receiving_ids)
    done = 0

    for send_id in sending_ids:
        send = institution_summary(inst_by_id[send_id])
        for recv_id in receiving_ids:
            done += 1
            recv = institution_summary(inst_by_id[recv_id])
            log.info("[%d/%d] %s -> %s", done, total_pairs, send["code"], recv["code"])
            try:
                agreements = list_agreements(session, recv_id, send_id, year_id, category)
            except Exception as e:
                log.warning("pair %s -> %s failed: %s", send["code"], recv["code"], e)
                pairs_with_errors.append({"sending": send, "receiving": recv, "error": str(e)})
                continue

            for a in agreements:
                label_lower = a["label"].lower()
                for f in filters_lower:
                    if f in label_lower:
                        by_filter[f].append({
                            "label": a["label"],
                            "key": a["key"],
                            "sending": send,
                            "receiving": recv,
                        })

    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "academic_year": {"id": year_id, "label": year_label(years_by_id[year_id])},
        "category_code": category,
        "major_filters": major_filters,
        "sending_institutions": [institution_summary(inst_by_id[i]) for i in sending_ids],
        "receiving_institutions": [institution_summary(inst_by_id[i]) for i in receiving_ids],
        "counts": {f: len(v) for f, v in by_filter.items()},
        "by_filter": by_filter,
        "pairs_with_errors": pairs_with_errors,
    }

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(index, indent=2))
    log.info("Wrote %s — %d agreements matched", out, sum(len(v) for v in by_filter.values()))
    return index
