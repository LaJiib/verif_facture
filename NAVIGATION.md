# Navigation hiérarchique - Guide d'utilisation

## Vue d'ensemble

L'application a été restructurée pour offrir une navigation hiérarchique à 3 niveaux :

```
Page d'accueil (Liste des entreprises)
  └─> Page Entreprise (Agrégation par mois + type de ligne)
       └─> Page Détails Ligne (Historique des records)
```

L'import CSV est désormais une page secondaire accessible depuis la page d'accueil.

---

## Architecture Backend

### Nouveaux endpoints

#### `GET /entreprises`
Liste toutes les entreprises avec leurs statistiques.

**Response:**
```json
{
  "entreprises": [
    {
      "id": 1,
      "nom": "Mon Entreprise",
      "nb_lignes": 46,
      "nb_records": 46
    }
  ]
}
```

#### `POST /entreprises`
Crée une nouvelle entreprise.

**Body:**
- `nom` (Form): Nom de l'entreprise

**Response:**
```json
{
  "id": 2,
  "nom": "Nouvelle Entreprise",
  "nb_lignes": 0,
  "nb_records": 0
}
```

#### `GET /entreprises/{entreprise_id}/aggregation`
Récupère les données agrégées d'une entreprise par mois et type de ligne.

**Response:**
```json
{
  "entreprise": {
    "id": 1,
    "nom": "Mon Entreprise"
  },
  "aggregation_par_mois": {
    "2025-11": {
      "mois": "Novembre",
      "total_ht": 12345.67,
      "total_ttc": 14814.80,
      "par_type_ligne": {
        "Internet": {
          "count": 5,
          "total_ht": 5000.00,
          "total_ttc": 6000.00,
          "lignes": [
            {
              "ligne_id": 1,
              "numero_acces": "0123456789",
              "nom": "Ligne Paris",
              "record_id": 10,
              "numero_facture": 303782319,
              "total_ht": 162.26
            }
          ]
        }
      }
    }
  }
}
```

#### `GET /lignes/{ligne_id}/records`
Récupère tous les records d'une ligne spécifique.

**Response:**
```json
{
  "ligne": {
    "id": 1,
    "nom": "Ligne Paris",
    "numero_acces": "0123456789",
    "type_ligne": "Internet",
    "adresse": "123 Rue de Paris"
  },
  "records": [
    {
      "id": 10,
      "numero_compte": "2380160",
      "numero_facture": 303782319,
      "date": "2025-11-15",
      "mois": "Novembre",
      "abo": 100.00,
      "conso": 50.00,
      "remise": -10.00,
      "total_ht": 162.26,
      "total_ttc": 194.71,
      "nb_lignes_detail": 5,
      "statut": "Validee"
    }
  ]
}
```

---

## Architecture Frontend

### Structure des fichiers

```
frontend/src/
├── App.tsx                    # Routeur principal (nouveau)
├── api.ts                     # API pour import CSV (existant)
├── entrepriseApi.ts           # API pour navigation (nouveau)
└── pages/
    ├── HomePage.tsx           # Liste des entreprises
    ├── EntreprisePage.tsx     # Agrégation par mois/type
    ├── LigneDetailsPage.tsx   # Historique d'une ligne
    └── ImportPage.tsx         # Import CSV (ancien App.tsx)
```

### Composants

#### `HomePage`
- Affiche la liste des entreprises avec statistiques
- Bouton "Ajouter une entreprise"
- Bouton "Importer un CSV" (navigation vers ImportPage)
- Click sur une entreprise → navigate vers EntreprisePage

#### `EntreprisePage`
- Affiche les données agrégées par mois
- Chaque mois est expandable/collapsible
- Pour chaque mois : agrégation par type de ligne (Internet, Fixe, Mobile, etc.)
- Pour chaque type : liste des lignes avec montants
- Click sur une ligne → navigate vers LigneDetailsPage

#### `LigneDetailsPage`
- Affiche les détails d'une ligne (nom, numéro d'accès, type, adresse)
- Résumé : nombre de records, total HT, total TTC
- Tableau historique des records (factures mensuelles)

#### `ImportPage`
- Ancien composant App.tsx
- Permet d'importer un CSV et de le sauvegarder en BDD
- Bouton "Retour" pour revenir à la HomePage

