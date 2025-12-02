export type StatutValeur = "valide" | "conteste" | "a_verifier";

export interface AutoVerifyResult {
  metricStatuts: Record<string, StatutValeur>;
  metricComments: Record<string, string>;
  metricReals: Record<string, string>;
  groupStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }>;
  groupComments: Record<string, { aboNet?: string; achat?: string }>;
  groupReals: Record<string, { aboNet?: string; achat?: string }>;
  factureStatut: "valide" | "conteste";
  csvFindings?: string[];
}

type DetailLigne = {
  ligne_id: number;
  ligne_num?: string;
  ligne_type: number;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
};

type FactureLigneGroupe = {
  ligne_type: number;
  prix_abo: number;
  count: number;
  abo: number;
  remises: number;
  conso: number;
  netAbo: number;
  achat: number;
};

type FactureAvecEcart = {
  facture_id: number;
  ecart: number;
  achat: number;
  facture_num?: string;
  facture_date?: string;
  csv_id?: string | null;
};

type AutoVerifyParams = {
  facture: FactureAvecEcart;
  detailLignes: DetailLigne[];
  prevLignes: DetailLigne[];
  groupes: FactureLigneGroupe[];
  csvRowsAllCurrent?: any[]; // CSV complet (filtré sur la facture) pour détecter les lignes sans accès
  currentRowsByAccess?: Record<string, any[]>; // map accès -> rows CSV de la facture courante
  refRowsByAccess?: Record<string, any[]>; // map accès -> rows CSV de la dernière facture validée
};

function safeNumber(val: any): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

// Stub LLM: à remplacer par Qwen2.5-0.5B local
export async function summarizeWithLLM(texts: string[], caller?: (texts: string[]) => Promise<string>): Promise<string> {
  if (!texts.length) return "";
  if (caller) {
    try {
      return await caller(texts);
    } catch {
      // fallback below
    }
  }
  return `Synthèse auto (LLM local à brancher): ${texts.join(" | ")}`;
}

function detectMissingAccess(csvRows: any[]): { comment: string; rows: string[] } | null {
  if (!csvRows || csvRows.length === 0) return null;
  const keys = Object.keys(csvRows[0] || {});
  const lower = (s: string) => (s || "").toLowerCase();
  const accessKey = keys.find((k) => lower(k).includes("acc"));
  const libKey = keys.find((k) => lower(k).includes("libell"));
  const factKey = keys.find((k) => lower(k).includes("facture"));
  const issues = csvRows.filter((r) => {
    const v = accessKey ? (r as any)[accessKey] : null;
    return !v || String(v).trim() === "";
  });
  if (issues.length === 0) return null;
  const rowsFull = issues.map((r: any) => JSON.stringify(r));
  const samples = issues.slice(0, 5).map((r: any) => {
    const lib = libKey ? r[libKey] : "";
    const fact = factKey ? r[factKey] : "";
    return `[Facture ${fact || "?"}] ${lib || "ligne sans libellé"}`;
  });
  return {
    comment: `Lignes sans numéro d'accès détectées: ${issues.length} (ex: ${samples.join("; ")})`,
    rows: rowsFull,
  };
}

function compareLinesToPrevious(
  detailLignes: DetailLigne[],
  prevLignes: DetailLigne[],
  currentRowsByAccess?: Record<string, any[]>,
  refRowsByAccess?: Record<string, any[]>
): string[] {
  const comments: string[] = [];
  const prevNetByLine: Record<number, number> = {};
  prevLignes.forEach((l) => {
    prevNetByLine[l.ligne_id] = safeNumber(l.abo) + safeNumber(l.remises);
  });

  detailLignes.forEach((l) => {
    const prevNet = prevNetByLine[l.ligne_id];
    const currNet = safeNumber(l.abo) + safeNumber(l.remises);
    if (prevNet === undefined) return;
    if (Math.abs(currNet - prevNet) >= 0.01) {
      const accessKey = l.ligne_num || String(l.ligne_id);
      const samplesCurr = currentRowsByAccess?.[accessKey] || [];
      const samplesPrev = refRowsByAccess?.[accessKey] || [];
      const details = [
        `Ligne ${accessKey}: net actuel ${currNet.toFixed(2)}€ vs précédent ${prevNet.toFixed(2)}€ (delta ${(currNet - prevNet).toFixed(2)}€)`,
        ...samplesCurr.slice(0, 2).map((r: any) => `CURR: ${JSON.stringify(r)}`),
        ...samplesPrev.slice(0, 2).map((r: any) => `REF: ${JSON.stringify(r)}`),
      ];
      const note = details.join(" | ");
      comments.push(note);
    }
  });
  return comments;
}

