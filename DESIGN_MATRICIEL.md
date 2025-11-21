# Design matriciel - Page Entreprise

## Vue d'ensemble

La page de détails d'une entreprise utilise maintenant un **design matriciel** (tableau croisé dynamique) :

- **Colonnes** : Mois (novembre, octobre, septembre...)
- **Lignes** : Types de ligne (Internet, Fixe, Mobile, etc.)
- **Cellules** : Montant HT + nombre de lignes
- **Expandable** : Cliquer sur un type de ligne pour voir le détail

```
┌─────────────────┬──────────┬──────────┬──────────┐
│ Type de ligne   │ Nov 2025 │ Oct 2025 │ Sep 2025 │
├─────────────────┼──────────┼──────────┼──────────┤
│ ▶ Internet      │ 5,000 €  │ 4,800 €  │ 4,900 €  │
│                 │ 5 lignes │ 5 lignes │ 5 lignes │
├─────────────────┼──────────┼──────────┼──────────┤
│ ▶ Fixe          │ 3,000 €  │ 2,900 €  │ 3,100 €  │
│                 │ 10 lignes│ 10 lignes│ 10 lignes│
├─────────────────┼──────────┼──────────┼──────────┤
│ ▼ Mobile        │ 2,500 €  │ 2,400 €  │ 2,600 €  │ ← Expandé
│                 │ 15 lignes│ 15 lignes│ 15 lignes│
└─────────────────┴──────────┴──────────┴──────────┘

  Détail des lignes - Mobile
  ┌─────────────────────────────────────────────┐
  │ Novembre 2025                               │
  │  • Ligne 1 (0612345678)         150.00 €   │
  │  • Ligne 2 (0623456789)         165.00 €   │
  │  ...                                        │
  └─────────────────────────────────────────────┘
```

---

## Fonctionnalités

### 1. Tableau matriciel principal

**Structure :**
- En-têtes de colonnes : Mois avec nom + code (ex: "Novembre / 2025-11")
- En-têtes de lignes : Types de ligne avec icône expandable (▶/▼)
- Cellules : Montant HT (gros chiffre vert) + nombre de lignes (petit texte gris)
- Cellules vides : "-" pour les mois sans données pour ce type

**Interaction :**
- Clic sur une ligne de type → Expand/collapse le détail
- Hover sur ligne → Highlight visuel
- Sticky headers : Type reste visible lors du scroll horizontal

### 2. Section détails expandable

Lorsqu'un type de ligne est cliqué :
- Une nouvelle ligne s'affiche sous le type
- Contenu organisé par mois (grille responsive)
- Pour chaque mois : liste des lignes individuelles
- Chaque ligne est cliquable → navigation vers LigneDetailsPage

**Layout des lignes :**
```
┌────────────────────────────┐
│ Nom de la ligne            │
│ 0612345678                 │  150.00 €
└────────────────────────────┘
```

### 3. Section résumé par mois

En bas de page, cartes résumé pour chaque mois :
- Total HT
- Total TTC
- Nombre de types de ligne

---

## Styles CSS

### Variables de couleurs

```css
Background principal: #0f172a
Cards: #1e293b
Hover: #283548
Borders: #334155
Primary blue: #3b82f6
Success green: #10b981
Muted text: #94a3b8
```

### Classes principales

**Tableau :**
- `.matrix-table` - Container du tableau
- `.data-matrix` - Table elle-même
- `.type-header` - Header "Type de ligne" (sticky left)
- `.mois-header` - Headers des mois
- `.type-row` - Ligne de type (cliquable)
- `.data-cell` - Cellule de données

**Cellules :**
- `.cell-content` - Container du contenu
- `.cell-amount` - Montant (gros, vert)
- `.cell-count` - Nombre de lignes (petit, gris)
- `.cell-empty` - Cellule vide ("-")

**Détails expandables :**
- `.detail-row` - Ligne de détails
- `.detail-content` - Container du contenu expandable
- `.lignes-by-month` - Grille des mois
- `.month-lignes` - Container d'un mois
- `.lignes-grid` - Liste des lignes
- `.ligne-card` - Carte d'une ligne (cliquable)

**Résumé :**
- `.summary-section` - Section résumé
- `.summary-grid` - Grille des cartes
- `.summary-card` - Carte d'un mois
- `.stat-item` - Item de statistique

---

## Responsive

### Desktop (> 768px)
- Tableau complet visible
- Grille détails : 3 colonnes auto-fit (min 300px)
- Grille résumé : auto-fit (min 200px)

### Mobile (≤ 768px)
- Scroll horizontal pour le tableau
- Font-size réduit (0.8rem)
- Padding réduit (0.75rem → 0.5rem)
- Grille détails : 1 colonne
- Headers sticky pour navigation

---

## Avantages du design matriciel

1. **Vue d'ensemble rapide** : Tous les mois visibles en un coup d'œil
2. **Comparaison facile** : Comparer les montants mois par mois
3. **Drill-down progressif** : Clic → détails → ligne individuelle
4. **Dense mais lisible** : Beaucoup d'info sans surcharge visuelle
5. **Scroll intelligent** : Headers sticky pour garder le contexte

---

## Exemple de données

```json
{
  "entreprise": {
    "id": 1,
    "nom": "Ma Collectivité"
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

---

## Workflow utilisateur

1. **Arrivée sur la page** : Voir le tableau matriciel
2. **Analyse rapide** : Scanner les montants par mois/type
3. **Clic sur type** : Voir détails des lignes pour ce type
4. **Clic sur ligne** : Navigation vers historique complet
5. **Scroll en bas** : Voir résumé mensuel (totaux HT/TTC)

---

## Différences avec l'ancien design

### Avant (accordéon par mois)
```
▼ Novembre 2025
  ┌─────────────┐ ┌─────────────┐
  │ Internet    │ │ Fixe        │
  │ 5 lignes    │ │ 10 lignes   │
  └─────────────┘ └─────────────┘

▶ Octobre 2025
```

### Après (matrice)
```
         Nov      Oct      Sep
Internet 5,000€   4,800€   4,900€
Fixe     3,000€   2,900€   3,100€
Mobile   2,500€   2,400€   2,600€
```

**Avantages :**
- ✅ Comparaison mois-à-mois immédiate
- ✅ Moins de clics pour voir l'information
- ✅ Vue globale plus claire
- ✅ Meilleure utilisation de l'espace

---

## Améliorations futures

### Phase 1 (actuelle) ✅
- Tableau matriciel basique
- Expand/collapse par type
- Navigation vers détails ligne

### Phase 2 (à venir)
- [ ] Tri des colonnes (par montant, par nombre de lignes)
- [ ] Filtres (masquer certains types, certains mois)
- [ ] Export Excel du tableau
- [ ] Graphiques de tendances (ligne par type)

### Phase 3 (à venir)
- [ ] Comparaison multi-périodes (YoY, MoM)
- [ ] Alertes visuelles (variations >X%)
- [ ] Heatmap (couleurs selon montants)
- [ ] Drill-down direct depuis cellule

---

## Code source

**Composant :** `frontend/src/pages/EntreprisePage.tsx`
**Styles :** `frontend/src/styles.css` (section "MATRIX TABLE STYLES")
**API :** `GET /entreprises/{id}/aggregation` (backend/app.py)

---

## Test

Pour tester le nouveau design :

1. Démarrer backend + frontend
2. Aller sur la page d'accueil
3. Cliquer sur une entreprise
4. Observer le tableau matriciel
5. Cliquer sur un type de ligne (ex: "Internet")
6. Observer les détails expandables
7. Cliquer sur une ligne individuelle
8. Vérifier l'historique de la ligne
