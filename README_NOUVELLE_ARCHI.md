# Système de Vérification de Factures Télécom - Architecture Simplifiée

## 🎯 Vue d'ensemble

Système de gestion de factures télécom avec architecture simple et efficace :
- **Backend** : FastAPI + SQLite avec 3 tables
- **Frontend** : React + TypeScript avec design professionnel clair
- **Import CSV** : Agrégation intelligente avec détection automatique des types

## 📊 Architecture Base de Données

```
Entreprise (Client)
    ↓ 1:N
Compte (Ligne télécom : numéro d'accès, type, lot)
    ↓ 1:N
Facture (Mensuelle : date, abo, conso, remise, statut)
```

**Voir:** `backend/ARCHITECTURE.md` pour les détails complets

## 🚀 Démarrage

### Option 1 : Script automatique (Recommandé)
```powershell
.\scripts\dev.ps1
```

Démarre automatiquement :
- Backend sur http://localhost:8000
- Frontend sur http://localhost:5173

### Option 2 : Manuel

**Backend:**
```bash
cd backend
python api.py
# ou
python -m uvicorn api:app --reload
```

**Frontend:**
```bash
cd frontend
npm run dev
```

## 📁 Structure des Fichiers

### Backend
```
backend/
├── api.py                  # API REST principale (nouvelle architecture)
├── models.py              # Modèles SQLAlchemy (3 tables)
├── database.py            # Configuration SQLite
├── alembic/              # Migrations
└── ARCHITECTURE.md       # Documentation détaillée
```

### Frontend
```
frontend/src/
├── pages/
│   ├── NewHomePage.tsx        # Liste des entreprises
│   ├── NewEntreprisePage.tsx  # Tableau matriciel des factures
│   └── NewImportPage.tsx      # Import CSV
├── newApi.ts                   # Client API
├── csvImporter.ts              # Logique d'import CSV
└── App.tsx                     # Routeur principal
```

## 📥 Import CSV

### Processus d'import

1. **Sélection de l'entreprise** dans le menu déroulant
2. **Chargement du CSV** avec colonnes attendues :
   - Numéro d'accès
   - Numéro de facture
   - Date (format DD/MM/YYYY)
   - Type d'accès
   - Catégorie de charge
   - Montant HT
   - Libellé détail

3. **Traitement automatique** :
   - ✅ Agrégation par (compte, date, facture)
   - ✅ Détection automatique du type :
     - Internet (ADSL, RNIS, Numeris) → "Internet bas debit"
     - Internet (Fibre, FTTH, SDSL) → "Internet"
     - Mobile (GSM, 4G, 5G) → "Mobile"
     - Fixe → "Fixe"
     - Fixe secondaire → "Fixe secondaire"
     - Autre → "Autre"
   - ✅ Vérification des doublons (même compte + date)
   - ✅ Validation des montants sur doublons
   - ✅ Création automatique des comptes si inexistants

### Résultat
```
Statistiques :
- Lignes CSV lues: 1000
- Comptes créés: 50
- Factures créées: 150
- Factures doublons: 10
- Erreurs: 0
```

## 🎨 Interface

### Page d'accueil
- Liste verticale des entreprises
- Stats: nombre de comptes et factures

### Page entreprise
- **Tableau matriciel** :
  - Mois en colonnes (abscisse)
  - Types de ligne en lignes (ordonnée)
  - Cliquer sur un type → affiche les comptes ligne par ligne
- Design clair et professionnel
- Nom de l'entreprise centré en haut

## 🔧 API REST

### Endpoints principaux

**Entreprises:**
- `GET /entreprises` - Liste toutes
- `POST /entreprises` - Crée une entreprise
- `PUT /entreprises/{id}` - Modifie le nom
- `DELETE /entreprises/{id}` - Supprime (avec cascade)

**Comptes:**
- `GET /comptes?entreprise_id={id}` - Liste les comptes
- `POST /comptes` - Crée un compte
- `PUT /comptes/{id}` - Modifie type ou lot
- `DELETE /comptes/{id}` - Supprime

**Factures:**
- `GET /factures?entreprise_id={id}` - Liste les factures
- `POST /factures` - Crée une facture
- `PUT /factures/{id}` - Modifie le statut
- `DELETE /factures/{id}` - Supprime

**Requêtes SQL:**
- `POST /query` - Exécute un SELECT personnalisé

**Documentation interactive:** http://localhost:8000/docs

## 💡 Principes de conception

### Backend
- ✅ **Simplicité** : 3 tables, relations claires
- ✅ **Intégrité** : Contraintes SQL, foreign keys, cascade
- ✅ **Opérations unitaires** : Consulter OU modifier, jamais les deux
- ✅ **Pas de sur-ingénierie** : Code direct et efficace

### Frontend
- ✅ **Visuel professionnel** : Design clair (blanc/gris), pas sombre
- ✅ **Interface épurée** : Textes courts, pas de descriptions inutiles
- ✅ **Requêtes SQL** : Agrégations côté frontend via `/query`
- ✅ **Import intelligent** : Détection automatique, validation

## 🔄 Migrations

```bash
cd backend

# Créer une migration
alembic revision --autogenerate -m "description"

# Appliquer les migrations
alembic upgrade head

# Revenir en arrière
alembic downgrade -1
```

## 📊 Exemples de requêtes SQL

### Agrégation par type pour une entreprise
```sql
SELECT
    c.type,
    COUNT(DISTINCT c.id) as nb_comptes,
    SUM(f.abo + f.conso + f.remise) as total_ht
FROM factures f
JOIN comptes c ON f.compte_id = c.id
WHERE c.entreprise_id = 1
GROUP BY c.type
```

### Factures par mois
```sql
SELECT
    strftime('%Y-%m', f.date) as mois,
    SUM(f.abo) as total_abo,
    SUM(f.conso) as total_conso,
    SUM(f.remise) as total_remise
FROM factures f
JOIN comptes c ON f.compte_id = c.id
WHERE c.entreprise_id = 1
GROUP BY mois
ORDER BY mois DESC
```

## 🐛 Dépannage

### Erreur "cannot import name 'Ligne'"
L'ancien code essaie d'importer les anciens modèles. Utilisez la nouvelle API :
```bash
python backend/api.py
```
Au lieu de :
```bash
python backend/app.py  # Ancien
```

### Port déjà utilisé
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:8000 | xargs kill -9
```

### Base de données corrompue
```bash
cd backend
rm invoices.db
alembic upgrade head
```

## 📝 Notes

- **Statuts de facture** : `importee`, `validee`, `contestee`
- **Types de ligne** : Internet, Internet bas debit, Fixe, Fixe secondaire, Mobile, Autre
- **Format date CSV** : DD/MM/YYYY (converti en YYYY-MM-DD en base)
- **Montants** : Stockés avec 2 décimales
- **Contrainte unique** : Une seule facture par (compte_id, date)

## 🎯 Améliorations futures possibles

- [ ] Édition en ligne du type de compte
- [ ] Édition du lot
- [ ] Validation/contestation de facture (changement de statut)
- [ ] Export Excel des données agrégées
- [ ] Graphiques d'évolution
- [ ] Comparaison inter-mois
- [ ] Alertes sur variations importantes

---

**Architecture complète et fonctionnelle !** 🎉
