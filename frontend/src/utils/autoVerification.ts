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
  groups: Array<{
    groupKey: string;
    ligneFactureIds: number[];
    statut: { aboNet: StatutValeur; achat: StatutValeur };
    comments: { aboNet?: string; achat?: string };
    anomalies: LigneAnomalie[];
  }>;
  lineStatuts: Record<number, { aboNet: StatutValeur; achat: StatutValeur; comment?: string }>;
  summary: {
    added: number;
    removed: number;
    modified: number;
    previousFactureId: number | null;
    previousFactureNum?: string | null;
    previousFactureDate?: string | null;
    referenceFactureId?: number | null;
    referenceFactureNum?: string | null;
    referenceFactureDate?: string | null;
    sharedLinesCount?: number;
    selectedLinesCount?: number;
    referenceLinesCount?: number;
    selectionRule?: string;
  };
}

function coerceStatut(value: string | undefined): StatutValeur {
  if (value === "valide" || value === "conteste" || value === "a_verifier") return value;
  return "a_verifier";
}

function coerceAnomalie(anomalie: any): LigneAnomalie {
  return {
    kind: anomalie.kind as "added" | "removed" | "net_change", // Cast to union type; add validation if needed
    line: anomalie.line,
    detail: anomalie.detail,
    prev_net: anomalie.prev_net,
    curr_net: anomalie.curr_net,
    prev_achat: anomalie.prev_achat,
    curr_achat: anomalie.curr_achat,
  };
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
  const groupAnomalies: AutoVerificationResult["groupAnomalies"] = {};
  Object.entries(res.groupAnomalies || {}).forEach(([key, anomalies]) => {
    groupAnomalies[key] = (anomalies as any[]).map(coerceAnomalie);
  });
  const groups: AutoVerificationResult["groups"] = Array.isArray(res.groups)
    ? res.groups.map((group) => ({
        groupKey: String(group.groupKey || ""),
        ligneFactureIds: Array.isArray(group.ligneFactureIds) ? group.ligneFactureIds.map((id) => Number(id)) : [],
        statut: {
          aboNet: coerceStatut(group.statut?.aboNet),
          achat: coerceStatut(group.statut?.achat),
        },
        comments: group.comments || {},
        anomalies: Array.isArray(group.anomalies) ? group.anomalies.map(coerceAnomalie) : [],
      }))
    : [];
  const lineStatuts: AutoVerificationResult["lineStatuts"] = {};
  Object.entries(res.lineStatuts || {}).forEach(([id, val]) => {
    lineStatuts[Number(id)] = {
      aboNet: coerceStatut(val.aboNet),
      achat: coerceStatut(val.achat),
      comment: val.comment,
    };
  });
  return {
    metricStatuts,
    metricComments: res.metricComments || {},
    metricReals: res.metricReals || {},
    groupStatuts,
    groupComments: res.groupComments || {},
    groupAnomalies,
    groups,
    lineStatuts,
    summary: res.summary as AutoVerificationResult["summary"],
  };
}

export async function runAutoVerification(inputs: AutoVerificationInputs): Promise<AutoVerificationResult> {
  const res = await autoVerifyFull(inputs.factureId);
  return mapResult(res);
}
