import { autoVerifyEcart, executeQuery, updateLigneFacture } from "../newApi";

export type StatutValeur = "valide" | "conteste" | "a_verifier";

export interface AutoVerificationInputs {
  factureId: number;
  compteId: number;
  factureDate?: string | null;
  factureEcart?: number | null;
  factureAchat?: number | null;
  existingMetricStatuts?: {
    aboNet: StatutValeur;
    ecart: StatutValeur;
    achat: StatutValeur;
    conso: StatutValeur;
  };
  existingMetricComments?: Record<string, string>;
  existingGroupStatuts?: Record<string, { aboNet: StatutValeur; achat: StatutValeur }>;
  existingGroupComments?: Record<string, { aboNet?: string; achat?: string }>;
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

interface FactureLineSnapshot {
  ligne_facture_id: number;
  ligne_id: number;
  ligne_num: string;
  ligne_type: number;
  net_abo: number;
  achat: number;
  statut?: number;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  return Number(value);
}

function hasDelta(a: number, b: number) {
  return Math.abs(a - b) > 0.009;
}

async function fetchFactureLines(factureId: number): Promise<FactureLineSnapshot[]> {
  const sql = `
    SELECT
      lf.id as ligne_facture_id,
      l.id as ligne_id,
      l.num as ligne_num,
      l.type as ligne_type,
      SUM(lf.abo + lf.remises) as net_abo,
      SUM(lf.achat) as achat,
      lf.statut as statut
    FROM lignes_factures lf
    JOIN lignes l ON l.id = lf.ligne_id
    WHERE lf.facture_id = ${factureId}
    GROUP BY l.id, l.num, l.type
  `;
  const res = await executeQuery(sql);
  return (res.data || []).map((row) => ({
    ligne_facture_id: row.ligne_facture_id,
    ligne_id: row.ligne_id,
    ligne_num: row.ligne_num,
    ligne_type: row.ligne_type,
    net_abo: Number(toNumber(row.net_abo).toFixed(2)),
    achat: Number(toNumber(row.achat).toFixed(2)),
    statut: row.statut,
  }));
}

async function fetchPreviousNonImportedByLine(compteId: number, factureDate?: string | null) {
  const dateFilter = factureDate ? `AND f.date < '${factureDate}'` : "";
  const sql = `
    SELECT
      lf.ligne_id,
      lf.abo,
      lf.remises,
      lf.achat,
      lf.statut
    FROM lignes_factures lf
    JOIN factures f ON f.id = lf.facture_id
    WHERE f.compte_id = ${compteId}
      ${dateFilter}
      AND lf.statut != 0
    ORDER BY f.date DESC, lf.id DESC
  `;
  const res = await executeQuery(sql);
  const prevMap = new Map<number, { net_abo: number; achat: number; statut: number }>();
  (res.data || []).forEach((row: any) => {
    if (prevMap.has(row.ligne_id)) return;
    prevMap.set(row.ligne_id, {
      net_abo: Number(toNumber(row.abo + row.remises).toFixed(2)),
      achat: Number(toNumber(row.achat).toFixed(2)),
      statut: Number(row.statut ?? 0),
    });
  });
  return prevMap;
}

async function findPreviousValidatedFactureId(args: {
  compteId: number;
  factureId: number;
  factureDate?: string | null;
}): Promise<number | null> {
  const { compteId, factureId, factureDate } = args;
  const dateFilter = factureDate ? `AND f.date < '${factureDate}'` : "";
  const sql = `
    SELECT f.id
    FROM factures f
    WHERE f.compte_id = ${compteId}
      AND f.statut = 1
      AND f.id <> ${factureId}
      ${dateFilter}
    ORDER BY f.date DESC
    LIMIT 1
  `;
  const res = await executeQuery(sql);
  const previousId = res.data?.[0]?.id;
  return previousId ?? null;
}

function buildGroupKey(line: FactureLineSnapshot) {
  return `${line.ligne_type}|${line.net_abo.toFixed(2)}`;
}

function registerGroupStatut(
  groupStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }>,
  key: string
) {
  groupStatuts[key] = { ...(groupStatuts[key] || {}), aboNet: "a_verifier", achat: "a_verifier" };
}

