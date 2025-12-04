"""Point d'entrée packagé : démarre FastAPI et ouvre le navigateur."""

from __future__ import annotations

import os
import sys
import webbrowser
from pathlib import Path

import uvicorn


def main() -> None:
    root = Path(__file__).resolve().parent
    src_dir = root / "src"
    if src_dir.exists() and str(src_dir) not in sys.path:
        sys.path.insert(0, str(src_dir))

    # Optionnel: forcer le dossier de données pour une installation portable
    # os.environ.setdefault("VERIF_FACTURE_DATA_DIR", str(root / "data"))

    url = "http://127.0.0.1:8000/"
    webbrowser.open_new_tab(url)

    # Désactive la config logging par défaut d'uvicorn (échec sans console dans l'exe)
    uvicorn.run(
        "backend.api:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
