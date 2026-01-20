import { autoVerifyFull, type AutoVerifFullResult } from "../newApi";

export type StatutValeur = "valide" | "conteste" | "a_verifier";

export interface AutoVerificationInputs {
  factureId: number;
}

export interface LigneAnomalie {
  kind: "added" | "removed" | "net_change";
  line?: string;
  detail: string;
  prev_net?: number;
  curr_net?: number;
  prev_achat?: number;
  curr_achat?: number;
}

export interface AutoVerificationResult {
  metricStatuts: {
    aboNet: StatutValeur;
    ecart: StatutValeur;
    achat: StatutValeur;
    conso: StatutValeur;
  };
  metricComments: Record<string, string>;
  metricReals: Record<string, string>;
  groupStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }>;
  groupComments: Record<string, { aboNet?: string; achat?: string }>;
  groupAnomalies: Record<string, LigneAnomalie[]>;
  summary: { added: number; removed: number; modified: number; previousFactureId: number | null; previousFactureNum?: string | null };
}

function coerceStatut(value: string | undefined): StatutValeur {
  if (value === "valide" || value === "conteste" || value === "a_verifier") return value;
  return "a_verifier";
}

function mapResult(res: AutoVerifFullResult): AutoVerificationResult {
  const metricStatuts: AutoVerificationResult["metricStatuts"] = {
    aboNet: coerceStatut(res.metricStatuts?.aboNet),
    ecart: coerceStatut(res.metricStatuts?.ecart),
    achat: coerceStatut(res.metricStatuts?.achat),
    conso: coerceStatut(res.metricStatuts?.conso),
  };
  const groupStatuts: AutoVerificationResult["groupStatuts"] = {};
  Object.entries(res.groupStatuts || {}).forEach(([key, val]) => {
    groupStatuts[key] = { aboNet: coerceStatut(val.aboNet), achat: coerceStatut(val.achat) };
  });
  return {
    metricStatuts,
    metricComments: res.metricComments || {},
    metricReals: res.metricReals || {},
    groupStatuts,
    groupComments: res.groupComments || {},
    groupAnomalies: res.groupAnomalies || {},
    summary: res.summary as AutoVerificationResult["summary"],
  };
}

export async function runAutoVerification(inputs: AutoVerificationInputs): Promise<AutoVerificationResult> {
  const res = await autoVerifyFull(inputs.factureId);
  return mapResult(res);
}
