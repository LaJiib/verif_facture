"""FastAPI application for the v2 backend (read/cmd/view/usecase)."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from . import database as _db
from .config import DATABASE_URL, DEFAULT_DB_PATH, DB_PATH, persist_db_path
from .database import init_engine
from .models import Base

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("api_v2")

_fallback_warning: str | None = None

try:
    init_engine(DATABASE_URL)
    Base.metadata.create_all(bind=_db.engine)
except Exception as e:
    _bad_path = str(DB_PATH)
    logger.warning("DB inaccessible (%s): %s — reset vers chemin par défaut", _bad_path, e)
    persist_db_path(None)
    _fallback_warning = f"Base inaccessible ({_bad_path}), retour au chemin par défaut."
    init_engine(f"sqlite:///{DEFAULT_DB_PATH}")
    Base.metadata.create_all(bind=_db.engine)

from .api_v2 import read, cmd, view, usecase, config as config_routes


# File logging (rotating) for backend
from .config import DATA_DIR
LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "backend.log"
if not any(isinstance(h, RotatingFileHandler) for h in logging.getLogger().handlers):
    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    logging.getLogger().addHandler(file_handler)



def create_app() -> FastAPI:
    app = FastAPI(title="Vérification Factures Télécom - API v2", version="2.0.0")

    allowed_origins = [
        os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
        os.getenv("FRONTEND_ORIGIN_ALT", "http://127.0.0.1:5173"),
    ]
    allowed_origins = [o for o in allowed_origins if o]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        logger.info("REQ %s %s", request.method, request.url.path)
        response = await call_next(request)
        logger.info("RES %s %s -> %s", request.method, request.url.path, response.status_code)
        return response

    # Static assets (frontend build) if present
    static_dir = Path(__file__).parent / "static"
    assets_dir = static_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    index_file = static_dir / "index.html"
    if index_file.exists():
        @app.get("/", include_in_schema=False)
        def serve_index():
            return FileResponse(index_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    # Routers v2
    app.include_router(read.router)
    app.include_router(cmd.router)
    app.include_router(view.router)
    app.include_router(usecase.router)
    app.include_router(config_routes.router)

    @app.get("/health")
    def health():
        return {"status": "ok", "version": "v2", "fallback_warning": _fallback_warning}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
