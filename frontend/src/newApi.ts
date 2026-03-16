/**
 * API client pour communiquer avec le backend restructuré.
 *
 * Architecture backend:
 * - Entreprise: Client
 * - Compte: Ligne télécom (id = numéro d'accès)
 * - Facture: Facture mensuelle (abo, conso, remise, statut)
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const V2_READ = `${API_BASE_URL}/v2/read`;
const V2_CMD = `${API_BASE_URL}/v2/cmd`;
const V2_VIEW = `${API_BASE_URL}/v2/view`;
const V2_USECASE = `${API_BASE_URL}/v2/usecase`;
const V2_CONFIG = `${API_BASE_URL}/v2/config`;

import type { CsvFormatConfig } from "./utils/csvFormats";

export type { CsvFormatConfig } from "./utils/csvFormats";

function logApi(message: string, extra?: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    // Log léger en dev pour suivre les appels
    console.info(`[api] ${message}`, extra || "");
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    logApi("error", { url: res.url, status: res.status });
    const errorBody = await res.json().catch(() => ({}));
    let message: string = errorBody.detail || res.statusText || "Erreur lors de l'appel API.";
    if (typeof message === "object") {
        try {
            message = JSON.stringify(message);
      } catch {
        message = "Erreur lors de l'appel API.";
      }
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ============================================================================
// TYPES
// ============================================================================

export interface Entreprise {
  id: number;
  nom: string;
}

export interface Compte {
  id: number;
  num: string;
  nom: string | null;
  entreprise_id: number;
  lot: string | null;
}

export interface Facture {
  id: number;
  numero_facture: string;
  compte_id: number;
  date: string;  // Format ISO: "2025-11-01"
  abo: number;
  conso: number;
  remises: number;
  statut: number; // 0=importe,1=valide,2=conteste
  total_ht: number;
  csv_id?: string | null;
}

export interface UploadMeta {
  upload_id: string;
  original_name: string;
  category: string;
  uploaded_at: string;
  uploaded_month: string | null;
  size: number;
  relative_path: string;
  saved_as: string;
  extra?: any;
}

export async function fetchUploadContent(uploadId: string): Promise<string> {
  const res = await fetch(`${V2_READ}/uploads/${uploadId}/download`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Impossible de récupérer le fichier");
  }
  return res.text();
}

// ============================================================================
// Configuration (chemin DB)
// ============================================================================

export interface DbPathConfig {
  db_path: string;
  default_db_path: string;
  configured_db_path: string | null;
  source: "env" | "config" | "default" | string;
  message?: string;
}

export interface DbPathSaveResponse {
  saved_db_path: string | null;
  uses_default: boolean;
  requires_restart: boolean;
  message?: string;
}

export async function fetchDbPathConfig(): Promise<DbPathConfig> {
  logApi("fetchDbPathConfig");
  return handleResponse<DbPathConfig>(await fetch(`${V2_CONFIG}/db-path`));
}

export async function saveDbPathConfig(dbPath: string | null): Promise<DbPathSaveResponse> {
  logApi("saveDbPathConfig", { dbPath });
  return handleResponse<DbPathSaveResponse>(
    await fetch(`${V2_CONFIG}/db-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ db_path: dbPath }),
    })
  );
}

// CSV formats (persistés backend)
export async function fetchCsvFormatsBackend(): Promise<CsvFormatConfig[]> {
  logApi("fetchCsvFormatsBackend");
  return handleResponse<CsvFormatConfig[]>(await fetch(`${V2_CONFIG}/csv-formats`));
}

export async function saveCsvFormatBackend(format: CsvFormatConfig): Promise<CsvFormatConfig> {
  logApi("saveCsvFormatBackend", { id: format.id });
  return handleResponse<CsvFormatConfig>(
    await fetch(`${V2_CONFIG}/csv-formats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(format),
    })
  );
}

// LLM local (Ollama)
export async function summarizeWithLlm(texts: string[], system?: string): Promise<string> {
  console.log("[LLM] summarize request", {
    count: texts.length,
    sample: texts.slice(0, 2),
    full: texts,
  });
  const res = await fetch(`${V2_USECASE}/llm/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, system }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn("[LLM] error", res.status, body);
    throw new Error(body || "Erreur LLM");
  }
  const payload = await res.json();
  console.log("[LLM] summarize response", payload);
  return payload.summary || "";
}

// Auto-vérification côté backend (étapes séparées)
export interface AutoVerifEcartResult {
  statut: "valide" | "conteste";
  ecart: number;
  commentaire: string;
  rows_missing_count: number;
  etat_technique_ecart?: string;
  type_anomalie?: string;
  montant_attendu?: number;
  details?: any;
}

export interface AutoVerifGroupeResult {
  statut: "valide" | "conteste";
  commentaire: string;
  montant_attendu: number;
  delta_count: number;
  delta_total: number;
  csv_context?: string[];
  anomalies?: { line?: string; kind?: string; detail: string; prev_net?: number; curr_net?: number; csv?: any }[];
}

export async function autoVerifyEcart(factureId: number): Promise<AutoVerifEcartResult> {
  logApi("autoVerifyEcart", { factureId });
  const res = await fetch(`${V2_USECASE}/autoverif/ecart?facture_id=${factureId}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Erreur auto-vérification écart");
  }
  return res.json() as Promise<AutoVerifEcartResult>;
}

// ============================================================================
// API CALL - LIGNES-FACTURES (statut / mise à jour simple)
// ============================================================================

export interface AutoVerifFullResult {
  metricStatuts: Record<string, string>;
  metricComments: Record<string, string>;
  metricReals: Record<string, string>;
  groupStatuts: Record<string, { aboNet: string; achat: string }>;
  groupComments: Record<string, { aboNet?: string; achat?: string }>;
  groupAnomalies: Record<string, { kind: string; line?: string; detail: string; prev_net?: number; curr_net?: number; prev_achat?: number; curr_achat?: number }[]>;
  summary: { added: number; removed: number; modified: number; previousFactureId: number | null; previousFactureNum?: string | null };
  previousFactureNum?: string | null;
  lineStatuts?: Record<number, { aboNet: string; achat: string; comment?: string }>;
}

export async function autoVerifyFull(factureId: number): Promise<AutoVerifFullResult> {
  logApi("autoVerifyFull", { factureId });
  const res = await fetch(`${V2_USECASE}/autoverif/full?facture_id=${factureId}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Erreur auto verification complete");
  }
  return res.json() as Promise<AutoVerifFullResult>;
}

// ============================================================================
// API CALL - IMPORT CSV (backend orchestré)
// ============================================================================

export interface ImportCsvResponse {
  status: "requires_account_confirmation" | "dry_run" | "success" | "partial";
  comptes_a_creer?: { num: string; nom: string; lot: string }[];
  stats?: any;
  errors?: string[];
  upload_id?: string | null;
  date_min?: string | null;
  date_max?: string | null;
  abonnements_suggeres?: { nom: string; prix: number; numeroCompte?: string; numeroAcces?: string | null; numeroFacture?: string; date?: string; typeCode?: number | null }[];
}

export async function importCsvBackend(params: {
  entrepriseId: number;
  file: File;
  format?: any;
  confirmedAccounts?: { num: string; nom?: string; lot?: string }[];
  confirmedAbos?: { nom: string; prix: number }[];
  analyzeAbos?: { enabled: boolean; types?: number[] };
  dryRun?: boolean;
}): Promise<ImportCsvResponse> {
  const form = new FormData();
  form.append("entreprise_id", String(params.entrepriseId));
  form.append("file", params.file);
  if (params.format) form.append("format", JSON.stringify(params.format));
  if (params.confirmedAccounts && params.confirmedAccounts.length > 0) {
    form.append("confirmed_accounts", JSON.stringify(params.confirmedAccounts));
  }
  if (params.confirmedAbos && params.confirmedAbos.length > 0) {
    form.append("confirmed_abos", JSON.stringify(params.confirmedAbos));
  }
  if (params.analyzeAbos) {
    form.append("analyze_abos", JSON.stringify(params.analyzeAbos));
  }
  if (params.dryRun) form.append("dry_run", "true");
  const res = await fetch(`${V2_USECASE}/import-csv`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Erreur import CSV");
  }
  return res.json() as Promise<ImportCsvResponse>;
}

export interface LigneFacture {
  id: number;
  facture_id: number;
  ligne_id: number;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  statut: number;
  total_ht: number;
}

export interface Abonnement {
  id: number;
  nom: string;
  prix: number;
  commentaire?: string | null;
}

export interface AbonnementUsageStat {
  id: number;
  nom: string;
  prix: number;
  commentaire?: string | null;
  nb_lignes: number;
  nb_factures: number;
  total_ht: number;
}

export interface AbonnementStatsResponse {
  mois: string;
  abonnements: AbonnementUsageStat[];
  lignes_sans_abonnement: number;
}

export interface LignesParTypeLot {
  lot: string;
  total: number;
  comptes: {
    compte_id: number;
    compte_num: string;
    compte_nom?: string | null;
    total: number;
    lignes: { id: number; num: string; nom?: string | null; sous_compte?: string | null }[];
  }[];
}

export interface LignesParTypeResponse {
  type: number;
  lots: LignesParTypeLot[];
}

export interface FactureAbonnementLink {
  ligne_id: number;
  ligne_type: number;
  prix_abo: number;
  date?: string | null;
  abonnement: Abonnement;
}

export interface AbonnementAttachPayload {
  ligne_ids: number[];
  abonnement_id?: number | null;
  nom?: string | null;
  prix?: number | null;
  commentaire?: string | null;
  date?: string | null;
}

export interface AbonnementAttachResponse {
  abonnement: Abonnement;
  ligne_ids: number[];
  date?: string | null;
}

export interface FactureDetail {
  facture: Facture;
  compte: Compte;
  lignes: {
    ligne_facture_id: number;
    ligne_id: number;
    ligne_num: string;
    nom?: string | null;
    ligne_type: number;
    sous_compte?: string | null;
    abo: number;
    conso: number;
    remises: number;
    achat: number;
    total_ht: number;
    statut: number;
    abo_id_ref?: number | null;
    abo_nom_ref?: string | null;
    abo_prix_ref?: number | null;
  }[];
  abonnements: any[];
}

export interface FactureDetailStats {
  stats_globales: Record<string, number>;
  stats_globales_prev?: Record<string, number> | null;
  months: {
    mois: string;
    total_ht: number;
    nb_factures: number;
    abo: number;
    conso: number;
    remises: number;
    achat: number;
  }[];
  lignes_by_id: Record<
    number,
    {
      abo: number;
      remises: number;
      achat: number;
      total_ht: number;
      statut: number;
      ligne_type: number;
      abo_id_ref?: number | null;
      abo_nom_ref?: string | null;
      abo_prix_ref?: number | null;
      sous_compte?: string | null;
      nom?: string | null;
    }
  >;
  facture_detail: FactureDetail;
  ligne_groupes?: {
    facture_id: number;
    group_key: string;
    ligne_type: number;
    abo_id_ref?: number | null;
    abo_nom_ref?: string | null;
    prix_abo: number;
    count: number;
    abo: number;
    remises: number;
    netAbo: number;
    conso: number;
    achat: number;
    total: number;
  }[];
  factures_resume?: {
    facture_id: number;
    facture_num: string;
    facture_date: string;
    total_ht: number;
    lignes_total: number;
    abo: number;
    conso: number;
    remises: number;
    achat: number;
    ecart: number;
  }[];
}

// Dashboard entreprise
export interface DashboardMonth {
  mois: string;
  total_ht: number;
  nb_factures: number;
  statuts: Record<number, number>;
  categories: Record<string, number>;
  delta_pct?: number | null;
  trend?: "up" | "down" | "flat" | null;
  categories_delta?: Record<string, number | null>;
}

export interface DashboardStats {
  nb_comptes: number;
  nb_lignes: number;
  nb_factures: number;
}

export interface DashboardResponse {
  entreprise: Entreprise;
  stats: DashboardStats;
  lignes_par_type: { type: number; count: number }[];
  statuts_global: Record<number, number>;
  months: DashboardMonth[];
  last_month?: DashboardMonth | null;
  prev_month?: DashboardMonth | null;
}

export interface MatriceFactureItem {
  facture_id: number;
  facture_num: string;
  statut: number;
  date_key: string;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  total_ht: number;
  csv_id?: string | null;
}

export interface MatriceCompte {
  compte_id: number;
  compte_num: string;
  compte_nom: string | null;
  lot: string | null;
  factures: MatriceFactureItem[];
}

export interface MatriceLot {
  lot: string;
  comptes: MatriceCompte[];
  totals_by_month: Record<string, number>;
  statuts_by_month: Record<string, Record<number, number>>;
}

export interface MatriceResponse {
  entreprise: Entreprise;
  months: string[];
  lots: MatriceLot[];
}

export async function shutdownBackend(): Promise<void> {
  const res = await fetch(`${V2_CMD}/shutdown`, { method: "POST" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Impossible d'arrêter le backend");
  }
}

export async function fetchEntrepriseDashboard(entrepriseId: number): Promise<DashboardResponse> {
  logApi("fetchEntrepriseDashboard", { entrepriseId });
  const res = await fetch(`${V2_VIEW}/entreprises/${entrepriseId}/dashboard`);
  return handleResponse<DashboardResponse>(res);
}

export async function fetchEntrepriseMatrice(entrepriseId: number): Promise<MatriceResponse> {
  logApi("fetchEntrepriseMatrice", { entrepriseId });
  const res = await fetch(`${V2_VIEW}/entreprises/${entrepriseId}/matrice`);
  return handleResponse<MatriceResponse>(res);
}

export async function listLignesFactures(params?: { facture_id?: number; ligne_id?: number }): Promise<LigneFacture[]> {
  const search = new URLSearchParams();
  if (params?.facture_id !== undefined) search.append("facture_id", params.facture_id.toString());
  if (params?.ligne_id !== undefined) search.append("ligne_id", params.ligne_id.toString());
  const res = await fetch(`${V2_READ}/lignes-factures${search.toString() ? `?${search}` : ""}`);
  return handleResponse<LigneFacture[]>(res);
}

export async function updateLigneFacture(
  id: number,
  payload: { statut?: number; abo?: number; conso?: number; remises?: number; achat?: number }
): Promise<LigneFacture> {
  const res = await fetch(`${V2_CMD}/lignes-factures/${id}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<LigneFacture>(res);
}

// Lignes (télécom)
// ============================================================================
// API CALL - ABONNEMENTS
// ============================================================================

export async function listAbonnements(): Promise<Abonnement[]> {
  const res = await fetch(`${V2_READ}/abonnements`);
  return handleResponse<Abonnement[]>(res);
}

export async function attachAbonnementToLines(payload: AbonnementAttachPayload): Promise<AbonnementAttachResponse> {
  const safePayload = { ...payload };
  // Backend schema expects null for optional date; avoid sending strings that trigger 422
  if (safePayload.date === undefined) {
    delete (safePayload as any).date;
  } else if (safePayload.date !== null) {
    safePayload.date = null;
  }
  const res = await fetch(`${V2_CMD}/abonnements/attacher`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(safePayload),
  });
  return handleResponse<AbonnementAttachResponse>(res);
}

export async function fetchEntrepriseAbonnementStats(entrepriseId: number): Promise<AbonnementStatsResponse> {
  const res = await fetch(`${V2_VIEW}/entreprises/${entrepriseId}/abonnements-stats`);
  return handleResponse<AbonnementStatsResponse>(res);
}

export async function fetchLignesParType(entrepriseId: number, type: number): Promise<LignesParTypeResponse> {
  const res = await fetch(`${V2_VIEW}/entreprises/${entrepriseId}/lignes-par-type?type_code=${type}`);
  return handleResponse<LignesParTypeResponse>(res);
}

export interface LigneTimelineResponse {
  ligne: {
    id: number;
    num: string;
    type: number;
    nom?: string | null;
    sous_compte?: string | null;
    compte_id: number;
    compte_num: string;
    compte_nom?: string | null;
    lot?: string | null;
  };
  factures: {
    facture_id: number;
    facture_num: string;
    date: string;
    statut: number;
    abo: number;
    conso: number;
    remises: number;
    achat: number;
    total_ht: number;
    ligne_facture_id: number;
    ligne_statut: number;
  }[];
  abonnements: {
    abonnement_id: number;
    nom: string;
    prix: number;
    date?: string | null;
  }[];
}

export async function fetchLigneTimeline(ligneId: number): Promise<LigneTimelineResponse> {
  const res = await fetch(`${V2_VIEW}/lignes/${ligneId}/timeline`);
  return handleResponse<LigneTimelineResponse>(res);
}

export async function getFactureAbonnements(factureId: number): Promise<FactureAbonnementLink[]> {
  const res = await fetch(`${V2_READ}/factures/${factureId}/abonnements`);
  return handleResponse<FactureAbonnementLink[]>(res);
}

// ============================================================================
// API CALLS - ENTREPRISES
// ============================================================================

export async function fetchEntreprises(): Promise<Entreprise[]> {
  const res = await fetch(`${V2_READ}/entreprises`);
  return handleResponse<Entreprise[]>(res);
}

export async function createEntreprise(nom: string): Promise<Entreprise> {
  const res = await fetch(`${V2_CMD}/entreprises/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nom }),
  });
  return handleResponse<Entreprise>(res);
}

export async function getEntreprise(id: number): Promise<Entreprise> {
  const res = await fetch(`${V2_READ}/entreprises/${id}`);
  return handleResponse<Entreprise>(res);
}

export async function updateEntreprise(id: number, nom: string): Promise<Entreprise> {
  const res = await fetch(`${V2_CMD}/entreprises/${id}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nom }),
  });
  return handleResponse<Entreprise>(res);
}

export async function deleteEntreprise(id: number): Promise<void> {
  const res = await fetch(`${V2_CMD}/entreprises/${id}/delete`, {
    method: "POST",
  });
  await handleResponse<{ deleted_id: number }>(res);
}

// ============================================================================ 
// API CALLS - UPLOADS CSV
// ============================================================================

export async function fetchUploadsForEntreprise(
  entrepriseId: number,
  opts?: { category?: string; limit?: number }
): Promise<{ entreprise: { id: number; nom: string }; uploads: UploadMeta[] }> {
  logApi("fetchUploadsForEntreprise", { entrepriseId, opts });
  const params = new URLSearchParams();
  if (opts?.category) params.append("category", opts.category);
  if (opts?.limit) params.append("limit", opts.limit.toString());
  const res = await fetch(
    `${V2_VIEW}/uploads/${entrepriseId}${params.toString() ? `?${params}` : ""}`
  );
  return handleResponse(res);
}

export async function deleteUpload(uploadId: string): Promise<void> {
  logApi("deleteUpload", { uploadId });
  const res = await fetch(`${V2_CMD}/uploads/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: uploadId }),
  });
  await handleResponse<{ deleted: boolean }>(res);
}

// ============================================================================
// API CALLS - COMPTES
// ============================================================================

export async function fetchComptes(entrepriseId?: number): Promise<Compte[]> {
  logApi("fetchComptes", { entrepriseId });
  const url = entrepriseId
    ? `${V2_READ}/comptes?entreprise_id=${entrepriseId}`
    : `${V2_READ}/comptes`;
  const res = await fetch(url);
  return handleResponse<Compte[]>(res);
}

export async function createCompte(compte: {
  num: string;
  nom?: string;
  entreprise_id: number;
  lot?: string;
}): Promise<Compte> {
  logApi("createCompte", { entreprise_id: compte.entreprise_id });
  const res = await fetch(`${V2_CMD}/comptes/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(compte),
  });
  return handleResponse<Compte>(res);
}

export async function getCompte(id: number): Promise<Compte> {
  const res = await fetch(`${V2_READ}/comptes/${id}`);
  return handleResponse<Compte>(res);
}

export async function updateCompte(
  id: number,
  update: { nom?: string | null; lot?: string | null }
): Promise<Compte> {
  const res = await fetch(`${V2_CMD}/comptes/${id}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return handleResponse<Compte>(res);
}

export async function deleteCompte(id: number): Promise<void> {
  const res = await fetch(`${V2_CMD}/comptes/${id}/delete`, {
    method: "POST",
  });
  await handleResponse<{ deleted_id: number }>(res);
}

// ============================================================================
// API CALLS - FACTURES
// ============================================================================

export async function fetchFactures(filters?: {
  compte_id?: number;
  entreprise_id?: number;
  date_debut?: string;
  date_fin?: string;
}): Promise<Facture[]> {
  logApi("fetchFactures", { filters });
  const params = new URLSearchParams();
  if (filters?.compte_id !== undefined) params.append("compte_id", filters.compte_id.toString());
  if (filters?.entreprise_id) params.append("entreprise_id", filters.entreprise_id.toString());
  if (filters?.date_debut) params.append("date_debut", filters.date_debut);
  if (filters?.date_fin) params.append("date_fin", filters.date_fin);

  const url = `${V2_READ}/factures${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url);
  logApi("fetchFactures: response", { url, status: res.status });
  return handleResponse<Facture[]>(res);
}

export async function createFacture(facture: {
  numero_facture: number | string;
  compte_id: number;
  date: string;
  abo: number;
  conso: number;
  remises: number;
  statut?: number;
  csv_id?: string | null;
}): Promise<Facture> {
  logApi("createFacture", { compte_id: facture.compte_id });
  const res = await fetch(`${V2_CMD}/factures/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...facture, numero_facture: facture.numero_facture.toString() }),
  });
  return handleResponse<Facture>(res);
}

export async function getFacture(id: number): Promise<Facture> {
  const res = await fetch(`${V2_READ}/factures/${id}`);
  return handleResponse<Facture>(res);
}

export async function updateFacture(
  id: number,
  update: { statut?: number }
): Promise<Facture> {
  logApi("updateFacture", { id, update });
  const payload: Record<string, any> = {};
  if (update.statut !== undefined && update.statut !== null) {
    payload.statut = update.statut;
  }
  const res = await fetch(`${V2_CMD}/factures/${id}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<Facture>(res);
}

export async function deleteFacture(id: number): Promise<void> {
  logApi("deleteFacture", { id });
  const res = await fetch(`${V2_CMD}/factures/${id}/delete`, {
    method: "POST",
  });
  await handleResponse<{ deleted_id: number }>(res);
}

export async function fetchFactureDetail(factureId: number): Promise<FactureDetail> {
  logApi("fetchFactureDetail", { factureId });
  const res = await fetch(`${V2_VIEW}/factures/${factureId}/detail`);
  logApi("fetchFactureDetail: response", { factureId, status: res.status });
  return handleResponse<FactureDetail>(res);
}

export async function fetchFactureDetailStats(factureId: number): Promise<FactureDetailStats> {
  logApi("fetchFactureDetailStats", { factureId });
  const res = await fetch(`${V2_VIEW}/factures/${factureId}/detail-stats`);
  logApi("fetchFactureDetailStats: response", { factureId, status: res.status });
  return handleResponse<FactureDetailStats>(res);
}

// ============================================================================
// API CALL - RAPPORT FACTURE
// ============================================================================

export interface FactureRapport {
  facture_id: number;
  commentaire: string | null;
  data: any;
  updated_at: string;
}

export async function getFactureRapport(factureId: number): Promise<FactureRapport | null> {
  console.log("[API] GET /factures/{id}/rapport", factureId);
  const res = await fetch(`${V2_READ}/factures/${factureId}/rapport`);
  if (res.status === 404) return null;
  return handleResponse<FactureRapport>(res);
}

export async function upsertFactureRapport(payload: {
  facture_id: number;
  commentaire?: string | null;
  data?: any;
}): Promise<FactureRapport> {
  const res = await fetch(`${V2_CMD}/factures/${payload.facture_id}/rapport`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<FactureRapport>(res);
}

// ============================================================================
// API CALL - REQUÊTE SQL PERSONNALISÉE
// ============================================================================

// ============================================================================
// API CALL - LIGNES
// ============================================================================

export async function updateLigneType(id: number, type: number): Promise<void> {
  const res = await fetch(`${V2_CMD}/lignes/${id}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
  await handleResponse<{ message: string }>(res);
}
