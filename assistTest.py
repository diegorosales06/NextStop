"""
ASSIST.org scraper.
Handles XSRF token pair and nested JSON string decoding.
"""
from curses import meta
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


def _load_metadata(meta_dir="metadata"):
    """Load institutions and academic years for id -> code/label lookup."""
    meta = Path(meta_dir)
    institutions = json.loads((meta / "institutions.json").read_text())
    years = json.loads((meta / "academic_years.json").read_text())
    inst_by_id = {i["id"]: i for i in institutions}
    year_by_id = {y["Id"]: y for y in years}
    return inst_by_id, year_by_id


def _institution_code(inst):
    """Best-effort short code for an institution (e.g. 'UCLA', 'MTSAC')."""
    return inst.get("code") or inst.get("names", [{}])[0].get("name", f"id{inst.get('id')}")


def _year_label(year):
    """Short label for an academic year (e.g. '2026-27')."""
    fall = year.get("FallYear")
    if fall:
        return f"{fall}-{str(fall + 1)[-2:]}"
    return year.get("AcademicYearName") or year.get("Name") or f"year{year.get('Id')}"


def scrape_and_cache(session, receiving_id, sending_id, year_id,
                     cache_dir="raw", major_filter=None, meta_dir="metadata"):
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    inst_by_id, year_by_id = _load_metadata(meta_dir)
    receiving_code = _institution_code(inst_by_id[receiving_id])
    sending_code = _institution_code(inst_by_id[sending_id])
    year_label = _year_label(year_by_id[year_id])
    prefix = f"{sending_code}_to_{receiving_code}_{year_label}"

    agreements = list_agreements(session, receiving_id, sending_id, year_id)

    if major_filter:
        # Case-insensitive substring match on the label
        filters_lower = [f.lower() for f in major_filter]
        agreements = [
            a for a in agreements
            if any(f in a["label"].lower() for f in filters_lower)
        ]

    print(f"{len(agreements)} majors to fetch")

    for i, a in enumerate(agreements):
        key = a["key"]
        safe_key = key.replace("/", "_")
        outfile = cache / f"{prefix}_{safe_key}.json"
        if outfile.exists():
            continue
        print(f"[{i + 1}/{len(agreements)}] {a['label']}")
        try:
            articulation = fetch_articulation(session, key)
        except Exception as e:
            print(f"  FAILED: {e}")
            continue
        outfile.write_text(json.dumps(articulation, indent=2))


if __name__ == "__main__":
    session = bootstrap_session()
    meta = Path("metadata")
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "institutions.json").write_text(
        json.dumps(get_institutions(session), indent=2)
    )
    (meta / "academic_years.json").write_text(
        json.dumps(get_academic_years(session), indent=2)
    )
    # Example: Mt. SAC (62) -> UCSD (7), 2026-27 (year 76)
    # scrape_and_cache(
    #     session,
    #     receiving_id=117,
    #     sending_id=62, # UCLA
    #     year_id=76,
    #     major_filter=["electrical engineering", "computer science", "computer engineering"],
    # )