"""Configuration utilitaire pour chemins et stockage de la base/exports.

Les chemins peuvent être surchargés via variables d'environnement :
- VERIF_FACTURE_DATA_DIR : dossier racine des données (DB, uploads)
- VERIF_FACTURE_DB_PATH  : chemin complet du fichier SQLite
En l'absence d'override, on persiste un fichier `config.json` dans DATA_DIR avec
un champ `db_path` pour permettre un emplacement personnalisé (ex: partage réseau/SharePoint).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

# Dossier données (par défaut: %LOCALAPPDATA%/VerifFacture/data)
DEFAULT_DATA_DIR = Path(
    os.getenv(
        "VERIF_FACTURE_DATA_DIR",
        Path.home() / "AppData" / "Local" / "VerifFacture" / "data",
    )
)

DATA_DIR = Path(os.getenv("VERIF_FACTURE_DATA_DIR", DEFAULT_DATA_DIR)).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Fichier de config persistant (ex: db_path)
CONFIG_FILE = DATA_DIR / "config.json"


def _load_config_file() -> Dict[str, Any]:
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8")) or {}
    except Exception:
        # En cas de fichier corrompu, on ignore et repart sur une config vide
        return {}


def _save_config_file(data: Dict[str, Any]) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_db_path(path_str: str) -> Path:
    """Normalise un chemin DB: expansion, résolution, et ajout invoices.db si chemin dossier."""
    resolved = Path(path_str).expanduser().resolve()
    if resolved.is_dir():
        resolved = resolved / "invoices.db"
    return resolved


def get_configured_db_path() -> Optional[Path]:
    """Retourne le chemin DB défini dans le fichier de config utilisateur (si présent)."""
    data = _load_config_file()
    raw_path = data.get("db_path")
    if not raw_path:
        return None
    try:
        return _normalize_db_path(raw_path)
    except Exception:
        return None


def persist_db_path(db_path: Optional[str]) -> Tuple[Optional[Path], bool]:
    """Persiste un nouveau chemin DB dans le fichier config.

    Retourne (path, bool) où bool indique si le chemin a été enregistré (False si suppression).
    """
    data = _load_config_file()
    if db_path:
        resolved = _normalize_db_path(db_path)
        data["db_path"] = str(resolved)
        _save_config_file(data)
        return resolved, True
    # suppression => retour au comportement par défaut
    if "db_path" in data:
        data.pop("db_path", None)
        _save_config_file(data)
    return None, False


# Fichier SQLite
DEFAULT_DB_PATH = (DATA_DIR / "invoices.db").resolve()
CONFIG_DB_PATH = get_configured_db_path()

# Source prioritaire: config.json > env > chemin par défaut
_ENV_DB = os.getenv("VERIF_FACTURE_DB_PATH")
if CONFIG_DB_PATH:
    DB_PATH = CONFIG_DB_PATH
    DB_PATH_SOURCE = "config"
elif _ENV_DB:
    DB_PATH = _normalize_db_path(_ENV_DB)
    DB_PATH_SOURCE = "env"
else:
    DB_PATH = DEFAULT_DB_PATH
    DB_PATH_SOURCE = "default"

# URL SQLAlchemy
DATABASE_URL = f"sqlite:///{DB_PATH}"

# Dossier uploads CSV
UPLOAD_DIR = (DATA_DIR / "uploads").resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Dossier rapports PDF générés automatiquement
RAPPORTS_DIR = (DATA_DIR / "rapports").resolve()
RAPPORTS_DIR.mkdir(parents=True, exist_ok=True)
