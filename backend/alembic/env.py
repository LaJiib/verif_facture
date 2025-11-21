"""
Configuration de l'environnement Alembic pour les migrations.

Ce fichier est exécuté par Alembic pour configurer les migrations.
"""

import os
import sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

# Ajouter le dossier racine au path pour importer les modèles
backend_dir = os.path.dirname(os.path.dirname(__file__))
root_dir = os.path.dirname(backend_dir)
sys.path.insert(0, root_dir)

# Importer la classe de base et tous les modèles
from backend.models import Base
from backend.database import DATABASE_URL

# Configuration Alembic
config = context.config

# Configurer les logs depuis alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Métadonnées des modèles SQLAlchemy (pour autogenerate)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    Exécute les migrations en mode 'offline'.

    Configure le contexte avec juste l'URL, sans Engine.
    Utile pour générer des scripts SQL sans connexion à la BDD.
    """
    url = DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Exécute les migrations en mode 'online'.

    Crée une connexion à la BDD et exécute les migrations.
    Mode par défaut lors de l'exécution de `alembic upgrade`.
    """
    # Surcharger l'URL de connexion depuis la variable d'environnement
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = DATABASE_URL

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


# Détermine le mode d'exécution
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
