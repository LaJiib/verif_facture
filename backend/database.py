"""SQLite connection helpers (centralized config, reusable session factory)."""

from __future__ import annotations

import logging
import os
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .config import DATA_DIR, DATABASE_URL

logger = logging.getLogger("database")

DATA_DIR.mkdir(parents=True, exist_ok=True)

DEBUG_SQL = os.getenv("DEBUG_SQL", "false").lower() == "true"

# Initialisés à None, peuplés par init_engine() appelé depuis api.py
engine = None
SessionLocal = None


def init_engine(url: str) -> None:
    """Initialise l'engine et SessionLocal sur l'URL donnée."""
    global engine, SessionLocal

    from pathlib import Path
    db_path = Path(url.replace("sqlite:///", ""))
    db_path.parent.mkdir(parents=True, exist_ok=True)

    if db_path.exists():
        logger.info("Base SQLite existante: %s (%.1f Ko)", db_path, db_path.stat().st_size / 1024)
    else:
        logger.info("Nouvelle base SQLite: %s", db_path)

    engine = create_engine(url, echo=DEBUG_SQL, connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency to yield a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()