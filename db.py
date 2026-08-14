"""Postgres connection helper.

Reads DATABASE_URL from .env.local (Next.js-flavored, matches the Supabase
docs) with .env as a fallback. Neither file is committed — see .gitignore.
"""
import logging
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

log = logging.getLogger("assist.db")

for _env_file in (".env.local", ".env"):
    if Path(_env_file).exists():
        load_dotenv(_env_file)
        log.debug("Loaded env from %s", _env_file)
        break


def get_connection() -> psycopg.Connection:
    """Open a new connection to the Postgres DB.

    Two ways to configure (checked in order):
      1. DATABASE_URL=postgresql://user:URL_ENCODED_PASS@host:port/db
      2. DB_HOST + DB_PORT + DB_NAME + DB_USER + DB_PASSWORD
         (individual parts, so the raw password needs no URL encoding)

    prepare_threshold=None disables server-side prepared statements so this
    works with either Supabase pooler mode (Session or Transaction).
    """
    url = os.getenv("DATABASE_URL")
    if url:
        return psycopg.connect(url, prepare_threshold=None)

    host = os.getenv("DB_HOST")
    password = os.getenv("DB_PASSWORD")
    if not host or not password:
        raise RuntimeError(
            "No DB config in env. Either set DATABASE_URL, or set "
            "DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD in .env.local. "
            "(Supabase Dashboard → Project Settings → Database → Connection parameters)"
        )
    return psycopg.connect(
        host=host,
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "postgres"),
        user=os.getenv("DB_USER", "postgres"),
        password=password,
        prepare_threshold=None,
    )
