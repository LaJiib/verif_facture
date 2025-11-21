/// <reference types="vite/client" />

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export interface InvoiceMontants {
  Abo: number;
  Conso: number;
  Remise: number;
}

export interface Invoice {
  numero_facture: number;
  mois: string;
  date: string;
  montants: InvoiceMontants;
  total: number;
  total_ttc: number;
  nb_lignes_detail: number;
  statut: string;
}

export interface AccountAggregate {
  compte: string;
  lignes_telecom: number;
  factures: Invoice[];
}

export interface AggregationResponse {
  accounts: AccountAggregate[];
  summary: {
    total_comptes: number;
    total_factures: number;
    total_ht: number;
  };
}

export interface SampleFile {
  name: string;
  size: number;
}

export type LineFilters = Partial<{
  date: string;
  date_debut: string;
  date_fin: string;
  numero_compte: string;
  numero_facture: number;
  numero_acces: string;
  type_acces: string[];
  type_ligne: string[];
  type_charge: string[];
}>;

export interface LineRow {
  compte: string;
  facture: number;
  date: string;
  numero_acces: string;
  type_acces: string;
  type_ligne: string;
  categorie_charge: string;
  rubrique_facture: string;
  type_charge: string;
  libelle: string;
  montant_ht: number;
  montant_ttc: number;
}

export interface LinesResponse {
  rows: LineRow[];
  summary: {
    total_lignes: number;
    total_montant_ht: number;
    par_type_ligne: Record<string, { count: number; montant_ht: number }>;
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody.detail || "Erreur lors de l'appel API.";
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function uploadCsv(file: File, filters?: LineFilters): Promise<AggregationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (filters) {
    formData.append("filters", JSON.stringify(cleanFilters(filters)));
  }
  const res = await fetch(`${API_BASE_URL}/aggregate/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(res);
}

export async function fetchSamples(): Promise<SampleFile[]> {
  const res = await fetch(`${API_BASE_URL}/samples`);
  const payload = await handleResponse<{ files: SampleFile[] }>(res);
  return payload.files;
}

export async function loadSample(filename: string, filters?: LineFilters): Promise<AggregationResponse> {
  const res = await fetch(`${API_BASE_URL}/aggregate/sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, ...cleanFilters(filters ?? {}) }),
  });
  return handleResponse(res);
}

function cleanFilters(filters: LineFilters): LineFilters {
  const cleaned: LineFilters = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && value.trim() === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    // @ts-expect-error dynamic assignment
    cleaned[key] = value;
  });
  return cleaned;
}

export async function fetchLinesFromSample(
  filename: string,
  filters: LineFilters,
): Promise<LinesResponse> {
  const res = await fetch(`${API_BASE_URL}/lines/sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, ...cleanFilters(filters) }),
  });
  return handleResponse(res);
}

export async function fetchLinesFromUpload(
  file: File,
  filters: LineFilters,
): Promise<LinesResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("filters", JSON.stringify(cleanFilters(filters)));
  const res = await fetch(`${API_BASE_URL}/lines/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(res);
}

export interface SaveResponse {
  success: boolean;
  stats: {
    lignes_created: number;
    records_created: number;
    records_skipped: number;
  };
  elapsed: number;
  entreprise: string;
  summary: {
    total_comptes: number;
    total_factures: number;
  };
}

export async function saveCsvUpload(file: File, entrepriseName: string = "Par défaut"): Promise<SaveResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("entreprise_name", entrepriseName);
  const res = await fetch(`${API_BASE_URL}/save/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(res);
}

export async function saveCsvSample(filename: string, entrepriseName: string = "Par défaut"): Promise<SaveResponse> {
  const formData = new FormData();
  formData.append("filename", filename);
  formData.append("entreprise_name", entrepriseName);
  const res = await fetch(`${API_BASE_URL}/save/sample`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(res);
}
