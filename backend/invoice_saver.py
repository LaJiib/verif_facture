"""
Utilitaire pour sauvegarder les factures agrégées en base de données.

Fait le pont entre le TelecomInvoiceProcessor et la persistence SQLite.
"""

import sys
from pathlib import Path

# Ajouter le dossier src au path pour importer telecom_invoice
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from typing import Dict
from sqlalchemy.orm import Session

from persistence import InvoicePersistence
from telecom_invoice.processor import TelecomInvoiceProcessor


def classify_ligne_type_from_account(
    processor: TelecomInvoiceProcessor,
    numero_compte: str
) -> str:
    """
    Détermine le type d'une ligne en analysant les données du compte.

    Stratégie simple: on regarde les types d'accès des lignes du compte
    et on prend le type le plus fréquent.

    Args:
        processor: Instance du TelecomInvoiceProcessor avec données chargées
        numero_compte: Numéro du compte à classifier

    Returns:
        Type de ligne: "Internet", "Mobile", "Fixe", etc.
    """
    if processor.data is None:
        return "Autre"

    # Filtrer les lignes du compte
    df = processor.data
    compte_col = processor.col("numero_compte")
    type_acces_col = processor.col("type_acces")

    compte_data = df[df[compte_col] == numero_compte]

    if compte_data.empty:
        return "Autre"

    # Compter les types d'accès
    type_counts = {}
    for _, row in compte_data.iterrows():
        type_acces = row.get(type_acces_col, "")
        ligne_type = processor.classify_access_type(
            value=type_acces,
            account=numero_compte
        )
        type_counts[ligne_type] = type_counts.get(ligne_type, 0) + 1

    # Retourner le type le plus fréquent
    if not type_counts:
        return "Autre"

    return max(type_counts, key=type_counts.get)


def save_aggregated_invoices(
    processor: TelecomInvoiceProcessor,
    db: Session,
    entreprise_name: str = "Par défaut"
) -> Dict[str, int]:
    """
    Sauvegarde les factures agrégées en base de données.

    Args:
        processor: Instance du TelecomInvoiceProcessor avec données agrégées
        db: Session SQLAlchemy
        entreprise_name: Nom de l'entreprise (créée si inexistante)

    Returns:
        Statistiques de sauvegarde

    Example:
        >>> from database import SessionLocal
        >>> from telecom_invoice import TelecomInvoiceProcessor
        >>> processor = TelecomInvoiceProcessor()
        >>> processor.load_csv("data.csv")
        >>> processor.aggregate_by_account()
        >>> db = SessionLocal()
        >>> stats = save_aggregated_invoices(processor, db)
        >>> print(stats)
        {'lignes_created': 5, 'records_created': 12, 'records_skipped': 0}
    """
    if not processor.aggregated_data:
        raise ValueError(
            "Aucune donnée agrégée. Appelez aggregate_by_account() d'abord."
        )

    # Initialiser la persistence
    persistence = InvoicePersistence(db)

    # Créer ou récupérer l'entreprise
    entreprise = persistence.get_or_create_default_entreprise(entreprise_name)

    # Fonction de classification avec accès au processor
    def type_classifier(numero_compte: str, compte_data: Dict) -> str:
        return classify_ligne_type_from_account(processor, numero_compte)

    # Sauvegarder toutes les données
    stats = persistence.save_aggregated_data(
        aggregated_data=processor.aggregated_data,
        entreprise_id=entreprise.id,
        type_classifier_func=type_classifier
    )

    return stats
