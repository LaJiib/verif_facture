"""
Ajoute la colonne `statut` (0=importe,1=valide,2=conteste) sur la table `lignes_factures`.
Peut être exécuté plusieurs fois sans risque : si la colonne existe déjà, rien n'est fait.

Usage (PowerShell) :
  @"
  python scripts/migrate_add_ligne_statut.py
  "@ | powershell -NoProfile -ExecutionPolicy Bypass
"""

from pathlib import Path
import sqlite3

try:
    # Utilise la même résolution de chemin que le backend (AppData/VerifFacture/data/invoices.db par défaut)
    from backend.config import DB_PATH  # type: ignore
    DEFAULT_DB = Path(DB_PATH)
except Exception:
    DEFAULT_DB = None

DB_PATHS = [
    DEFAULT_DB,
    Path("backend") / "invoices.db",
    Path("invoices.db"),
    Path.home() / "AppData" / "Local" / "VerifFacture" / "data" / "invoices.db",
]


def find_db() -> Path:
    for p in DB_PATHS:
        if p and Path(p).exists():
            return Path(p)
    raise SystemExit("Aucune base SQLite trouvée (essayé backend/invoices.db et %LOCALAPPDATA%/VerifFacture/data/invoices.db).")


def column_exists(cur: sqlite3.Cursor, table: str, column: str) -> bool:
    cur.execute(f"PRAGMA table_info({table});")
    return any(row[1] == column for row in cur.fetchall())


def table_exists(cur: sqlite3.Cursor, table: str) -> bool:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?;", (table,))
    return cur.fetchone() is not None


def main():
    db_path = find_db()
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    if not table_exists(cur, "lignes_factures"):
        print(f"[WARN] Table lignes_factures absente dans {db_path}. Lancez l'app/backend une fois pour initialiser la DB.")
        return

    if column_exists(cur, "lignes_factures", "statut"):
        print(f"[OK] Colonne statut déjà présente dans {db_path}")
        return

    print(f"[MIGRATION] Ajout colonne statut -> {db_path}")
    cur.execute("ALTER TABLE lignes_factures ADD COLUMN statut INTEGER NOT NULL DEFAULT 0;")
    conn.commit()
    print("[DONE] Colonne statut ajoutée avec valeur par défaut 0.")


if __name__ == "__main__":
    main()
