"""Configuration endpoints (DB path + CSV formats)."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from ..config import DEFAULT_DB_PATH, DB_PATH, CONFIG_DB_PATH, DATA_DIR, persist_db_path
from .import_csv import normalize_format_cfg, DEFAULT_BACKEND_CSV_FORMAT

router = APIRouter(prefix="/v2/config", tags=["config"])
CSV_FORMATS_FILE = Path(DATA_DIR) / "csv_formats.json"


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


def _slugify(value: str) -> str:
    value = value.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return slug or f"format-{len(value)}"


def _load_formats_file() -> List[Dict]:
    if not CSV_FORMATS_FILE.exists():
        return [_with_defaults(DEFAULT_BACKEND_CSV_FORMAT)]
    try:
        raw = json.loads(CSV_FORMATS_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            return [_with_defaults(DEFAULT_BACKEND_CSV_FORMAT)]
        if not any(f.get("id") == DEFAULT_BACKEND_CSV_FORMAT.get("id") for f in raw):
            raw.append(_with_defaults(DEFAULT_BACKEND_CSV_FORMAT))
        return raw
    except Exception:
        return [_with_defaults(DEFAULT_BACKEND_CSV_FORMAT)]


def _save_formats_file(formats: List[Dict]) -> None:
    try:
        CSV_FORMATS_FILE.parent.mkdir(parents=True, exist_ok=True)
        CSV_FORMATS_FILE.write_text(json.dumps(formats, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Impossible d'enregistrer les formats: {exc}")


def _with_defaults(fmt: Dict) -> Dict:
    fmt_copy = dict(fmt or {})
    fmt_copy.setdefault("id", DEFAULT_BACKEND_CSV_FORMAT.get("id") or "orange")
    fmt_copy.setdefault("name", DEFAULT_BACKEND_CSV_FORMAT.get("name") or "Format CSV")
    fmt_copy.setdefault("dateFormat", DEFAULT_BACKEND_CSV_FORMAT.get("dateFormat") or "DD/MM/YYYY")
    fmt_copy.setdefault("columns", DEFAULT_BACKEND_CSV_FORMAT.get("columns") or {})
    fmt_copy.setdefault("createdAt", datetime.utcnow().isoformat())
    fmt_copy.setdefault("updatedAt", datetime.utcnow().isoformat())
    return fmt_copy


@router.get("/csv-formats")
def list_csv_formats() -> List[Dict]:
    return _load_formats_file()


@router.post("/csv-formats")
def upsert_csv_format(payload: dict) -> Dict:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name requis")

    fmt_id = (payload.get("id") or "").strip() or _slugify(name)
    format_cfg_raw = {
        "dateFormat": payload.get("dateFormat"),
        "columns": payload.get("columns") or {},
    }
    format_cfg = normalize_format_cfg(format_cfg_raw)

    existing_formats = _load_formats_file()
    now_iso = datetime.utcnow().isoformat()
    updated_entry = {
        "id": fmt_id,
        "name": name,
        "dateFormat": format_cfg.get("dateFormat"),
        "columns": format_cfg.get("columns") or {},
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }

    new_list = []
    found = False
    for f in existing_formats:
        if f.get("id") == fmt_id:
            updated_entry["createdAt"] = f.get("createdAt") or now_iso
            new_list.append(updated_entry)
            found = True
        else:
            new_list.append(f)
    if not found:
        new_list.append(updated_entry)

    # Assure la présence du format par défaut
    if not any(f.get("id") == DEFAULT_BACKEND_CSV_FORMAT.get("id") for f in new_list):
        new_list.append(_with_defaults(DEFAULT_BACKEND_CSV_FORMAT))

    _save_formats_file(new_list)
    return updated_entry


@router.delete("/csv-formats/{format_id}")
def delete_csv_format(format_id: str) -> Dict:
    default_id = DEFAULT_BACKEND_CSV_FORMAT.get("id") or "orange"
    if format_id == default_id:
        raise HTTPException(status_code=400, detail="Le format par défaut ne peut pas être supprimé")

    existing_formats = _load_formats_file()
    filtered = [f for f in existing_formats if f.get("id") != format_id]
    if len(filtered) == len(existing_formats):
        raise HTTPException(status_code=404, detail="Format introuvable")
    _save_formats_file(filtered)
    return {"deleted_id": format_id}
