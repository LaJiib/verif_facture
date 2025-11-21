/**
 * Utilitaire pour importer des CSV et peupler la base de données.
 *
 * Logique:
 * 1. Parse le CSV ligne par ligne
 * 2. Agrège les données par (compte, numéro_facture, date)
 * 3. Pour chaque facture agrégée:
 *    - Vérifie si la facture existe déjà (même compte_id + date)
 *    - Si oui: vérifie que les montants correspondent
 *    - Si non: crée le compte s'il n'existe pas, puis crée la facture
 */

import * as Papa from "papaparse";
import {
  createCompte,
  getCompte,
  createFacture,
  fetchFactures,
  type Compte,
  type Facture,
} from "./newApi";

// ============================================================================
// TYPES
// ============================================================================

export interface CSVRow {
  [key: string]: string;
}

export interface AggregatedFacture {
  compte_id: string;
  numero_facture: number;
  date: string;
  abo: number;
  conso: number;
  remise: number;
  type_ligne_detecte: string;  // Type détecté automatiquement
}

export interface ImportResult {
  success: boolean;
  stats: {
    lignes_csv: number;
    comptes_crees: number;
    factures_creees: number;
    factures_doublons: number;
    erreurs: number;
  };
  errors: string[];
}

// ============================================================================
// DÉTECTION AUTOMATIQUE DU TYPE DE LIGNE
// ============================================================================

function detectTypeLigne(typeAcces: string | undefined, libelleDetail: string | undefined): string {
  if (!typeAcces && !libelleDetail) return "Autre";

  const text = `${typeAcces || ""} ${libelleDetail || ""}`.toLowerCase();

  // Internet bas débit
  if (
    text.includes("adsl") ||
    text.includes("rnis") ||
    text.includes("numeris") ||
    text.includes("bas debit") ||
    text.includes("bas débit")
  ) {
    return "Internet bas debit";
  }

  // Internet (haut débit)
  if (
    text.includes("internet") ||
    text.includes("fibre") ||
    text.includes("ftth") ||
    text.includes("sdsl") ||
    text.includes("vdsl")
  ) {
    return "Internet";
  }

  // Mobile
  if (
    text.includes("mobile") ||
    text.includes("gsm") ||
    text.includes("4g") ||
    text.includes("5g") ||
    text.includes("sim")
  ) {
    return "Mobile";
  }

  // Fixe secondaire
  if (
    text.includes("secondaire") ||
    text.includes("terminal") ||
    text.includes("poste supplementaire") ||
    text.includes("poste supplémentaire")
  ) {
    return "Fixe secondaire";
  }

  // Fixe (par défaut si contient "ligne" ou "telephon")
  if (text.includes("ligne") || text.includes("telephon") || text.includes("téléphon")) {
    return "Fixe";
  }

  return "Autre";
}

// ============================================================================
// AGRÉGATION DES DONNÉES CSV
// ============================================================================

function aggregateCSVData(rows: CSVRow[]): AggregatedFacture[] {
  // Map: "compte_id|numero_facture|date" -> AggregatedFacture
  const facturesMap = new Map<string, AggregatedFacture>();
  let skippedRows = 0;

  for (const row of rows) {
    const numeroAcces = row["Numéro accès"]?.trim();
    const numeroFacture = parseInt(row["Numéro facture"]?.trim() || "0", 10);
    const dateStr = row["Date"]?.trim();
    const typeAcces = row["Type d'accès"]?.trim();
    const libelleDetail = row["Libellé ligne facture"]?.trim();
    const montantHT = parseFloat(row["Montant (€ HT)"]?.replace(",", ".") || "0");
    const niveauCharge = row["Niveau de charge"]?.trim()?.toLowerCase() || "";
    const typeCharge = row["Type de charge"]?.trim()?.toLowerCase() || "";

    if (!numeroAcces || !numeroFacture || !dateStr) {
      skippedRows++;
      if (skippedRows <= 3) {
        console.warn(`[CSV Import] ⚠️ Ligne ignorée (manque données):`, {
          numeroAcces,
          numeroFacture,
          dateStr,
          row
        });
      }
      continue;
    }

    // Convertir la date en format ISO (YYYY-MM-DD)
    const [day, month, year] = dateStr.split("/");
    const dateISO = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    const key = `${numeroAcces}|${numeroFacture}|${dateISO}`;

    if (!facturesMap.has(key)) {
      facturesMap.set(key, {
        compte_id: numeroAcces,
        numero_facture: numeroFacture,
        date: dateISO,
        abo: 0,
        conso: 0,
        remise: 0,
        type_ligne_detecte: detectTypeLigne(typeAcces, libelleDetail),
      });
    }

    const facture = facturesMap.get(key)!;

    // Agrégation des montants selon le niveau de charge ou type de charge
    const chargeInfo = `${niveauCharge} ${typeCharge}`.toLowerCase();

    if (chargeInfo.includes("abonnement") || chargeInfo.includes("forfait") || niveauCharge.includes("abo")) {
      facture.abo += montantHT;
    } else if (chargeInfo.includes("consommation") || chargeInfo.includes("hors forfait") || chargeInfo.includes("conso")) {
      facture.conso += montantHT;
    } else if (chargeInfo.includes("remise") || chargeInfo.includes("avoir") || chargeInfo.includes("crédit")) {
      facture.remise += montantHT;
    } else {
      // Par défaut, on considère comme abonnement
      facture.abo += montantHT;
    }
  }

  if (skippedRows > 0) {
    console.warn(`[CSV Import] ⚠️ Total de lignes ignorées: ${skippedRows}/${rows.length}`);
  }

  return Array.from(facturesMap.values());
}

