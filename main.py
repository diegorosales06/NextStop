"""CLI entry point.

Subcommands:
  refresh-metadata   Refetch institutions.json + academic_years.json
  build-index        Build metadata/agreements_index.json for the MVP roster
  scrape             Cache full articulation JSONs for one (sending, receiving) pair
  show PATH          Print a summary of one cached articulation JSON

Every module uses a named logger — an error line like
  [14:23:01] ERROR assist.client: ...
tells you immediately which layer failed.
"""
import argparse
import logging
import sys

from logging_setup import configure_logging
from assist_client import bootstrap_session
from metadata_store import refresh_metadata
from agreements_index import build_agreements_index
from articulation_cache import scrape_and_cache
from articulation_format import load_articulation, summarize_articulation
from mvp_config import (
    MVP_SENDING_IDS,
    MVP_RECEIVING_IDS,
    MVP_MAJOR_FILTERS,
    MVP_YEAR_ID,
)


def _parse_str_list(s: str) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()]


def cmd_refresh_metadata(args):
    session = bootstrap_session()
    refresh_metadata(session)


def cmd_build_index(args):
    session = bootstrap_session()
    build_agreements_index(
        session,
        sending_ids=MVP_SENDING_IDS,
        receiving_ids=MVP_RECEIVING_IDS,
        year_id=args.year,
        major_filters=MVP_MAJOR_FILTERS,
    )


def cmd_scrape(args):
    session = bootstrap_session()
    scrape_and_cache(
        session,
        receiving_id=args.receiving,
        sending_id=args.sending,
        year_id=args.year,
        major_filter=args.majors,
    )


def cmd_show(args):
    summarize_articulation(load_articulation(args.path))


def cmd_load_institutions(args):
    # Lazy import so the other subcommands don't require psycopg/dotenv.
    from db_institutions import load_institutions
    load_institutions()


def cmd_load_academic_years(args):
    from db_academic_years import load_academic_years
    load_academic_years()


def cmd_load_articulations(args):
    from db_articulations import load_articulations
    load_articulations(refresh_view=not args.no_refresh)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="assist")
    parser.add_argument("--log-level", default="INFO",
                        help="DEBUG, INFO, WARNING, ERROR (default INFO)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("refresh-metadata",
                       help="Refetch institutions and academic years")
    p.set_defaults(func=cmd_refresh_metadata)

    p = sub.add_parser("build-index",
                       help="Build the agreements index for the MVP roster")
    p.add_argument("--year", type=int, default=MVP_YEAR_ID)
    p.set_defaults(func=cmd_build_index)

    p = sub.add_parser("scrape",
                       help="Cache full articulation JSONs for one (sending, receiving) pair")
    p.add_argument("--sending", type=int, required=True)
    p.add_argument("--receiving", type=int, required=True)
    p.add_argument("--year", type=int, default=MVP_YEAR_ID)
    p.add_argument("--majors", type=_parse_str_list, default=MVP_MAJOR_FILTERS,
                   help="Comma-separated major substrings (default: MVP list)")
    p.set_defaults(func=cmd_scrape)

    p = sub.add_parser("show",
                       help="Print a summary of a cached articulation JSON")
    p.add_argument("path")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("load-institutions",
                       help="Upsert metadata/institutions.json into Postgres")
    p.set_defaults(func=cmd_load_institutions)

    p = sub.add_parser("load-academic-years",
                       help="Upsert metadata/academic_years.json into Postgres")
    p.set_defaults(func=cmd_load_academic_years)

    p = sub.add_parser("load-articulations",
                       help="Upsert every raw/*.json into Postgres")
    p.add_argument("--no-refresh", action="store_true",
                   help="Skip REFRESH MATERIALIZED VIEW course_articulates_to")
    p.set_defaults(func=cmd_load_articulations)

    args = parser.parse_args(argv)
    configure_logging(args.log_level)

    try:
        args.func(args)
    except Exception:
        logging.getLogger("assist.main").exception("Command failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
