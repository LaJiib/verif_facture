"""FastAPI application for the v2 backend (read/cmd/view/usecase)."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import engine
from .models import Base
from .api_v2 import read, cmd, view, usecase, config as config_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("api_v2")

# Ensure DB schema exists
Base.metadata.create_all(bind=engine)


def create_app() -> FastAPI:
    app = FastAPI(title="Vérification Factures Télécom - API v2", version="2.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
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
            return FileResponse(index_file)

    # Routers v2
    app.include_router(read.router)
    app.include_router(cmd.router)
    app.include_router(view.router)
    app.include_router(usecase.router)
    app.include_router(config_routes.router)

    @app.get("/health")
    def health():
        return {"status": "ok", "version": "v2"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
