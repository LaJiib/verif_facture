# Récapitulatif des changements - Navigation hiérarchique

## ✅ Modifications effectuées

### Backend (`backend/app.py`)

**Imports ajoutés:**
```python
from models import Entreprise, Ligne, Record
from sqlalchemy import select, func
from datetime import datetime
```

**Nouveaux endpoints:**
1. `GET /entreprises` - Liste les entreprises avec statistiques
2. `POST /entreprises` - Crée une nouvelle entreprise
3. `GET /entreprises/{entreprise_id}/aggregation` - Données agrégées par mois et type
4. `GET /lignes/{ligne_id}/records` - Historique d'une ligne

### Frontend

**Nouveaux fichiers créés:**
- `frontend/src/entrepriseApi.ts` - API calls pour navigation
- `frontend/src/pages/HomePage.tsx` - Liste des entreprises
- `frontend/src/pages/EntreprisePage.tsx` - Agrégation entreprise
- `frontend/src/pages/LigneDetailsPage.tsx` - Détails ligne
- `frontend/src/pages/ImportPage.tsx` - Import CSV (ancien App.tsx)

**Fichier modifié:**
- `frontend/src/App.tsx` - Nouveau routeur simple
- `frontend/src/styles.css` - Nouveaux styles ajoutés

**Fichier sauvegardé:**
- `frontend/src/App.tsx.bak` - Sauvegarde de l'ancien App.tsx

### Documentation

**Nouveaux fichiers:**
- `NAVIGATION.md` - Guide complet de la navigation
- `CHANGEMENTS_NAVIGATION.md` - Ce fichier

---

## 🎯 Workflow utilisateur

### 1. Page d'accueil (`HomePage`)
```
┌─────────────────────────────────────────┐
│  Gestion des Entreprises               │
│                                         │
│  [+ Ajouter]  [Importer un CSV →]     │
│                                         │
│  ┌──────────┐  ┌──────────┐           │
│  │ Acme Inc │  │ TechCorp │           │
│  │ 46 lignes│  │ 23 lignes│           │
│  │ 46 records│ │ 23 records│          │
│  └──────────┘  └──────────┘           │
└─────────────────────────────────────────┘
```

**Actions:**
- Clic sur entreprise → `EntreprisePage`
- Clic "Importer un CSV" → `ImportPage`
- Clic "+ Ajouter" → Form pour créer entreprise

### 2. Page entreprise (`EntreprisePage`)
```
┌─────────────────────────────────────────┐
│  ← Retour    Acme Inc                   │
│                                         │
│  ▼ Novembre 2025        12,345.67 €    │
│    ┌──────────────────┐                │
│    │ Internet         │                │
│    │ 5 lignes         │                │
│    │ - Ligne Paris    │ 162.26 €      │
│    │ - Ligne Lyon     │ 250.00 €      │
│    └──────────────────┘                │
│                                         │
│  ▶ Octobre 2025         10,234.50 €    │
└─────────────────────────────────────────┘
```

**Actions:**
- Clic sur mois → Expand/collapse
- Clic sur ligne → `LigneDetailsPage`
- Clic "← Retour" → `HomePage`

### 3. Page ligne (`LigneDetailsPage`)
```
┌─────────────────────────────────────────┐
│  ← Retour    Ligne Paris                │
│  [Internet] 0123456789                  │
│                                         │
│  Records: 3    Total HT: 500 €         │
│                                         │
│  Date       Mois    Facture   Total    │
│  2025-11-01 Nov     12345     162.26€  │
│  2025-10-01 Oct     12344     167.00€  │
│  2025-09-01 Sep     12343     170.74€  │
└─────────────────────────────────────────┘
```

**Actions:**
- Clic "← Retour" → `EntreprisePage`

### 4. Page import (`ImportPage`)
```
┌─────────────────────────────────────────┐
│  ← Retour aux entreprises               │
│  Import CSV                             │
│                                         │
│  [Choisir fichier] [Analyser]          │
│                                         │
│  Nom entreprise: [_____________]       │
│  [Sauvegarder en base]                 │
│                                         │
│  Factures agrégées (tableau...)        │
└─────────────────────────────────────────┘
```

