# Base de données - Guide de démarrage

## Architecture

Le système utilise **SQLite** pour stocker les données de facturation de manière persistante.
SQLite est une base de données locale stockée dans un fichier unique, parfaite pour une application mono-utilisateur.

### Schéma de données

```
Entreprise (client/collectivité)
    ├── Ligne (ligne télécom: fixe, mobile, internet)
    │   └── Record (facture mensuelle pour cette ligne)
```

**Table `entreprise`:**
- `id`: Identifiant unique
- `nom`: Nom de l'entreprise ou collectivité

**Table `ligne`:**
- `id`: Identifiant unique
- `nom`: Nom/description de la ligne (optionnel)
- `type_ligne`: Type (Internet, Mobile, Fixe, etc.)
- `numero_acces`: Numéro d'accès unique (téléphone, ligne ADSL, etc.)
- `adresse`: Adresse de l'installation (optionnel)
- `entreprise_id`: Référence vers l'entreprise

**Table `record`:**
- `id`: Identifiant unique
- `ligne_id`: Référence vers la ligne
- `numero_compte`: Numéro de compte de facturation
- `numero_facture`: Numéro de facture
- `date`: Date de facturation
- `mois`: Nom du mois (ex: "Novembre")
- `abo`: Montant abonnements HT
- `conso`: Montant consommations HT
- `remise`: Montant remises HT
- `total_ht`: Total HT
- `total_ttc`: Total TTC
- `nb_lignes_detail`: Nombre de lignes de détail
- `statut`: Statut de la facture (ex: "Validee")

## Démarrage rapide

### 1. Installer les dépendances Python

```bash
pip install -r requirements.txt
```

### 2. Créer la base de données

```bash
cd backend
alembic upgrade head
```

Cela crée le fichier `data/verif_facture.db` avec toutes les tables.

### 3. Tester la persistence

```bash
python backend/test_persistence.py
```

Ce script:
- Charge un CSV d'exemple depuis `data/csv_examples/`
- Agrège les données par compte et facture
- Sauvegarde en base de données
- Affiche les statistiques d'insertion

## Utilisation de la persistence

### Via script Python

```python
from database import SessionLocal
from telecom_invoice import TelecomInvoiceProcessor
from invoice_saver import save_aggregated_invoices

# Charger et agréger un CSV
processor = TelecomInvoiceProcessor()
processor.load_csv("data/csv_examples/fichier.csv")
processor.aggregate_by_account()

# Sauvegarder en base
db = SessionLocal()
stats = save_aggregated_invoices(processor, db, "Mon Entreprise")
db.close()

print(f"Lignes créées: {stats['lignes_created']}")
print(f"Records créés: {stats['records_created']}")
```

### Via API

```bash
# Démarrer le serveur
uvicorn backend.app:app --reload

# Sauvegarder un CSV uploadé
curl -X POST http://localhost:8000/save/upload \
  -F "file=@data.csv" \
  -F "entreprise_name=Mon Entreprise"

# Sauvegarder un fichier d'exemple
curl -X POST http://localhost:8000/save/sample \
  -F "filename=DonneesNov2025.csv" \
  -F "entreprise_name=Mon Entreprise"
```

## Commandes utiles

### Migrations

```bash
# Appliquer toutes les migrations
alembic upgrade head

# Revenir à la migration précédente
alembic downgrade -1

# Voir l'état actuel
alembic current

# Voir l'historique
alembic history

# Créer une nouvelle migration (après modification des modèles)
alembic revision --autogenerate -m "description du changement"
```

### Base de données

```bash
# Ouvrir la base SQLite
sqlite3 data/verif_facture.db

# Dans sqlite:
.tables                    # Lister les tables
.schema ligne              # Voir le schéma d'une table
SELECT * FROM entreprise;  # Requête SQL
.quit                      # Quitter
```

## Fichier de base de données

La base de données est stockée dans : `data/verif_facture.db`

Pour réinitialiser la BDD:
```bash
rm data/verif_facture.db
cd backend
alembic upgrade head
```

## Fichiers importants

- `models.py`: Définition des modèles SQLAlchemy (Entreprise, Ligne, Record)
- `database.py`: Configuration de la connexion SQLite
- `persistence.py`: Logique de sauvegarde et déduplication
- `invoice_saver.py`: Pont entre TelecomInvoiceProcessor et la persistence
- `test_persistence.py`: Script de test
- `alembic/`: Dossier des migrations
- `alembic.ini`: Configuration Alembic

## Logique de déduplication

Le système évite les doublons automatiquement:

1. **Lignes**: Identifiées par `numero_acces` (unique)
   - Si la ligne existe, on met à jour nom/adresse si manquants
   - Sinon, on crée une nouvelle ligne avec détection automatique du type

2. **Records**: Identifiés par `(ligne_id, numero_facture, date)`
   - Si le record existe, il est ignoré (pas de doublon)
   - Sinon, il est inséré

Cela permet de recharger le même CSV plusieurs fois sans créer de doublons.
