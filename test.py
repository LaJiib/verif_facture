from telecom_invoice_processor_v2 import TelecomInvoiceProcessorV2

# Créer une instance du processeur
processor = TelecomInvoiceProcessorV2()

# 1. Charger le fichier CSV
processor.load_csv('CSV_examples\\DonnéesNov2025.csv')

# 2. Afficher la structure (optionnel)
processor.display_structure()

# 3. Agréger les données par compte
processor.aggregate_by_account()

# 4. Générer un rapport textuel (optionnel)
processor.generate_report()

# 5. Exporter au format Excel
processor.export_to_excel_format('Lot_1_Nov_2025.xlsx', 'Novembre')