import { useEffect, useState } from "react";
import { executeQuery, updateLigneType, getFactureRapport, upsertFactureRapport, updateFacture, autoVerifyEcart, autoVerifyGroupe } from "../newApi";
import { decodeLineType, decodeFactureStatus } from "../utils/codecs";
import { exportFactureReportPdf } from "../utils/pdfReport";
import { exportFactureReportDocx } from "../utils/docxReport";

interface CompteDetailModalProps {
  compteId: number;
  compteNum: string;
  compteNom: string | null;
  entrepriseNom?: string | null;
  mois?: string; // Format: YYYY-MM, optionnel pour filtrer sur un mois
  onClose: () => void;
  onRefreshParent?: (args: { factureId: number; newStatut: number; mois?: string; compteId: number }) => void; // permet de déclencher un refresh ciblé
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  hasPrevMonth?: boolean;
  hasNextMonth?: boolean;
  onDeleteMonth?: () => void;
}

interface StatsGlobales {
  total_abo: number;
  total_conso: number;
  total_remises: number;
  total_achat: number;
  total_ht: number;
}

interface MonthBreakdown {
  total_abo: number;
  total_conso: number;
  total_remises: number;
  total_achat: number;
  total_ht: number;
}

interface FactureDetail {
  facture_id: number;
  facture_num: string;
  facture_date: string;
  facture_statut: number;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  total_ht: number;
  csv_id?: string | null;
}

interface DetailLigne {
  ligne_id: number;
  ligne_num: string;
  ligne_type: number;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  total_ht: number;
}

interface FactureLignesResume {
  facture_id: number;
  facture_num: string;
  facture_date: string;
  lignes_abo: number;
  lignes_conso: number;
  lignes_remises: number;
  lignes_achat: number;
  lignes_total_ht: number;
}

interface LigneGroupeSynthese {
  type: string;
  prixAbo: number;
  count: number;
  abo: number;
  remises: number;
  netAbo: number;
  conso: number;
  achat: number;
  total: number;
}

interface FactureLigneGroupe {
  facture_id: number;
  facture_num: string;
  facture_date: string;
  ligne_type: number;
  prix_abo: number;
  count: number;
  abo: number;
  conso: number;
  remises: number;
  netAbo: number;
  achat: number;
}

type StatutValeur = "valide" | "conteste" | "a_verifier";

const statutTokens: Record<StatutValeur, { bg: string; color: string; label: string }> = {
  valide: { bg: "#ecfdf3", color: "#15803d", label: "Valide" },
  conteste: { bg: "#fef2f2", color: "#b91c1c", label: "Conteste" },
  // gris pour rester coh?rent avec les exports PDF/ODT
  a_verifier: { bg: "#f3f4f6", color: "#374151", label: "A verifier" },
};

function StatutBadge({ value }: { value: StatutValeur }) {
  const token = statutTokens[value];
  return (
    <span
      style={{
        background: token.bg,
        color: token.color,
        borderRadius: "999px",
        padding: "0.2rem 0.65rem",
        fontWeight: 700,
        fontSize: "0.8rem",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "999px", background: token.color, display: "inline-block" }} />
      {token.label}
    </span>
  );
}

const rapportCardStyle = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: "0.75rem",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
};