**Actions:**
- Upload CSV + sauvegarder → Données en BDD
- Clic "← Retour" → `HomePage`

---

## 🚀 Lancement

### Terminal 1 - Backend
```bash
cd c:/Users/jbsk/verif_facture
.venv/Scripts/activate
uvicorn backend.app:app --reload
```

### Terminal 2 - Frontend
```bash
cd c:/Users/jbsk/verif_facture/frontend
npm run dev
```

### Accéder à l'application
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

---

## 🔧 Test rapide

1. **Vérifier les entreprises existantes:**
   ```bash
   curl http://localhost:8000/entreprises
   ```

2. **Créer une entreprise de test:**
   ```bash
   curl -X POST http://localhost:8000/entreprises -F "nom=Test Entreprise"
   ```

3. **Voir l'agrégation (si données existent):**
   ```bash
   curl http://localhost:8000/entreprises/1/aggregation
   ```

---

## 📊 Structure des données

### Agrégation par mois
```json
{
  "2025-11": {
    "mois": "Novembre",
    "total_ht": 12345.67,
    "par_type_ligne": {
      "Internet": {
        "count": 5,
        "total_ht": 5000.00,
        "lignes": [...]
      },
      "Fixe": {...},
      "Mobile": {...}
    }
  }
}
```

### Types de ligne supportés
- Internet
- Internet bas débit
- Fixe
- Fixe secondaire
- Mobile
- Autre

---

## 🎨 Nouveaux styles CSS

Les styles dark mode ont été étendus pour supporter:
- Cartes d'entreprises avec hover effects
- Grilles responsive
- Accordéons mois (expandable/collapsible)
- Cartes de types de ligne
- Items de ligne cliquables
- Badges et statistiques
- Boutons retour

**Palette de couleurs:**
- Background principal: `#0f172a`
- Cards: `#1e293b`
- Borders: `#334155`
- Primary blue: `#3b82f6`
- Success green: `#10b981`
- Purple badge: `#8b5cf6`
- Muted text: `#94a3b8`

---

## ⚠️ Points d'attention

### Performance
- Les agrégations sont calculées côté backend (pas de pagination pour l'instant)
- Pour de gros volumes, envisager pagination sur `/aggregation` endpoint

### État de navigation
- Le routeur utilise un simple state React (pas de react-router)
- Le state n'est PAS persisté (refresh = retour home)
- Pour ajouter de la persistance: utiliser localStorage ou react-router

### Compatibilité
- Tous les anciens endpoints fonctionnent toujours (`/aggregate/*`, `/save/*`, etc.)
- L'import CSV fonctionne exactement comme avant
- La sauvegarde en BDD est identique

---

## 🐛 Résolution de problèmes

### Le frontend ne compile pas
```bash
cd frontend
npm install
npm run build
```

### Le backend ne démarre pas
```bash
cd backend
python -m py_compile app.py
```

### Les entreprises ne s'affichent pas
1. Vérifier que la BDD existe: `ls data/verif_facture.db`
2. Vérifier les migrations: `cd backend && alembic current`
3. Importer un CSV pour créer des données

### Les styles ne s'appliquent pas
1. Vérifier que `styles.css` contient les nouveaux styles
2. Rebuild le frontend: `npm run build`
3. Vider le cache navigateur (Ctrl+Shift+R)

---

## 📝 TODO futur

- [ ] Ajout de pagination pour gros volumes
- [ ] Persistance du state de navigation (localStorage)
- [ ] Graphiques de tendances (Chart.js)
- [ ] Export PDF/Excel des agrégations
- [ ] Recherche globale
- [ ] Filtres avancés (par date, montant, etc.)
- [ ] Modification/suppression d'entreprises
- [ ] Fusion d'entreprises
- [ ] API de statistiques avancées

---

## 📚 Documentation complète

Voir [NAVIGATION.md](./NAVIGATION.md) pour:
- Documentation complète des endpoints
- Exemples de requêtes/réponses
- Architecture détaillée
- Guide CSS complet
