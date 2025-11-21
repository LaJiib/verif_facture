"""
Modèles de base de données simplifiés.

Architecture:
- Entreprise: Entité de haut niveau (client)
- Compte: Ligne de facturation (compte Orange, etc.) liée à une entreprise
- Facture: Facture mensuelle pour un compte avec montants détaillés
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Numeric,
    Date,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class Entreprise(Base):
    """Table des entreprises (clients)."""

    __tablename__ = "entreprises"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False, unique=True)

    # Relations
    comptes = relationship("Compte", back_populates="entreprise", cascade="all, delete-orphan")


class Compte(Base):
    """
    Table des comptes de facturation (lignes télécom).

    Un compte représente une ligne télécom avec son numéro d'accès.
    """

    __tablename__ = "comptes"

    id = Column(String, primary_key=True)  # Numéro d'accès (ex: "0546982410")
    type = Column(String, nullable=False)  # Internet, Fixe, Mobile, etc.
    entreprise_id = Column(Integer, ForeignKey("entreprises.id", ondelete="CASCADE"), nullable=False)
    lot = Column(String, nullable=True)  # Subdivision optionnelle (ex: "Lot 1", "Siège", etc.)

    # Relations
    entreprise = relationship("Entreprise", back_populates="comptes")
    factures = relationship("Facture", back_populates="compte", cascade="all, delete-orphan")


class Facture(Base):
    """
    Table des factures mensuelles.

    Une facture contient les montants détaillés (Abo, Conso, Remises) pour un compte sur un mois.
    """

    __tablename__ = "factures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    numero_facture = Column(Integer, nullable=False)
    compte_id = Column(String, ForeignKey("comptes.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    abo = Column(Numeric(10, 2), nullable=False, default=0)
    conso = Column(Numeric(10, 2), nullable=False, default=0)
    remise = Column(Numeric(10, 2), nullable=False, default=0)
    statut = Column(String, nullable=False, default="importee")  # importee, validee, contestee

    # Contrainte d'unicité: un seul enregistrement par (compte, date)
    __table_args__ = (
        UniqueConstraint("compte_id", "date", name="uix_compte_date"),
    )

    # Relations
    compte = relationship("Compte", back_populates="factures")

    @property
    def total_ht(self):
        """Calcul du total HT."""
        return float(self.abo) + float(self.conso) + float(self.remise)
