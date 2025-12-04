"""Configuration utilitaire pour chemins et stockage de la base/exports.

L'objectif est de séparer les binaires installés des données utilisateur.
Les chemins peuvent être surchargés via variables d'environnement :
- VERIF_FACTURE_DATA_DIR : dossier racine des données (DB, uploads)
- VERIF_FACTURE_DB_PATH  : chemin complet du fichier SQLite
"""

from __future__ import annotations

import os
from pathlib import Path

# Dossier données (par défaut: %LOCALAPPDATA%/VerifFacture/data)
DEFAULT_DATA_DIR = Path(
    os.getenv(
        "VERIF_FACTURE_DATA_DIR",
        Path.home() / "AppData" / "Local" / "VerifFacture" / "data",
    )
)

DATA_DIR = Path(os.getenv("VERIF_FACTURE_DATA_DIR", DEFAULT_DATA_DIR)).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Fichier SQLite
DB_PATH = Path(
    os.getenv(
        "VERIF_FACTURE_DB_PATH",
        DATA_DIR / "invoices.db",
    )
).resolve()

# URL SQLAlchemy
DATABASE_URL = f"sqlite:///{DB_PATH}"

# Dossier uploads CSV
UPLOAD_DIR = (DATA_DIR / "uploads").resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
