# Outil de Vérification des Factures Télécoms - Jalon 1 (Version 2)

## 📋 Objectif
Traiter les fichiers CSV de facturation télécom Orange Business et générer des rapports agrégés par compte de facturation avec la répartition entre Abonnements, Consommations et Remises.

## 🚀 Installation

```bash
pip install pandas openpyxl --break-system-packages
```

## 📥 Format d'entrée attendu

Fichier CSV avec séparateur `;` contenant les colonnes suivantes :
- `Numéro compte` : Identifiant du compte de facturation
- `Numéro facture` : Numéro de la facture
- `Date` : Date de facturation (format DD/MM/YYYY)
- `Numéro accès` : Numéro d'accès / ligne télécom
- `Rubrique facture` : Catégorie de la ligne (abonnements, consommations, remises, etc.)
- `Type de charge` : Type de charge détaillé
- `Montant (€ HT)` : Montant hors taxes
- `Montant (€ TTC)` : Montant TTC
- Et autres colonnes descriptives...

## 💻 Utilisation

### Exemple simple

```python
from telecom_invoice_processor_v2 import TelecomInvoiceProcessorV2

# Créer une instance du processeur
processor = TelecomInvoiceProcessorV2()

# 1. Charger le fichier CSV
processor.load_csv('DonnéesNov2025.csv')

# 2. Afficher la structure (optionnel)
processor.display_structure()

# 3. Agréger les données par compte
processor.aggregate_by_account()

# 4. Générer un rapport textuel (optionnel)
processor.generate_report()

# 5. Exporter au format Excel
processor.export_to_excel_format('Lot_1_Fixe_Nov_2025.xlsx', 'Novembre')

# 6. Exporter un résumé CSV
processor.export_summary_csv('resume_facturation.csv')
```

### Script de test fourni

Un script complet est disponible : `test_real_data.py`

```bash
python3 test_real_data.py
```

Ce script :
1. Charge le fichier `DonnéesNov2025.csv`
2. Affiche les statistiques
3. Agrège les données
4. Génère un rapport complet
5. Exporte les résultats en Excel et CSV

## 📤 Formats de sortie

### 1. Fichier Excel (format conforme à l'exemple fourni)

Structure du fichier Excel généré :
```
Compte de facturation | Nom du compte | Novembre
                      |               | n° de facture | Résumé | Montant €HT | Statut
────────────────────────────────────────────────────────────────────────────────
2380160               |               | 303782319     | Total  | 162.26      | Validée
                      | Abo           |               | Abo    | 143.59      |
                      | Conso         |               | Conso  | 18.67       |
                      | Remise        |               | Remise | 0.00        |
────────────────────────────────────────────────────────────────────────────────
```

### 2. Fichier CSV résumé

Format : séparateur `;`, encodage UTF-8 avec BOM

Colonnes :
- `Compte` : Numéro de compte
- `Facture` : Numéro de facture
- `Mois` : Mois de facturation
- `Abonnements_HT` : Total des abonnements HT
- `Consommations_HT` : Total des consommations HT
- `Remises_HT` : Total des remises HT (valeur négative)
- `Total_HT` : Total général HT
- `Total_TTC` : Total général TTC
- `Nb_lignes_telecom` : Nombre de lignes/accès télécom
- `Statut` : Statut de la facture

## 📊 Résultats du test (données Nov 2025)

Le traitement du fichier `DonnéesNov2025.csv` a produit :

- ✅ **46 comptes de facturation** traités
- ✅ **46 factures** analysées (1 par compte)
- ✅ **246 numéros d'accès** télécom
- ✅ **2 837 lignes de détail** traitées
- ✅ **Montant total HT** : 13 906,62 €
- ✅ **Montant total TTC** : 16 687,94 €

### Répartition des charges

| Type de charge                          | Nombre de lignes |
|-----------------------------------------|------------------|
| Abonnements, forfaits, formules         | 1 860            |
| Consommations                           | 964              |
| Remises                                 | 10               |
| Services ponctuels                      | 3                |

## 🔍 Catégorisation des charges

L'outil catégorise automatiquement chaque ligne en :
- **Abo** : Abonnements, forfaits, formules et options
- **Conso** : Consommations (appels, SMS, data, etc.)
- **Remise** : Remises et réductions (montants négatifs)

La catégorisation se base sur :
- Le champ `Type de charge`
- Le champ `Rubrique facture`
- Les mots-clés dans les libellés

## 🎯 Fonctionnalités du Jalon 1

✅ **Import CSV** avec gestion de l'encodage et des formats numériques  
✅ **Agrégation** par compte de facturation et par facture  
✅ **Catégorisation** automatique en Abo/Conso/Remise  
✅ **Calculs** des totaux et sous-totaux  
✅ **Export Excel** au format conforme aux standards  
✅ **Export CSV** pour analyse dans d'autres outils  
✅ **Rapport textuel** détaillé dans la console  

## 📝 Fichiers générés lors du test

| Fichier                                  | Description                        |
|------------------------------------------|------------------------------------|
| `Lot_1_Fixe_Nov_2025_Generated.xlsx`    | Fichier Excel au format standard   |
| `resume_facturation_nov2025.csv`        | Résumé CSV pour analyse            |

## 🔧 Structure du code

```
telecom_invoice_processor_v2.py
├── TelecomInvoiceProcessorV2 (classe principale)
│   ├── load_csv()                    # Chargement et conversion des données
│   ├── display_structure()           # Affichage des statistiques
│   ├── categorize_charge()           # Catégorisation Abo/Conso/Remise
│   ├── aggregate_by_account()        # Agrégation par compte
│   ├── generate_report()             # Rapport textuel
│   ├── export_to_excel_format()      # Export Excel
│   └── export_summary_csv()          # Export CSV résumé
```

## 🚀 Prochains jalons

### Jalon 2 : Validation et contrôle qualité
- Validation des montants (HT + TVA = TTC)
- Détection des incohérences
- Vérification des totaux

### Jalon 3 : Comparaison multi-périodes
- Import de plusieurs mois
- Évolution des coûts
- Détection des variations anormales

### Jalon 4 : Analyse détaillée par ligne
- Drill-down par numéro d'accès
- Analyse des consommations par type
- Identification des lignes coûteuses

### Jalon 5 : Reporting avancé
- Graphiques et visualisations
- Tableaux de bord
- Exports PDF

## 💡 Notes techniques

### Gestion des formats numériques
Le CSV source utilise des virgules comme séparateurs décimaux. Le code effectue automatiquement la conversion :
```python
# Remplacement virgule → point puis conversion float
data['Montant (€ HT)'] = data['Montant (€ HT)'].str.replace(',', '.').astype(float)
```

### Gestion des mois
Les dates sont converties automatiquement et le mois est extrait en français (ex: "November" pour novembre).

### Encodage
Le fichier CSV source utilise UTF-8 avec BOM (`utf-8-sig`), ce qui est géré automatiquement.

## 📞 Support

Pour toute question ou problème :
1. Vérifiez que le format CSV correspond bien à celui attendu
2. Vérifiez les encodages (UTF-8 recommandé)
3. Consultez les messages d'erreur détaillés