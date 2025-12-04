// Centralised encoding/decoding for integer-coded enums (types, statuts, etc.).
// Update these maps in one place if a new code is added.

export const LINE_TYPE_LABELS: Record<number, string> = {
  0: "Fixe",
  1: "Mobile",
  2: "Internet",
  3: "Autre",
};

// Normalise labels to codes for imports/detections
const LINE_TYPE_CODES: Record<string, number> = {
  fixe: 0,
  "fixe secondaire": 0,
  mobile: 1,
  internet: 2,
  "internet bas debit": 2,
  autre: 3,
};

export function decodeLineType(code: number | null | undefined): string {
  if (code === null || code === undefined) return "Type inconnu";
  return LINE_TYPE_LABELS[code] ?? `Type ${code}`;
}

export function encodeLineType(label: string | null | undefined): number {
  if (!label) return 3;
  const key = label.trim().toLowerCase();
  return LINE_TYPE_CODES[key] ?? 3;
}

export const FACTURE_STATUS_LABELS: Record<number, string> = {
  0: "Importé",
  1: "Validé",
  2: "Contesté",
};

export function decodeFactureStatus(code: number | null | undefined): string {
  if (code === null || code === undefined) return "Statut inconnu";
  return FACTURE_STATUS_LABELS[code] ?? `Statut ${code}`;
}

// Statut lignes_factures (0=importé,1=validé,2=contesté)
const LIGNE_FACTURE_STATUS_LABELS: Record<number, string> = {
  0: "Importé",
  1: "Validé",
  2: "Contesté",
};

export function decodeLigneFactureStatus(code: number | null | undefined): string {
  if (code === null || code === undefined) return "Statut inconnu";
  return LIGNE_FACTURE_STATUS_LABELS[code] ?? `Statut ${code}`;
}