function collectLineDiffs(
  currentLines: FactureLineSnapshot[],
  previousLines: FactureLineSnapshot[],
  existingGroupStatuts?: Record<string, { aboNet: StatutValeur; achat: StatutValeur }>,
  existingGroupComments?: Record<string, { aboNet?: string; achat?: string }>
): {
  groupStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }>;
  groupComments: Record<string, { aboNet?: string; achat?: string }>;
  groupAnomalies: Record<string, LigneAnomalie[]>;
  summary: { added: number; removed: number; modified: number };
} {
  const prevById = new Map(previousLines.map((l) => [l.ligne_id, l]));
  const seenPrev = new Set<number>();
  const groupAnomalies: Record<string, LigneAnomalie[]> = {};
  const groupTotals: Record<string, { achat: number }> = {};
  const commentParts: Record<string, string[]> = {};
  const achatTotals: Record<string, number> = {};
  const groupStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }> = {
    ...(existingGroupStatuts || {}),
  };
  const groupComments: Record<string, { aboNet?: string; achat?: string }> = {
    ...(existingGroupComments || {}),
  };

  let added = 0;
  let removed = 0;
  let modified = 0;

  const pushAnomaly = (key: string, anomaly: LigneAnomalie) => {
    if (!groupAnomalies[key]) groupAnomalies[key] = [];
    groupAnomalies[key].push(anomaly);
  };

  const pushComment = (key: string, text: string, achat?: number) => {
    if (!commentParts[key]) commentParts[key] = [];
    commentParts[key].push(text);
    if (achat !== undefined && achat !== null && !Number.isNaN(achat)) {
      achatTotals[key] = (achatTotals[key] || 0) + achat;
    }
  };

  currentLines.forEach((line) => {
    const prev = prevById.get(line.ligne_id);
    const groupKey = buildGroupKey(line);
    const lineLabel = line.ligne_num || `Ligne ${line.ligne_id}`;
    groupTotals[groupKey] = groupTotals[groupKey] || { achat: 0 };
    groupTotals[groupKey].achat += toNumber(line.achat);
    if (!prev) {
      added += 1;
      const detail = `${lineLabel} : nouvelle ligne (net ${line.net_abo.toFixed(2)} EUR)`;
      pushAnomaly(groupKey, {
        kind: "added",
        line: lineLabel,
        curr_net: line.net_abo,
        curr_achat: line.achat,
        detail,
      });
      registerGroupStatut(groupStatuts, groupKey);
      pushComment(groupKey, `+ ${detail}`, line.achat);
      return;
    }
    seenPrev.add(prev.ligne_id);
    if (hasDelta(line.net_abo, prev.net_abo)) {
      modified += 1;
      const detail = `${lineLabel} : net ${prev.net_abo.toFixed(2)} EUR -> ${line.net_abo.toFixed(2)} EUR`;
      pushAnomaly(groupKey, {
        kind: "net_change",
        line: lineLabel,
        prev_net: prev.net_abo,
        curr_net: line.net_abo,
        prev_achat: prev.achat,
        curr_achat: line.achat,
        detail,
      });
      registerGroupStatut(groupStatuts, groupKey);
      pushComment(groupKey, detail, line.achat);
    }
  });

  previousLines.forEach((line) => {
    if (seenPrev.has(line.ligne_id)) return;
    removed += 1;
    const key = `removed|${line.ligne_type}|${line.net_abo.toFixed(2)}`;
    const lineLabel = line.ligne_num || `Ligne ${line.ligne_id}`;
    const detail = `${lineLabel} : supprimee (net ${line.net_abo.toFixed(2)} EUR)`;
    pushAnomaly(key, {
      kind: "removed",
      line: lineLabel,
      prev_net: line.net_abo,
      prev_achat: line.achat,
      detail,
    });
  });

  Object.entries(commentParts).forEach(([key, parts]) => {
    const achatTotal = achatTotals[key];
    groupComments[key] = {
      ...(groupComments[key] || {}),
      aboNet: parts.join("\n"),
      achat: achatTotal !== undefined ? `Achats regroupes: ${achatTotal.toFixed(2)} EUR` : groupComments[key]?.achat,
    };
  });

  return {
    groupStatuts,
    groupComments,
    groupAnomalies,
    summary: { added, removed, modified },
  };
}

