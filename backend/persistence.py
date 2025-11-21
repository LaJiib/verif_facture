"""
Module de persistence pour sauvegarder les données de facturation en base.

Logique simple:
1. Créer/récupérer une entreprise par défaut
2. Pour chaque ligne du CSV, vérifier si elle existe (par numéro d'accès)
   - Si non, créer la ligne avec détection automatique du type
3. Pour chaque record, vérifier s'il existe déjà (même facture + même ligne)
   - Si non, insérer le record
"""

import logging
from typing import Dict, Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime

from models import Entreprise, Ligne, Record, TypeLigne

# Logger pour la persistence
logger = logging.getLogger("persistence")


class InvoicePersistence:
    """Gestionnaire de persistence pour les factures télécom."""

    def __init__(self, db: Session):
        """
        Initialise le gestionnaire de persistence.

        Args:
            db: Session SQLAlchemy active
        """
        self.db = db
        logger.debug("InvoicePersistence initialisé")

    def get_or_create_default_entreprise(self, nom: str = "Par défaut") -> Entreprise:
        """
        Récupère ou crée l'entreprise par défaut.

        Args:
            nom: Nom de l'entreprise par défaut

        Returns:
            L'instance Entreprise
        """
        logger.debug(f"Recherche entreprise '{nom}'")
        entreprise = self.db.execute(
            select(Entreprise).where(Entreprise.nom == nom)
        ).scalar_one_or_none()

        if not entreprise:
            logger.info(f"Création nouvelle entreprise '{nom}'")
            entreprise = Entreprise(nom=nom)
            self.db.add(entreprise)
            self.db.commit()
            self.db.refresh(entreprise)
            logger.info(f"Entreprise créée: id={entreprise.id}")
        else:
            logger.debug(f"Entreprise existante: id={entreprise.id}")

        return entreprise

    def get_or_create_ligne(
        self,
        numero_acces: str,
        type_ligne: str,
        entreprise_id: int,
        nom: Optional[str] = None,
        adresse: Optional[str] = None
    ) -> tuple[Ligne, bool]:
        """
        Récupère ou crée une ligne télécom par numéro d'accès.

        Args:
            numero_acces: Numéro d'accès unique (téléphone, ligne ADSL, etc.)
            type_ligne: Type de ligne (Internet, Fixe, Mobile, etc.)
            entreprise_id: ID de l'entreprise propriétaire
            nom: Nom/description optionnelle de la ligne
            adresse: Adresse optionnelle

        Returns:
            Tuple (ligne, created) où created est True si la ligne a été créée
        """
        # Vérifier si la ligne existe déjà
        logger.debug(f"Recherche ligne: numero_acces='{numero_acces}'")
        ligne = self.db.execute(
            select(Ligne).where(Ligne.numero_acces == numero_acces)
        ).scalar_one_or_none()

        if ligne:
            # Ligne existante : mettre à jour les informations si nécessaires
            logger.debug(f"Ligne existante: id={ligne.id}, type={ligne.type_ligne}")
            updated = False
            if nom and not ligne.nom:
                ligne.nom = nom
                updated = True
            if adresse and not ligne.adresse:
                ligne.adresse = adresse
                updated = True
            if updated:
                self.db.commit()
                self.db.refresh(ligne)
                logger.debug(f"Ligne mise à jour: id={ligne.id}")
            return ligne, False  # Ligne existante, pas créée

        # Créer une nouvelle ligne
        logger.info(f"Création nouvelle ligne: numero_acces='{numero_acces}', type='{type_ligne}'")
        ligne = Ligne(
            numero_acces=numero_acces,
            type_ligne=type_ligne,
            entreprise_id=entreprise_id,
            nom=nom,
            adresse=adresse
        )
        self.db.add(ligne)
        self.db.commit()
        self.db.refresh(ligne)
        logger.info(f"Ligne créée: id={ligne.id}")
        return ligne, True  # Ligne créée

    def record_exists(
        self,
        ligne_id: int,
        numero_facture: int,
        date: datetime
    ) -> bool:
        """
        Vérifie si un record existe déjà pour une ligne/facture/date donnée.

        Args:
            ligne_id: ID de la ligne
            numero_facture: Numéro de facture
            date: Date de facturation

        Returns:
            True si le record existe, False sinon
        """
        record = self.db.execute(
            select(Record).where(
                Record.ligne_id == ligne_id,
                Record.numero_facture == numero_facture,
                Record.date == date
            )
        ).scalar_one_or_none()

        exists = record is not None
        if exists:
            logger.debug(f"Record existe: ligne_id={ligne_id}, facture={numero_facture}")
        return exists

    def create_record(
        self,
        ligne_id: int,
        numero_compte: str,
        numero_facture: int,
        date: datetime,
        mois: str,
        abo: float,
        conso: float,
        remise: float,
        total_ht: float,
        total_ttc: float,
        nb_lignes_detail: int,
        statut: str = "Validee"
    ) -> Record:
        """
        Crée un nouveau record de facturation.

        Args:
            ligne_id: ID de la ligne
            numero_compte: Numéro de compte de facturation
            numero_facture: Numéro de facture
            date: Date de facturation
            mois: Nom du mois (ex: "Novembre")
            abo: Montant abonnements HT
            conso: Montant consommations HT
            remise: Montant remises HT
            total_ht: Total HT
            total_ttc: Total TTC
            nb_lignes_detail: Nombre de lignes de détail
            statut: Statut de la facture

        Returns:
            Le Record créé
        """
        logger.info(f"Création record: facture={numero_facture}, mois={mois}, total_ht={total_ht:.2f}€")
        record = Record(
            ligne_id=ligne_id,
            numero_compte=numero_compte,
            numero_facture=numero_facture,
            date=date,
            mois=mois,
            abo=abo,
            conso=conso,
            remise=remise,
            total_ht=total_ht,
            total_ttc=total_ttc,
            nb_lignes_detail=nb_lignes_detail,
            statut=statut
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)
        logger.info(f"Record créé: id={record.id}")
        return record

    def save_aggregated_data(
        self,
        aggregated_data: Dict,
        entreprise_id: int,
        type_classifier_func=None
    ) -> Dict[str, int]:
        """
        Sauvegarde les données agrégées en base de données.

        Args:
            aggregated_data: Données agrégées par compte (format TelecomInvoiceProcessor)
            entreprise_id: ID de l'entreprise à laquelle rattacher les lignes
            type_classifier_func: Fonction pour classifier le type de ligne (optionnel)

        Returns:
            Statistiques de sauvegarde: {"lignes_created": X, "records_created": Y, "records_skipped": Z}
        """
        logger.info(f"Début sauvegarde: {len(aggregated_data)} comptes à traiter")
        stats = {
            "lignes_created": 0,
            "records_created": 0,
            "records_skipped": 0
        }

        # Pour chaque compte de facturation
        for idx, (numero_compte, compte_data) in enumerate(aggregated_data.items(), 1):
            logger.debug(f"Traitement compte {idx}/{len(aggregated_data)}: {numero_compte}")
            factures = compte_data.get("factures", {})

            # Pour chaque facture du compte
            for numero_facture, invoice_breakdown in factures.items():
                # Le numéro d'accès est le numero_compte pour simplifier
                # (dans les données Orange, le compte représente souvent une ligne principale)
                numero_acces = numero_compte

                # Déterminer le type de ligne
                # Par défaut "Autre", ou utiliser la fonction de classification fournie
                type_ligne = "Autre"
                if type_classifier_func:
                    type_ligne = type_classifier_func(numero_compte, compte_data)

                # Créer ou récupérer la ligne
                ligne, created = self.get_or_create_ligne(
                    numero_acces=numero_acces,
                    type_ligne=type_ligne,
                    entreprise_id=entreprise_id,
                    nom=f"Compte {numero_compte}"
                )

                if created:
                    stats["lignes_created"] += 1

                # Vérifier si le record existe déjà
                if self.record_exists(
                    ligne_id=ligne.id,
                    numero_facture=numero_facture,
                    date=invoice_breakdown.date
                ):
                    stats["records_skipped"] += 1
                    continue

                # Extraire les montants
                montants = invoice_breakdown.montants
                abo = montants.get("Abo", 0.0)
                conso = montants.get("Conso", 0.0)
                remise = montants.get("Remise", 0.0)

                # Créer le record
                self.create_record(
                    ligne_id=ligne.id,
                    numero_compte=numero_compte,
                    numero_facture=numero_facture,
                    date=invoice_breakdown.date,
                    mois=invoice_breakdown.mois,
                    abo=abo,
                    conso=conso,
                    remise=remise,
                    total_ht=invoice_breakdown.total,
                    total_ttc=invoice_breakdown.total_ttc,
                    nb_lignes_detail=invoice_breakdown.nb_lignes_detail,
                    statut=invoice_breakdown.statut
                )
                stats["records_created"] += 1

        logger.info(
            f"Sauvegarde terminée: {stats['lignes_created']} lignes créées, "
            f"{stats['records_created']} records créés, {stats['records_skipped']} records ignorés"
        )
        return stats