export default function CompteDetailModal({
  compteId,
  compteNum,
  compteNom,
  entrepriseNom,
  mois,
  onClose,
  onRefreshParent,
  onPrevMonth,
  onNextMonth,
  hasPrevMonth = false,
  hasNextMonth = false,
  onDeleteMonth,
}: CompteDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"stats" | "factures" | "lignes" | "rapport">("stats");
  const [statsGlobales, setStatsGlobales] = useState<StatsGlobales | null>(null);
  const [prevStatsGlobales, setPrevStatsGlobales] = useState<StatsGlobales | null>(null);
  const [detailFactures, setDetailFactures] = useState<FactureDetail[]>([]);
  const [prevFactures, setPrevFactures] = useState<FactureDetail[]>([]);
  const [detailLignes, setDetailLignes] = useState<DetailLigne[]>([]);
  const [prevLignes, setPrevLignes] = useState<DetailLigne[]>([]);
  const [factureLignesResume, setFactureLignesResume] = useState<FactureLignesResume[]>([]);
  const [factureLigneGroupes, setFactureLigneGroupes] = useState<FactureLigneGroupe[]>([]);
  const [selectedFactureId, setSelectedFactureId] = useState<number | null>(null);
  const [factureCommentaires, setFactureCommentaires] = useState<Record<number, string>>({});
  const [factureStatuts, setFactureStatuts] = useState<
    Record<
      number,
      {
        aboNet: StatutValeur;
        ecart: StatutValeur;
        achat: StatutValeur;
        conso: StatutValeur;
      }
    >
  >({});
  const [factureGroupStatuts, setFactureGroupStatuts] = useState<
    Record<number, Record<string, { aboNet: StatutValeur; achat: StatutValeur }>>
  >({});
  const [factureMetricComments, setFactureMetricComments] = useState<
    Record<number, { aboNet?: string; ecart?: string; achat?: string; conso?: string }>
  >({});
  const [factureGroupComments, setFactureGroupComments] = useState<Record<number, Record<string, { aboNet?: string; achat?: string }>>>({});
  const [factureMetricReals, setFactureMetricReals] = useState<Record<number, { ecart?: string }>>({});
  const [factureGroupReals, setFactureGroupReals] = useState<Record<number, Record<string, { aboNet?: string; achat?: string }>>>({});
  const [autoLoading, setAutoLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [ligneSort, setLigneSort] = useState<{ field: keyof DetailLigne; direction: "asc" | "desc" } | null>(null);
  const [editedTypes, setEditedTypes] = useState<Record<number, number>>({});
  const [savingType, setSavingType] = useState<number | null>(null);
  const [rapportPanelCollapsed, setRapportPanelCollapsed] = useState(false);

  useEffect(() => {
    loadData();
  }, [compteId, mois]);

  function formatMoisDisplay(dateKey: string): string {
    const [year, month] = dateKey.split("-");
    const moisMap: { [key: string]: string } = {
      "01": "Janvier",
      "02": "Février",
      "03": "Mars",
      "04": "Avril",
      "05": "Mai",
      "06": "Juin",
      "07": "Juillet",
      "08": "Août",
      "09": "Septembre",
      "10": "Octobre",
      "11": "Novembre",
      "12": "Décembre",
    };
    return `${moisMap[month]} ${year}`;
  }

  async function applyAutoVerification() {
    if (!factureCourante) return;
    try {
      setAutoLoading(true);
      console.log("[Auto] Debut auto-verification (backend etapes)", {
        facture_id: factureCourante.facture_id,
        facture_num: factureCourante.facture_num,
        csv_id: factureCourante.csv_id,
      });

      // 1) Ecart global
      const resEcart = await autoVerifyEcart(factureCourante.facture_id);
      console.log("[Auto][Ecart] Reponse", resEcart);
      const metricStatuts: { aboNet: StatutValeur; ecart: StatutValeur; achat: StatutValeur; conso: StatutValeur } = {
        ...(factureStatuts[factureCourante.facture_id] || statutDefault),
        ecart: resEcart.statut as StatutValeur,
        achat: factureCourante.achat === 0 ? "valide" : "conteste",
        aboNet: (factureStatuts[factureCourante.facture_id]?.aboNet || statutDefault.aboNet) as StatutValeur,
        conso: (factureStatuts[factureCourante.facture_id]?.conso || statutDefault.conso) as StatutValeur,
      };
      const metricComments = { ...(factureMetricComments[factureCourante.facture_id] || {}), ecart: resEcart.commentaire || "" };
      const metricReals = {} as { ecart?: string };
      metricReals.ecart = Number(factureCourante.ecart ?? 0).toFixed(2);

      // 2) Analyse par type : prefill statuts/commentaires (CSV + reference)
      const groupStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }> = {};
      const groupComments: Record<string, { aboNet?: string; achat?: string }> = {};
      const groupReals: Record<string, { aboNet?: string; achat?: string }> = {};

      for (const g of ligneGroupesFacture) {
        const netUnitVal = g.count ? g.netAbo / g.count : Number(g.netAbo ?? 0);
        const key = `${g.ligne_type}|${Number(netUnitVal || 0).toFixed(2)}`;
        try {
          const resG = await autoVerifyGroupe(factureCourante.facture_id, { ligne_type: g.ligne_type, prix_abo: netUnitVal });
          console.log("[Auto][Groupe] Reponse", {
            key,
            ligne_type: g.ligne_type,
            net_unit: netUnitVal,
            achat: g.achat,
            res: resG,
          });
          groupStatuts[key] = {
            aboNet: resG.statut as StatutValeur,
            achat: g.achat && g.achat !== 0 ? "conteste" : "valide",
          };
          const achatComment = g.achat && g.achat !== 0 ? `Achats détectés: ${Number(g.achat || 0).toFixed(2)} €` : "";
          const summarizedContexts = summarizeCsvContexts(resG.csv_context);
          const baseComments = [resG.commentaire, ...summarizedContexts, achatComment].filter(Boolean);
          groupComments[key] = {
            aboNet: baseComments.join(" | "),
            achat: achatComment || undefined,
          };
          groupReals[key] = { aboNet: "", achat: "" };
        } catch (err) {
          console.warn("[Auto][Groupe] erreur", key, err);
          const achatComment = g.achat && g.achat !== 0 ? `Achats détectés: ${g.achat.toFixed(2)} €` : "";
          groupStatuts[key] = { aboNet: "a_verifier", achat: g.achat && g.achat !== 0 ? "conteste" : "a_verifier" };
          groupComments[key] = { aboNet: ["Analyse indisponible", achatComment].filter(Boolean).join(" | "), achat: achatComment || undefined };
          groupReals[key] = { aboNet: "", achat: "" };
        }
      }

      setFactureStatuts((prev) => ({ ...prev, [factureCourante.facture_id]: metricStatuts }));
      setFactureMetricComments((prev) => ({ ...prev, [factureCourante.facture_id]: metricComments }));
      setFactureMetricReals((prev) => ({ ...prev, [factureCourante.facture_id]: metricReals }));
      setFactureGroupStatuts((prev) => ({ ...prev, [factureCourante.facture_id]: groupStatuts }));
      setFactureGroupComments((prev) => ({ ...prev, [factureCourante.facture_id]: groupComments }));
      setFactureGroupReals((prev) => ({ ...prev, [factureCourante.facture_id]: groupReals }));
      console.log("[Auto] Résumé calculé", {
        facture_id: factureCourante.facture_id,
        metricStatuts,
        metricComments,
        groupStatuts,
        groupComments,
        groupReals,
      });
      alert("Auto (CSV) terminée : statuts et commentaires pré-remplis.");

    } catch (err) {
      console.error("Auto verification error", err);
      alert("Auto verification impossible : " + (err as Error).message);
    } finally {
      setAutoLoading(false);
    }
  }

  function exportPdf() {
    if (!factureCourante) return;
    const glob = factureStatuts[factureCourante.facture_id] || statutDefault;
    exportFactureReportPdf({
      entrepriseNom,
      compteNum,
      compteNom,
      factureId: factureCourante.facture_id,
      factureNum: factureCourante.facture_num,
      factureDate: factureCourante.facture_date,
      factureStatut:
        detailFactures.find((f) => f.facture_id === factureCourante.facture_id)?.facture_statut || 0,
      ecart: factureCourante.ecart,
      achat: factureCourante.achat,
      metricStatuts: { ecart: glob.ecart, achat: glob.achat },
      metricComments: factureMetricComments[factureCourante.facture_id] || {},
      groupStatuts: factureGroupStatuts[factureCourante.facture_id] || {},
      groupComments: factureGroupComments[factureCourante.facture_id] || {},
      groupReals: factureGroupReals[factureCourante.facture_id] || {},
      globalComment: factureCommentaires[factureCourante.facture_id],
      groupes: ligneGroupesFacture.map((g) => {
        const netUnit = g.count ? g.netAbo / g.count : 0;
        return {
          ligne_type: g.ligne_type,
          prix_abo: netUnit,
          count: g.count,
          achat_total: g.achat,
          ref_net: undefined,
        };
      }),
    });
  }

  function exportOdt() {
    if (!factureCourante) return;
    const glob = factureStatuts[factureCourante.facture_id] || statutDefault;
    exportFactureReportDocx({
      entrepriseNom,
      compteNum,
      compteNom,
      factureId: factureCourante.facture_id,
      factureNum: factureCourante.facture_num,
      factureDate: factureCourante.facture_date,
      factureStatut:
        detailFactures.find((f) => f.facture_id === factureCourante.facture_id)?.facture_statut || 0,
      ecart: factureCourante.ecart,
      achat: factureCourante.achat,
      metricStatuts: { ecart: glob.ecart, achat: glob.achat },
      metricComments: factureMetricComments[factureCourante.facture_id] || {},
      groupStatuts: factureGroupStatuts[factureCourante.facture_id] || {},
      groupComments: factureGroupComments[factureCourante.facture_id] || {},
      groupReals: factureGroupReals[factureCourante.facture_id] || {},
      globalComment: factureCommentaires[factureCourante.facture_id],
      groupes: ligneGroupesFacture.map((g) => {
        const netUnit = g.count ? g.netAbo / g.count : 0;
        return {
          ligne_type: g.ligne_type,
          prix_abo: netUnit,
          count: g.count,
          achat_total: g.achat,
          ref_net: undefined,
        };
      }),
    });
  }

  function previousMonth(dateKey: string): string | null {
    const [yearStr, monthStr] = dateKey.split("-");
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(month)) return null;
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    const monthPadded = month < 10 ? `0${month}` : `${month}`;
    return `${year}-${monthPadded}`;
  }

  function computeDelta(current: number, prev?: number | null) {
    if (prev === undefined || prev === null) return { symbol: "→", color: "#6b7280", text: "N/A" };
    if (prev === 0) return { symbol: current === 0 ? "→" : "↑", color: current === 0 ? "#6b7280" : "#16a34a", text: "N/A" };
    const delta = ((current - prev) / prev) * 100;
    const symbol = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    const color = delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#6b7280";
    const text = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
    return { symbol, color, text };
  }

  async function loadData() {
    setIsLoading(true);
    try {
      // Condition de filtrage par mois
      const moisFilter = mois ? `AND strftime('%Y-%m', f.date) = '${mois}'` : "";

      // Trouver le dernier mois disponible avant le mois courant (le plus récent, pas forcément mois-1)
      let prevFilter = "";
      if (mois) {
        const prevMonthRow = await executeQuery(`
          SELECT strftime('%Y-%m', f.date) as mois_key
          FROM factures f
          WHERE f.compte_id = ${compteId}
            AND strftime('%Y-%m', f.date) < '${mois}'
          GROUP BY mois_key
          ORDER BY mois_key DESC
          LIMIT 1
        `);
        const prevKey = prevMonthRow.data?.[0]?.mois_key as string | undefined;
        if (prevKey) {
          prevFilter = `AND strftime('%Y-%m', f.date) = '${prevKey}'`;
        }
      }

      // Requête pour stats globales
      const statsQuery = `
        SELECT
          SUM(f.abo) as total_abo,
          SUM(f.conso) as total_conso,
          SUM(f.remises) as total_remises,
          SUM(f.achat) as total_achat,
          SUM(f.abo + f.conso + f.remises + f.achat) as total_ht
        FROM factures f
        WHERE f.compte_id = ${compteId}
        ${moisFilter}
      `;
      const statsResult = await executeQuery(statsQuery);
      if (statsResult.data && statsResult.data.length > 0) {
        setStatsGlobales(statsResult.data[0]);
      }
      if (prevFilter) {
        const prevStatsQuery = `
          SELECT
            SUM(f.abo) as total_abo,
            SUM(f.conso) as total_conso,
            SUM(f.remises) as total_remises,
            SUM(f.achat) as total_achat,
            SUM(f.abo + f.conso + f.remises + f.achat) as total_ht
          FROM factures f
          WHERE f.compte_id = ${compteId}
          ${prevFilter}
        `;
        const prevStatsResult = await executeQuery(prevStatsQuery);
        setPrevStatsGlobales(prevStatsResult.data?.[0] || null);
      } else {
        setPrevStatsGlobales(null);
      }

      // Requête pour détail par ligne
      const lignesQuery = `
        SELECT
          l.id as ligne_id,
          l.num as ligne_num,
          l.type as ligne_type,
          SUM(lf.abo) as abo,
          SUM(lf.conso) as conso,
          SUM(lf.remises) as remises,
          SUM(lf.achat) as achat,
          SUM(lf.abo + lf.conso + lf.remises + lf.achat) as total_ht
        FROM lignes l
        JOIN lignes_factures lf ON lf.ligne_id = l.id
        JOIN factures f ON f.id = lf.facture_id
        WHERE l.compte_id = ${compteId}
        ${moisFilter}
        GROUP BY l.id, l.num, l.type
        ORDER BY total_ht DESC
      `;
      const lignesResult = await executeQuery(lignesQuery);
      setDetailLignes(lignesResult.data || []);
      if (lignesResult.data) {
        const typesMap: Record<number, number> = {};
        lignesResult.data.forEach((l: DetailLigne) => {
          typesMap[l.ligne_id] = l.ligne_type ?? 3;
        });
        setEditedTypes(typesMap);
      }
      if (prevFilter) {
        const prevLignesQuery = `
          SELECT
            l.id as ligne_id,
            l.num as ligne_num,
            l.type as ligne_type,
            SUM(lf.abo) as abo,
            SUM(lf.conso) as conso,
            SUM(lf.remises) as remises,
            SUM(lf.achat) as achat,
            SUM(lf.abo + lf.conso + lf.remises + lf.achat) as total_ht
          FROM lignes l
          JOIN lignes_factures lf ON lf.ligne_id = l.id
          JOIN factures f ON f.id = lf.facture_id
          WHERE l.compte_id = ${compteId}
          ${prevFilter}
          GROUP BY l.id, l.num, l.type
        `;
        const prevLignesResult = await executeQuery(prevLignesQuery);
        setPrevLignes(prevLignesResult.data || []);
      } else {
        setPrevLignes([]);
      }

      // Requête pour détail par facture
      const facturesQuery = `
        SELECT
          f.id as facture_id,
          f.num as facture_num,
          f.date as facture_date,
          f.statut as facture_statut,
          f.csv_id as csv_id,
          f.abo as abo,
          f.conso as conso,
          f.remises as remises,
          f.achat as achat,
          SUM(f.abo + f.conso + f.remises + f.achat) as total_ht
        FROM factures f
        WHERE f.compte_id = ${compteId}
        ${moisFilter}
        GROUP BY f.id, f.num, f.date, f.statut
        ORDER BY f.date DESC
      `;
      const facturesResult = await executeQuery(facturesQuery);
      setDetailFactures(facturesResult.data || []);

      // RequǦte pour consolider les montants de lignes par facture (v��rification facture vs lignes)
      const facturesLignesQuery = `
        SELECT
          f.id as facture_id,
          f.num as facture_num,
          f.date as facture_date,
          SUM(lf.abo) as lignes_abo,
          SUM(lf.conso) as lignes_conso,
          SUM(lf.remises) as lignes_remises,
          SUM(lf.achat) as lignes_achat,
          SUM(lf.abo + lf.conso + lf.remises + lf.achat) as lignes_total_ht
        FROM factures f
        LEFT JOIN lignes_factures lf ON lf.facture_id = f.id
        WHERE f.compte_id = ${compteId}
        ${moisFilter}
        GROUP BY f.id, f.num, f.date
        ORDER BY f.date DESC
      `;
      const facturesLignesResult = await executeQuery(facturesLignesQuery);
      setFactureLignesResume(facturesLignesResult.data || []);

      // RequǦte pour consolider les lignes par facture / type / prix abo
      const facturesLignesGroupQuery = `
        SELECT
          f.id as facture_id,
          f.num as facture_num,
          f.date as facture_date,
          COALESCE(l.type, 'Non renseigne') as ligne_type,
          ROUND(lf.abo, 2) as prix_abo,
          COUNT(lf.id) as count,
          SUM(lf.abo) as abo,
          SUM(lf.conso) as conso,
          SUM(lf.remises) as remises,
          SUM(lf.abo + lf.remises) as netAbo,
          SUM(lf.achat) as achat
        FROM factures f
        JOIN lignes_factures lf ON lf.facture_id = f.id
        JOIN lignes l ON l.id = lf.ligne_id
        WHERE f.compte_id = ${compteId}
        ${moisFilter}
        GROUP BY f.id, f.num, f.date, ligne_type, prix_abo
        ORDER BY f.date DESC, netAbo DESC
      `;
      const facturesLignesGroupResult = await executeQuery(facturesLignesGroupQuery);
      setFactureLigneGroupes(facturesLignesGroupResult.data || []);

      if (mois) {
        const prevFacturesQuery = `
          SELECT
            f.id as facture_id,
            f.num as facture_num,
            f.date as facture_date,
            f.statut as facture_statut,
            f.csv_id as csv_id,
            f.abo as abo,
            f.conso as conso,
            f.remises as remises,
            f.achat as achat,
            SUM(f.abo + f.conso + f.remises + f.achat) as total_ht
          FROM factures f
          WHERE f.compte_id = ${compteId}
            AND f.date < (
              SELECT MIN(date) FROM factures f2 WHERE f2.compte_id = ${compteId} ${moisFilter}
            )
          GROUP BY f.id, f.num, f.date, f.statut
          ORDER BY f.date DESC
          LIMIT 1
        `;
        const prevFacturesResult = await executeQuery(prevFacturesQuery);
        setPrevFactures(prevFacturesResult.data || []);
      } else {
        setPrevFactures([]);
      }
    } catch (error) {
      console.error("Erreur lors du chargement des détails:", error);
    } finally {
      setIsLoading(false);
    }
  }

  function VariationBadge({ current, previous }: { current: number; previous?: number | null }) {
    const { symbol, text, color } = computeDelta(current, previous);
    return (
      <span className="variation-badge" style={{ fontSize: "0.7rem", padding: "0.15rem 0.35rem", color }}>
        <span className="variation-arrow" style={{ fontSize: "0.8rem" }}>{symbol}</span>
        <span className="variation-label">{text}</span>
      </span>
    );
  }

  const lignesGroupes: LigneGroupeSynthese[] = Object.values(
    detailLignes.reduce((acc, ligne) => {
        const typeLabel = decodeLineType(ligne.ligne_type);
        const prixAbo = Number(Number(ligne.abo || 0).toFixed(2));
        const key = `${typeLabel}|${prixAbo}`;
      if (!acc[key]) {
        acc[key] = {
          type: typeLabel,
          prixAbo,
          count: 0,
          abo: 0,
          remises: 0,
          netAbo: 0,
          conso: 0,
          achat: 0,
          total: 0,
        };
      }
      acc[key].count += 1;
      acc[key].abo += ligne.abo;
      acc[key].remises += ligne.remises;
      acc[key].netAbo += ligne.abo + ligne.remises;
      acc[key].conso += ligne.conso;
      acc[key].achat += ligne.achat;
      acc[key].total += ligne.total_ht;
      return acc;
    }, {} as Record<string, LigneGroupeSynthese>)
  ).sort((a, b) => b.total - a.total);

  const totalFactureHt = detailFactures.reduce((acc, f) => acc + (f.total_ht || 0), 0);
  const totalFactureConso = detailFactures.reduce((acc, f) => acc + (f.conso || 0), 0);
  const totalFactureRemises = detailFactures.reduce((acc, f) => acc + (f.remises || 0), 0);
  const totalFactureAchat = detailFactures.reduce((acc, f) => acc + (f.achat || 0), 0);
  const totalLignesHt = factureLignesResume.reduce((acc, f) => acc + (f.lignes_total_ht || 0), 0);
  const ecartGlobal = totalFactureHt - totalLignesHt;
  const totalAboBrut = lignesGroupes.reduce((acc, g) => acc + g.abo, 0);
  const totalAboNet = lignesGroupes.reduce((acc, g) => acc + g.netAbo, 0);
  const totalConsoLignes = lignesGroupes.reduce((acc, g) => acc + g.conso, 0);

    const facturesAvecEcart = detailFactures.map((facture) => {
      const lignes = factureLignesResume.find((fl) => fl.facture_id === facture.facture_id);
      const lignesTotal = lignes?.lignes_total_ht ?? 0;
      const ecart = facture.total_ht - lignesTotal;
      return {
        facture_id: facture.facture_id,
        facture_num: facture.facture_num,
        facture_date: facture.facture_date,
        csv_id: (facture as any).csv_id,
        facture_total: facture.total_ht,
        lignes_total: lignesTotal,
        remises: facture.remises,
        conso: facture.conso,
        achat: facture.achat,
      ecart,
    };
  });
  const facturesEnAlerte = facturesAvecEcart.filter((f) => Math.abs(f.ecart) > 0.05);

  useEffect(() => {
    if (activeTab === "rapport" && detailFactures.length > 0 && selectedFactureId === null) {
      setSelectedFactureId(detailFactures[0].facture_id);
    }
  }, [activeTab, detailFactures, selectedFactureId]);

  useEffect(() => {
    async function fetchRapport() {
      if (!selectedFactureId) return;
      try {
        const rapport = await getFactureRapport(selectedFactureId);
        if (rapport) {
          setFactureCommentaires((prev) => ({ ...prev, [selectedFactureId]: rapport.commentaire || "" }));
          const data = rapport.data || {};
          if (data.metricStatuts) {
            setFactureStatuts((prev) => ({ ...prev, [selectedFactureId]: data.metricStatuts }));
          }
          if (data.groupStatuts) {
            setFactureGroupStatuts((prev) => ({ ...prev, [selectedFactureId]: data.groupStatuts }));
          }
          if (data.metricComments) {
            setFactureMetricComments((prev) => ({ ...prev, [selectedFactureId]: data.metricComments }));
          }
          if (data.groupComments) {
            setFactureGroupComments((prev) => ({ ...prev, [selectedFactureId]: data.groupComments }));
          }
          if (data.metricReals) {
            setFactureMetricReals((prev) => ({ ...prev, [selectedFactureId]: data.metricReals }));
          }
          if (data.groupReals) {
            setFactureGroupReals((prev) => ({ ...prev, [selectedFactureId]: data.groupReals }));
          }
        }
      } catch (err) {
        console.error("Erreur chargement rapport", err);
      }
    }
    fetchRapport();
  }, [selectedFactureId]);

  const factureCourante = facturesAvecEcart.find((f) => f.facture_id === selectedFactureId) || null;
  const ligneGroupesFacture = factureLigneGroupes.filter((g) => g.facture_id === selectedFactureId);
  const resumeFacture = factureLignesResume.find((r) => r.facture_id === selectedFactureId) || null;
  const totalLignesFactureHt = resumeFacture?.lignes_total_ht || 0;

  const statutDefault: { aboNet: StatutValeur; ecart: StatutValeur; achat: StatutValeur; conso: StatutValeur } = {
    aboNet: "a_verifier",
    ecart: "a_verifier",
    achat: "a_verifier",
    conso: "a_verifier",
  };

  useEffect(() => {
    if (factureCourante && !factureStatuts[factureCourante.facture_id]) {
      setFactureStatuts((prev) => ({ ...prev, [factureCourante.facture_id]: statutDefault }));
    }
  }, [factureCourante, factureStatuts]);

  function updateStatut(
    factureId: number,
    key: "aboNet" | "ecart" | "achat" | "conso",
    value: StatutValeur
  ) {
    setFactureStatuts((prev) => ({
      ...prev,
      [factureId]: { ...(prev[factureId] || statutDefault), [key]: value },
    }));
  }

  function updateGroupStatut(
    factureId: number,
    groupKey: string,
    key: "aboNet" | "achat",
    value: StatutValeur
  ) {
    setFactureGroupStatuts((prev) => ({
      ...prev,
      [factureId]: {
        ...(prev[factureId] || {}),
        [groupKey]: { ...(prev[factureId]?.[groupKey] || { aboNet: "a_verifier", achat: "a_verifier" }), [key]: value },
      },
    }));
  }

  function updateMetricComment(factureId: number, key: "aboNet" | "ecart" | "achat" | "conso", value: string) {
    setFactureMetricComments((prev) => ({
      ...prev,
      [factureId]: { ...(prev[factureId] || {}), [key]: value },
    }));
  }

  function updateGroupComment(factureId: number, groupKey: string, key: "aboNet" | "achat", value: string) {
    setFactureGroupComments((prev) => ({
      ...prev,
      [factureId]: {
        ...(prev[factureId] || {}),
        [groupKey]: { ...(prev[factureId]?.[groupKey] || {}), [key]: value },
      },
    }));
  }

  function updateMetricReal(factureId: number, key: "ecart", value: string) {
    setFactureMetricReals((prev) => ({
      ...prev,
      [factureId]: { ...(prev[factureId] || {}), [key]: value },
    }));
  }

  function updateGroupReal(factureId: number, groupKey: string, key: "aboNet" | "achat", value: string) {
    setFactureGroupReals((prev) => ({
      ...prev,
      [factureId]: {
        ...(prev[factureId] || {}),
        [groupKey]: { ...(prev[factureId]?.[groupKey] || {}), [key]: value },
      },
    }));
  }

  async function saveRapport() {
    if (!selectedFactureId) return;
    console.log("[RAPPORT][SAVE][START]", { factureId: selectedFactureId });
    const payload = {
      facture_id: selectedFactureId,
      commentaire: factureCommentaires[selectedFactureId] || null,
      data: {
        // On ne conserve plus que le statut global d'ecart
        metricStatuts: { ecart: factureStatuts[selectedFactureId]?.ecart || "a_verifier" },
        groupStatuts: factureGroupStatuts[selectedFactureId] || {},
        metricComments: factureMetricComments[selectedFactureId] || {},
        groupComments: factureGroupComments[selectedFactureId] || {},
        metricReals: factureMetricReals[selectedFactureId] || {},
        groupReals: factureGroupReals[selectedFactureId] || {},
      },
    };
    try {
      console.log("[RAPPORT][SAVE][UPSERT_PAYLOAD]", payload);
      await upsertFactureRapport(payload);
      // Détermine statut facture: conteste > valide > importé
      // Les statuts globaux: on ne prend en compte que l'écart (aboNet/achat sont gérés par groupe)
      const ecartStatut = factureStatuts[selectedFactureId]?.ecart || "a_verifier";
      const groupStatuts = factureGroupStatuts[selectedFactureId] || {};

      const hasConteste =
        ecartStatut === "conteste" ||
        Object.values(groupStatuts).some((g) => g.aboNet === "conteste" || g.achat === "conteste");

      const hasPending =
        ecartStatut === "a_verifier" ||
        Object.values(groupStatuts).some((g) => g.aboNet === "a_verifier" || g.achat === "a_verifier");

      const allValide = !hasConteste && !hasPending;

      // Codes statut alignés backend: 0=importe,1=valide,2=conteste
      let newStatut: number | null = null;
      if (hasConteste) newStatut = 2;
      else if (allValide) newStatut = 1;
      else newStatut = 0;

      if (newStatut !== null) {
        console.log("[FACTURE][STATUS][REQUEST]", { factureId: selectedFactureId, statut: newStatut });
        await updateFacture(selectedFactureId, { statut: newStatut });
        console.log("[FACTURE][STATUS][SUCCESS]", { factureId: selectedFactureId, statut: newStatut });
        // Recharge les données pour refléter le nouveau statut
        loadData();
        if (factureCourante) {
          const moisFacture = factureCourante.facture_date?.slice(0, 7);
          onRefreshParent?.({
            factureId: selectedFactureId,
            newStatut,
            mois: moisFacture,
            compteId,
          });
        }
      }
      alert("Rapport enregistré");
    } catch (err) {
      console.error("[RAPPORT][SAVE][ERROR]", err);
      alert((err as Error).message || "Erreur lors de l'enregistrement du rapport");
    }
  }

  async function saveLigneType(ligneId: number, newType: number) {
    if (savingType === ligneId) return;
    setSavingType(ligneId);
    try {
      await updateLigneType(ligneId, newType);
      await loadData();
    } catch (err) {
      alert((err as Error).message || "Erreur lors de la mise à jour du type");
    } finally {
      setSavingType(null);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: "relative",
          background: "white",
          borderRadius: "0.5rem",
          width: "96%",
          maxWidth: "1400px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {mois && hasPrevMonth && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrevMonth?.();
            }}
            style={{
              position: "absolute",
              left: "-4rem",
              top: "50%",
              transform: "translateY(-50%)",
              background: "#f8fafc",
              color: "#0f172a",
              border: "1px solid #cbd5e1",
              borderRadius: "999px",
              padding: "0.45rem 0.65rem",
              cursor: "pointer",
              boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
              fontWeight: 600,
              fontSize: "1.15rem",
            }}
          aria-label="Précédent"
        >
          ←
        </button>
      )}

        {mois && hasNextMonth && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNextMonth?.();
            }}
            style={{
              position: "absolute",
              right: "-4rem",
              top: "50%",
              transform: "translateY(-50%)",
              background: "#f8fafc",
              color: "#0f172a",
              border: "1px solid #cbd5e1",
              borderRadius: "999px",
              padding: "0.45rem 0.65rem",
              cursor: "pointer",
              boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
              fontWeight: 600,
              fontSize: "1.15rem",
            }}
          aria-label="Suivant"
        >
          →
          </button>
        )}

        {/* Header */}
                        <div
                          style={{
                            padding: "1.5rem",
                            borderBottom: "1px solid #e5e7eb",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <h2 style={{ margin: 0, fontSize: "1.5rem" }}>
              {compteNom || compteNum}
              {mois && (
                <span style={{ color: "#6b7280", fontSize: "1.25rem", marginLeft: "0.75rem" }}>
                  • {formatMoisDisplay(mois)}
                </span>
              )}
            </h2>
            <p style={{ margin: "0.25rem 0 0 0", color: "#6b7280", fontSize: "0.875rem" }}>
              Compte n° {compteNum}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "#6b7280",
              padding: "0.5rem",
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <button
            onClick={() => setActiveTab("stats")}
            style={{
              padding: "1rem 1.5rem",
              border: "none",
              background: activeTab === "stats" ? "white" : "transparent",
              borderBottom: activeTab === "stats" ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: activeTab === "stats" ? "600" : "normal",
              color: activeTab === "stats" ? "#3b82f6" : "#6b7280",
            }}
          >
            Statistiques globales
          </button>
          <button
            onClick={() => setActiveTab("factures")}
            style={{
              padding: "1rem 1.5rem",
              border: "none",
              background: activeTab === "factures" ? "white" : "transparent",
              borderBottom: activeTab === "factures" ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: activeTab === "factures" ? "600" : "normal",
              color: activeTab === "factures" ? "#3b82f6" : "#6b7280",
            }}
          >
            Détail par factures
          </button>
          <button
            onClick={() => setActiveTab("lignes")}
            style={{
              padding: "1rem 1.5rem",
              border: "none",
              background: activeTab === "lignes" ? "white" : "transparent",
              borderBottom: activeTab === "lignes" ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: activeTab === "lignes" ? "600" : "normal",
              color: activeTab === "lignes" ? "#3b82f6" : "#6b7280",
            }}
          >
            Détail par ligne
          </button>
          <button
            onClick={() => setActiveTab("rapport")}
            style={{
              padding: "1rem 1.5rem",
              border: "none",
              background: activeTab === "rapport" ? "white" : "transparent",
              borderBottom: activeTab === "rapport" ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: activeTab === "rapport" ? "600" : "normal",
              color: activeTab === "rapport" ? "#3b82f6" : "#6b7280",
            }}
          >
            Rapport
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "1.5rem", overflow: "auto", flex: 1 }}>
          {isLoading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
              Chargement...
            </div>
          ) : (
            <>
              {/* TAB: Statistiques globales */}
              {activeTab === "stats" && statsGlobales && (
                <div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: "1rem",
                      marginBottom: "2rem",
                    }}
                  >
                    <div
                      style={{
                        background: "#eff6ff",
                        padding: "1rem",
                        borderRadius: "0.5rem",
                      }}
                    >
                      <div style={{ color: "#3b82f6", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                        Total HT
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                          {Number(statsGlobales.total_ht || 0).toFixed(2)} € 
                          </div>
                        {mois && (
                          <VariationBadge current={statsGlobales.total_ht} previous={prevStatsGlobales?.total_ht} />
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#f0fdf4",
                        padding: "1rem",
                        borderRadius: "0.5rem",
                      }}
                    >
                      <div style={{ color: "#10b981", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                        Abonnements
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                          {Number(statsGlobales.total_abo || 0).toFixed(2)} € 
                          </div>
                        {mois && (
                          <VariationBadge current={statsGlobales.total_abo} previous={prevStatsGlobales?.total_abo} />
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#fef3c7",
                        padding: "1rem",
                        borderRadius: "0.5rem",
                      }}
                    >
                      <div style={{ color: "#f59e0b", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                        Consommations
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                          {Number(statsGlobales.total_conso || 0).toFixed(2)} € 
                          </div>
                        {mois && (
                          <VariationBadge current={statsGlobales.total_conso} previous={prevStatsGlobales?.total_conso} />
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#fef2f2",
                        padding: "1rem",
                        borderRadius: "0.5rem",
                      }}
                    >
                      <div style={{ color: "#ef4444", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                        Achats
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                          {Number(statsGlobales.total_achat || 0).toFixed(2)} € 
                          </div>
                        {mois && (
                          <VariationBadge current={statsGlobales.total_achat} previous={prevStatsGlobales?.total_achat} />
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#f0fdfa",
                        padding: "1rem",
                        borderRadius: "0.5rem",
                      }}
                    >
                      <div style={{ color: "#14b8a6", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                        Remises
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                          {Number(statsGlobales.total_remises || 0).toFixed(2)} € 
                          </div>
                        {mois && (
                          <VariationBadge current={statsGlobales.total_remises} previous={prevStatsGlobales?.total_remises} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Graphique de répartition (simple) */}
                  <div>
                    <h3 style={{ marginBottom: "1rem" }}>Répartition</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {[
                        { label: "Abonnements", value: statsGlobales.total_abo, color: "#10b981" },
                        { label: "Consommations", value: statsGlobales.total_conso, color: "#f59e0b" },
                        { label: "Achats", value: statsGlobales.total_achat, color: "#ef4444" },
                        { label: "Remises", value: statsGlobales.total_remises, color: "#14b8a6" },
                      ].map((item) => {
                        const percentage = (item.value / statsGlobales.total_ht) * 100;
                        return (
                          <div key={item.label}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                              <span style={{ fontSize: "0.875rem", color: "#374151" }}>{item.label}</span>
                                <span style={{ fontSize: "0.875rem", fontWeight: "600" }}>
                                {Number(item.value || 0).toFixed(2)} € ({Number(percentage || 0).toFixed(1)}%)
                              </span>
                            </div>
                            <div
                              style={{
                                width: "100%",
                                height: "0.5rem",
                                background: "#e5e7eb",
                                borderRadius: "0.25rem",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${percentage}%`,
                                  height: "100%",
                                  background: item.color,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {/* TAB: Détail par facture */}
              {activeTab === "factures" && (
                <div>
                  <h3 style={{ marginBottom: "1rem" }}>
                    {detailFactures.length} facture(s)
                  </h3>
                  <div style={{ overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                          <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Numéro</th>
                          <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Date</th>
                          <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Statut</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Abo</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Conso</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Remises</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Achats</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Total HT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailFactures.map((facture, idx) => (
                          <tr
                            key={facture.facture_id ?? idx}
                            style={{
                              borderBottom: "1px solid #e5e7eb",
                              background: idx % 2 === 0 ? "white" : "#f9fafb",
                            }}
                          >
                            <td style={{ padding: "0.75rem", fontWeight: "500" }}>{facture.facture_num}</td>
                            <td style={{ padding: "0.75rem", color: "#6b7280", fontSize: "0.875rem" }}>
                              {facture.facture_date}
                            </td>
                                <td style={{ padding: "0.75rem" }}>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      padding: "0.25rem 0.5rem",
                                      borderRadius: "0.35rem",
                                      background: "#eef2ff",
                                      color: "#4338ca",
                                      fontWeight: 600,
                                      fontSize: "0.85rem",
                                    }}
                                  >
                                {decodeFactureStatus(facture.facture_statut)}
                                  </span>
                                </td>
                              <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              {Number(facture.abo || 0).toFixed(2)} € 
                              </td>
                              <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              {Number(facture.conso || 0).toFixed(2)} € 
                              </td>
                              <td style={{ padding: "0.75rem", textAlign: "right", color: "#14b8a6" }}>
                              {Number(facture.remises || 0).toFixed(2)} € 
                              </td>
                              <td style={{ padding: "0.75rem", textAlign: "right", color: "#ef4444" }}>
                              {Number(facture.achat || 0).toFixed(2)} € 
                              </td>
                              <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>
                              {Number(facture.total_ht || 0).toFixed(2)} € 
                              </td>
                          </tr>
                        ))}
                        {detailFactures.length === 0 && (
                          <tr>
                            <td colSpan={8} style={{ padding: "1rem", textAlign: "center", color: "#6b7280" }}>
                              Aucune facture pour ce périmètre.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB: Détail par ligne */}
              {activeTab === "lignes" && (
                <div>
                  <h3 style={{ marginBottom: "1rem" }}>
                    {detailLignes.length} ligne(s) télécom
                  </h3>
                  <div style={{ overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                          <th
                            style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600", cursor: "pointer" }}
                            onClick={() =>
                              setLigneSort((prev) =>
                                prev?.field === "ligne_num"
                                  ? { field: "ligne_num", direction: prev.direction === "asc" ? "desc" : "asc" }
                                  : { field: "ligne_num", direction: "asc" }
                              )
                            }
                          >
                            Numéro {ligneSort?.field === "ligne_num" ? (ligneSort.direction === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Type</th>
                          <th
                            style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600", cursor: "pointer" }}
                            onClick={() =>
                              setLigneSort((prev) =>
                                prev?.field === "abo"
                                  ? { field: "abo", direction: prev.direction === "asc" ? "desc" : "asc" }
                                  : { field: "abo", direction: "asc" }
                              )
                            }
                          >
                            Abo {ligneSort?.field === "abo" ? (ligneSort.direction === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th
                            style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600", cursor: "pointer" }}
                            onClick={() =>
                              setLigneSort((prev) =>
                                prev?.field === "conso"
                                  ? { field: "conso", direction: prev.direction === "asc" ? "desc" : "asc" }
                                  : { field: "conso", direction: "asc" }
                              )
                            }
                          >
                            Conso {ligneSort?.field === "conso" ? (ligneSort.direction === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th
                            style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600", cursor: "pointer" }}
                            onClick={() =>
                              setLigneSort((prev) =>
                                prev?.field === "remises"
                                  ? { field: "remises", direction: prev.direction === "asc" ? "desc" : "asc" }
                                  : { field: "remises", direction: "asc" }
                              )
                            }
                          >
                            Remises {ligneSort?.field === "remises" ? (ligneSort.direction === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th
                            style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600", cursor: "pointer" }}
                            onClick={() =>
                              setLigneSort((prev) =>
                                prev?.field === "achat"
                                  ? { field: "achat", direction: prev.direction === "asc" ? "desc" : "asc" }
                                  : { field: "achat", direction: "asc" }
                              )
                            }
                          >
                            Achats {ligneSort?.field === "achat" ? (ligneSort.direction === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th
                            style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600", cursor: "pointer" }}
                            onClick={() =>
                              setLigneSort((prev) =>
                                prev?.field === "total_ht"
                                  ? { field: "total_ht", direction: prev.direction === "asc" ? "desc" : "asc" }
                                  : { field: "total_ht", direction: "asc" }
                              )
                            }
                          >
                            Total HT {ligneSort?.field === "total_ht" ? (ligneSort.direction === "asc" ? "↑" : "↓") : ""}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {([...detailLignes].sort((a, b) => {
                          if (!ligneSort) return 0;
                          const { field, direction } = ligneSort;
                          const av = a[field];
                          const bv = b[field];
                          const factor = direction === "asc" ? 1 : -1;
                          if (typeof av === "number" && typeof bv === "number") {
                            return av === bv ? 0 : av > bv ? factor : -factor;
                          }
                          if (typeof av === "string" && typeof bv === "string") {
                            return av.localeCompare(bv) * factor;
                          }
                          return 0;
                        }) as DetailLigne[]).map((ligne, idx) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: "1px solid #e5e7eb",
                              background: idx % 2 === 0 ? "white" : "#f9fafb",
                            }}
                          >
                            <td style={{ padding: "0.75rem", fontWeight: "500" }}>{ligne.ligne_num}</td>
                            <td style={{ padding: "0.75rem", color: "#6b7280", fontSize: "0.875rem" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                {(() => {
                                  const baseTypes = [0, 1, 2, 3];
                                  const currentType = editedTypes[ligne.ligne_id] ?? ligne.ligne_type;
                                  const options = baseTypes.includes(currentType) ? baseTypes : [...baseTypes, currentType];
                                  return (
                                    <select
                                      value={currentType}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setEditedTypes((prev) => ({ ...prev, [ligne.ligne_id]: val }));
                                        saveLigneType(ligne.ligne_id, val);
                                      }}
                                      disabled={savingType === ligne.ligne_id}
                                      style={{
                                        padding: "0.35rem 0.5rem",
                                        border: "1px solid #d1d5db",
                                        borderRadius: "0.35rem",
                                        fontSize: "0.85rem",
                                        minWidth: "140px",
                                      }}
                                    >
                                      {options.map((typeCode) => (
                                        <option key={`${ligne.ligne_id}-${typeCode}`} value={typeCode}>
                                          {decodeLineType(typeCode)}
                                        </option>
                                      ))}
                                    </select>
                                  );
                                })()}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem" }}>
                                 <span>{Number(ligne.abo || 0).toFixed(2)} €</span>
                                {mois && (
                                  <VariationBadge
                                    current={ligne.abo}
                                    previous={prevLignes.find((pl) => pl.ligne_id === ligne.ligne_id)?.abo}
                                  />
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem" }}>
                                 <span>{Number(ligne.conso || 0).toFixed(2)} €</span>
                                {mois && (
                                  <VariationBadge
                                    current={ligne.conso}
                                    previous={prevLignes.find((pl) => pl.ligne_id === ligne.ligne_id)?.conso}
                                  />
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", color: "#14b8a6" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem", color: "#14b8a6" }}>
                                 <span>{Number(ligne.remises || 0).toFixed(2)} €</span>
                                {mois && (
                                  <VariationBadge
                                    current={ligne.remises}
                                    previous={prevLignes.find((pl) => pl.ligne_id === ligne.ligne_id)?.remises}
                                  />
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", color: "#ef4444" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem", color: "#ef4444" }}>
                                 <span>{Number(ligne.achat || 0).toFixed(2)} €</span>
                                {mois && (
                                  <VariationBadge
                                    current={ligne.achat}
                                    previous={prevLignes.find((pl) => pl.ligne_id === ligne.ligne_id)?.achat}
                                  />
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem" }}>
                                 <span>{Number(ligne.total_ht || 0).toFixed(2)} €</span>
                                {mois && (
                                  <VariationBadge
                                    current={ligne.total_ht}
                                    previous={prevLignes.find((pl) => pl.ligne_id === ligne.ligne_id)?.total_ht}
                                  />
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {activeTab === "rapport" && (
                <div style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
                  {rapportPanelCollapsed ? (
                    <button
                      onClick={() => setRapportPanelCollapsed(false)}
                      title="Afficher la liste des factures"
                      style={{
                        minWidth: "42px",
                        height: "220px",
                        border: "1px solid #e5e7eb",
                        background: "#f8fafc",
                        borderRadius: "0.75rem",
                        cursor: "pointer",
                        color: "#0f172a",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.35rem",
                        padding: "0.5rem",
                        boxShadow: "0 6px 18px rgba(15,23,42,0.12)",
                      }}
                    >
                      <span style={{ fontSize: "1.2rem" }}>⟩</span>
                      <span style={{ fontSize: "0.78rem", writingMode: "vertical-rl" }}>Factures</span>
                    </button>
                  ) : (
                    <div style={{ minWidth: "250px", ...rapportCardStyle, padding: "0.85rem", position: "relative" }}>
                      <button
                        onClick={() => setRapportPanelCollapsed(true)}
                        title="Réduire la liste"
                        style={{
                          position: "absolute",
                          top: "0.4rem",
                          right: "0.4rem",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: "#6b7280",
                          fontSize: "1rem",
                        }}
                      >
                        ⟨
                      </button>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", paddingRight: "1.5rem" }}>
                        <h4 style={{ margin: 0 }}>Factures</h4>
                        <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>{facturesAvecEcart.length} éléments</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                        {facturesAvecEcart.map((f) => {
                          const isActive = f.facture_id === selectedFactureId;
                          return (
                            <button
                              key={f.facture_id}
                              onClick={() => setSelectedFactureId(f.facture_id)}
                              style={{
                                textAlign: "left",
                                padding: "0.55rem 0.7rem",
                                borderRadius: "0.55rem",
                                border: isActive ? "1px solid #2563eb" : "1px solid #e5e7eb",
                                background: isActive ? "#eff6ff" : "#f9fafb",
                                cursor: "pointer",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "0.5rem",
                                boxShadow: isActive ? "0 10px 25px rgba(37,99,235,0.12)" : "none",
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 700 }}>{f.facture_num}</div>
                                <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{f.facture_date}</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                 <div style={{ fontWeight: 700 }}>{Number(f.facture_total || 0).toFixed(2)} €</div>
                                <div style={{ color: Math.abs(f.ecart) > 0.05 ? "#dc2626" : "#16a34a", fontSize: "0.85rem" }}>
                                  {f.ecart >= 0 ? "+" : ""}
                                   {Number(f.ecart || 0).toFixed(2)} € 
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        {facturesAvecEcart.length === 0 && <div style={{ color: "#6b7280" }}>Aucune facture.</div>}
                      </div>
                    </div>
                  )}

                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {factureCourante ? (
                      <>
                        <div style={{ ...rapportCardStyle, padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                            <h3 style={{ margin: 0 }}>Rapport facture {factureCourante.facture_num}</h3>
                            <p style={{ margin: 0, color: "#6b7280", fontSize: "0.95rem" }}>
                              {factureCourante.facture_date} · Ecart facture - lignes :{" "}
                              <span style={{ color: Math.abs(factureCourante.ecart) > 0.05 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                                {factureCourante.ecart >= 0 ? "+" : ""}
                                  {Number(factureCourante.ecart || 0).toFixed(2)} € 
                              </span>
                            </p>
                          </div>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <button
                              onClick={applyAutoVerification}
                              disabled={autoLoading}
                              style={{
                                padding: "0.45rem 0.85rem",
                                background: autoLoading ? "#bae6fd" : "#0ea5e9",
                                color: "#0b172a",
                                border: "1px solid #0ea5e9",
                                borderRadius: "0.35rem",
                                cursor: autoLoading ? "not-allowed" : "pointer",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {autoLoading ? "Auto en cours..." : "Auto (CSV)"}
                            </button>
                            <button
                              onClick={exportPdf}
                              style={{
                                padding: "0.45rem 0.85rem",
                                background: "#f3e8ff",
                                color: "#6b21a8",
                                border: "1px solid #e9d5ff",
                                borderRadius: "0.35rem",
                                cursor: "pointer",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                              }}
                            >
                              Export PDF
                            </button>
                            <button
                              onClick={exportOdt}
                              style={{
                                padding: "0.45rem 0.85rem",
                                background: "#ecfdf3",
                                color: "#166534",
                                border: "1px solid #bbf7d0",
                                borderRadius: "0.35rem",
                                cursor: "pointer",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                              }}
                            >
                              Export ODT
                            </button>
                          </div>
                        </div>

                        <div style={{ ...rapportCardStyle, padding: "1rem" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
                            <div style={{ background: "#eff6ff", borderRadius: "0.55rem", padding: "0.75rem" }}>
                              <div style={{ color: "#1d4ed8", fontSize: "0.9rem", fontWeight: 700 }}>Total facture HT</div>
                              <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{Number(factureCourante.facture_total || 0).toFixed(2)} €</div>
                            </div>
                            <div style={{ background: "#f0fdf4", borderRadius: "0.55rem", padding: "0.75rem" }}>
                              <div style={{ color: "#166534", fontSize: "0.9rem", fontWeight: 700 }}>Total lignes HT</div>
                              <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{Number(totalLignesFactureHt || 0).toFixed(2)} €</div>
                            </div>
                            <div style={{ background: "#fff7ed", borderRadius: "0.55rem", padding: "0.75rem" }}>
                              <div style={{ color: "#c2410c", fontSize: "0.9rem", fontWeight: 700 }}>Ecart facture - lignes</div>
                              <div style={{ fontSize: "1.15rem", fontWeight: 800, color: Math.abs(factureCourante.ecart) > 0.05 ? "#dc2626" : "#16a34a" }}>
                                {factureCourante.ecart >= 0 ? "+" : ""}
                                  {Number(factureCourante.ecart || 0).toFixed(2)} € 
                              </div>
                            </div>
                          </div>
                        </div>

                        <div style={{ ...rapportCardStyle, padding: "1rem", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 0.9fr)", gap: "0.75rem", alignItems: "start" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ fontWeight: 700, color: "#0f172a" }}>Ecart global</div>
                              <StatutBadge value={factureStatuts[factureCourante.facture_id]?.ecart || "a_verifier"} />
                            </div>
                            <select
                              value={factureStatuts[factureCourante.facture_id]?.ecart || "a_verifier"}
                              onChange={(e) => updateStatut(factureCourante.facture_id, "ecart", e.target.value as any)}
                              style={{ padding: "0.45rem 0.5rem", borderRadius: "0.5rem", border: "1px solid #cbd5e1", background: "#f8fafc", fontWeight: 600 }}
                            >
                              <option value="valide">Valide</option>
                              <option value="conteste">Conteste</option>
                              <option value="a_verifier">A verifier</option>
                            </select>
                            <textarea
                              placeholder="Commentaire sur l'ecart (auto + manuel)"
                              value={factureMetricComments[factureCourante.facture_id]?.ecart || ""}
                              onChange={(e) => updateMetricComment(factureCourante.facture_id, "ecart", e.target.value)}
                              style={{ width: "100%", padding: "0.55rem", borderRadius: "0.5rem", border: "1px solid #cbd5e1", resize: "vertical", minHeight: "70px", background: "#f8fafc" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                            <div style={{ fontWeight: 700, color: "#0f172a" }}>Valeur corrigee (si contestee)</div>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Ecart reel"
                              value={factureMetricReals[factureCourante.facture_id]?.ecart || ""}
                              onChange={(e) => updateMetricReal(factureCourante.facture_id, "ecart", e.target.value)}
                              style={{ padding: "0.55rem 0.6rem", borderRadius: "0.5rem", border: "1px solid #cbd5e1", background: "#fff" }}
                            />
                            <small style={{ color: "#6b7280" }}>Ajoute la valeur corrigee que tu consideres juste en cas de contestation.</small>
                          </div>
                        </div>

                                                <div style={{ ...rapportCardStyle, padding: "1rem" }}>
                          <div style={{ marginBottom: "0.6rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                            <h4 style={{ margin: 0 }}>Regroupements de lignes</h4>
                            <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>Statut et commentaire par regroupement</span>
                          </div>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", minWidth: "1100px", borderCollapse: "separate", borderSpacing: 0, fontSize: "0.86rem", tableLayout: "auto" }}>
                              <thead>
                                <tr style={{ background: "#f8fafc", color: "#0f172a" }}>
                                  <th style={{ textAlign: "left", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Type</th>
                                  <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Lignes</th>
                                  <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Abo brut</th>
                                  <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Conso</th>
                                  <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Remises</th>
                                  <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Abo net unitaire</th>
                                  <th style={{ textAlign: "left", padding: "0.65rem", borderBottom: "1px solid #e5e7eb", minWidth: "210px" }}>Statut abo net</th>
                                  <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Achats total</th>
                                  <th style={{ textAlign: "left", padding: "0.65rem", borderBottom: "1px solid #e5e7eb", minWidth: "210px" }}>Statut achats</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ligneGroupesFacture.map((g, idx) => {
                                    const netUnitVal = g.count ? g.netAbo / g.count : Number(g.netAbo ?? 0);
                                    const achatUnit = g.count ? g.achat / g.count : Number(g.achat ?? 0);
                                    const key = `${g.ligne_type}|${Number(netUnitVal || 0).toFixed(2)}`;
                                  const stat = factureGroupStatuts[factureCourante.facture_id]?.[key];
                                  const comment = factureGroupComments[factureCourante.facture_id]?.[key]?.aboNet || "";
                                  const commentAchat = factureGroupComments[factureCourante.facture_id]?.[key]?.achat || "";
                                  const rowBg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
                                  return (
                                    <tr key={`${key}-${idx}`} style={{ background: rowBg, borderBottom: "1px solid #e5e7eb", verticalAlign: "top" }}>
                                      <td style={{ padding: "0.65rem" }}>
                                        <div style={{ fontWeight: 700 }}>{decodeLineType(g.ligne_type)}</div>
                                      </td>
                                      <td style={{ padding: "0.65rem", textAlign: "right", fontWeight: 700 }}>{g.count}</td>
                                       <td style={{ padding: "0.65rem", textAlign: "right" }}>{Number(g.abo || 0).toFixed(2)} €</td>
                                       <td style={{ padding: "0.65rem", textAlign: "right" }}>{Number(g.conso || 0).toFixed(2)} €</td>
                                       <td style={{ padding: "0.65rem", textAlign: "right", color: "#0f766e" }}>{Number(g.remises || 0).toFixed(2)} €</td>
                                       <td style={{ padding: "0.65rem", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{Number(netUnitVal || 0).toFixed(2)} €</td>
                                      <td style={{ padding: "0.65rem", minWidth: "240px" }}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                            <StatutBadge value={stat?.aboNet || "a_verifier"} />
                                            <select
                                              value={stat?.aboNet || "a_verifier"}
                                              onChange={(e) => updateGroupStatut(factureCourante.facture_id, key, "aboNet", e.target.value as StatutValeur)}
                                              style={{ padding: "0.38rem", borderRadius: "0.45rem", border: "1px solid #cbd5e1", background: "#f8fafc", fontWeight: 600 }}
                                            >
                                              <option value="valide">Valide</option>
                                              <option value="conteste">Conteste</option>
                                              <option value="a_verifier">A verifier</option>
                                            </select>
                                          </div>
                                          <textarea
                                            placeholder="Commentaire abo net"
                                            value={comment}
                                            onChange={(e) => updateGroupComment(factureCourante.facture_id, key, "aboNet", e.target.value)}
                                            style={{ width: "100%", padding: "0.42rem", borderRadius: "0.45rem", border: "1px solid #cbd5e1", minHeight: "60px", resize: "vertical", background: "#f8fafc" }}
                                          />
                                        </div>
                                      </td>
                                       <td style={{ padding: "0.65rem", textAlign: "right", fontWeight: 700, color: "#b45309" }}>{Number(g.achat || 0).toFixed(2)} €</td>
                                      <td style={{ padding: "0.65rem", minWidth: "240px" }}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                            <StatutBadge value={stat?.achat || (g.achat && g.achat !== 0 ? "conteste" : "a_verifier")} />
                                             <span style={{ color: "#6b7280", fontSize: "0.82rem" }}>Net unitaire: {Number(achatUnit || 0).toFixed(2)} €</span>
                                            <select
                                              value={stat?.achat || (g.achat && g.achat !== 0 ? "conteste" : "a_verifier")}
                                              onChange={(e) => updateGroupStatut(factureCourante.facture_id, key, "achat", e.target.value as StatutValeur)}
                                              style={{ padding: "0.38rem", borderRadius: "0.45rem", border: "1px solid #cbd5e1", background: "#f8fafc", fontWeight: 600 }}
                                            >
                                              <option value="valide">Valide</option>
                                              <option value="conteste">Conteste</option>
                                              <option value="a_verifier">A verifier</option>
                                            </select>
                                          </div>
                                          <textarea
                                            placeholder="Commentaire achats"
                                            value={commentAchat}
                                            onChange={(e) => updateGroupComment(factureCourante.facture_id, key, "achat", e.target.value)}
                                            style={{ width: "100%", padding: "0.42rem", borderRadius: "0.45rem", border: "1px solid #cbd5e1", minHeight: "60px", resize: "vertical", background: "#f8fafc" }}
                                          />
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div style={{ ...rapportCardStyle, padding: "1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <h4 style={{ margin: 0 }}>Commentaire global</h4>
                            <small style={{ color: "#6b7280" }}>Sauvegarde le statut + les commentaires</small>
                          </div>
                          <textarea
                            placeholder="Notes sur les irregularites ou contestations..."
                            value={factureCommentaires[factureCourante.facture_id] || ""}
                            onChange={(e) =>
                              setFactureCommentaires((prev) => ({
                                ...prev,
                                [factureCourante.facture_id]: e.target.value,
                              }))
                            }
                            style={{
                              width: "100%",
                              minHeight: "90px",
                              padding: "0.65rem",
                              borderRadius: "0.5rem",
                              border: "1px solid #cbd5e1",
                              background: "#f8fafc",
                              resize: "vertical",
                            }}
                          />
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button
                              onClick={saveRapport}
                              style={{
                                padding: "0.55rem 0.95rem",
                                background: "#3b82f6",
                                color: "white",
                                border: "none",
                                borderRadius: "0.35rem",
                                cursor: "pointer",
                                fontWeight: 700,
                              }}
                            >
                              Enregistrer
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: "#6b7280" }}>Aucune facture selectionnee.</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 1.5rem",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <div>
            {mois && onDeleteMonth && (
              <button
                onClick={onDeleteMonth}
                style={{
                  padding: "0.6rem 1rem",
                  background: "#ef4444",
                  color: "white",
                  border: "none",
                  borderRadius: "0.35rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Supprimer
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1.5rem",
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "0.25rem",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

  function summarizeCsvContexts(contexts?: string[]): string[] {
    if (!contexts || contexts.length === 0) return [];
    if (contexts.length <= 5) return contexts;
    const lower = contexts.map((c) => c.toLowerCase());
    const newCount = lower.filter((c) => c.includes("nouvelle")).length;
    const missingCount = lower.filter((c) => c.includes("absent") || c.includes("manqu")).length;
    const summaries: string[] = [];
    if (newCount > 0) summaries.push(`${newCount} nouvelles lignes`);
    if (missingCount > 0) summaries.push(`${missingCount} lignes absentes`);
    const remaining = contexts.length - (newCount + missingCount);
    if (remaining > 0 && summaries.length === 0) {
      summaries.push(`${contexts.length} lignes concernées`);
    }
    return summaries;
  }
