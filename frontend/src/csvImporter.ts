/**
 * Utilitaire pour importer des CSV et peupler la base de données restructurée.
 *
 * Nouvelle architecture:
 * 1. Parse le CSV ligne par ligne
 * 2. Extrait: Compte (numéro de compte), Ligne (numéro d'accès), Facture (par compte + date), LigneFacture (détails par ligne)
 * 3. Crée/met à jour toutes les entités en respectant les relations
 */

import * as Papa from "papaparse";

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
  type: string;
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
  statut: string;
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
  type: string;
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
  statut?: string;
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

function detectTypeLigne(typeAcces: string | undefined, libelleDetail: string | undefined): string {
  if (!typeAcces && !libelleDetail) return "Autre";

  const text = `${typeAcces || ""} ${libelleDetail || ""}`.toLowerCase();

  if (
    text.includes("adsl") ||
    text.includes("rnis") ||
    text.includes("numeris") ||
    text.includes("bas debit") ||
    text.includes("bas débit")
  ) {
    return "Internet bas debit";
  }

  if (
    text.includes("internet") ||
    text.includes("fibre") ||
    text.includes("ftth") ||
    text.includes("sdsl") ||
    text.includes("vdsl")
  ) {
    return "Internet";
  }

  if (
    text.includes("mobile") ||
    text.includes("gsm") ||
    text.includes("4g") ||
    text.includes("5g") ||
    text.includes("sim")
  ) {
    return "Mobile";
  }

  if (
    text.includes("secondaire") ||
    text.includes("terminal") ||
    text.includes("poste supplementaire") ||
    text.includes("poste supplémentaire")
  ) {
    return "Fixe secondaire";
  }

  if (text.includes("ligne") || text.includes("telephon") || text.includes("téléphon")) {
    return "Fixe";
  }

  return "Autre";
}

// ============================================================================
// EXTRACTION DES DONNÉES
// ============================================================================

interface LigneData {
  numeroCompte: string;
  numeroAcces: string;
  numeroFacture: string;
  date: string;
  type: string;
  montantHT: number;
  niveauCharge: string;
  typeCharge: string;
}