// ============================================================================
// IMPORT CSV PRINCIPAL
// ============================================================================

export async function importCSV(
  file: File,
  entrepriseId: number
): Promise<ImportResult> {
  console.log(`[CSV Import] 🚀 Début de l'import pour l'entreprise ${entrepriseId}`);
  const result: ImportResult = {
    success: false,
    stats: {
      lignes_csv: 0,
      comptes_crees: 0,
      factures_creees: 0,
      factures_doublons: 0,
      erreurs: 0,
    },
    errors: [],
  };

  try {
    // 1. Parse le CSV
    console.log(`[CSV Import] 📄 Lecture du fichier CSV: ${file.name}`);
    const csvText = await file.text();
    const parseResult = Papa.parse<CSVRow>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parseResult.errors && parseResult.errors.length > 0) {
      console.warn(`[CSV Import] ⚠️ Erreurs de parsing CSV:`, parseResult.errors);
      result.errors.push(`Erreurs de parsing CSV: ${parseResult.errors.map((e: any) => e.message).join(", ")}`);
    }

    result.stats.lignes_csv = parseResult.data?.length || 0;
    console.log(`[CSV Import] ✅ ${result.stats.lignes_csv} lignes CSV lues`);

    // Debug: afficher les colonnes et la première ligne
    if (parseResult.data && parseResult.data.length > 0) {
      const firstRow = parseResult.data[0];
      const columnNames = Object.keys(firstRow);
      console.log(`[CSV Import] 🔍 Colonnes détectées (${columnNames.length}):`, columnNames);
      console.log(`[CSV Import] 🔍 Première ligne exemple:`, firstRow);
    }

    // 2. Agrège les données
    console.log(`[CSV Import] 🔄 Début de l'agrégation des données`);
    const facturesAgregees = aggregateCSVData(parseResult.data || []);
    console.log(`[CSV Import] ✅ ${facturesAgregees.length} factures agrégées`);

    // Log des 3 premières factures pour debug
    if (facturesAgregees.length > 0) {
      console.log(`[CSV Import] 🔍 Exemple de factures agrégées (3 premières):`, facturesAgregees.slice(0, 3));
    }

    // 3. Récupère les comptes existants
    console.log(`[CSV Import] 🔍 Récupération des comptes existants pour l'entreprise ${entrepriseId}`);
    const comptesExistantsMap = new Map<string, Compte>();
    try {
      const comptes = await fetchComptes(entrepriseId);
      comptes.forEach(c => comptesExistantsMap.set(c.id, c));
      console.log(`[CSV Import] ✅ ${comptes.length} comptes existants récupérés`);
    } catch (err) {
      console.warn(`[CSV Import] ⚠️ Impossible de récupérer les comptes existants:`, err);
    }

    // 4. Récupère les factures existantes pour cette entreprise
    console.log(`[CSV Import] 🔍 Récupération des factures existantes pour l'entreprise ${entrepriseId}`);
    const facturesExistantes = await fetchFactures({ entreprise_id: entrepriseId });
    const facturesExistantesSet = new Set<string>();
    facturesExistantes.forEach(f => {
      facturesExistantesSet.add(`${f.compte_id}|${f.date}`);
    });
    console.log(`[CSV Import] ✅ ${facturesExistantes.length} factures existantes récupérées`);

    // 5. Pour chaque facture agrégée
    console.log(`[CSV Import] 🔄 Traitement de ${facturesAgregees.length} factures agrégées`);
    for (let i = 0; i < facturesAgregees.length; i++) {
      const factureData = facturesAgregees[i];
      try {
        const key = `${factureData.compte_id}|${factureData.date}`;

        // 5a. Vérifie si la facture existe déjà
        if (facturesExistantesSet.has(key)) {
          // Doublon détecté
          console.log(`[CSV Import] ⏭️ Facture ${i + 1}/${facturesAgregees.length}: Doublon détecté (${key})`);
          const existing = facturesExistantes.find(
            f => f.compte_id === factureData.compte_id && f.date === factureData.date
          );

          if (existing) {
            // Vérifie que les montants correspondent
            const aboMatch = Math.abs(existing.abo - factureData.abo) < 0.01;
            const consoMatch = Math.abs(existing.conso - factureData.conso) < 0.01;
            const remiseMatch = Math.abs(existing.remise - factureData.remise) < 0.01;

            if (!aboMatch || !consoMatch || !remiseMatch) {
              result.errors.push(
                `Facture ${factureData.compte_id} ${factureData.date}: montants différents (DB: abo=${existing.abo}, conso=${existing.conso}, remise=${existing.remise} | CSV: abo=${factureData.abo}, conso=${factureData.conso}, remise=${factureData.remise})`
              );
            }
          }

          result.stats.factures_doublons++;
          continue;
        }

        // 5b. Crée le compte s'il n'existe pas
        if (!comptesExistantsMap.has(factureData.compte_id)) {
          console.log(`[CSV Import] 📝 Facture ${i + 1}/${facturesAgregees.length}: Création du compte ${factureData.compte_id} (type: ${factureData.type_ligne_detecte})`);
          try {
            const newCompte = await createCompte({
              id: factureData.compte_id,
              type: factureData.type_ligne_detecte,
              entreprise_id: entrepriseId,
            });
            comptesExistantsMap.set(newCompte.id, newCompte);
            result.stats.comptes_crees++;
            console.log(`[CSV Import] ✅ Compte ${factureData.compte_id} créé avec succès`);
          } catch (err) {
            console.error(`[CSV Import] ❌ Erreur création compte ${factureData.compte_id}:`, err);
            result.errors.push(
              `Erreur création compte ${factureData.compte_id}: ${(err as Error).message}`
            );
            result.stats.erreurs++;
            continue;
          }
        }

        // 5c. Crée la facture
        console.log(`[CSV Import] 📝 Facture ${i + 1}/${facturesAgregees.length}: Création de la facture (compte: ${factureData.compte_id}, date: ${factureData.date})`);
        try {
          await createFacture({
            numero_facture: factureData.numero_facture,
            compte_id: factureData.compte_id,
            date: factureData.date,
            abo: Math.round(factureData.abo * 100) / 100,
            conso: Math.round(factureData.conso * 100) / 100,
            remise: Math.round(factureData.remise * 100) / 100,
            statut: "importee",
          });
          result.stats.factures_creees++;
          if ((i + 1) % 50 === 0) {
            console.log(`[CSV Import] 📊 Progression: ${i + 1}/${facturesAgregees.length} factures traitées`);
          }
        } catch (err) {
          console.error(`[CSV Import] ❌ Erreur création facture ${factureData.compte_id} ${factureData.date}:`, err);
          result.errors.push(
            `Erreur création facture ${factureData.compte_id} ${factureData.date}: ${(err as Error).message}`
          );
          result.stats.erreurs++;
        }
      } catch (err) {
        console.error(`[CSV Import] ❌ Erreur traitement facture ${factureData.compte_id}:`, err);
        result.errors.push(
          `Erreur traitement facture ${factureData.compte_id}: ${(err as Error).message}`
        );
        result.stats.erreurs++;
      }
    }

    result.success = result.stats.erreurs === 0;
    console.log(`[CSV Import] ✅ Import terminé - Résumé:`, result.stats);
    if (result.errors.length > 0) {
      console.error(`[CSV Import] ⚠️ Erreurs rencontrées:`, result.errors);
    }
    return result;
  } catch (err) {
    console.error(`[CSV Import] ❌ Erreur générale:`, err);
    result.errors.push(`Erreur générale: ${(err as Error).message}`);
    result.success = false;
    return result;
  }
}

// Import manquant
import { fetchComptes } from "./newApi";
