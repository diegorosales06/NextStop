"""One-call logging config used by main.py.

Every module uses a named logger (assist.client, assist.metadata,
assist.index, assist.cache, assist.format, assist.main) so log lines
identify which layer emitted them.
"""
import logging


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level,
        format="[%(asctime)s] %(levelname)-5s %(name)-15s %(message)s",
        datefmt="%H:%M:%S",
    )
