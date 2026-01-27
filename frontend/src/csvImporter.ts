import { CsvFormatConfig, DEFAULT_CSV_FORMAT } from "./utils/csvFormats";
import { importCsvBackend } from "./newApi";

export interface CSVRow {
  [key: string]: string;
}

export interface CompteACreer {
  num: string;
  nom: string;
  lot: string;
}

export interface AboSuggere {
  nom: string;
  prix: number;
  numeroCompte?: string;
  numeroAcces?: string | null;
  numeroFacture?: string;
  date?: string;
  typeCode?: number | null;
  count_lignes?: number;
  numeroAcces_list?: string[];
}

export interface ImportResult {
  success: boolean;
  stats: {
    lignes_csv: number;
    comptes_crees: number;
    lignes_creees: number;
    factures_creees: number;
    lignes_factures_creees: number;
    abonnements_crees?: number;
    lignes_abonnements_creees?: number;
    factures_doublons: number;
    erreurs: number;
  };
  errors: string[];
  comptesACreer?: CompteACreer[];
  abonnementsSuggeres?: AboSuggere[];
}

export async function analyzeCSV(
  file: File,
  entrepriseId: number,
  format?: CsvFormatConfig,
  analyzeAbos?: { enabled: boolean; types?: number[] }
): Promise<{ comptesACreer: CompteACreer[]; lignes_csv: number; abonnementsSuggeres: AboSuggere[] }> {
  const formatToUse = format || DEFAULT_CSV_FORMAT;
  const res = await importCsvBackend({
    entrepriseId,
    file,
    format: formatToUse,
    analyzeAbos,
    dryRun: true,
  });
  return {
    comptesACreer: res.comptes_a_creer || [],
    lignes_csv: res.stats?.lignes_csv || 0,
    abonnementsSuggeres: res.abonnements_suggeres || [],
  };
}

export async function importCSV(
  file: File,
  entrepriseId: number,
  format?: CsvFormatConfig,
  comptesSelectionnes?: Set<string>,
  comptesOverrides?: CompteACreer[],
  analyzeAbos?: { enabled: boolean; types?: number[] },
  abosSelectionnes?: AboSuggere[],
  onProgress?: (stage: string, percent: number) => void
): Promise<ImportResult> {
  const formatToUse = format || DEFAULT_CSV_FORMAT;
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let progressivePercent = 10;
  const result: ImportResult = {
    success: false,
    stats: {
      lignes_csv: 0,
      comptes_crees: 0,
      lignes_creees: 0,
      factures_creees: 0,
      lignes_factures_creees: 0,
      abonnements_crees: 0,
      lignes_abonnements_creees: 0,
      factures_doublons: 0,
      erreurs: 0,
    },
    errors: [],
  };

  try {
    onProgress?.("Envoi au backend...", 10);
    progressTimer = setInterval(() => {
      progressivePercent = Math.min(progressivePercent + 5, 90);
      const stageLabel = progressivePercent < 40 ? "Analyse CSV..." : progressivePercent < 75 ? "Creation entites..." : "Finalisation...";
      onProgress?.(`${stageLabel}`, progressivePercent);
    }, 800);
    const confirmed =
      comptesSelectionnes && comptesOverrides
        ? comptesOverrides.filter((c) => comptesSelectionnes.has(c.num))
        : undefined;
    const response = await importCsvBackend({
      entrepriseId,
      file,
      format: formatToUse,
      confirmedAccounts: confirmed,
      analyzeAbos,
      confirmedAbos: abosSelectionnes,
    });

    if (response.status === "requires_account_confirmation") {
      result.comptesACreer = response.comptes_a_creer;
      result.stats.lignes_csv = response.stats?.lignes_csv || 0;
      result.errors.push("Comptes a confirmer");
      return result;
    }

    result.stats = {
      ...result.stats,
      ...(response.stats || {}),
    };
    result.errors = response.errors || [];
    result.success = response.status === "success" && result.errors.length === 0;
    result.abonnementsSuggeres = response.abonnements_suggeres || [];
    const facturesPrevues = response.stats?.factures_prevues ?? response.stats?.factures_agregees;
    const lignesPrevues = response.stats?.lignes_prevues;
    const lignesFactPrevues = response.stats?.lignes_factures_prevues;
    if (facturesPrevues || lignesFactPrevues) {
      const parts = [];
      if (facturesPrevues) {
        parts.push(`Factures: ${response.stats?.factures_creees ?? 0}/${facturesPrevues}`);
      }
      if (lignesFactPrevues) {
        parts.push(`Lignes-factures: ${response.stats?.lignes_factures_creees ?? 0}/${lignesFactPrevues}`);
      } else if (lignesPrevues) {
        parts.push(`Lignes: ${response.stats?.lignes_creees ?? 0}/${lignesPrevues}`);
      }
      onProgress?.(parts.join(" | ") || "Finalisation...", Math.max(progressivePercent, 95));
    } else {
      onProgress?.("Finalisation...", Math.max(progressivePercent, 95));
    }
    onProgress?.("Import termine !", 100);
    return result;
  } catch (err) {
    result.errors.push((err as Error).message);
    result.success = false;
    return result;
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
}
