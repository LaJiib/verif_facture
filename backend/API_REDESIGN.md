# Refonte API - Backend piloté et multi-niveaux

Objectif : déplacer la logique métier vers le backend, offrir des endpoints très ciblés et versionnés, et séparer clairement les niveaux d’abstraction (lecture, commande, orchestration). Le frontend devient purement affichage/interactions.

## Niveaux d’abstraction

- **Niveau 0 - Queries (lecture seule)** : endpoints de consultation stricts, pas d’écriture, pas d’effets secondaires. Réponses typées et stables.
- **Niveau 0 - Commands (écriture uniquement)** : opérations unitaires qui valident l’input, vérifient l’existence des FK, puis mutent la base dans une transaction. Aucun retour de liste/lecture d’agrégat (juste l’état de l’opération et les ids concernés).
- **Niveau 1 - Aggregates/Views** : lectures métier construites côté backend (ex: matrice factures par type, stats mensuelles). Toujours read-only, cohérence garantie par des jointures validées côté serveur.
- **Niveau 2 - Use-cases métier** : workflows complexes (import CSV, auto-vérification, rapprochement, contestation). Ils orchestrent plusieurs commands internes, font les validations de cohésion et renvoient un état consolidé.
- **Niveau 3 - Batch/automation** : traitements planifiés (ex: recalcul d’écarts, purge d’uploads). Hors scope immédiat mais prévus pour séparation des responsabilités.

Principe transversal : un endpoint fait soit de la lecture, soit de la modification, jamais les deux. Les validations Pydantic+SQLAlchemy portent à la fois sur la structure et la cohérence (existence FK, doublons uniques, statuts permis).

## Découpage des routes (v2 proposé)

Préfixe commun `/{version}` pour cohabiter avec l’existant. Exemples ci-dessous avec `v2`.

### Queries (`/v2/read/...`) — lecture seule
- `GET /v2/read/entreprises`
- `GET /v2/read/entreprises/{id}`
- `GET /v2/read/comptes?entreprise_id=...&type=...&lot=...`
- `GET /v2/read/lignes?compte_id=...&type=...`
- `GET /v2/read/factures?compte_id=...&entreprise_id=...&mois=YYYY-MM`
- `GET /v2/read/lignes-factures?facture_id=...`
- `GET /v2/read/abonnements`
- `POST /v2/read/query` (SELECT only, contrôlé côté backend)

### Commands (`/v2/cmd/...`) — écriture uniquement
- Entreprises : `POST /v2/cmd/entreprises/create`, `POST /v2/cmd/entreprises/rename`, `POST /v2/cmd/entreprises/delete`
- Comptes : `POST /v2/cmd/comptes/create`, `POST /v2/cmd/comptes/update`, `POST /v2/cmd/comptes/delete`
- Lignes : `POST /v2/cmd/lignes/create`, `POST /v2/cmd/lignes/update`, `POST /v2/cmd/lignes/delete`
- Factures : `POST /v2/cmd/factures/create`, `POST /v2/cmd/factures/update-statut`, `POST /v2/cmd/factures/delete`
- Lignes-factures : `POST /v2/cmd/lignes-factures/create`, `POST /v2/cmd/lignes-factures/update`, `POST /v2/cmd/lignes-factures/delete`
- Abonnements : `POST /v2/cmd/abonnements/create`, `POST /v2/cmd/abonnements/update`, `POST /v2/cmd/abonnements/delete`, `POST /v2/cmd/abonnements/attacher`, `POST /v2/cmd/abonnements/detacher`

Chaque command :
- Valide le payload (structure, types, valeurs admissibles).
- Vérifie l’existence/relation des entités référencées avant mutation.
- Exécute dans une transaction courte (commit explicite).
- Retourne `{status, id, version}` ou la clé composite concernée, pas de lecture d’agrégat.

### Aggregates/Views (`/v2/view/...`) — lecture enrichie
- `GET /v2/view/entreprises/{id}/comptes-stats` : comptes + totaux factures.
- `GET /v2/view/entreprises/{id}/matrice-factures?from=...&to=...` : tableau par type/mois.
- `GET /v2/view/factures/{id}/detail` : facture + lignes + abonnements liés.
- `GET /v2/view/uploads/{entreprise_id}` : métadonnées fichiers, cohérence avec factures importées.

### Use-cases (`/v2/usecase/...`) — orchestration métier
- `POST /v2/usecase/import-csv` : stocke l’upload, crée/associe entreprise, comptes, factures, lignes-factures, retourne un récap (créés/doublons/erreurs) sans exposer de logique frontend.
- `POST /v2/usecase/autoverif` : lance la vérification sur une facture ou un lot, renvoie le rapport et l’état des écarts.
- `POST /v2/usecase/contester-facture` : marque la facture, journalise la raison, optionnellement notifie.
- `POST /v2/usecase/rebuild-views` : recalcul de vues matérialisées/cache (si introduit).

## Validation et cohésion
- **Schémas Pydantic dédiés** par endpoint (command vs query) pour éviter la réutilisation ambiguë.
- **Contrôles de cohérence** : unicité (numéro facture/compte/date), existence des FK, statuts autorisés, cohérence compte/entreprise.
- **Séparation lecture/écriture** : aucune lecture d’agrégat dans les commands (seulement les checks nécessaires), aucune mutation dans les queries/views.
- **Transactions courtes** : unitaire par command; les use-cases orchestrent plusieurs commands dans une transaction englobante quand nécessaire.

## Impacts breaking
- Noms/urls d’endpoints changent (`/v2/...`), les payloads sont resserrés et typés par action.
- Le frontend devra abandonner la logique métier (agrégations, validations, auto-verif) et appeler les views/use-cases.
- Les anciennes routes resteront éventuellement en `/v1` en lecture seule pendant la migration, mais devront être supprimées à terme.

## Plan de migration proposé

1) **Backend**
   - Introduire les routers `read`, `cmd`, `view`, `usecase` sous préfixe `/v2`.
   - Extraire la logique métier actuelle de `api.py` dans des services/commands explicites (ex: `services/factures.py`, `commands/comptes.py`).
   - Renforcer les schémas Pydantic par action et ajouter des tests unitaires sur validation/cohérence.
2) **Frontend**
   - Mettre à jour le client API pour cibler `/v2`, découpler toute logique métier/validation.
   - Consommer les endpoints view/usecase pour les écrans (home, entreprise, import, vérification).
3) **Transitions**
   - Maintenir `/v1` en lecture seule le temps de basculer l’UI, puis supprimer.
   - Ajouter un feature flag ou variable d’env pour activer `/v2` en préproduction puis en prod.
