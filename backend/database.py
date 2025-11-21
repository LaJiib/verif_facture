"""
Configuration de la connexion à la base de données SQLite.

Simple et direct: un moteur SQLAlchemy et un générateur de sessions.
Le fichier SQLite est stocké localement dans data/verif_facture.db
"""

import os
import logging
from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

# Logger pour la base de données
logger = logging.getLogger("database")

# Dossier de stockage de la base de données
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# Chemin vers le fichier SQLite
DB_PATH = DATA_DIR / "verif_facture.db"

# Vérifier si la base existe déjà
db_exists = DB_PATH.exists()
if db_exists:
    db_size = DB_PATH.stat().st_size / 1024  # Taille en Ko
    logger.info(f"Base de données existante: {DB_PATH} ({db_size:.1f} Ko)")
else:
    logger.info(f"Nouvelle base de données sera créée: {DB_PATH}")

# URL de connexion SQLite
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DB_PATH}"
)

# Activer le mode debug SQL via variable d'environnement
DEBUG_SQL = os.getenv("DEBUG_SQL", "false").lower() == "true"

# Moteur SQLAlchemy
# check_same_thread=False nécessaire pour FastAPI (multi-threading)
engine = create_engine(
    DATABASE_URL,
    echo=DEBUG_SQL,  # Affiche les requêtes SQL si DEBUG_SQL=true
    connect_args={"check_same_thread": False}
)

# Logger les connexions (pour debug)
@event.listens_for(engine, "connect")
def receive_connect(dbapi_conn, connection_record):
    logger.debug("Nouvelle connexion SQLite établie")

# Factory pour créer des sessions
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


def get_db() -> Generator[Session, None, None]:
    """
    Générateur de session de base de données pour FastAPI.

    Usage dans un endpoint:
        @app.get("/exemple")
        def exemple(db: Session = Depends(get_db)):
            # utiliser db ici
            pass

    La session est automatiquement fermée après la requête.
    """
    db = SessionLocal()
    logger.debug("Session DB créée")
    try:
        yield db
        logger.debug("Session DB utilisée avec succès")
    except Exception as e:
        logger.error(f"Erreur dans la session DB: {e}")
        db.rollback()
        raise
    finally:
        db.close()
        logger.debug("Session DB fermée")
