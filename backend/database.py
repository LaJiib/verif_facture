"""SQLite connection helpers (centralized config, reusable session factory)."""

from __future__ import annotations

import logging
import os
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .config import DATA_DIR, DB_PATH, DATABASE_URL

logger = logging.getLogger("database")

# Ensure folders exist (data dir is outside install tree by default)
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

db_exists = DB_PATH.exists()
if db_exists:
    size_kb = DB_PATH.stat().st_size / 1024
    logger.info("Base SQLite existante: %s (%.1f Ko)", DB_PATH, size_kb)
else:
    logger.info("Nouvelle base SQLite: %s", DB_PATH)

# Enable optional SQL echo
DEBUG_SQL = os.getenv("DEBUG_SQL", "false").lower() == "true"

engine = create_engine(
    DATABASE_URL,
    echo=DEBUG_SQL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency to yield a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Ensure foreign keys are enforced."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
