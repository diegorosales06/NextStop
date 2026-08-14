"""HTTP client for the ASSIST.org API.

Only concern: talk to assist.org. Handles the XSRF token pair, rate limits
to 1 req/sec, and returns decoded JSON. No filesystem access, no business
logic — those live in the other modules.
"""
from __future__ import annotations

import json
import logging
import time
import requests

log = logging.getLogger("assist.client")

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
    _refresh_xsrf(s)
    if "X-XSRF-TOKEN" not in s.headers:
        raise RuntimeError("Failed to obtain X-XSRF-TOKEN cookie from assist.org")
    log.debug("Session bootstrapped with XSRF token")
    return s


def _refresh_xsrf(session: requests.Session) -> None:
    """Hit the homepage so assist.org re-issues the cookie pair."""
    session.get("https://assist.org/", timeout=30)
    xsrf = session.cookies.get("X-XSRF-TOKEN")
    if xsrf:
        session.headers["X-XSRF-TOKEN"] = xsrf


def _get_json(session: requests.Session, url: str, params: dict | None = None) -> dict:
    """GET with a 1s throttle and one XSRF-refresh retry on 400/401."""
    time.sleep(1.0)  # DO NOT lower — assist.org rate limits aggressively
    r = session.get(url, params=params, timeout=30)
    if r.status_code in (400, 401):
        log.warning("Got %s from %s — refreshing XSRF token and retrying", r.status_code, url)
        _refresh_xsrf(session)
        time.sleep(1.0)
        r = session.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def get_institutions(session) -> list[dict]:
    return _get_json(session, f"{BASE}/institutions")


def get_academic_years(session) -> list[dict]:
    return _get_json(session, f"{BASE}/AcademicYears")


def list_agreements(session, receiving_id: int, sending_id: int, year_id: int,
                    category: str = "major") -> list[dict]:
    """Return the `reports` list: [{label, key, ownerInstitutionId}, ...]."""
    resp = _get_json(session, f"{BASE}/agreements", params={
        "receivingInstitutionId": receiving_id,
        "sendingInstitutionId": sending_id,
        "academicYearId": year_id,
        "categoryCode": category,
    })
    return resp.get("reports", [])


def fetch_articulation(session, key: str) -> dict:
    """Fetch one articulation by key (e.g. '76/62/to/7/Major/{guid}').

    The key contains slashes we must NOT URL-encode, so we build the URL
    by hand instead of using requests' params dict.
    """
    url = f"{BASE}/articulation/Agreements?Key={key}"
    outer = _get_json(session, url)
    try:
        result = outer["result"]
    except KeyError as e:
        raise RuntimeError(f"unexpected articulation response for key={key!r}: missing 'result'") from e

    # The API string-encodes several nested JSON payloads — unwrap them.
    for k, v in list(result.items()):
        if isinstance(v, str) and v.strip().startswith(("{", "[")):
            try:
                result[k] = json.loads(v)
            except json.JSONDecodeError as e:
                raise RuntimeError(
                    f"failed to decode nested JSON field {k!r} in articulation key={key!r}"
                ) from e
    return result
