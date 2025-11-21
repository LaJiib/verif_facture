"""
Script de test pour vérifier la persistence en base de données.

Usage:
    python backend/test_persistence.py
"""

import sys
from pathlib import Path

# Ajouter le dossier src au path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from database import SessionLocal, engine
from models import Base, Entreprise, Ligne, Record
from telecom_invoice import TelecomInvoiceProcessor
from invoice_saver import save_aggregated_invoices


def test_persistence():
    """Test simple de la persistence."""

    print("=" * 60)
    print("TEST DE PERSISTENCE")
    print("=" * 60)

    # 1. Créer les tables si elles n'existent pas
    print("\n1. Création des tables...")
    Base.metadata.create_all(bind=engine)
    print("   ✅ Tables créées")

    # 2. Vérifier qu'un fichier CSV existe
    csv_path = Path("data/csv_examples")
    if not csv_path.exists():
        print(f"\n❌ Dossier {csv_path} introuvable")
        print("   Créez le dossier et ajoutez un fichier CSV d'exemple")
        return

    csv_files = list(csv_path.glob("*.csv"))
    if not csv_files:
        print(f"\n❌ Aucun fichier CSV dans {csv_path}")
        print("   Ajoutez un fichier CSV d'exemple pour tester")
        return

    test_file = csv_files[0]
    print(f"\n2. Fichier de test: {test_file.name}")

    # 3. Charger et agréger le CSV
    print("\n3. Chargement du CSV...")
    processor = TelecomInvoiceProcessor()
    try:
        processor.load_csv(test_file, silent=False)
        print(f"   ✅ {len(processor.data)} lignes chargées")
    except Exception as e:
        print(f"   ❌ Erreur: {e}")
        return

    print("\n4. Agrégation des données...")
    aggregated = processor.aggregate_by_account()
    total_factures = sum(len(v["factures"]) for v in aggregated.values())
    print(f"   ✅ {len(aggregated)} comptes, {total_factures} factures")

    # 5. Sauvegarder en base
    print("\n5. Sauvegarde en base de données...")
    db = SessionLocal()
    try:
        stats = save_aggregated_invoices(processor, db, "Test Entreprise")
        print(f"   ✅ Lignes créées: {stats['lignes_created']}")
        print(f"   ✅ Records créés: {stats['records_created']}")
        print(f"   ✅ Records ignorés (doublons): {stats['records_skipped']}")
    except Exception as e:
        print(f"   ❌ Erreur: {e}")
        db.rollback()
        return
    finally:
        db.close()

    # 6. Vérifier les données en base
    print("\n6. Vérification des données...")
    db = SessionLocal()
    try:
        nb_entreprises = db.query(Entreprise).count()
        nb_lignes = db.query(Ligne).count()
        nb_records = db.query(Record).count()

        print(f"   ✅ Entreprises en base: {nb_entreprises}")
        print(f"   ✅ Lignes en base: {nb_lignes}")
        print(f"   ✅ Records en base: {nb_records}")

        # Afficher un exemple
        if nb_records > 0:
            record = db.query(Record).first()
            print(f"\n   Exemple de record:")
            print(f"   - Facture: {record.numero_facture}")
            print(f"   - Mois: {record.mois}")
            print(f"   - Total HT: {record.total_ht:.2f}€")
            print(f"   - Type ligne: {record.ligne.type_ligne}")
    finally:
        db.close()

    print("\n" + "=" * 60)
    print("✅ TEST RÉUSSI")
    print("=" * 60)
    print("\nPour consulter la base:")
    print("  sqlite3 data/verif_facture.db")
    print("  > SELECT * FROM entreprise;")
    print("  > SELECT * FROM ligne LIMIT 5;")
    print("  > SELECT * FROM record LIMIT 5;")
    print()


if __name__ == "__main__":
    test_persistence()
