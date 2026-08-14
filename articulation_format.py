"""Load a cached articulation JSON and print a human-readable summary.

Pure formatting — no network, no writing. Given a path, prints each receiving
course and the sending-side course(s) required, respecting AND/OR grouping.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger("assist.format")


def load_articulation(path: str | Path) -> dict:
    return json.loads(Path(path).read_text())


def summarize_articulation(art: dict) -> None:
    print(f"Major: {art.get('name')}")
    for entry in art.get("articulations", []):
        inner = entry.get("articulation", {})
        if inner.get("type") != "Course":
            # Non-course entry (e.g. GE block) — dump a preview and move on.
            print(json.dumps(inner, indent=2)[:2000])
            continue

        course = inner.get("course", {})
        print(
            f"\n{course.get('prefix')} {course.get('courseNumber')} - "
            f"{course.get('courseTitle')} ({course.get('minUnits')} units)"
        )

        sending = inner.get("sendingArticulation", {})
        if sending.get("noArticulationReason"):
            print(f"  NO ARTICULATION: {sending['noArticulationReason']}")
            continue

        for j, group in enumerate(sending.get("items", [])):
            conj = group.get("courseConjunction", "")  # AND/OR between groups
            parts = [
                f"{c.get('prefix')} {c.get('courseNumber')} ({c.get('minUnits')}u)"
                for c in group.get("items", [])
            ]
            joined = " AND ".join(parts)  # within a group, AND is implied
            prefix = f"  {conj} " if j > 0 else "  "
            print(f"{prefix}{joined}")