export async function runAutoVerification(inputs: AutoVerificationInputs): Promise<AutoVerificationResult> {
  const {
    factureId,
    compteId,
    factureDate,
    factureEcart,
    factureAchat,
    existingMetricStatuts,
    existingMetricComments,
    existingGroupStatuts,
    existingGroupComments,
  } = inputs;

  const baseMetricStatuts: AutoVerificationResult["metricStatuts"] =
    existingMetricStatuts || { aboNet: "a_verifier", ecart: "a_verifier", achat: "a_verifier", conso: "a_verifier" };
  const achatStatut: StatutValeur = factureAchat === 0 ? "valide" : "conteste";

  const ecartResult = await autoVerifyEcart(factureId);
  const metricStatuts = {
    ...baseMetricStatuts,
    ecart: ecartResult.statut as StatutValeur,
    achat: achatStatut,
  };
  const metricComments: Record<string, string> = {
    ...(existingMetricComments || {}),
    ecart: ecartResult.commentaire || "",
  };
  const metricReals: Record<string, string> = { ecart: Number(factureEcart ?? 0).toFixed(2) };

  const previousFactureId = await findPreviousValidatedFactureId({ compteId, factureId, factureDate });
  const currentLines = await fetchFactureLines(factureId);
  const previousLines = previousFactureId ? await fetchFactureLines(previousFactureId) : [];
  const prevNonImportedMap = await fetchPreviousNonImportedByLine(compteId, factureDate);

  const {
    groupStatuts,
    groupComments,
    groupAnomalies,
    summary: lineSummary,
  } = collectLineDiffs(currentLines, previousLines, existingGroupStatuts, existingGroupComments);

  // Auto-valide les groupes sans anomalies et avec achat total nul
  const groupTotals: Record<string, { achat: number }> = {};
  currentLines.forEach((line) => {
    const key = buildGroupKey(line);
    groupTotals[key] = groupTotals[key] || { achat: 0 };
    groupTotals[key].achat += toNumber(line.achat);
  });
  Object.entries(groupTotals).forEach(([key, totals]) => {
    const hasAnomaly = (groupAnomalies[key] || []).length > 0;
    const achatZero = Math.abs(totals.achat) < 0.0001;
    // Achat nul => peut être validé même s'il y a des anomalies sur le net
    if (achatZero) {
      groupStatuts[key] = { ...(groupStatuts[key] || {}), achat: "valide" };
    }
    // Si aucune anomalie et achat nul, on valide aussi l'abo net
    if (!hasAnomaly && achatZero) {
      groupStatuts[key] = { ...(groupStatuts[key] || {}), aboNet: "valide", achat: "valide" };
    }
  });

  // Aligne les statuts des lignesFactures actuelles sur la dernière occurrence non importée (statut != 0) si net identique
  const updates: Promise<any>[] = [];
  currentLines.forEach((line) => {
    const prev = prevNonImportedMap.get(line.ligne_id);
    if (!prev) return;
    const netCurr = Number(line.net_abo.toFixed(2));
    const netPrev = Number(prev.net_abo.toFixed(2));
    if (netCurr === netPrev && line.statut !== prev.statut) {
      updates.push(updateLigneFacture(line.ligne_facture_id, { statut: prev.statut }));
    }
  });
  if (updates.length > 0) {
    await Promise.allSettled(updates);
  }

  return {
    metricStatuts,
    metricComments,
    metricReals,
    groupStatuts,
    groupComments,
    groupAnomalies,
    summary: { ...lineSummary, previousFactureId: previousFactureId ?? null, previousFactureNum: previousFactureId ? String(previousFactureId) : null },
  };
}
