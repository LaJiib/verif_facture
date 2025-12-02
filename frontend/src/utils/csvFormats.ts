export type CsvDateFormat = "DD/MM/YYYY" | "YYYY-MM-DD";

export interface CsvFormatConfig {
  id: string;
  name: string;
  dateFormat?: CsvDateFormat;
  columns: {
    numeroCompte: string;
    numeroAcces?: string;
    numeroFacture: string;
    date: string;
    typeAcces?: string;
    libelleDetail?: string;
    rubriqueFacture?: string;
    montantHT: string;
    niveauCharge?: string;
    typeCharge?: string;
  };
}

const STORAGE_KEY = "csvFormats";

export const DEFAULT_CSV_FORMAT: CsvFormatConfig = {
  id: "orange",
  name: "Format Orange (défaut)",
  dateFormat: "DD/MM/YYYY",
  columns: {
    numeroCompte: "Numéro compte",
    numeroAcces: "Numéro accès",
    numeroFacture: "Numéro facture",
    date: "Date",
    typeAcces: "Type d'accès",
    libelleDetail: "Libellé ligne facture",
    rubriqueFacture: "Rubrique facture",
    montantHT: "Montant (€ HT)",
    niveauCharge: "Niveau de charge",
    typeCharge: "Type de charge",
  },
};

function persist(formats: CsvFormatConfig[]): CsvFormatConfig[] {
  const normalized = ensureDefaultFormat(formats);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    // Ignore storage errors, keep in-memory list only
  }
  return normalized;
}

export function ensureDefaultFormat(formats: CsvFormatConfig[]): CsvFormatConfig[] {
  const hasDefault = formats.some((f) => f.id === DEFAULT_CSV_FORMAT.id);
  return hasDefault ? formats : [DEFAULT_CSV_FORMAT, ...formats];
}

export function loadCsvFormats(): CsvFormatConfig[] {
  try {
    if (typeof localStorage === "undefined") {
      return [DEFAULT_CSV_FORMAT];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [DEFAULT_CSV_FORMAT];
    }
    const parsed = JSON.parse(raw) as CsvFormatConfig[];
    if (!Array.isArray(parsed)) {
      return [DEFAULT_CSV_FORMAT];
    }
    return ensureDefaultFormat(parsed);
  } catch {
    return [DEFAULT_CSV_FORMAT];
  }
}

export function upsertCsvFormat(format: CsvFormatConfig, base?: CsvFormatConfig[]): CsvFormatConfig[] {
  const formats = base ? [...base] : loadCsvFormats();
  const filtered = formats.filter((f) => f.id !== format.id);
  const updated = [...filtered, format];
  return persist(updated);
}
