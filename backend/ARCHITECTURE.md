# Architecture Simplifiée - Base de Données & API

## Vue d'ensemble

Architecture simple et efficace avec 3 tables SQL et une API REST pour toutes les opérations.

## Schéma de la base de données

```
┌─────────────────┐
│   Entreprise    │
├─────────────────┤
│ id (PK)         │
│ nom             │
└────────┬────────┘
         │
         │ 1:N
         │
┌────────▼────────┐
│     Compte      │
├─────────────────┤
│ id (PK)         │ ← Numéro d'accès (ex: "0546982410")
│ type            │ ← Internet, Fixe, Mobile, etc.
│ entreprise_id(FK)│
│ lot             │ ← Optionnel (ex: "Lot 1", "Siège")
└────────┬────────┘
         │
         │ 1:N
         │
┌────────▼────────┐
│    Facture      │
├─────────────────┤
│ id (PK)         │
│ numero_facture  │
│ compte_id (FK)  │
│ date            │
│ abo             │
│ conso           │
│ remise          │
│ statut          │ ← importee, validee, contestee
└─────────────────┘

UNIQUE(compte_id, date) ← Une facture par compte par mois
```

## Tables

### Entreprise
Représente un client (entreprise/collectivité).

| Colonne | Type    | Description                |
|---------|---------|----------------------------|
| id      | INTEGER | Clé primaire auto-incrémentée |
| nom     | STRING  | Nom unique de l'entreprise |

### Compte
Représente une ligne télécom (compte de facturation).

| Colonne       | Type    | Description                          |
|---------------|---------|--------------------------------------|
| id            | STRING  | Numéro d'accès (clé primaire)        |
| type          | STRING  | Type: Internet, Fixe, Mobile, etc.   |
| entreprise_id | INTEGER | FK vers Entreprise                    |
| lot           | STRING  | Subdivision optionnelle (nullable)    |

**Note:** L'ID est le numéro d'accès lui-même (ex: "0546982410"), pas un entier auto-incrémenté.

### Facture
Représente une facture mensuelle pour un compte.

| Colonne        | Type       | Description                          |
|----------------|------------|--------------------------------------|
| id             | INTEGER    | Clé primaire auto-incrémentée       |
| numero_facture | INTEGER    | Numéro de facture Orange            |
| compte_id      | STRING     | FK vers Compte                       |
| date           | DATE       | Date de la facture                   |
| abo            | NUMERIC    | Montant abonnements                  |
| conso          | NUMERIC    | Montant consommations                |
| remise         | NUMERIC    | Montant remises (souvent négatif)    |
| statut         | STRING     | importee / validee / contestee       |

**Contrainte:** UNIQUE(compte_id, date) - une seule facture par compte par mois.

**Propriété calculée:** `total_ht = abo + conso + remise`

## API REST

### Principe
- **Opérations unitaires:** Chaque endpoint fait UNE chose (consulter OU modifier, jamais les deux)
- **CRUD simple:** Create, Read, Update, Delete pour chaque ressource
- **Pas de sur-ingénierie:** Code direct, pas d'abstractions complexes

### Endpoints

#### Entreprises

```
GET    /entreprises                    Liste toutes les entreprises
POST   /entreprises                    Crée une entreprise
GET    /entreprises/{id}               Récupère une entreprise
PUT    /entreprises/{id}               Modifie le nom
DELETE /entreprises/{id}               Supprime (avec cascade)
```

#### Comptes

```
GET    /comptes?entreprise_id={id}     Liste les comptes (optionnellement filtrés)
POST   /comptes                        Crée un compte
GET    /comptes/{id}                   Récupère un compte
PUT    /comptes/{id}                   Modifie type ou lot
DELETE /comptes/{id}                   Supprime (avec cascade)
```

**Body PUT:**
```json
{
  "type": "Internet",
  "lot": "Lot 1"
}
```

#### Factures

```
GET    /factures?compte_id={id}&...    Liste les factures (avec filtres)
POST   /factures                       Crée une facture
GET    /factures/{id}                  Récupère une facture
PUT    /factures/{id}                  Modifie le statut
DELETE /factures/{id}                  Supprime
```

**Filtres GET:**
- `compte_id`: Filtre par compte
- `entreprise_id`: Filtre par entreprise (join)
- `date_debut`: Date minimum
- `date_fin`: Date maximum

**Body PUT:**
```json
{
  "statut": "validee"
}
```

#### Requêtes personnalisées

```
POST   /query                          Exécute un SELECT personnalisé
```

**Body:**
```json
{
  "sql": "SELECT * FROM entreprises WHERE nom LIKE '%test%'"
}
```

**Sécurité:** Seules les requêtes `SELECT` sont autorisées.

## Exemples d'utilisation

### Import de données CSV

1. Parse le CSV
2. Crée l'entreprise si elle n'existe pas
3. Pour chaque ligne CSV:
   - Crée le compte (POST /comptes) si nouveau
   - Crée la facture (POST /factures)
   - Si doublon (même compte_id + date), l'insert échoue (contrainte unique)

### Agrégation frontend

Le frontend peut faire des requêtes SQL via `/query`:

```sql
-- Total par type de compte pour une entreprise
SELECT
    c.type,
    COUNT(DISTINCT c.id) as nb_comptes,
    SUM(f.abo) as total_abo,
    SUM(f.conso) as total_conso,
    SUM(f.remise) as total_remise,
    SUM(f.abo + f.conso + f.remise) as total_ht
FROM factures f
JOIN comptes c ON f.compte_id = c.id
WHERE c.entreprise_id = 1
GROUP BY c.type
```

### Modification d'un type mal attribué

```http
PUT /comptes/0546982410
{
  "type": "Fixe"
}
```

### Validation d'une facture

```http
PUT /factures/123
{
  "statut": "validee"
}
```

## Migrations

Les migrations Alembic gèrent l'évolution du schéma:

```bash
# Créer une migration
alembic revision --autogenerate -m "description"

# Appliquer les migrations
alembic upgrade head

# Revenir en arrière
alembic downgrade -1
```

## Démarrage

```bash
cd backend
python api.py
```

API disponible sur: http://localhost:8000

Documentation auto-générée: http://localhost:8000/docs
