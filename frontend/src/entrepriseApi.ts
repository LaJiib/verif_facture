/// <reference types="vite/client" />

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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
  nb_lignes: number;
  nb_records: number;
}

export interface TypeLigneAggregation {
  count: number;
  total_ht: number;
  total_ttc: number;
  lignes: LigneInfo[];
}

export interface LigneInfo {
  ligne_id: number;
  numero_acces: string;
  nom: string | null;
  record_id: number;
  numero_facture: number;
  total_ht: number;
}

export interface MoisAggregation {
  mois: string;
  total_ht: number;
  total_ttc: number;
  par_type_ligne: Record<string, TypeLigneAggregation>;
}

export interface EntrepriseAggregationResponse {
  entreprise: {
    id: number;
    nom: string;
  };
  aggregation_par_mois: Record<string, MoisAggregation>;
}

export interface RecordDetail {
  id: number;
  numero_compte: string;
  numero_facture: number;
  date: string | null;
  mois: string;
  abo: number;
  conso: number;
  remise: number;
  total_ht: number;
  total_ttc: number;
  nb_lignes_detail: number;
  statut: string;
}

export interface LigneDetail {
  id: number;
  nom: string | null;
  numero_acces: string;
  type_ligne: string;
  adresse: string | null;
}

export interface LigneRecordsResponse {
  ligne: LigneDetail;
  records: RecordDetail[];
}

// ============================================================================
// API CALLS
// ============================================================================

export async function fetchEntreprises(): Promise<Entreprise[]> {
  const res = await fetch(`${API_BASE_URL}/entreprises`);
  const data = await handleResponse<{ entreprises: Entreprise[] }>(res);
  return data.entreprises;
}

export async function createEntreprise(nom: string): Promise<Entreprise> {
  const formData = new FormData();
  formData.append("nom", nom);
  const res = await fetch(`${API_BASE_URL}/entreprises`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<Entreprise>(res);
}

export async function fetchEntrepriseAggregation(
  entrepriseId: number
): Promise<EntrepriseAggregationResponse> {
  const res = await fetch(
    `${API_BASE_URL}/entreprises/${entrepriseId}/aggregation`
  );
  return handleResponse<EntrepriseAggregationResponse>(res);
}

export async function fetchLigneRecords(
  ligneId: number
): Promise<LigneRecordsResponse> {
  const res = await fetch(`${API_BASE_URL}/lignes/${ligneId}/records`);
  return handleResponse<LigneRecordsResponse>(res);
}