### Routeur simple

Le routeur est implémenté avec un simple state React (pas de react-router) :

```typescript
type Route =
  | { page: "home" }
  | { page: "entreprise"; entrepriseId: number }
  | { page: "ligne"; ligneId: number; entrepriseId: number }
  | { page: "import" };
```

---

## Utilisation

### Démarrer l'application

1. **Backend** :
   ```bash
   cd c:/Users/jbsk/verif_facture
   .venv/Scripts/activate
   uvicorn backend.app:app --reload
   ```

2. **Frontend** :
   ```bash
   cd frontend
   npm run dev
   ```

### Workflow typique

1. **Page d'accueil** : Liste des entreprises
   - Si aucune entreprise : cliquer sur "Importer un CSV" ou "Ajouter une entreprise"

2. **Importer des données** :
   - Cliquer sur "Importer un CSV"
   - Sélectionner un fichier ou charger un exemple
   - Entrer le nom de l'entreprise
   - Cliquer sur "Sauvegarder en base"
   - Retour à la page d'accueil

3. **Consulter une entreprise** :
   - Cliquer sur une carte d'entreprise
   - Voir l'agrégation par mois (expandable)
   - Voir l'agrégation par type de ligne pour chaque mois

4. **Consulter une ligne** :
   - Dans EntreprisePage, cliquer sur une ligne dans un type
   - Voir l'historique complet des factures pour cette ligne

---

## CSS à ajouter

Quelques classes CSS utilisées par les nouveaux composants :

```css
/* HomePage */
.entreprises-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
}

.entreprise-card {
  padding: 1.5rem;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.entreprise-card:hover {
  border-color: #007bff;
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

.stats {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: bold;
  color: #007bff;
}

.stat-label {
  font-size: 0.875rem;
  color: #666;
}

.add-form {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: #666;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.secondary-button {
  background: #6c757d;
  color: white;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.back-button {
  background: none;
  border: none;
  color: #007bff;
  cursor: pointer;
  font-size: 1rem;
  margin-bottom: 1rem;
}

.back-button:hover {
  text-decoration: underline;
}

/* EntreprisePage */
.mois-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.mois-card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.mois-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  border-bottom: 1px solid #e0e0e0;
}

.mois-header:hover {
  background: #f8f9fa;
}

.mois-summary {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.total-ht {
  font-size: 1.25rem;
  font-weight: bold;
  color: #28a745;
}

.expand-icon {
  color: #007bff;
  font-size: 0.875rem;
}

.type-ligne-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
  padding: 1rem;
}

.type-ligne-card {
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 1rem;
}

.type-ligne-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.badge {
  background: #007bff;
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
}

.type-ligne-totals {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e0e0e0;
}

.total-item {
  display: flex;
  flex-direction: column;
}

.total-item .label {
  font-size: 0.75rem;
  color: #666;
}

.total-item .value {
  font-weight: bold;
}

.lignes-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ligne-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.ligne-item:hover {
  background: #f8f9fa;
  border-color: #007bff;
}

.ligne-nom {
  font-weight: 500;
  margin: 0;
}

.ligne-numero {
  font-size: 0.875rem;
  margin: 0;
}

.ligne-amount {
  font-weight: bold;
  color: #28a745;
}

/* LigneDetailsPage */
.ligne-details {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}
```

---

## Notes de migration

- L'ancien `App.tsx` a été sauvegardé dans `App.tsx.bak` et déplacé vers `pages/ImportPage.tsx`
- Les imports relatifs dans ImportPage ont été mis à jour (`./api` → `../api`)
- Le composant App est maintenant un simple routeur avec state management
- Tous les composants utilisent des callbacks pour la navigation (pas de contexte global)
- La persistance en base fonctionne de la même manière (endpoints `/save/*`)

---

## Roadmap future

### Phase 3: API étendue (à venir)
- Endpoints CRUD pour modifier entreprises/lignes
- Suppression de records/lignes
- Fusion d'entreprises
- Export de données agrégées

### Phase 4: Interface améliorée (à venir)
- Graphiques de tendances (Chart.js ou Recharts)
- Comparaisons multi-périodes
- Alertes d'anomalies
- Recherche globale
- Filtres avancés
