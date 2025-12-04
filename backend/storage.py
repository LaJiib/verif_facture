"""
Utility functions to persist uploaded CSV files alongside the database.

The service keeps a copy of each CSV under data/uploads with the structure:
data/uploads/<entreprise>/<category>/<YYYY>/<MM>/<DD>/<timestamp>_<filename>.csv

It also writes a small JSON metadata file next to the CSV so the UI can list
or inspect uploads later without touching the database.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .config import UPLOAD_DIR

logger = logging.getLogger("storage")

UPLOAD_ROOT = UPLOAD_DIR
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

_SAFE_CHARS = re.compile(r"[^A-Za-z0-9_.-]+")


class StorageError(Exception):
    """Raised when a CSV file cannot be persisted to disk."""


def _sanitize(value: Optional[str], fallback: str) -> str:
    """Keep only safe filename characters and return a fallback when empty."""
    if not value:
        return fallback
    cleaned = _SAFE_CHARS.sub("_", value.strip())
    cleaned = cleaned.strip("._")
    return cleaned or fallback


def _build_destination(
    original_name: str,
    entreprise: Optional[str],
    category: str,
    now: datetime,
    upload_id: str,
) -> Path:
    entreprise_dir = _sanitize(entreprise, "sans_entreprise")
    category_dir = _sanitize(category, "misc")
    date_parts = Path(str(now.year)) / f"{now.month:02d}" / f"{now.day:02d}"
    safe_name = _sanitize(Path(original_name).name, "upload.csv")
    filename = f"{now.strftime('%H%M%S_%f')}_{upload_id}_{safe_name}"
    return UPLOAD_ROOT / entreprise_dir / category_dir / date_parts / filename


@dataclass
class StoredCSV:
    path: Path
    metadata_path: Path
    uploaded_at: datetime
    size: int
    upload_id: str
    content_hash: str
    existing: bool = False
    logical_hash: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "upload_id": self.upload_id,
            "path": str(self.path),
            "metadata_path": str(self.metadata_path),
            "uploaded_at": self.uploaded_at.isoformat() + "Z",
            "size": self.size,
            "content_hash": self.content_hash,
            "existing": self.existing,
            "logical_hash": self.logical_hash,
        }


def store_csv_file(
    content: bytes,
    original_name: str,
    category: str,
    entreprise: Optional[str] = None,
    extra_metadata: Optional[Dict[str, Any]] = None,
    logical_hash: Optional[str] = None,
) -> StoredCSV:
    """
    Persist an uploaded CSV to disk and write a metadata sidecar file.

    Args:
        content: Raw CSV bytes.
        original_name: Filename provided by the client.
        category: Logical bucket (ex: aggregate, lines, save).
        entreprise: Optional entreprise name used to group uploads.
        extra_metadata: Additional context stored in the metadata JSON.

    Returns:
        StoredCSV describing the saved file.
    """
    now = datetime.utcnow()
    upload_id = uuid.uuid4().hex
    content_hash = hashlib.sha256(content).hexdigest()

    existing = find_existing_upload(content_hash, entreprise, category, logical_hash)
    if existing:
        rel = existing.get("relative_path")
        if rel:
            existing_path = UPLOAD_ROOT / rel
            if existing_path.exists():
                logger.info(
                    "CSV déjà stocké, réutilisation (entreprise=%s, category=%s, hash=%s)",
                    entreprise or "n/a",
                    category,
                    content_hash[:12],
                )
                meta_path = existing_path.with_suffix(existing_path.suffix + ".json")
                uploaded_at_raw = existing.get("uploaded_at")
                try:
                    uploaded_at = datetime.fromisoformat(str(uploaded_at_raw).replace("Z", ""))
                except Exception:
                    uploaded_at = now
                return StoredCSV(
                    path=existing_path,
                    metadata_path=meta_path,
                    uploaded_at=uploaded_at,
                    size=int(existing.get("size", 0)),
                    upload_id=str(existing.get("upload_id", upload_id)),
                    content_hash=content_hash,
                    existing=True,
                    logical_hash=logical_hash or existing.get("logical_hash"),
                )

    destination = _build_destination(original_name, entreprise, category, now, upload_id)

    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    except OSError as exc:  # pragma: no cover - filesystem errors
        raise StorageError(f"unable to write CSV file: {exc}") from exc

    metadata = {
        "upload_id": upload_id,
        "original_name": original_name,
        "saved_as": destination.name,
        "uploaded_at": now.isoformat() + "Z",
        "entreprise": entreprise,
        "category": category,
        "size": len(content),
        "relative_path": str(destination.relative_to(UPLOAD_ROOT)),
        "content_hash": content_hash,
    }
    if logical_hash:
        metadata["logical_hash"] = logical_hash
    if extra_metadata:
        metadata["extra"] = extra_metadata

    metadata_path = destination.with_suffix(destination.suffix + ".json")
    try:
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=True, indent=2), encoding="utf-8")
    except OSError as exc:  # pragma: no cover - filesystem errors
        raise StorageError(f"unable to write metadata file: {exc}") from exc

    logger.info(
        "CSV stored at %s (entreprise=%s, category=%s, size=%d)",
        destination,
        entreprise or "n/a",
        category,
        len(content),
    )

    return StoredCSV(
        path=destination,
        metadata_path=metadata_path,
        uploaded_at=now,
        size=len(content),
        upload_id=upload_id,
        content_hash=content_hash,
        existing=False,
        logical_hash=logical_hash,
    )


def _iter_metadata_files() -> Iterable[Path]:
    if not UPLOAD_ROOT.exists():
        return []
    return UPLOAD_ROOT.rglob("*.csv.json")


def list_uploads(
    entreprise: Optional[str] = None,
    category: Optional[str] = None,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Return a lightweight list of uploads (parsed metadata), newest first.

    Args:
        entreprise: Optional filter by entreprise name (case-sensitive).
        category: Optional filter by category.
        limit: Optional cap on the number of results.
    """
    results: List[Dict[str, Any]] = []
    for meta_file in sorted(_iter_metadata_files(), reverse=True):
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Impossible de lire la métadonnée %s: %s", meta_file, exc)
            continue
        if entreprise and meta.get("entreprise") != entreprise:
            continue
        if category and meta.get("category") != category:
            continue
        results.append(meta)
        if limit and len(results) >= limit:
            break
    return results


