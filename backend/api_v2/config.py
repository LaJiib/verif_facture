"""Configuration endpoints (DB path)."""

from __future__ import annotations

from fastapi import APIRouter

from ..config import DEFAULT_DB_PATH, DB_PATH, CONFIG_DB_PATH, persist_db_path

router = APIRouter(prefix="/v2/config", tags=["config"])


@router.get("/db-path")
def get_db_path():
    source = "config" if CONFIG_DB_PATH else "default"
    return {
        "db_path": str(DB_PATH),
        "default_db_path": str(DEFAULT_DB_PATH),
        "configured_db_path": str(CONFIG_DB_PATH) if CONFIG_DB_PATH else None,
        "source": source,
    }


@router.post("/db-path")
def save_db_path(payload: dict):
    db_path = payload.get("db_path")
    saved_path, persisted = persist_db_path(db_path)
    return {
        "saved_db_path": str(saved_path) if saved_path else None,
        "uses_default": not persisted,
        "requires_restart": True,
    }
