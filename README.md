# Vérification des factures télécoms

Application full-stack pour agréger et analyser les factures télécom Orange Business. Permet de charger des CSV, extraire et standardiser les données, et les persister dans une base PostgreSQL pour analyse historique.

---

## Arborescence

```
.
├── data/
│   ├── csv_examples/         # Fichiers sources (un CSV par mois)
│   └── output_examples/      # Exports générés par le CLI
├── scripts/
│   └── process_csv.py        # Exemple de traitement en ligne de commande
├── backend/
│   └── app.py                # Application FastAPI (API REST)
├── frontend/                 # Vite + React + TypeScript
│   ├── package.json
│   └── src/...
├── src/
│   └── telecom_invoice/
│       ├── __init__.py
│       └── processor.py      # Classe TelecomInvoiceProcessor réutilisable
├── requirements.txt
└── README.md
```

---

## Base de données

L'application utilise **SQLite** pour persister les données de facturation localement.

### Architecture des données

```
Entreprise (client/collectivité)
  ├── Ligne (ligne télécom: fixe, mobile, internet)
  │   └── Record (facture mensuelle)
```

- **Entreprise**: Représente un client ou une collectivité
- **Ligne**: Ligne télécom identifiée par son numéro d'accès (type: Internet, Mobile, Fixe, etc.)
- **Record**: Enregistrement de facturation mensuelle (abo, conso, remises, totaux)

### Initialiser la base de données

```bash
# Créer la base de données SQLite (fichier data/verif_facture.db)
cd backend
alembic upgrade head
```

**Commandes utiles:**
- Consulter la BDD: `sqlite3 data/verif_facture.db`
- Réinitialiser: `rm data/verif_facture.db && cd backend && alembic upgrade head`

📖 Documentation complète: [backend/DATABASE.md](backend/DATABASE.md)

---

## Installation & scripts CLI

### Préparer l'environnement Python

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

Les principaux paquets utilisés : `pandas`, `openpyxl`, `fastapi`, `uvicorn`, `python-multipart`.

### Traiter un CSV depuis le terminal

```bash
python scripts/process_csv.py \
  data/csv_examples/DonnéesNov2025.csv \
  --month Novembre \
  --excel-output data/output_examples/Lot_1_Nov_2025.xlsx \
  --summary-output data/output_examples/resume_facturation_nov2025.csv
```

Le script :
1. charge le CSV,
2. affiche des statistiques rapides,
3. agrège les lignes par compte/facture,
4. produit un rapport texte,
5. exporte un fichier Excel + un résumé CSV.

Vous pouvez importer la classe directement :

```python
from telecom_invoice import TelecomInvoiceProcessor

processor = TelecomInvoiceProcessor()
processor.load_csv("data/csv_examples/DonnéesNov2025.csv")
processor.display_structure()
processor.aggregate_by_account()
processor.generate_report()
processor.export_to_excel_format("data/output_examples/Lot_1_Nov_2025.xlsx", "Novembre")
processor.export_summary_csv("data/output_examples/resume_facturation.csv")
```

---

## Backend FastAPI

1. Activez l'environnement virtuel puis lancez :
   ```bash
   uvicorn backend.app:app --reload --port 8000
   ```
2. Endpoints principaux :
   - `GET /health` : statut
   - `GET /samples` : liste les CSV présents dans `data/csv_examples`
   - `POST /aggregate/upload` : téléverser un CSV et agréger (mode stateless)
   - `POST /aggregate/sample` : agrège un fichier d'exemple
   - `POST /save/upload` : **téléverser un CSV et sauvegarder en BDD** ✨
   - `POST /save/sample` : **charger un exemple et sauvegarder en BDD** ✨
3. Les réponses incluent les comptes, les factures associées et un résumé global (totaux HT, nombre de comptes/factures).

---

## Frontend React/TypeScript

Le frontend est basé sur Vite (React + TypeScript).

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Par défaut, l'application consomme l'API sur `http://localhost:8000`. Pour pointer vers un autre backend, créez un fichier `.env` dans `frontend/` avec `VITE_API_BASE_URL="http://mon-api:8000"`.

Fonctionnalités :
1. Téléverser un CSV et afficher immédiatement les montants agrégés.
2. Charger un fichier d'exemple depuis `data/csv_examples`.
3. Visualiser les totaux (comptes, factures, HT) et parcourir les factures dans un tableau moderne.

---

## Notes techniques

- Les montants (`Montant (€ HT)`, `Montant TVA`, `Montant (€ TTC)`) sont normalisés en flottants (remplacement virgule → point).
- Les classifications utilisent les champs `Type de charge` et `Rubrique facture` pour distinguer Abonnements / Consommations / Remises.
- Les exports Excel respectent le format fourni par Orange Business.
- Les sorties (Excel/CSV), les environnements virtuels et `frontend/node_modules` sont ignorés pour garder un dépôt propre.

---

## Roadmap

### Phase 1: Infrastructure BDD ✅
- Modèles SQLAlchemy (Entreprise, Ligne, Record)
- SQLite pour stockage local (fichier `data/verif_facture.db`)
- Migrations avec Alembic

### Phase 2: Persistance des données ✅
- Module de persistence avec déduplication automatique
- Endpoints API `/save/upload` et `/save/sample`
- Classification automatique du type de ligne
- Script de test `backend/test_persistence.py`

### Phase 3: API étendue
- Endpoints CRUD pour entreprises, lignes, records
- Interrogation historique des factures
- Migration progressive des endpoints actuels

### Phase 4: Interface améliorée
- Dashboard analytics avec historique
- Gestion des entreprises et lignes
- Comparaisons multi-périodes
- Alertes d'anomalies (variations, écarts HT/TTC)
