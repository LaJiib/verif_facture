## Migration import CSV vers backend (plan de travail)

- [x] Creer un endpoint backend `/v2/usecase/import-csv` (POST multipart) : analyse CSV, detection comptes manquants, creation upload_id, reponse structuree (ok / requires_account_confirmation / errors).
- [x] Deplacer la logique d'agregation CSV du frontend (categorizeMontant, aggregateFacturesData, detection type ligne) vers un module backend reutilisable.
- [x] Ajouter un endpoint `/v2/usecase/import-csv/confirm-accounts` pour valider/creer les comptes proposes puis reprendre l'import.
- [x] Gerer le stockage optionnel du CSV (upload_id) dans le backend et tracer la date_min/date_max.
- [x] Adapter `frontend/src/newApi.ts` avec les nouveaux endpoints import + types de reponse.
- [x] Simplifier `frontend/src/csvImporter.ts` : envoi du fichier + format, affichage des etapes/erreurs, gestion de la demande de confirmation (appels backend, plus de creation locale).
- [x] Conserver les statistiques de resultat (lignes/comptes/factures crees, doublons, erreurs) dans la reponse backend pour affichage identique.
- [x] Supprimer les appels directs de creation (comptes/lignes/factures) cote frontend lies a l'import et nettoyer les helpers inutilises si plus references.
- [ ] Tests a prevoir : import sans nouveaux comptes, import avec nouveaux comptes (confirmation), doublons de facture, CSV partiellement invalide.