export async function autoVerifyFacture(
  params: AutoVerifyParams,
  llmCaller?: (texts: string[]) => Promise<string>
): Promise<AutoVerifyResult> {
  const { facture, detailLignes, prevLignes, groupes, csvRowsAllCurrent, currentRowsByAccess, refRowsByAccess } = params;
  console.log("[Auto] Paramètres autoVerifyFacture", {
    facture_id: facture?.facture_id,
    ecart: facture?.ecart,
    achat: facture?.achat,
    csv_rows: csvRowsAllCurrent?.length || 0,
    current_access_keys: currentRowsByAccess ? Object.keys(currentRowsByAccess).length : 0,
    ref_access_keys: refRowsByAccess ? Object.keys(refRowsByAccess).length : 0,
  });

  const metricStatuts: Record<string, StatutValeur> = {};
  const metricComments: Record<string, string> = {};
  const metricReals: Record<string, string> = {};
  const groupStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }> = {};
  const groupComments: Record<string, { aboNet?: string; achat?: string }> = {};
  const groupReals: Record<string, { aboNet?: string; achat?: string }> = {};
  const csvFindings: string[] = [];

  // 1) Ecart global facture-lignes
  const safeEcart = safeNumber(facture?.ecart);
  if (Math.abs(safeEcart) < 0.01) {
    metricStatuts.ecart = "valide";
  } else {
    metricStatuts.ecart = "conteste";
    metricComments.ecart = `Ecart facture - lignes de ${safeEcart.toFixed(2)} €`;
    metricReals.ecart = safeEcart.toFixed(2);
  }

  // 2) Achats globaux
  const safeAchat = safeNumber(facture?.achat);
  metricStatuts.achat = safeAchat === 0 ? "valide" : "conteste";
  if (safeAchat !== 0) {
    metricComments.achat = `Achat(s) détecté(s): ${safeAchat.toFixed(2)} €`;
    metricReals.achat = safeAchat.toFixed(2);
  }

  // 3) Conso globale (par défaut à vérifier)
  metricStatuts.conso = "a_verifier";

  // 4) Groupes (aboNet/achat)
  const prevNetByLine: Record<number, number> = {};
  prevLignes.forEach((l) => (prevNetByLine[l.ligne_id] = safeNumber(l.abo) + safeNumber(l.remises)));

  groupes.forEach((g) => {
    const prix = safeNumber((g as any).prix_abo ?? (g as any).prixAbo);
    const achatVal = safeNumber(g.achat);
    const key = `${g.ligne_type}|${prix.toFixed(2)}`;
    let aboStatus: StatutValeur = "valide";
    let aboComment = "";
    let aboReal: string | undefined;

    const lignesGroupe = detailLignes.filter((l) => l.ligne_type === g.ligne_type);
    lignesGroupe.forEach((l) => {
      const prevNet = prevNetByLine[l.ligne_id];
      const currNet = safeNumber(l.abo) + safeNumber(l.remises);
      if (prevNet === undefined) {
        aboStatus = "conteste";
        aboComment = "Nouvelle ligne dans ce groupe";
        aboReal = currNet.toFixed(2);
      } else if (Math.abs(currNet - prevNet) >= 0.01) {
        aboStatus = "conteste";
        aboComment = `Net unitaire changé (ancien ${prevNet.toFixed(2)} €, nouveau ${currNet.toFixed(2)} €)`;
        aboReal = currNet.toFixed(2);
      }
    });

    groupStatuts[key] = { aboNet: aboStatus, achat: achatVal === 0 ? "valide" : "conteste" };
    if (aboComment) groupComments[key] = { ...(groupComments[key] || {}), aboNet: aboComment };
    if (aboReal) groupReals[key] = { ...(groupReals[key] || {}), aboNet: aboReal };
    if (groupStatuts[key].achat === "conteste") {
      groupComments[key] = { ...(groupComments[key] || {}), achat: `Achat détecté: ${achatVal.toFixed(2)} €` };
      groupReals[key] = { ...(groupReals[key] || {}), achat: achatVal.toFixed(2) };
    }
  });

  // 5) Analyse CSV: lignes sans accès
  if (csvRowsAllCurrent && csvRowsAllCurrent.length > 0) {
    const missingAccess = detectMissingAccess(csvRowsAllCurrent);
    if (missingAccess) {
      csvFindings.push(missingAccess.comment, ...missingAccess.rows);
      metricStatuts.ecart = "conteste";
      console.log("[Auto] Lignes sans accès détectées", { count: csvRowsAllCurrent.length });
    }
  }

  // 6) Deltas par ligne vs dernière facture validée (si données dispos)
  const deltaComments = compareLinesToPrevious(detailLignes, prevLignes, currentRowsByAccess, refRowsByAccess);
  if (deltaComments.length > 0) {
    csvFindings.push(...deltaComments);
    metricStatuts.ecart = "conteste";
    console.log("[Auto] Deltas par ligne détectés", { deltaComments });
  }

  if (csvFindings.length > 0) {
    const summary = await summarizeWithLLM(csvFindings, llmCaller);
    const existing = metricComments.ecart ? `${metricComments.ecart} | ` : "";
    metricComments.ecart = `${existing}${summary}`;
    console.log("[Auto] Synthèse CSV/LLM", { summary });
  }

  const hasConteste =
    metricStatuts.ecart === "conteste" ||
    metricStatuts.achat === "conteste" ||
    Object.values(groupStatuts).some((gs) => gs.aboNet === "conteste" || gs.achat === "conteste");

  return {
    metricStatuts,
    metricComments,
    metricReals,
    groupStatuts,
    groupComments,
    groupReals,
    factureStatut: hasConteste ? "conteste" : "valide",
    csvFindings: csvFindings.length ? csvFindings : undefined,
  };
}
