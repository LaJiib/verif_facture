"""
Ajoute les tables `abonnements` et `lignes_abonnements` pour gérer les types d'abonnement liés aux lignes.
Idempotent : si les tables existent déjà, rien n'est modifié.

Usage (PowerShell) :
  python scripts/migrate_add_abonnements.py
  # ou avec un chemin explicite
  python scripts/migrate_add_abonnements.py "C:\\chemin\\vers\\invoices.db"
"""

from __future__ import annotations

import datetime
import shutil
import sqlite3
import sys
from pathlib import Path

try:
    # Même résolution de chemin que le backend (config utilisateur prise en compte)
    from backend.config import DB_PATH  # type: ignore

    DEFAULT_DB = Path(DB_PATH)
except Exception:
    DEFAULT_DB = None


DB_CANDIDATES = [
    DEFAULT_DB,
    Path("backend") / "invoices.db",
    Path("invoices.db"),
    Path.home() / "AppData" / "Local" / "VerifFacture" / "data" / "invoices.db",
]


def find_db() -> Path:
    """Retourne le premier fichier DB existant parmi les emplacements connus."""
    for candidate in DB_CANDIDATES:
        if candidate and candidate.exists():
            return candidate
    raise SystemExit("Aucune base SQLite trouvée (essayé backend/invoices.db et %LOCALAPPDATA%/VerifFacture/data/invoices.db).")


def ensure_table_abonnements(cur: sqlite3.Cursor) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS abonnements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL UNIQUE,
            prix NUMERIC(10,2) NOT NULL DEFAULT 0,
            commentaire TEXT
        );
        """
    )


def ensure_table_lignes_abonnements(cur: sqlite3.Cursor) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS lignes_abonnements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            abonnement_id INTEGER NOT NULL,
            ligne_id INTEGER NOT NULL,
            date DATE,
            UNIQUE(abonnement_id, ligne_id, date),
            FOREIGN KEY(abonnement_id) REFERENCES abonnements(id) ON DELETE CASCADE,
            FOREIGN KEY(ligne_id) REFERENCES lignes(id) ON DELETE CASCADE
        );
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS ix_lignes_abonnements_ligne ON lignes_abonnements(ligne_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_lignes_abonnements_abonnement ON lignes_abonnements(abonnement_id);")


def main() -> None:
    target_db = Path(sys.argv[1]) if len(sys.argv) >= 2 else find_db()

    if not target_db.exists():
        raise SystemExit(f"Base introuvable: {target_db}")

    backup = target_db.with_suffix(f".backup_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}")
    try:
        shutil.copy2(target_db, backup)
        print(f"[BACKUP] Copie de sécurité créée: {backup}")
    except Exception as exc:  # pragma: no cover - protection manuelle
        print(f"[WARN] Impossible de créer la sauvegarde ({exc}), migration interrompue.")
        return

    conn = sqlite3.connect(target_db)
    conn.execute("PRAGMA foreign_keys=ON;")
    cur = conn.cursor()

    ensure_table_abonnements(cur)
    ensure_table_lignes_abonnements(cur)

    conn.commit()
    conn.close()
    print("[DONE] Tables abonnements et lignes_abonnements vérifiées/créées.")


if __name__ == "__main__":
    main()
