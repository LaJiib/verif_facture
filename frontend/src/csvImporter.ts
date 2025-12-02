/**
 * Utilitaire pour importer des CSV et peupler la base de données restructurée.
 *
 * Nouvelle architecture:
 * 1. Parse le CSV ligne par ligne
 * 2. Extrait: Compte (numéro de compte), Ligne (numéro d'accès), Facture (par compte + date), LigneFacture (détails par ligne)
 * 3. Crée/met à jour toutes les entités en respectant les relations
 */

import * as Papa from "papaparse";
import { encodeLineType } from "./utils/codecs";
import { CsvFormatConfig, DEFAULT_CSV_FORMAT } from "./utils/csvFormats";

// Types API (devront être importés depuis newApi.ts une fois mis à jour)
interface Compte {
  id: number;
  num: string;
  nom: string | null;
  entreprise_id: number;
  lot: string | null;
}

interface Ligne {
  id: number;
  num: string;
  type: number;
  compte_id: number;
}

interface Facture {
  id: number;
  fournisseur: string;
  num: string;
  compte_id: number;
  date: string;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  statut: number; // 0=importe,1=valide,2=conteste
  total_ht: number;
}

interface LigneFacture {
  id: number;
  facture_id: number;
  ligne_id: number;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  total_ht: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

type DetectedType = { code: number; label: string };

// ============================================================================
// API HELPERS
// ============================================================================

async function apiRequest<T>(
  method: string,
  endpoint: string,
  body?: any
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${endpoint}`, options);
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.detail || `Erreur API: ${res.statusText}`);
  }
  return res.json();
}

async function getComptes(entrepriseId: number): Promise<Compte[]> {
  return apiRequest<Compte[]>("GET", `/comptes?entreprise_id=${entrepriseId}`);
}

async function createCompte(data: {
  num: string;
  nom?: string;
  entreprise_id: number;
  lot?: string;
}): Promise<Compte> {
  return apiRequest<Compte>("POST", "/comptes", data);
}

async function getLignes(compteId: number): Promise<Ligne[]> {
  return apiRequest<Ligne[]>("GET", `/lignes?compte_id=${compteId}`);
}

async function createLigne(data: {
  num: string;
  type: number;
  compte_id: number;
}): Promise<Ligne> {
  return apiRequest<Ligne>("POST", "/lignes", data);
}

async function getFactures(entrepriseId: number): Promise<Facture[]> {
  return apiRequest<Facture[]>("GET", `/factures?entreprise_id=${entrepriseId}`);
}

async function createFacture(data: {
  fournisseur: string;
  num: string;
  compte_id: number;
  date: string;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  statut?: number; // 0 par défaut
  csv_id?: string | null;
}): Promise<Facture> {
  return apiRequest<Facture>("POST", "/factures", data);
}

async function createLigneFacture(data: {
  facture_id: number;
  ligne_id: number;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
}): Promise<LigneFacture> {
  return apiRequest<LigneFacture>("POST", "/lignes-factures", data);
}

// ============================================================================
// TYPES
// ============================================================================

export interface CSVRow {
  [key: string]: string;
}

export interface CompteACreer {
  num: string;
  nom: string;
  lot: string;
}

export interface ImportResult {
  success: boolean;
  stats: {
    lignes_csv: number;
    comptes_crees: number;
    lignes_creees: number;
    factures_creees: number;
    lignes_factures_creees: number;
    factures_doublons: number;
    erreurs: number;
  };
  errors: string[];
  comptesACreer?: CompteACreer[]; // Nouveaux comptes détectés qui nécessitent confirmation
}

// ============================================================================
// DÉTECTION AUTOMATIQUE DU TYPE DE LIGNE
// ============================================================================

function detectTypeLigne(typeAcces: string | undefined, libelleDetail: string | undefined): DetectedType {
  if (!typeAcces && !libelleDetail) return { code: 3, label: "Autre" };

  const text = `${typeAcces || ""} ${libelleDetail || ""}`.toLowerCase();
  let label = "Autre";

  if (
    text.includes("adsl") ||
    text.includes("rnis") ||
    text.includes("numeris") ||
    text.includes("bas debit") ||
    text.includes("bas d?bit")
  ) {
    label = "Internet bas debit";
  } else if (
    text.includes("internet") ||
    text.includes("fibre") ||
    text.includes("ftth") ||
    text.includes("sdsl") ||
    text.includes("vdsl")
  ) {
    label = "Internet";
  } else if (
    text.includes("mobile") ||
    text.includes("gsm") ||
    text.includes("4g") ||
    text.includes("5g") ||
    text.includes("sim")
  ) {
    label = "Mobile";
  } else if (
    text.includes("secondaire") ||
    text.includes("terminal") ||
    text.includes("poste supplementaire") ||
    text.includes("poste suppl?mentaire")
  ) {
    label = "Fixe secondaire";
  } else if (text.includes("ligne") || text.includes("telephon") || text.includes("t?l?phon")) {
    label = "Fixe";
  }

  const code = encodeLineType(label);
  return { code, label };
}
// ============================================================================
// EXTRACTION DES DONNÉES
// ============================================================================

function getColumnValue(row: CSVRow, columnName?: string): string | undefined {
  if (!columnName) return undefined;
  if (row[columnName] !== undefined) return row[columnName];
  const normalized = columnName.trim().toLowerCase();
  const matchKey = Object.keys(row).find(key => key.trim().toLowerCase() === normalized);
  return matchKey ? row[matchKey] : undefined;
}

function parseDateValue(raw: string | undefined, format: CsvFormatConfig): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const dateFormat = format.dateFormat || "DD/MM/YYYY";
  const parts = value.split(/[/-]/);
  if (parts.length !== 3) {
    return null;
  }

  let day = parts[0];
  let month = parts[1];
  let year = parts[2];

  if (dateFormat === "YYYY-MM-DD" || value.match(/^\d{4}-\d{2}-\d{2}$/)) {
    year = parts[0];
    month = parts[1];
    day = parts[2];
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

interface LigneData {
  numeroCompte: string;
  numeroAcces: string | null;
  numeroFacture: string;
  date: string;
  typeCode: number;
  typeLabel: string;
  montantHT: number;
  niveauCharge: string;
  typeCharge: string;
  libelleDetail: string;
  rubriqueFacture?: string;
}

function extractLignesData(rows: CSVRow[], format: CsvFormatConfig): LigneData[] {
  const lignesData: LigneData[] = [];
  let skippedRows = 0;

  for (const row of rows) {
    const numeroCompte = getColumnValue(row, format.columns.numeroCompte)?.trim();
    const numeroAcces = getColumnValue(row, format.columns.numeroAcces)?.trim() || null;
    const numeroFacture = getColumnValue(row, format.columns.numeroFacture)?.trim();
    const rawDate = getColumnValue(row, format.columns.date);
    const dateStr = parseDateValue(rawDate, format);
    const typeAcces = getColumnValue(row, format.columns.typeAcces)?.trim();
    const libelleDetail = getColumnValue(row, format.columns.libelleDetail)?.trim();
    const rubriqueFacture = getColumnValue(row, format.columns.rubriqueFacture)?.trim();
    const montantHT = parseFloat(getColumnValue(row, format.columns.montantHT)?.replace(',', '.') || '0');
    const niveauCharge = getColumnValue(row, format.columns.niveauCharge)?.trim()?.toLowerCase() || '';
    const typeCharge = getColumnValue(row, format.columns.typeCharge)?.trim()?.toLowerCase() || '';

    if (!numeroCompte || !numeroFacture || !dateStr) {
      skippedRows++;
      if (skippedRows <= 3) {
        console.warn(`[CSV Import] Ligne ignoree (manque donnees):`, {
          numeroCompte,
          numeroAcces,
          numeroFacture,
          dateStr,
        });
      }
      continue;
    }

    const detectedType = detectTypeLigne(typeAcces, libelleDetail);

    lignesData.push({
      numeroCompte,
      numeroAcces,
      numeroFacture,
      date: dateStr,
      typeCode: detectedType.code,
      typeLabel: detectedType.label,
      montantHT,
      niveauCharge,
      typeCharge,
      libelleDetail: libelleDetail || '',
      rubriqueFacture,
    });
  }

  if (skippedRows > 0) {
    console.warn(`[CSV Import] Total de lignes ignorees: ${skippedRows}/${rows.length}`);
  }

  return lignesData;
}

// ============================================================================
// AGRÉGATION POUR LES FACTURES
// ============================================================================

interface FactureAgregee {
  numeroCompte: string;
  numeroFacture: string;
  date: string;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  lignes: {
    numeroAcces: string;
    type: number;
    abo: number;
    conso: number;
    remises: number;
    achat: number;
  }[];
}

function normalizeText(...parts: string[]): string {
  return parts
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function categorizeMontant(ligne: LigneData): "abo" | "conso" | "achat" | "remises" {
  const info = normalizeText(
    ligne.niveauCharge,
    ligne.typeCharge,
    ligne.libelleDetail,
    ligne.rubriqueFacture || "",
    ligne.typeLabel
  );
  const rubrique = normalizeText(ligne.rubriqueFacture || "");
  const isNegative = ligne.montantHT < 0;
  const isRemiseKeyword = isNegative || /remise|avoir|credit|rembourse|rabais|geste commercial/.test(info);

  // 1) Utiliser la rubrique pour déterminer la famille principale
  let base: "abo" | "conso" | "achat" | null = null;
  if (rubrique) {
    if (/forfait|formule|option|abonnement|offre/.test(rubrique)) {
      base = "abo";
    } else if (/conso|consommation|usage|trafic/.test(rubrique)) {
      base = "conso";
    } else if (/achat|terminaux|accessoires|equipement|appareil|device|services?\s+ponctuels?/.test(rubrique)) {
      base = "achat";
    }
  }

  if (base) {
    if ((base === "abo" || base === "conso") && isRemiseKeyword) {
      return "remises";
    }
    return base;
  }

  // 2) Fallback heuristique si rubrique absente/inconnue
  const hasConso =
    /conso|consommation|usage|hors forfait|communication|appel|voix|sms|mms|data|internet|trafic|roaming/.test(info);
  const hasForfait = /abo|abonnement|forfait|mensuel|frais fixe|pack|offre|option|formule/.test(info);
  const achatWords =
    /achat|terminal|equipement|appareil|device|box|modem|routeur|paiement|location|services?\s+ponctuels?/.test(info);
  const hasSmartphone = /smartphone/.test(info);

  if (hasConso) {
    return isRemiseKeyword ? "remises" : "conso";
  }
  if (achatWords && (!hasSmartphone || !hasForfait)) {
    return "achat";
  }
  if (hasForfait || hasSmartphone) {
    return isRemiseKeyword ? "remises" : "abo";
  }
  return isRemiseKeyword ? "remises" : "abo";
}

function aggregateFacturesData(lignesData: LigneData[]): FactureAgregee[] {
  // Map: "numeroCompte|numeroFacture|date" -> FactureAgregee
  const facturesMap = new Map<string, FactureAgregee>();

  for (const ligne of lignesData) {
    const key = `${ligne.numeroCompte}|${ligne.numeroFacture}|${ligne.date}`;

    if (!facturesMap.has(key)) {
      facturesMap.set(key, {
        numeroCompte: ligne.numeroCompte,
        numeroFacture: ligne.numeroFacture,
        date: ligne.date,
        abo: 0,
        conso: 0,
        remises: 0,
        achat: 0,
        lignes: [],
      });
    }

    const facture = facturesMap.get(key)!;

    // Déterminer la catégorie du montant avec une heuristique plus robuste
    const category = categorizeMontant(ligne);
    let abo = 0, conso = 0, remises = 0, achat = 0;

    if (category === "abo") {
      abo = ligne.montantHT;
      facture.abo += ligne.montantHT;
    } else if (category === "conso") {
      conso = ligne.montantHT;
      facture.conso += ligne.montantHT;
    } else if (category === "remises") {
      remises = ligne.montantHT;
      facture.remises += ligne.montantHT;
    } else if (category === "achat") {
      achat = ligne.montantHT;
      facture.achat += ligne.montantHT;
    }

    // Trouver ou créer l'entrée pour cette ligne d'accès
    // N'ajoute une entrée ligne que si un numéro d'accès est présent
    if (ligne.numeroAcces) {
      let ligneEntry = facture.lignes.find(l => l.numeroAcces === ligne.numeroAcces);
      if (!ligneEntry) {
        ligneEntry = {
          numeroAcces: ligne.numeroAcces,
          type: ligne.typeCode,
          abo: 0,
          conso: 0,
          remises: 0,
          achat: 0,
        };
        facture.lignes.push(ligneEntry);
      }

      ligneEntry.abo += abo;
      ligneEntry.conso += conso;
      ligneEntry.remises += remises;
      ligneEntry.achat += achat;
    }
  }

  return Array.from(facturesMap.values());
}

// ============================================================================
// ANALYSE PRÉLIMINAIRE DU CSV (sans modification DB)
// ============================================================================

export async function analyzeCSV(
  file: File,
  entrepriseId: number,
  format?: CsvFormatConfig
): Promise<{ comptesACreer: CompteACreer[]; lignes_csv: number }> {
  const formatToUse = format || DEFAULT_CSV_FORMAT;
  console.log(`[CSV Analyze] Analyse du CSV pour l'entreprise ${entrepriseId} avec le format ${formatToUse.id}`);

  const csvText = await file.text();
  const parseResult = Papa.parse<CSVRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const lignesData = extractLignesData(parseResult.data || [], formatToUse);
  const facturesAgregees = aggregateFacturesData(lignesData);

  const comptesUniques = new Set<string>();
  facturesAgregees.forEach(f => comptesUniques.add(f.numeroCompte));

  const comptesExistants = await getComptes(entrepriseId);
  const comptesExistantsSet = new Set(comptesExistants.map(c => c.num));

  const comptesACreer: CompteACreer[] = [];
  for (const numeroCompte of Array.from(comptesUniques)) {
    if (!comptesExistantsSet.has(numeroCompte)) {
      comptesACreer.push({
        num: numeroCompte,
        nom: `Compte ${numeroCompte}`,
        lot: 'Non defini',
      });
    }
  }

  console.log(`[CSV Analyze] ${comptesACreer.length} nouveaux comptes detectes`);
  return { comptesACreer, lignes_csv: parseResult.data.length };
}


// IMPORT CSV PRINCIPAL
// ============================================================================

export async function importCSV(
  file: File,
  entrepriseId: number,
  format?: CsvFormatConfig,
  comptesSelectionnes?: Set<string>, // Si fourni, ne cr?e que ces comptes
  comptesOverrides?: CompteACreer[], // Permet d'ajuster nom/lot pour les nouveaux comptes
  onProgress?: (stage: string, percent: number) => void // Callback pour suivre la progression
): Promise<ImportResult> {
  const formatToUse = format || DEFAULT_CSV_FORMAT;
  console.log(`[CSV Import] D?but de l'import pour l'entreprise ${entrepriseId} (format ${formatToUse.id})`);

  // Identifier l'upload_id pour rattacher aux factures cr??es
  let currentUploadId: string | null = null;

  const result: ImportResult = {
    success: false,
    stats: {
      lignes_csv: 0,
      comptes_crees: 0,
      lignes_creees: 0,
      factures_creees: 0,
      lignes_factures_creees: 0,
      factures_doublons: 0,
      erreurs: 0,
    },
    errors: [],
  };

  try {
    // 1. Parse le CSV
    onProgress?.("Lecture du fichier CSV...", 5);
    console.log(`[CSV Import] Lecture du fichier CSV: ${file.name}`);
    const csvText = await file.text();
const parseResult = Papa.parse<CSVRow>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parseResult.errors && parseResult.errors.length > 0) {
      console.warn(`[CSV Import] ⚠️ Erreurs de parsing CSV:`, parseResult.errors);
    }

    result.stats.lignes_csv = parseResult.data?.length || 0;
    console.log(`[CSV Import] ✅ ${result.stats.lignes_csv} lignes CSV lues`);

    if (parseResult.data && parseResult.data.length > 0) {
      const firstRow = parseResult.data[0];
      const columnNames = Object.keys(firstRow);
      console.log(`[CSV Import] 🔍 Colonnes détectées (${columnNames.length}):`, columnNames);
    }

    // 2. Extrait les lignes
    onProgress?.("Extraction des données...", 10);
    console.log(`[CSV Import] 🔄 Extraction des données`);
    const lignesData = extractLignesData(parseResult.data || [], formatToUse);
    console.log(`[CSV Import] ✅ ${lignesData.length} lignes de données extraites`);

    // 3. Agrège les factures
    onProgress?.("Agrégation des factures...", 15);
    console.log(`[CSV Import] 🔄 Agrégation des factures`);
    const facturesAgregees = aggregateFacturesData(lignesData);
    console.log(`[CSV Import] ✅ ${facturesAgregees.length} factures agrégées`);

    if (facturesAgregees.length > 0) {
      console.log(`[CSV Import] 🔍 Exemple de facture:`, facturesAgregees[0]);
    }

  // Copie du CSV vers le backend (stockage disque) - dédup côté API
  try {
    const dates = facturesAgregees.map(f => f.date).filter(Boolean);
    const dateMin = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : "";
    const dateMax = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : "";
    console.log("[CSV Import] Dates CSV détectées pour stockage:", { dateMin, dateMax, count: dates.length });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entreprise_name", `entreprise_${entrepriseId}`);
    formData.append("category", "import_manual");
    if (dateMin) formData.append("date_min", dateMin);
    if (dateMax) formData.append("date_max", dateMax);
    const res = await fetch(`${API_BASE_URL}/uploads`, { method: "POST", body: formData });
    if (res.ok) {
      const payload = await res.json().catch(() => ({}));
      currentUploadId = payload?.upload?.upload_id || null;
      console.log("[CSV Import] Copie du CSV envoyée au backend (storage) upload_id=", currentUploadId);
    } else {
      console.warn("[CSV Import] Copie CSV non effectuée (HTTP)", res.status);
    }
  } catch (err) {
    console.warn("[CSV Import] Copie CSV non effectuée:", err);
  }

    // ========================================================================
    // ÉTAPE 4: TRAITEMENT PAR COMPTE DE FACTURATION
    // ========================================================================
    onProgress?.("Traitement des comptes...", 20);
    console.log(`[CSV Import] 🔄 ÉTAPE 4: Traitement des comptes de facturation`);

    // 4a. Récupère tous les comptes existants pour cette entreprise
    console.log(`[CSV Import] 🔍 Récupération des comptes existants...`);
    const comptesExistants = await getComptes(entrepriseId);
    const comptesMap = new Map<string, Compte>();
    comptesExistants.forEach(c => comptesMap.set(c.num, c));
    console.log(`[CSV Import] ✅ ${comptesExistants.length} comptes existants trouvés`);

    // 4b. Identifie les comptes uniques dans le CSV
    const comptesUniques = new Set<string>();
    facturesAgregees.forEach(f => comptesUniques.add(f.numeroCompte));
    console.log(`[CSV Import] 🔍 ${comptesUniques.size} comptes uniques dans le CSV`);

    // 4c. Crée les comptes manquants (seulement ceux sélectionnés)
    const comptesACréer = Array.from(comptesUniques).filter(num => !comptesMap.has(num));
    const overrideMap = new Map<string, CompteACreer>();
    (comptesOverrides || []).forEach(c => overrideMap.set(c.num, c));

    if (comptesACréer.length > 0) {
      console.log(`[CSV Import] ➕ Création de ${comptesACréer.length} compte(s) de facturation...`);

      for (const numeroCompte of comptesACréer) {
        // Si comptesSelectionnes est fourni, ne créer que les comptes sélectionnés
        if (comptesSelectionnes && !comptesSelectionnes.has(numeroCompte)) {
          console.log(`[CSV Import] ⏭️ Compte ${numeroCompte} non sélectionné, ignoré`);
          continue;
        }

        try {
          const override = overrideMap.get(numeroCompte);
          const nouveauCompte = await createCompte({
            num: numeroCompte,
            nom: override?.nom || `Compte ${numeroCompte}`,
            entreprise_id: entrepriseId,
            lot: override?.lot || "Non defini",
          });
          comptesMap.set(numeroCompte, nouveauCompte);
          result.stats.comptes_crees++;
        } catch (err) {
          console.error(`[CSV Import] ❌ Erreur création compte ${numeroCompte}:`, err);
          result.errors.push(`Compte ${numeroCompte}: ${(err as Error).message}`);
          result.stats.erreurs++;
        }
      }

      console.log(`[CSV Import] ✅ ${result.stats.comptes_crees} compte(s) créé(s)`);
    }

    // ========================================================================
    // ÉTAPE 5: TRAITEMENT DES LIGNES PAR COMPTE
    // ========================================================================
    onProgress?.("Création des lignes télécom...", 30);
    console.log(`[CSV Import] 🔄 ÉTAPE 5: Traitement des lignes télécom`);

    // Cache global pour toutes les lignes (évite les appels API répétés)
    const lignesGlobalMap = new Map<string, Ligne>(); // key: numero_ligne, value: Ligne

    // Pour chaque compte, récupère et crée les lignes nécessaires
    let totalLignesACreer = 0;
    const comptesArray = Array.from(comptesMap.entries());
    for (let compteIdx = 0; compteIdx < comptesArray.length; compteIdx++) {
      const [numeroCompte, compte] = comptesArray[compteIdx];

      // Progress: 30% to 50% for lignes creation
      const progressPercent = 30 + Math.floor((compteIdx / comptesArray.length) * 20);
      onProgress?.(`Création des lignes (${compteIdx + 1}/${comptesArray.length})...`, progressPercent);
      // Identifie les lignes appartenant à ce compte dans le CSV
      const lignesPourCeCompte = new Set<{ num: string; type: number }>();
      facturesAgregees
        .filter(f => f.numeroCompte === numeroCompte)
        .forEach(f => {
          f.lignes.forEach(l => {
            // Utiliser un Set avec une clé unique pour éviter les doublons
            const key = `${l.numeroAcces}|${l.type}`;
            if (!l.numeroAcces) {
              return;
            }
            if (!Array.from(lignesPourCeCompte).find(lpc => lpc.num === l.numeroAcces)) {
              lignesPourCeCompte.add({ num: l.numeroAcces, type: l.type });
            }
          });
        });

      if (lignesPourCeCompte.size === 0) continue;

      // Récupère les lignes existantes pour ce compte
      const lignesExistantes = await getLignes(compte.id);
      const lignesExistantesSet = new Set<string>();
      lignesExistantes.forEach(l => {
        lignesExistantesSet.add(l.num);
        lignesGlobalMap.set(l.num, l);
      });

      // Crée les lignes manquantes
      for (const { num, type } of Array.from(lignesPourCeCompte)) {
        if (!lignesExistantesSet.has(num)) {
          try {
            const nouvelleLigne = await createLigne({
              num: num,
              type: type,
              compte_id: compte.id,
            });
            lignesGlobalMap.set(num, nouvelleLigne);
            result.stats.lignes_creees++;
            totalLignesACreer++;
          } catch (err) {
            console.error(`[CSV Import] ❌ Erreur création ligne ${num}:`, err);
            result.errors.push(`Ligne ${num}: ${(err as Error).message}`);
            result.stats.erreurs++;
          }
        }
      }
    }

    if (totalLignesACreer > 0) {
      console.log(`[CSV Import] ✅ ${totalLignesACreer} ligne(s) créée(s)`);
    }

    // ========================================================================
    // ÉTAPE 6: TRAITEMENT DES FACTURES
    // ========================================================================
    onProgress?.("Création des factures...", 50);
    console.log(`[CSV Import] 🔄 ÉTAPE 6: Traitement des factures`);

    // 6a. Récupère les factures existantes
    const facturesExistantes = await getFactures(entrepriseId);
    const facturesSet = new Set<string>(); // key: "num|compte_id|date"
    const facturesMap = new Map<string, Facture>(); // pour accès rapide
    facturesExistantes.forEach(f => {
      const key = `${f.num}|${f.compte_id}|${f.date}`;
      facturesSet.add(key);
      facturesMap.set(key, f);
    });
    console.log(`[CSV Import] ✅ ${facturesExistantes.length} factures existantes trouvées`);

    // 6b. Crée les factures manquantes
    const facturesCreees = new Map<string, Facture>();

    for (let i = 0; i < facturesAgregees.length; i++) {
      const factureData = facturesAgregees[i];

      // Progress: 50% to 80% for factures creation
      if (i % 10 === 0) {
        const progressPercent = 50 + Math.floor((i / facturesAgregees.length) * 30);
        onProgress?.(`Création des factures (${i + 1}/${facturesAgregees.length})...`, progressPercent);
      }
      const compte = comptesMap.get(factureData.numeroCompte);

      if (!compte) {
        result.errors.push(`Compte ${factureData.numeroCompte} introuvable`);
        result.stats.erreurs++;
        continue;
      }

      const factureKey = `${factureData.numeroFacture}|${compte.id}|${factureData.date}`;

      // Vérifie si la facture existe déjà
      if (facturesSet.has(factureKey)) {
        result.stats.factures_doublons++;
        continue;
      }

      // Crée la nouvelle facture
      try {
        const nouvelleFacture = await createFacture({
          fournisseur: "Orange",
          num: factureData.numeroFacture,
          compte_id: compte.id,
          date: factureData.date,
          abo: Math.round(factureData.abo * 100) / 100,
          conso: Math.round(factureData.conso * 100) / 100,
          remises: Math.round(factureData.remises * 100) / 100,
          achat: Math.round(factureData.achat * 100) / 100,
          statut: 0,
          csv_id: currentUploadId,
        });
        facturesCreees.set(factureKey, nouvelleFacture);
        result.stats.factures_creees++;
      } catch (err) {
        result.errors.push(`Facture ${factureData.numeroFacture}: ${(err as Error).message}`);
        result.stats.erreurs++;
      }

      if ((i + 1) % 100 === 0) {
        console.log(`[CSV Import] 📊 Progression factures: ${i + 1}/${facturesAgregees.length}`);
      }
    }

    console.log(`[CSV Import] ✅ ${result.stats.factures_creees} facture(s) créée(s)`);

    // ========================================================================
    // ÉTAPE 7: CRÉATION DES LIGNES-FACTURES (RELATION MANY-TO-MANY)
    // ========================================================================
    onProgress?.("Création des relations lignes-factures...", 80);
    console.log(`[CSV Import] 🔄 ÉTAPE 7: Création des relations lignes-factures`);

    let lignesFacturesCount = 0;
    for (let idx = 0; idx < facturesAgregees.length; idx++) {
      const factureData = facturesAgregees[idx];

      // Progress: 80% to 100% for lignes-factures creation
      if (idx % 10 === 0) {
        const progressPercent = 80 + Math.floor((idx / facturesAgregees.length) * 20);
        onProgress?.(`Finalisation (${idx + 1}/${facturesAgregees.length})...`, progressPercent);
      }
      const compte = comptesMap.get(factureData.numeroCompte);
      if (!compte) continue;

      const factureKey = `${factureData.numeroFacture}|${compte.id}|${factureData.date}`;
      const facture = facturesCreees.get(factureKey) || facturesMap.get(factureKey);

      if (!facture) {
        // Facture doublon ou erreur, déjà traitée
        continue;
      }
      // Si la facture existait avant cet import, ne pas recréer les lignes-factures pour éviter les doublons
      if (!facturesCreees.has(factureKey)) {
        continue;
      }

      // Pour chaque ligne de cette facture, crée l'entrée lignes_factures
      for (const ligneData of factureData.lignes) {
        // Les lignes sans numéro d'accès n'ont pas de création de ligne_facture
        if (!ligneData.numeroAcces) {
          continue;
        }

        const ligne = lignesGlobalMap.get(ligneData.numeroAcces);

        if (!ligne) {
          continue;
        }

        try {
          await createLigneFacture({
            facture_id: facture.id,
            ligne_id: ligne.id,
            abo: Math.round(ligneData.abo * 100) / 100,
            conso: Math.round(ligneData.conso * 100) / 100,
            remises: Math.round(ligneData.remises * 100) / 100,
            achat: Math.round(ligneData.achat * 100) / 100,
          });
          result.stats.lignes_factures_creees++;
          lignesFacturesCount++;
        } catch (err) {
          result.errors.push(`Ligne-Facture (F:${facture.id}, L:${ligne.id}): ${(err as Error).message}`);
          result.stats.erreurs++;
        }
      }

      if (lignesFacturesCount % 100 === 0 && lignesFacturesCount > 0) {
        console.log(`[CSV Import] 📊 Progression lignes-factures: ${lignesFacturesCount}`);
      }
    }

    console.log(`[CSV Import] ✅ ${result.stats.lignes_factures_creees} ligne(s)-facture(s) créée(s)`);

    onProgress?.("Import terminé !", 100);
    result.success = result.stats.erreurs === 0;
    console.log(`[CSV Import] ✅ Import terminé:`, result.stats);
    if (result.errors.length > 0) {
      console.error(`[CSV Import] ⚠️ Erreurs:`, result.errors);
    }
    return result;
  } catch (err) {
    console.error(`[CSV Import] ❌ Erreur générale:`, err);
    result.errors.push(`Erreur générale: ${(err as Error).message}`);
    result.success = false;
    return result;
  }
}
