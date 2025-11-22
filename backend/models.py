"""
Modèles de base de données restructurés.

Architecture:
- Entreprise: Entité de haut niveau (client)
- Compte: Compte de facturation (ex: numéro de compte Orange dans colonne "Numéro compte")
- Ligne: Ligne télécom (numéro d'accès, téléphone, internet, etc.)
- Facture: Facture mensuelle d'un compte avec montants globaux
- LigneFacture: Table de liaison many-to-many entre Facture et Ligne avec détails par ligne
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
    Table des comptes de facturation.

    Correspond au numéro de compte chez le fournisseur (ex: colonne "Numéro compte" dans CSV Orange).
    """

    __tablename__ = "comptes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    num = Column(String, nullable=False)  # Numéro de compte (ex: "123456789")
    nom = Column(String, nullable=True)  # Nom du compte (optionnel)
    entreprise_id = Column(Integer, ForeignKey("entreprises.id", ondelete="CASCADE"), nullable=False)
    lot = Column(String, nullable=True)  # Subdivision optionnelle (ex: "Lot 1", "Siège")

    # Contrainte: un numéro de compte unique par entreprise
    __table_args__ = (
        UniqueConstraint("num", "entreprise_id", name="uix_compte_num_entreprise"),
    )

    # Relations
    entreprise = relationship("Entreprise", back_populates="comptes")
    lignes = relationship("Ligne", back_populates="compte", cascade="all, delete-orphan")
    factures = relationship("Facture", back_populates="compte", cascade="all, delete-orphan")


class Ligne(Base):
    """
    Table des lignes télécom (numéros d'accès).

    Représente une ligne télécom/internet avec son numéro d'accès.
    """

    __tablename__ = "lignes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    num = Column(String, nullable=False)  # Numéro d'accès (ex: "0546982410")
    type = Column(String, nullable=False)  # Type: Internet, Fixe, Mobile, etc.
    compte_id = Column(Integer, ForeignKey("comptes.id", ondelete="CASCADE"), nullable=False)

    # Contrainte: un numéro d'accès unique par compte
    __table_args__ = (
        UniqueConstraint("num", "compte_id", name="uix_ligne_num_compte"),
    )

    # Relations
    compte = relationship("Compte", back_populates="lignes")
    ligne_factures = relationship("LigneFacture", back_populates="ligne", cascade="all, delete-orphan")


class Facture(Base):
    """
    Table des factures mensuelles.

    Une facture contient les montants globaux pour un compte sur un mois.
    """

    __tablename__ = "factures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fournisseur = Column(String, nullable=False, default="Orange")  # Orange, SFR, Bouygues, etc.
    num = Column(String, nullable=False)  # Numéro de facture
    compte_id = Column(Integer, ForeignKey("comptes.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)  # Date de facturation
    abo = Column(Numeric(10, 2), nullable=False, default=0)  # Total abonnements
    conso = Column(Numeric(10, 2), nullable=False, default=0)  # Total consommations
    remises = Column(Numeric(10, 2), nullable=False, default=0)  # Total remises
    achat = Column(Numeric(10, 2), nullable=False, default=0)  # Total achats
    statut = Column(String, nullable=False, default="importé")  # importé, validé, contesté

    # Contrainte: une seule facture par (numéro, compte, date)
    __table_args__ = (
        UniqueConstraint("num", "compte_id", "date", name="uix_facture_num_compte_date"),
    )

    # Relations
    compte = relationship("Compte", back_populates="factures")
    ligne_factures = relationship("LigneFacture", back_populates="facture", cascade="all, delete-orphan")

    @property
    def total_ht(self):
        """Calcul du total HT."""
        return float(self.abo) + float(self.conso) + float(self.remises) + float(self.achat)


class LigneFacture(Base):
    """
    Table de liaison many-to-many entre Facture et Ligne.

    Contient les montants détaillés par ligne pour une facture donnée.
    """

    __tablename__ = "lignes_factures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    facture_id = Column(Integer, ForeignKey("factures.id", ondelete="CASCADE"), nullable=False)
    ligne_id = Column(Integer, ForeignKey("lignes.id", ondelete="CASCADE"), nullable=False)
    abo = Column(Numeric(10, 2), nullable=False, default=0)  # Abonnement de cette ligne
    conso = Column(Numeric(10, 2), nullable=False, default=0)  # Consommation de cette ligne
    remises = Column(Numeric(10, 2), nullable=False, default=0)  # Remises sur cette ligne
    achat = Column(Numeric(10, 2), nullable=False, default=0)  # Achats sur cette ligne

    # Contrainte: une seule entrée par (facture, ligne)
    __table_args__ = (
        UniqueConstraint("facture_id", "ligne_id", name="uix_lignefacture_facture_ligne"),
    )

    # Relations
    facture = relationship("Facture", back_populates="ligne_factures")
    ligne = relationship("Ligne", back_populates="ligne_factures")

    @property
    def total_ht(self):
        """Calcul du total HT pour cette ligne."""
        return float(self.abo) + float(self.conso) + float(self.remises) + float(self.achat)
