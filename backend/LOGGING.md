# Logging - Guide de debug

## Logs disponibles

Le système de logging est organisé par module :

- **`database`** : Connexions, sessions, état de la base
- **`persistence`** : Opérations de sauvegarde (création entreprises, lignes, records)
- **`factures`** : Logs de l'API FastAPI (déjà existant)

## Niveaux de logs

- **INFO** : Opérations importantes (créations, sauvegardes)
- **DEBUG** : Détails techniques (recherches, vérifications)
- **ERROR** : Erreurs

## Configuration

### 1. Logs normaux (INFO)

Par défaut, seuls les logs INFO+ sont affichés :

```bash
uvicorn backend.app:app --reload
```

Vous verrez :
```
INFO [database] Base de données existante: data/verif_facture.db (45.2 Ko)
INFO [persistence] Création nouvelle entreprise 'Mon Entreprise'
INFO [persistence] Ligne créée: id=5
INFO [persistence] Création record: facture=123456, mois=Novembre, total_ht=1234.56€
```

### 2. Mode DEBUG database & persistence

Pour voir tous les détails des opérations BDD :

```bash
# Windows PowerShell
$env:DEBUG_DB="true"
uvicorn backend.app:app --reload

# Linux/Mac
DEBUG_DB=true uvicorn backend.app:app --reload
```

Vous verrez en plus :
```
DEBUG [database] Session DB créée
DEBUG [persistence] Recherche entreprise 'Mon Entreprise'
DEBUG [persistence] Recherche ligne: numero_acces='0123456789'
DEBUG [persistence] Ligne existante: id=5, type=Fixe
DEBUG [database] Session DB fermée
```

### 3. Voir les requêtes SQL

Pour afficher toutes les requêtes SQL exécutées :

```bash
# Windows PowerShell
$env:DEBUG_SQL="true"
uvicorn backend.app:app --reload

# Linux/Mac
DEBUG_SQL=true uvicorn backend.app:app --reload
```

Vous verrez :
```sql
SELECT entreprise.id, entreprise.nom FROM entreprise WHERE entreprise.nom = ?
INSERT INTO ligne (nom, type_ligne, numero_acces, ...) VALUES (?, ?, ?, ...)
```

### 4. Mode DEBUG complet (SQL + détails BDD)

Combiner les deux :

```bash
# Windows PowerShell
$env:DEBUG_SQL="true"
$env:DEBUG_DB="true"
uvicorn backend.app:app --reload

# Linux/Mac
DEBUG_SQL=true DEBUG_DB=true uvicorn backend.app:app --reload
```

## Logs dans les scripts

### Script de test

```bash
# Mode normal
python backend/test_persistence.py

# Mode DEBUG
python backend/test_persistence.py --log-level DEBUG
```

### Configuration programmatique

Dans vos propres scripts Python :

```python
import logging

# Activer DEBUG pour tous les loggers
logging.basicConfig(level=logging.DEBUG)

# Ou seulement pour certains modules
logging.getLogger("database").setLevel(logging.DEBUG)
logging.getLogger("persistence").setLevel(logging.INFO)
```

## Logs en production

Pour une utilisation en production, configurez les logs dans un fichier :

```python
# backend/logging_config.py
import logging.config

LOGGING_CONFIG = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'default': {
            'format': '%(asctime)s [%(levelname)s] %(name)s: %(message)s'
        }
    },
    'handlers': {
        'file': {
            'class': 'logging.FileHandler',
            'filename': 'app.log',
            'formatter': 'default'
        },
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'default'
        }
    },
    'loggers': {
        'database': {'level': 'INFO', 'handlers': ['file', 'console']},
        'persistence': {'level': 'INFO', 'handlers': ['file', 'console']},
        'factures': {'level': 'INFO', 'handlers': ['file', 'console']}
    }
}

logging.config.dictConfig(LOGGING_CONFIG)
```

## Exemples de debug

### Problème: Les données ne sont pas sauvegardées

1. Activer DEBUG :
   ```bash
   $env:DEBUG_SQL="true"
   uvicorn backend.app:app --reload --log-level debug
   ```

2. Faire une requête à `/save/sample`

3. Vérifier les logs :
   - Connexion DB établie ?
   - Entreprise créée/trouvée ?
   - Lignes créées ?
   - Records créés ou ignorés (doublons) ?
   - Requêtes SQL exécutées ?

### Problème: Doublons dans la base

Activer DEBUG et chercher :
```
DEBUG [persistence] Record existe: ligne_id=X, facture=Y
```

Si vous voyez ce message, le record est correctement détecté comme doublon.

### Problème: Type de ligne incorrect

Chercher :
```
INFO [persistence] Création nouvelle ligne: numero_acces='...', type='...'
```

Vérifier que le type détecté est correct.
