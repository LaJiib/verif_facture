"""Migration initiale: création des tables entreprise, ligne et record

Revision ID: 001
Revises:
Create Date: 2025-11-20 15:00:00

"""
from alembic import op
import sqlalchemy as sa

# Identifiants de révision
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Crée les tables entreprise, ligne et record."""

    # Table entreprise
    op.create_table(
        'entreprise',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('nom', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('nom')
    )

    # Table ligne
    # Note: SQLite ne supporte pas les ENUM natifs, on utilise String avec contrainte CHECK
    op.create_table(
        'ligne',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('nom', sa.String(length=255), nullable=True),
        sa.Column('type_ligne', sa.String(length=50), nullable=False),
        sa.Column('numero_acces', sa.String(length=100), nullable=False),
        sa.Column('adresse', sa.String(length=500), nullable=True),
        sa.Column('entreprise_id', sa.Integer(), nullable=False),
        sa.CheckConstraint("type_ligne IN ('Internet', 'Internet bas debit', 'Mobile', 'Fixe', 'Fixe secondaire', 'Autre')"),
        sa.ForeignKeyConstraint(['entreprise_id'], ['entreprise.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('numero_acces')
    )
    op.create_index(op.f('ix_ligne_numero_acces'), 'ligne', ['numero_acces'], unique=True)

    # Table record
    op.create_table(
        'record',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('ligne_id', sa.Integer(), nullable=False),
        sa.Column('numero_compte', sa.String(length=100), nullable=False),
        sa.Column('numero_facture', sa.Integer(), nullable=False),
        sa.Column('date', sa.DateTime(), nullable=False),
        sa.Column('mois', sa.String(length=50), nullable=False),
        sa.Column('abo', sa.Float(), nullable=False),
        sa.Column('conso', sa.Float(), nullable=False),
        sa.Column('remise', sa.Float(), nullable=False),
        sa.Column('total_ht', sa.Float(), nullable=False),
        sa.Column('total_ttc', sa.Float(), nullable=False),
        sa.Column('nb_lignes_detail', sa.Integer(), nullable=False),
        sa.Column('statut', sa.String(length=50), nullable=False),
        sa.ForeignKeyConstraint(['ligne_id'], ['ligne.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_record_numero_compte'), 'record', ['numero_compte'], unique=False)
    op.create_index(op.f('ix_record_numero_facture'), 'record', ['numero_facture'], unique=False)


def downgrade() -> None:
    """Supprime les tables dans l'ordre inverse."""
    op.drop_index(op.f('ix_record_numero_facture'), table_name='record')
    op.drop_index(op.f('ix_record_numero_compte'), table_name='record')
    op.drop_table('record')
    op.drop_index(op.f('ix_ligne_numero_acces'), table_name='ligne')
    op.drop_table('ligne')
    op.drop_table('entreprise')
