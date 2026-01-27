"""ajout colonnes nom et sous_compte sur lignes

Revision ID: 20260123_add_ligne_metadata
Revises: b3fa553fab7c
Create Date: 2026-01-23 12:00:00
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260123_add_ligne_metadata"
down_revision = "b3fa553fab7c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lignes", sa.Column("nom", sa.String(), nullable=True))
    op.add_column("lignes", sa.Column("sous_compte", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("lignes", "sous_compte")
    op.drop_column("lignes", "nom")
