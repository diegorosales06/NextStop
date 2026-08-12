# import json

# d = json.load(open("mtsac_ucsd_ee_clean.json"))
# arts = d["articulations"]

# print(f"\n=== {len(arts)} entries ===\n")

# for i, entry in enumerate(arts):
#     art = entry["articulation"]
#     course = art.get("course", {})
#     # print(type(arts))
#     # print(type(course))

    
#     # Receiving side (UCSD)
#     ucsd = f"{course.get('prefix')} {course.get('courseNumber')} - {course.get('courseTitle')} ({course.get('minUnits')} units)"
#     print(f"[{i}] UCSD: {ucsd}")
    
#     # Sending side (Mt. SAC)
#     sending = art.get("sendingArticulation", {})
#     reason = sending.get("noArticulationReason")
#     if reason:
#         print(f"     NO ARTICULATION: {reason}")
#         print()
#         continue
    
#     items = sending.get("items", [])
#     for j, group in enumerate(items):
#         conj = group.get("courseConjunction", "")  # And / Or between groups
#         courses = group.get("items", [])
#         course_strs = []
#         for c in courses:
#             course_strs.append(
#                 f"{c.get('prefix')} {c.get('courseNumber')} - {c.get('courseTitle')} ({c.get('minUnits')}u)"
#             )
#         # Within a group, courses are joined by AND (both required)
#         joined = "  AND  ".join(course_strs) if course_strs else "(none)"
#         prefix = f"     {conj} " if j > 0 else "     "
#         print(f"{prefix}{joined}")
#     print()

import json
from pathlib import Path

def load_articulation(path):
    return json.loads(Path(path).read_text())

def summarize(art):
    """Print human-readable summary of one articulation dict."""
    print(f"Major: {art['name']}")
    for entry in art["articulations"]:
        inner = entry["articulation"]
        if inner.get("type") != "Course":
            print(json.dumps(inner, indent=2)[:2000])
            break
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

loaded_data = load_articulation("raw/76_62_to_117_Major_e64bd521-a760-47cb-1fc5-08ddcb96df9e.json")
summarize(loaded_data)