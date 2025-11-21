"""Simple CLI helper to process a CSV file and export reports."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from telecom_invoice import TelecomInvoiceProcessor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Agrège un fichier CSV Orange Business et exporte les rapports."
    )
    parser.add_argument(
        "csv_path",
        type=Path,
        nargs="?",
        default=Path("data/csv_examples/DonnéesNov2025.csv"),
        help="Chemin vers le fichier CSV à traiter.",
    )
    parser.add_argument(
        "--month",
        default="Novembre",
        help="Nom du mois à afficher dans l'export Excel.",
    )
    parser.add_argument(
        "--excel-output",
        type=Path,
        default=Path("data/output_examples/Lot_1_Nov_2025.xlsx"),
        help="Chemin de sortie pour l'export Excel.",
    )
    parser.add_argument(
        "--summary-output",
        type=Path,
        default=Path("data/output_examples/resume_facturation_nov2025.csv"),
        help="Chemin de sortie pour le CSV récapitulatif.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    processor = TelecomInvoiceProcessor()
    processor.load_csv(args.csv_path)
    processor.display_structure()
    processor.aggregate_by_account()
    processor.generate_report()
    processor.export_to_excel_format(args.excel_output, args.month)
    processor.export_summary_csv(args.summary_output)


if __name__ == "__main__":
    main()