def get_upload(upload_id: str) -> Optional[Dict[str, Any]]:
    """Load metadata for a given upload_id."""
    for meta in list_uploads():
        if meta.get("upload_id") == upload_id:
            return meta
    return None


def load_upload_bytes(upload_id: str) -> bytes:
    """
    Load raw CSV bytes by upload_id.

    Raises:
        FileNotFoundError if the upload is unknown or file missing.
        OSError for IO errors.
    """
    meta = get_upload(upload_id)
    if not meta:
        raise FileNotFoundError(f"upload_id inconnu: {upload_id}")
    rel = meta.get("relative_path")
    if not rel:
        raise FileNotFoundError(f"chemin introuvable pour upload_id {upload_id}")
    return (UPLOAD_ROOT / rel).read_bytes()


def find_existing_upload(
    content_hash: str,
    entreprise: Optional[str],
    category: Optional[str],
    logical_hash: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Look for an existing upload with the same hash (content or logical) + entreprise + category.
    """
    for meta in list_uploads(entreprise=entreprise, category=category):
        if meta.get("content_hash") == content_hash:
            return meta
        if logical_hash and meta.get("logical_hash") == logical_hash:
            return meta
    return None


def delete_upload(upload_id: str) -> bool:
    """
    Delete both CSV and metadata for a given upload_id.

    Returns:
        True if something was deleted, False if not found.
    """
    meta = get_upload(upload_id)
    if not meta:
        return False
    deleted = False
    rel = meta.get("relative_path")
    if rel:
        csv_path = UPLOAD_ROOT / rel
        if csv_path.exists():
            try:
                csv_path.unlink()
                deleted = True
            except OSError as exc:  # pragma: no cover - defensive
                logger.warning("Impossible de supprimer %s: %s", csv_path, exc)
    meta_path = None
    if rel:
        meta_path = (UPLOAD_ROOT / rel).with_suffix((UPLOAD_ROOT / rel).suffix + ".json")
    if meta_path and meta_path.exists():
        try:
            meta_path.unlink()
            deleted = True
        except OSError as exc:  # pragma: no cover - defensive
            logger.warning("Impossible de supprimer %s: %s", meta_path, exc)
    return deleted


def delete_uploads_for_entreprise(entreprise: str) -> int:
    """
    Delete all uploads and metadata for the given entreprise name.

    Returns:
        Number of uploads deleted.
    """
    count = 0
    for meta in list_uploads(entreprise=entreprise):
        if meta_id := meta.get("upload_id"):
            if delete_upload(meta_id):
                count += 1
    return count
