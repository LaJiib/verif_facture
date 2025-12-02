/**
 * API client pour communiquer avec le backend restructuré.
 *
 * Architecture backend:
 * - Entreprise: Client
 * - Compte: Ligne télécom (id = numéro d'accès)
 * - Facture: Facture mensuelle (abo, conso, remise, statut)
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody.detail || "Erreur lors de l'appel API.";
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
  numero_facture: number;
  compte_id: string;
  date: string;  // Format ISO: "2025-11-01"
  abo: number;
  conso: number;
  remise: number;
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
  const res = await fetch(`${API_BASE_URL}/uploads/${uploadId}/download`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Impossible de récupérer le fichier");
  }
  return res.text();
}

// LLM local (Ollama)
export async function summarizeWithLlm(texts: string[], system?: string): Promise<string> {
  console.log("[LLM] summarize request", {
    count: texts.length,
    sample: texts.slice(0, 2),
    full: texts,
  });
  const res = await fetch(`${API_BASE_URL}/llm/summarize`, {
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
  const res = await fetch(`${API_BASE_URL}/factures/${factureId}/autoverif/ecart`, { method: "POST" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Erreur auto-vérification écart");
  }
  return res.json() as Promise<AutoVerifEcartResult>;
}

export async function autoVerifyGroupe(
  factureId: number,
  payload: { ligne_type: number; prix_abo: number }
): Promise<AutoVerifGroupeResult> {
  const res = await fetch(`${API_BASE_URL}/factures/${factureId}/autoverif/groupe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Erreur auto-vérification groupe");
  }
  return res.json() as Promise<AutoVerifGroupeResult>;
}

// ============================================================================
// API CALLS - ENTREPRISES
// ============================================================================

export async function fetchEntreprises(): Promise<Entreprise[]> {
  const res = await fetch(`${API_BASE_URL}/entreprises`);
  return handleResponse<Entreprise[]>(res);
}

export async function createEntreprise(nom: string): Promise<Entreprise> {
  const res = await fetch(`${API_BASE_URL}/entreprises`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nom }),
  });
  return handleResponse<Entreprise>(res);
}

export async function getEntreprise(id: number): Promise<Entreprise> {
  const res = await fetch(`${API_BASE_URL}/entreprises/${id}`);
  return handleResponse<Entreprise>(res);
}

export async function updateEntreprise(id: number, nom: string): Promise<Entreprise> {
  const res = await fetch(`${API_BASE_URL}/entreprises/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nom }),
  });
  return handleResponse<Entreprise>(res);
}

export async function deleteEntreprise(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/entreprises/${id}`, {
    method: "DELETE",
  });
  await handleResponse<{ message: string }>(res);
}

// ============================================================================ 
// API CALLS - UPLOADS CSV
// ============================================================================

export async function fetchUploadsForEntreprise(
  entrepriseId: number,
  opts?: { category?: string; limit?: number }
): Promise<{ entreprise: { id: number; nom: string }; uploads: UploadMeta[] }> {
  const params = new URLSearchParams();
  if (opts?.category) params.append("category", opts.category);
  if (opts?.limit) params.append("limit", opts.limit.toString());
  const res = await fetch(
    `${API_BASE_URL}/entreprises/${entrepriseId}/uploads${params.toString() ? `?${params}` : ""}`
  );
  return handleResponse(res);
}

export async function deleteUpload(uploadId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/uploads/${uploadId}`, {
    method: "DELETE",
  });
  await handleResponse<{ message: string }>(res);
}

// ============================================================================
// API CALLS - COMPTES
// ============================================================================

export async function fetchComptes(entrepriseId?: number): Promise<Compte[]> {
  const url = entrepriseId
    ? `${API_BASE_URL}/comptes?entreprise_id=${entrepriseId}`
    : `${API_BASE_URL}/comptes`;
  const res = await fetch(url);
  return handleResponse<Compte[]>(res);
}

export async function createCompte(compte: {
  num: string;
  nom?: string;
  entreprise_id: number;
  lot?: string;
}): Promise<Compte> {
  const res = await fetch(`${API_BASE_URL}/comptes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(compte),
  });
  return handleResponse<Compte>(res);
}

export async function getCompte(id: string): Promise<Compte> {
  const res = await fetch(`${API_BASE_URL}/comptes/${id}`);
  return handleResponse<Compte>(res);
}

export async function updateCompte(
  id: number,
  update: { nom?: string | null; lot?: string | null }
): Promise<Compte> {
  const res = await fetch(`${API_BASE_URL}/comptes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return handleResponse<Compte>(res);
}

export async function deleteCompte(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/comptes/${id}`, {
    method: "DELETE",
  });
  await handleResponse<{ message: string }>(res);
}

// ============================================================================
// API CALLS - FACTURES
// ============================================================================

export async function fetchFactures(filters?: {
  compte_id?: string;
  entreprise_id?: number;
  date_debut?: string;
  date_fin?: string;
}): Promise<Facture[]> {
  const params = new URLSearchParams();
  if (filters?.compte_id) params.append("compte_id", filters.compte_id);
  if (filters?.entreprise_id) params.append("entreprise_id", filters.entreprise_id.toString());
  if (filters?.date_debut) params.append("date_debut", filters.date_debut);
  if (filters?.date_fin) params.append("date_fin", filters.date_fin);

  const url = `${API_BASE_URL}/factures${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url);
  return handleResponse<Facture[]>(res);
}

export async function createFacture(facture: {
  numero_facture: number;
  compte_id: string;
  date: string;
  abo: number;
  conso: number;
  remise: number;
  statut?: number;
  csv_id?: string | null;
}): Promise<Facture> {
  const res = await fetch(`${API_BASE_URL}/factures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(facture),
  });
  return handleResponse<Facture>(res);
}

export async function getFacture(id: number): Promise<Facture> {
  const res = await fetch(`${API_BASE_URL}/factures/${id}`);
  return handleResponse<Facture>(res);
}

export async function updateFacture(
  id: number,
  update: { statut?: number }
): Promise<Facture> {
  const res = await fetch(`${API_BASE_URL}/factures/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return handleResponse<Facture>(res);
}

export async function deleteFacture(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/factures/${id}`, {
    method: "DELETE",
  });
  await handleResponse<{ message: string }>(res);
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
  const res = await fetch(`${API_BASE_URL}/factures/${factureId}/rapport`);
  if (res.status === 404) return null;
  return handleResponse<FactureRapport>(res);
}

export async function upsertFactureRapport(payload: {
  facture_id: number;
  commentaire?: string | null;
  data?: any;
}): Promise<FactureRapport> {
  const res = await fetch(`${API_BASE_URL}/factures/${payload.facture_id}/rapport`, {
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
  const res = await fetch(`${API_BASE_URL}/query`, {
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
  const res = await fetch(`${API_BASE_URL}/lignes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
  await handleResponse<{ message: string }>(res);
}
