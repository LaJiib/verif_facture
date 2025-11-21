# Changements - Refonte Architecture

## 📅 Date : 21 Novembre 2025

## 🎯 Objectif
Simplifier l'architecture backend/frontend pour avoir un système clair, maintenable et efficace sans sur-ingénierie.

---

## 🗄️ Backend

### Avant (ancien système)
```
3 tables complexes:
- Entreprise
- Ligne (avec nom, adresse, etc.)
- Record (avec numero_compte, total_ht, total_ttc, nb_lignes_detail, etc.)

Logique:
- app.py avec endpoints complexes
- persistence.py avec logique métier
- invoice_saver.py pour l'import
```

### Après (nouveau système)
```
3 tables simples:
- Entreprise (id, nom)
- Compte (id=numero_acces, type, entreprise_id, lot)
- Facture (id, numero_facture, compte_id, date, abo, conso, remise, statut)

Logique:
- api.py avec endpoints REST simples CRUD
- Opérations unitaires (lecture OU écriture)
- Pas de logique métier complexe
```

### Bénéfices
✅ Plus simple à comprendre
✅ Plus facile à maintenir
✅ Contraintes SQL pour l'intégrité
✅ ID du compte = numéro d'accès (pas d'abstraction inutile)
✅ Endpoint `/query` pour SQL personnalisé

---

## 💻 Frontend

### Avant
```
- Ancien design sombre
- Textes descriptifs longs
- Cartes en grille pour les entreprises
- API avec ancien modèle (lignes, records)
```

### Après
```
- Design professionnel clair (blanc/gris)
- Textes courts et épurés
- Liste verticale pour les entreprises
- Nouveau système d'API (comptes, factures)
- Import CSV intelligent avec détection automatique
```

### Fichiers créés
- `newApi.ts` - Client API pour nouvelle architecture
- `csvImporter.ts` - Import CSV avec agrégation et détection
- `NewHomePage.tsx` - Liste entreprises avec stats SQL
- `NewEntreprisePage.tsx` - Tableau matriciel avec requêtes SQL
- `NewImportPage.tsx` - Import simple avec sélection entreprise

### Bénéfices
✅ Design plus moderne et professionnel
✅ Import CSV intelligent avec validation
✅ Détection automatique du type de ligne
✅ Agrégations via requêtes SQL
✅ Code plus simple et direct

---

## 📥 Import CSV

### Logique d'import (inchangée conceptuellement)
1. ✅ Parse le CSV ligne par ligne
2. ✅ Agrège par (compte_id, date, numero_facture)
3. ✅ Calcule abo/conso/remises selon catégorie
4. ✅ Vérifie si facture existe déjà (doublon)
5. ✅ Vérifie si compte existe, sinon le crée
6. ✅ Détecte automatiquement le type de ligne
7. ✅ Insère la facture

### Nouveautés
✅ Détection automatique plus robuste (Internet, Fixe, Mobile, etc.)
✅ Validation des montants sur doublons
✅ Rapport détaillé avec erreurs
✅ Sélection d'entreprise avant import

---

## 🎨 Visuel

### Changements
- ✅ Fond blanc au lieu de sombre (#f8fafc)
- ✅ Couleurs épurées (blanc, gris, bleu)
- ✅ Titres centrés pour les pages entreprise
- ✅ Liste verticale au lieu de grille
- ✅ Textes courts sans descriptions inutiles
- ✅ Tableau matriciel : mois en colonnes, types en lignes
- ✅ Détail expandable ligne par ligne

### Principe
"Design professionnel et épuré, pas sombre"

---

## 🔄 Migration

### Base de données
```bash
cd backend
alembic upgrade head
```

Migration automatique :
- ❌ Suppression anciennes tables (entreprise, ligne, record)
- ✅ Création nouvelles tables (entreprises, comptes, factures)
- ⚠️ **Attention:** Les anciennes données sont perdues

### Script de dev
Modifié pour pointer vers la nouvelle API :
```powershell
.\scripts\dev.ps1  # Lance api.py au lieu de app.py
```

---

## 📊 Comparaison

| Aspect | Avant | Après |
|--------|-------|-------|
| Tables | 3 (complexes) | 3 (simples) |
| Endpoints | Complexes | REST CRUD simple |
| Logique métier | Dans le backend | Dans le frontend (SQL) |
| Design | Sombre | Clair professionnel |
| Import CSV | Backend | Frontend + Backend |
| Détection type | Basique | Robuste |
| Validation | Basique | Complète avec rapport |

---

## ✅ Avantages

### Backend
1. **Simplicité** : Code direct, pas d'abstraction inutile
2. **Maintenabilité** : Facile à comprendre et modifier
3. **Intégrité** : Contraintes SQL automatiques
4. **Flexibilité** : Requêtes SQL personnalisées via `/query`

### Frontend
1. **Visuel moderne** : Design professionnel clair
2. **Performance** : Agrégations SQL optimisées
3. **Validation** : Import intelligent avec détection et vérification
4. **UX** : Interface épurée, navigation simple

---

## 🔧 Pour les développeurs

### Anciens fichiers (à ne plus utiliser)
- ❌ `backend/app.py`
- ❌ `backend/persistence.py`
- ❌ `backend/invoice_saver.py`
- ❌ `backend/test_persistence.py`
- ❌ `frontend/src/api.ts`
- ❌ `frontend/src/entrepriseApi.ts`
- ❌ `frontend/src/pages/HomePage.tsx` (ancien)
- ❌ `frontend/src/pages/EntreprisePage.tsx` (ancien)
- ❌ `frontend/src/pages/ImportPage.tsx` (ancien)

### Nouveaux fichiers (à utiliser)
- ✅ `backend/api.py` - **API principale**
- ✅ `backend/models.py` - **Nouveaux modèles**
- ✅ `backend/ARCHITECTURE.md` - **Documentation**
- ✅ `frontend/src/newApi.ts` - **Client API**
- ✅ `frontend/src/csvImporter.ts` - **Import CSV**
- ✅ `frontend/src/pages/NewHomePage.tsx`
- ✅ `frontend/src/pages/NewEntreprisePage.tsx`
- ✅ `frontend/src/pages/NewImportPage.tsx`

---

## 🚀 Démarrage

```powershell
# Méthode simple
.\scripts\dev.ps1

# Ou manuel
cd backend && python api.py
cd frontend && npm run dev
```

API: http://localhost:8000
Frontend: http://localhost:5173
Docs: http://localhost:8000/docs

---

**Architecture complète, simple et fonctionnelle !** ✨
