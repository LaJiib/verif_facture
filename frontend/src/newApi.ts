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
    ligne_type: number;
    abo: number;
    conso: number;
    remises: number;
    achat: number;
    total_ht: number;
    statut: number;
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
    }
  >;
  facture_detail: FactureDetail;
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

// ============================================================================
// API CALL - ABONNEMENTS
// ============================================================================

export async function listAbonnements(): Promise<Abonnement[]> {
  const res = await fetch(`${V2_READ}/abonnements`);
  return handleResponse<Abonnement[]>(res);
}

export async function attachAbonnementToLines(payload: AbonnementAttachPayload): Promise<AbonnementAttachResponse> {
  const res = await fetch(`${V2_CMD}/abonnements/attacher`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<AbonnementAttachResponse>(res);
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
  return handleResponse<Facture[]>(res);
}

export async function createFacture(facture: {
  numero_facture: number;
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
  const res = await fetch(`${V2_CMD}/factures/${id}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
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
  return handleResponse<FactureDetail>(res);
}

export async function fetchFactureDetailStats(factureId: number): Promise<FactureDetailStats> {
  logApi("fetchFactureDetailStats", { factureId });
  const res = await fetch(`${V2_VIEW}/factures/${factureId}/detail-stats`);
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

export async function executeQuery(sql: string): Promise<{ data: any[]; count: number }> {
  logApi("executeQuery", { length: sql.length });
  const res = await fetch(`${V2_READ}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  return handleResponse<{ data: any[]; count: number }>(res);
}

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
