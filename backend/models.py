"""
Modèles de base de données.

Architecture:
- Entreprise: Client
- Compte: Compte de facturation
- Ligne: Ligne télécom
- Facture: Facture mensuelle d'un compte
- LigneFacture: Détail par ligne pour chaque facture
- FactureReport: Commentaires/statuts de vérification par facture
"""

from datetime import datetime, date
from sqlalchemy import (
    Column,
    Integer,
    String,
    Numeric,
    Date,
    ForeignKey,
    DateTime,
    Text,
    UniqueConstraint,
)
from sqlalchemy.types import JSON
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class Entreprise(Base):
    __tablename__ = "entreprises"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False, unique=True)

    comptes = relationship("Compte", back_populates="entreprise", cascade="all, delete-orphan")
    abonnements = relationship("Abonnement", back_populates="entreprise", cascade="all, delete-orphan")


class Compte(Base):
    __tablename__ = "comptes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    num = Column(String, nullable=False)
    nom = Column(String, nullable=True)
    entreprise_id = Column(Integer, ForeignKey("entreprises.id", ondelete="CASCADE"), nullable=False)
    lot = Column(String, nullable=True)

    __table_args__ = (UniqueConstraint("num", "entreprise_id", name="uix_compte_num_entreprise"),)

    entreprise = relationship("Entreprise", back_populates="comptes")
    lignes = relationship("Ligne", back_populates="compte", cascade="all, delete-orphan")
    factures = relationship("Facture", back_populates="compte", cascade="all, delete-orphan")


class Ligne(Base):
    __tablename__ = "lignes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    num = Column(String, nullable=False)
    type = Column(Integer, nullable=False, default=0)  # 0=Fixe,1=Mobile,2=Internet,3=Autre
    nom = Column(String, nullable=True)
    sous_compte = Column(String, nullable=True)
    compte_id = Column(Integer, ForeignKey("comptes.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (UniqueConstraint("num", "compte_id", name="uix_ligne_num_compte"),)

    compte = relationship("Compte", back_populates="lignes")
    ligne_factures = relationship("LigneFacture", back_populates="ligne", cascade="all, delete-orphan")
    ligne_abonnements = relationship(
        "LigneAbonnement",
        back_populates="ligne",
        cascade="all, delete-orphan",
        overlaps="abonnements,lignes"
    )
    abonnements = relationship(
        "Abonnement",
        secondary="lignes_abonnements",
        back_populates="lignes",
        overlaps="ligne_abonnements,lignes"
    )


class Abonnement(Base):
    __tablename__ = "abonnements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False)
    prix = Column(Numeric(10, 2), nullable=False, default=0)
    commentaire = Column(Text, nullable=True)
    entreprise_id = Column(Integer, ForeignKey("entreprises.id", ondelete="CASCADE"), nullable=True)

    entreprise = relationship("Entreprise", back_populates="abonnements")
    lignes = relationship(
        "Ligne",
        secondary="lignes_abonnements",
        back_populates="abonnements",
        overlaps="ligne_abonnements,abonnements"
    )
    ligne_abonnements = relationship(
        "LigneAbonnement",
        back_populates="abonnement",
        cascade="all, delete-orphan",
        overlaps="lignes,abonnements"
    )

    __table_args__ = (
        UniqueConstraint("nom", "entreprise_id", name="uix_abonnement_nom_entreprise"),
    )


class LigneAbonnement(Base):
    __tablename__ = "lignes_abonnements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    abonnement_id = Column(Integer, ForeignKey("abonnements.id", ondelete="CASCADE"), nullable=False)
    ligne_id = Column(Integer, ForeignKey("lignes.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=True)

    __table_args__ = (UniqueConstraint("abonnement_id", "ligne_id", "date", name="uix_ligne_abonnement"),)

    abonnement = relationship(
        "Abonnement",
        back_populates="ligne_abonnements",
        overlaps="lignes,abonnements,ligne_abonnements"
    )
    ligne = relationship(
        "Ligne",
        back_populates="ligne_abonnements",
        overlaps="lignes,abonnements,ligne_abonnements"
    )


class Facture(Base):
    __tablename__ = "factures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fournisseur = Column(String, nullable=False, default="Orange")
    num = Column(String, nullable=False)
    compte_id = Column(Integer, ForeignKey("comptes.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    abo = Column(Numeric(10, 2), nullable=False, default=0)
    conso = Column(Numeric(10, 2), nullable=False, default=0)
    remises = Column(Numeric(10, 2), nullable=False, default=0)
    achat = Column(Numeric(10, 2), nullable=False, default=0)
    statut = Column(Integer, nullable=False, default=0)  # 0=importe,1=valide,2=conteste
    csv_id = Column(String, nullable=True)  # identifiant d'upload CSV (upload_id)

    __table_args__ = (UniqueConstraint("num", "compte_id", "date", name="uix_facture_num_compte_date"),)

    compte = relationship("Compte", back_populates="factures")
    ligne_factures = relationship("LigneFacture", back_populates="facture", cascade="all, delete-orphan")
    report = relationship("FactureReport", back_populates="facture", cascade="all, delete-orphan", uselist=False)

    @property
    def total_ht(self):
        return float(self.abo) + float(self.conso) + float(self.remises) + float(self.achat)


class LigneFacture(Base):
    __tablename__ = "lignes_factures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    facture_id = Column(Integer, ForeignKey("factures.id", ondelete="CASCADE"), nullable=False)
    ligne_id = Column(Integer, ForeignKey("lignes.id", ondelete="CASCADE"), nullable=False)
    abo = Column(Numeric(10, 2), nullable=False, default=0)
    conso = Column(Numeric(10, 2), nullable=False, default=0)
    remises = Column(Numeric(10, 2), nullable=False, default=0)
    achat = Column(Numeric(10, 2), nullable=False, default=0)
    statut = Column(Integer, nullable=False, default=0)  # 0=importe,1=valide,2=conteste

    __table_args__ = (UniqueConstraint("facture_id", "ligne_id", name="uix_lignefacture_facture_ligne"),)

    facture = relationship("Facture", back_populates="ligne_factures")
    ligne = relationship("Ligne", back_populates="ligne_factures")

    @property
    def total_ht(self):
        return float(self.abo) + float(self.conso) + float(self.remises) + float(self.achat)


class FactureReport(Base):
    __tablename__ = "facture_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    facture_id = Column(Integer, ForeignKey("factures.id", ondelete="CASCADE"), unique=True, nullable=False)
    commentaire = Column(Text, nullable=True)
    data = Column(JSON, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    facture = relationship("Facture", back_populates="report")