function extractLignesData(rows: CSVRow[]): LigneData[] {
  const lignesData: LigneData[] = [];
  let skippedRows = 0;

  for (const row of rows) {
    const numeroCompte = row["Numéro compte"]?.trim();
    const numeroAcces = row["Numéro accès"]?.trim();
    const numeroFacture = row["Numéro facture"]?.trim();
    const dateStr = row["Date"]?.trim();
    const typeAcces = row["Type d'accès"]?.trim();
    const libelleDetail = row["Libellé ligne facture"]?.trim();
    const montantHT = parseFloat(row["Montant (€ HT)"]?.replace(",", ".") || "0");
    const niveauCharge = row["Niveau de charge"]?.trim()?.toLowerCase() || "";
    const typeCharge = row["Type de charge"]?.trim()?.toLowerCase() || "";

    if (!numeroCompte || !numeroAcces || !numeroFacture || !dateStr) {
      skippedRows++;
      if (skippedRows <= 3) {
        console.warn(`[CSV Import] ⚠️ Ligne ignorée (manque données):`, {
          numeroCompte,
          numeroAcces,
          numeroFacture,
          dateStr,
        });
      }
      continue;
    }

    // Convertir la date en format ISO (YYYY-MM-DD)
    const [day, month, year] = dateStr.split("/");
    const dateISO = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    lignesData.push({
      numeroCompte,
      numeroAcces,
      numeroFacture,
      date: dateISO,
      type: detectTypeLigne(typeAcces, libelleDetail),
      montantHT,
      niveauCharge,
      typeCharge,
    });
  }

  if (skippedRows > 0) {
    console.warn(`[CSV Import] ⚠️ Total de lignes ignorées: ${skippedRows}/${rows.length}`);
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
    type: string;
    abo: number;
    conso: number;
    remises: number;
    achat: number;
  }[];
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

    // Déterminer la catégorie du montant
    const chargeInfo = `${ligne.niveauCharge} ${ligne.typeCharge}`.toLowerCase();
    let abo = 0, conso = 0, remises = 0, achat = 0;

    if (chargeInfo.includes("abonnement") || chargeInfo.includes("forfait") || ligne.niveauCharge.includes("abo")) {
      abo = ligne.montantHT;
      facture.abo += ligne.montantHT;
    } else if (chargeInfo.includes("consommation") || chargeInfo.includes("hors forfait") || chargeInfo.includes("conso")) {
      conso = ligne.montantHT;
      facture.conso += ligne.montantHT;
    } else if (chargeInfo.includes("remise") || chargeInfo.includes("avoir") || chargeInfo.includes("crédit")) {
      remises = ligne.montantHT;
      facture.remises += ligne.montantHT;
    } else if (chargeInfo.includes("achat") || chargeInfo.includes("terminal") || chargeInfo.includes("équipement")) {
      achat = ligne.montantHT;
      facture.achat += ligne.montantHT;
    } else {
      // Par défaut, on considère comme abonnement
      abo = ligne.montantHT;
      facture.abo += ligne.montantHT;
    }

    // Trouver ou créer l'entrée pour cette ligne d'accès
    let ligneEntry = facture.lignes.find(l => l.numeroAcces === ligne.numeroAcces);
    if (!ligneEntry) {
      ligneEntry = {
        numeroAcces: ligne.numeroAcces,
        type: ligne.type,
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

  return Array.from(facturesMap.values());
}

// ============================================================================
// ANALYSE PRÉLIMINAIRE DU CSV (sans modification DB)
// ============================================================================

export async function analyzeCSV(
  file: File,
  entrepriseId: number
): Promise<{ comptesACreer: CompteACreer[]; lignes_csv: number }> {
  console.log(`[CSV Analyze] 🔍 Analyse du CSV pour l'entreprise ${entrepriseId}`);

  // 1. Parse le CSV
  const csvText = await file.text();
  const parseResult = Papa.parse<CSVRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const lignesData = extractLignesData(parseResult.data || []);
  const facturesAgregees = aggregateFacturesData(lignesData);

  // 2. Identifie les comptes uniques dans le CSV
  const comptesUniques = new Set<string>();
  facturesAgregees.forEach(f => comptesUniques.add(f.numeroCompte));

  // 3. Récupère les comptes existants
  const comptesExistants = await getComptes(entrepriseId);
  const comptesExistantsSet = new Set(comptesExistants.map(c => c.num));

  // 4. Identifie les comptes à créer
  const comptesACreer: CompteACreer[] = [];
  for (const numeroCompte of Array.from(comptesUniques)) {
    if (!comptesExistantsSet.has(numeroCompte)) {
      comptesACreer.push({
        num: numeroCompte,
        nom: `Compte ${numeroCompte}`,
        lot: "Non défini",
      });
    }
  }

  console.log(`[CSV Analyze] ✅ ${comptesACreer.length} nouveaux comptes détectés`);
  return { comptesACreer, lignes_csv: parseResult.data.length };
}

// ============================================================================
// IMPORT CSV PRINCIPAL
// ============================================================================

export async function importCSV(
  file: File,
  entrepriseId: number,
  comptesSelectionnes?: Set<string>, // Si fourni, ne crée que ces comptes
  onProgress?: (stage: string, percent: number) => void // Callback pour suivre la progression
): Promise<ImportResult> {
  console.log(`[CSV Import] 🚀 Début de l'import pour l'entreprise ${entrepriseId}`);
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
    console.log(`[CSV Import] 📄 Lecture du fichier CSV: ${file.name}`);
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
    const lignesData = extractLignesData(parseResult.data || []);
    console.log(`[CSV Import] ✅ ${lignesData.length} lignes de données extraites`);

    // 3. Agrège les factures
    onProgress?.("Agrégation des factures...", 15);
    console.log(`[CSV Import] 🔄 Agrégation des factures`);
    const facturesAgregees = aggregateFacturesData(lignesData);
    console.log(`[CSV Import] ✅ ${facturesAgregees.length} factures agrégées`);

    if (facturesAgregees.length > 0) {
      console.log(`[CSV Import] 🔍 Exemple de facture:`, facturesAgregees[0]);
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

    if (comptesACréer.length > 0) {
      console.log(`[CSV Import] ➕ Création de ${comptesACréer.length} compte(s) de facturation...`);

      for (const numeroCompte of comptesACréer) {
        // Si comptesSelectionnes est fourni, ne créer que les comptes sélectionnés
        if (comptesSelectionnes && !comptesSelectionnes.has(numeroCompte)) {
          console.log(`[CSV Import] ⏭️ Compte ${numeroCompte} non sélectionné, ignoré`);
          continue;
        }

        try {
          const nouveauCompte = await createCompte({
            num: numeroCompte,
            nom: `Compte ${numeroCompte}`,
            entreprise_id: entrepriseId,
            lot: "Non défini",
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
      const lignesPourCeCompte = new Set<{ num: string; type: string }>();
      facturesAgregees
        .filter(f => f.numeroCompte === numeroCompte)
        .forEach(f => {
          f.lignes.forEach(l => {
            // Utiliser un Set avec une clé unique pour éviter les doublons
            const key = `${l.numeroAcces}|${l.type}`;
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
          statut: "importé",
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

      // Pour chaque ligne de cette facture, crée l'entrée lignes_factures
      for (const ligneData of factureData.lignes) {
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
