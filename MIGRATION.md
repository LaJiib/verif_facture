# Migration vers la nouvelle architecture de base de données

## Modifications apportées

### Nouveau modèle de données (7 tables)

**Architecture précédente:**
- Entreprise → Compte (ligne télécom) → Facture

**Nouvelle architecture:**
- **Entreprise** : [id, nom]
- **Compte** : [id, num, nom, entreprise_id, lot] - Comptes de facturation (ex: numéro de compte Orange)
- **Ligne** : [id, num, type, compte_id] - Lignes télécom (numéros d'accès)
- **Facture** : [id, fournisseur, num, compte_id, date, abo, conso, remises, achat]
- **LigneFacture** : [id, facture_id, ligne_id, abo, conso, remises, achat] - Relation many-to-many
- **Abonnement** : [id, nom, prix, commentaire] - Référentiel des types d'abonnement
- **LigneAbonnement** : [id, abonnement_id, ligne_id, date] - Liaison N..N entre lignes et abonnements (avec date d'effet)

### Hiérarchie des données

```
Entreprise
  └─ Compte de facturation (avec Lot)
       ├─ Ligne 1 (téléphone/internet)
       ├─ Ligne 2
       └─ Ligne N
       └─ Factures (par mois)
            └─ Détails par ligne (LigneFacture)
```

## Étapes de migration

### 1. Arrêter les serveurs

Si les serveurs sont en cours d'exécution, appuyez sur **Ctrl+C** dans chaque fenêtre PowerShell (backend et frontend).

### 2. Mettre à jour la base existante (nouvelle colonne `statut` sur `lignes_factures`)

Si vous avez déjà une base existante, lancez la migration :

```powershell
python scripts/migrate_add_ligne_statut.py
```

La commande est idempotente : si la colonne existe déjà, rien n'est modifié.
Par défaut, le script cherche la base à l’emplacement utilisé par l’exécutable installé :
`%LOCALAPPDATA%\VerifFacture\data\invoices.db` (configuré dans `backend/config.py`). Vous pouvez
forcer un autre chemin avec `VERIF_FACTURE_DB_PATH` ou `VERIF_FACTURE_DATA_DIR`.

### 3. Ajouter les tables d'abonnement (nouvelle fonctionnalité)

```powershell
python scripts/migrate_add_abonnements.py
```

Le script est idempotent : il crée `abonnements` et `lignes_abonnements` uniquement si elles sont absentes (clés uniques + clés étrangères).

### 4. (Option) Recréer la base de données from scratch

```powershell
Remove-Item backend\invoices.db
```

### 5. Relancer les serveurs

```powershell
.\scripts\dev.ps1
```

La nouvelle base de données sera automatiquement créée avec le nouveau schéma au démarrage du backend.

### 6. Créer une entreprise

Dans l'interface web, cliquez sur **"Ajouter une entreprise"** dans le menu latéral.

### 7. Importer un CSV

Les fichiers CSV au format Orange seront automatiquement analysés et les données seront réparties dans les 7 tables :

**Processus d'import:**
1. **Extraction des comptes** : Identifie tous les "Numéro compte" uniques
2. **Extraction des lignes** : Identifie tous les "Numéro accès" (numéros de téléphone/internet)
3. **Agrégation des factures** : Regroupe par compte + numéro de facture + date
4. **Création des relations** : Lie chaque ligne à ses factures avec les montants détaillés

**Statistiques affichées après import:**
- Lignes CSV lues
- Comptes créés
- Lignes créées
- Factures créées
- Lignes-factures créées (détails)
- Doublons ignorés

## Nouvelles fonctionnalités

### Vue en cascade (drill-down)

La page de visualisation des factures propose maintenant 3 niveaux de détail :

1. **Niveau Lot** : Vue agrégée par lot avec les mois en colonnes
   - Cliquez sur un lot pour voir les comptes

2. **Niveau Compte de facturation** : Vue par compte dans le lot sélectionné
   - Cliquez sur un compte pour voir les lignes

3. **Niveau Ligne télécom** : Détail des montants par ligne (abo, conso, remises, achat)
   - Affiche tous les détails mois par mois

### Navigation

- **Bouton ←** : Retour au niveau supérieur (drill-up)
- **Clic sur ligne** : Descendre d'un niveau (drill-down)

## Format CSV attendu (Orange)

### Colonnes requises :
- **Numéro compte** : Numéro de compte de facturation
- **Numéro accès** : Numéro de la ligne télécom/internet
- **Numéro facture** : Numéro de la facture
- **Date** : Date de facturation (format DD/MM/YYYY)
- **Type d'accès** : Type de ligne (Mobile, Internet, Fixe, etc.)
- **Libellé ligne facture** : Description de la charge
- **Niveau de charge** : Abonnement, Consommation, etc.
- **Type de charge** : Forfait, Hors forfait, Remise, Achat, etc.
- **Montant (€ HT)** : Montant HT

### Catégorisation automatique des montants :

Les montants sont automatiquement répartis dans les catégories :
- **Abo** : Abonnements, forfaits
- **Conso** : Consommations, hors forfait
- **Remises** : Remises, avoirs, crédits
- **Achat** : Achats de terminaux, équipements

### Détection automatique du type de ligne :

Le système détecte automatiquement le type de ligne en fonction des mots-clés :
- **Internet** : fibre, ftth, sdsl, vdsl
- **Internet bas débit** : adsl, rnis, numeris
- **Mobile** : mobile, gsm, 4g, 5g, sim
- **Fixe** : ligne, téléphone
- **Fixe secondaire** : secondaire, terminal, poste supplémentaire
- **Autre** : par défaut

## Structure des fichiers modifiés

### Backend
- `backend/models.py` - Nouveaux modèles SQLAlchemy (7 tables)
- `backend/api.py` - Endpoints CRUD complets pour toutes les tables

### Frontend
- `frontend/src/csvImporter.ts` - Import CSV restructuré avec logs détaillés
- `frontend/src/pages/NewEntreprisePage.tsx` - Vue en cascade (Lot → Compte → Ligne)
- `frontend/src/pages/NewHomePage2.tsx` - Dashboard avec nouvelles statistiques
- `frontend/src/pages/NewImportPage.tsx` - Page d'import avec nouvelles stats

## Remarques importantes

- **Lots par défaut** : Les comptes créés automatiquement auront le lot "Non défini"
- **Nom par défaut** : Les comptes auront le nom "Compte {numéro}" par défaut
- **Logs détaillés** : Tous les imports sont loggés dans la console du navigateur (F12)
- **Gestion des doublons** : Les factures déjà importées sont automatiquement ignorées
- **Cascade de suppression** : Supprimer une entreprise supprime tous ses comptes, lignes, factures et détails
