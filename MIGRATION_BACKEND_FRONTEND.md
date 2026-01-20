# Journal de migration logique Front → Back

Objectif : le frontend reste purement affichage/interaction. Toute la logique métier, agrégation et validation bascule côté backend (API v2). Synthèse par page, avec granularité fine (fonctionnalités) et état actuel.

## NewHomePage2
- **Stats globales (comptes/lignes/factures)**  
  - État : OK backend via `/v2/view/entreprises/{id}/dashboard`. Front consomme déjà l’endpoint.  
  - Action : aucune.
- **Répartition lignes par type**  
  - État : OK backend via dashboard, utilisé côté front.  
  - Action : aucune.
- **Statuts globaux factures**  
  - État : OK backend via dashboard, utilisé côté front.  
  - Action : aucune.
- **Stats mois courant / précédent (delta, trend, breakdown abo/conso/remises/achat)**  
  - État : OK backend (last_month + categories_delta) et utilisé côté front pour le rendu.  
  - Action : aucune.
- **Uploads**  
  - État : déjà backend (`/v2/view/uploads/{entreprise_id}` + download).  
  - Action : aucune.

## NewEntreprisePage
- **Matrice factures (lots/comptes/mois, totaux HT)**  
  - État : OK backend via `/v2/view/entreprises/{id}/matrice` (totals/statuts par mois intégrés). Front consomme l’endpoint, plus de SQL.  
  - Action : aucune.
- **Filtres/mois/statuts (ordre/tri) et stats par lot**  
  - État : alimentés par la matrice v2 (totals_by_month, statuts_by_month).  
  - Action : aucune.

## CompteDetailModal
- **Stats globales facture/mois + stats précédentes**  
  - État : OK backend via `/v2/view/factures/{id}/detail-stats` (consommé).  
  - Action : aucune.
- **Lignes de facture (totaux par ligne, statuts, types)**  
  - État : OK backend (facture_detail + lignes_by_id), plus de SQL front.  
  - Action : aucune.
- **Séries mensuelles du compte**  
  - État : OK backend (`months` de detail-stats), utilisées pour l’affichage.  
  - Action : aucune.
- **Comparaison factures précédentes / lignes précédentes**  
  - État : OK backend (stats_globales_prev + lignes_by_id). La vue actuelle ne renvoie pas la liste complète des factures précédentes mais les stats sont couvertes.  
  - Action : compléter la vue si besoin d’un historique plus riche.
- **Rapports / abonnements / mises à jour**  
  - État : déjà backend (routes v2 cmd/read).  
  - Action : aucune.

## API backend existante (v2)
- `GET /v2/view/entreprises/{id}/dashboard` : stats globales, lignes_par_type, statuts_global, last/prev month (delta & categories_delta). Logs OK.
- `GET /v2/view/entreprises/{id}/matrice` : matrice lots/comptes/mois (à enrichir si besoin de totaux additionnels).
- `GET /v2/view/factures/{id}/detail` : détail facture + lignes + abonnements.
- `GET /v2/view/factures/{id}/detail-stats` : stats globales/prev, months, lignes_by_id, facture_detail (logs OK).
- `GET /v2/read/query` : à supprimer à terme côté frontend.

## Prochaines étapes
1) NewHomePage2.tsx : remplacer tous les `executeQuery` par `fetchEntrepriseDashboard`. Garder le rendu identique (utiliser last_month/categories_delta pour les variations).
2) NewEntreprisePage.tsx : consommer `fetchEntrepriseMatrice`; enrichir la réponse backend si besoin (totaux par mois/lot/statuts) pour supprimer toutes les requêtes SQL front.
3) CompteDetailModal.tsx : remplacer toute la chaîne `executeQuery` par `fetchFactureDetailStats`; mapper les structures dans l’état existant (stats globales, months, lignes, prev stats).
4) Nettoyage : retirer `executeQuery` du frontend une fois les trois pages migrées; ajuster `api_v2/view.py` si des champs manquent pour conserver le même affichage.
