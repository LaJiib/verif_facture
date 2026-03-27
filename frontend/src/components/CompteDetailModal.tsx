import React, { useEffect, useMemo, useState } from "react";
import {
  updateLigneType,
  getFactureRapport,
  upsertFactureRapport,
  updateFacture,
  listLignesFactures,
  updateLigneFacture,
  listAbonnements,
  attachAbonnementToLines,
  getFactureAbonnements,
  fetchFactures,
  fetchFactureDetailStats,
  Abonnement,
  FactureDetailStats,
  type Facture,
} from "../newApi";
import { decodeLineType, decodeFactureStatus, decodeLigneFactureStatus } from "../utils/codecs";
import { STATUS_COLORS } from "../utils/statusBar";
import { exportFactureReportPdf } from "../utils/pdfReport";
import { exportFactureReportDocx } from "../utils/docxReport";
import { runAutoVerification, StatutValeur, LigneAnomalie } from "../utils/autoVerification";
import { importCSV } from "../csvImporter";
import { fetchUploadContent } from "../newApi";
import LigneInsightModal from "./LigneInsightModal";

function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() => (typeof window !== "undefined" ? window.innerWidth : 1280));
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

interface CompteDetailModalProps {
  compteId: number;
  compteNum: string;
  compteNom: string | null;
  entrepriseNom?: string | null;
  mois?: string; // Format: YYYY-MM, optionnel pour filtrer sur un mois
  onClose: () => void;
  onRefreshParent?: (args: { factureId: number; newStatut: number; mois?: string; compteId: number }) => void; // permet de declencher un refresh cible
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
  ligne_facture_id: number;
  ligne_num: string;
  ligne_type: number;
  ligne_nom: string;
  sous_compte?: string | null;
  ligne_statut?: number;
  abo_id_ref?: number | null;
  abo_nom_ref?: string | null;
  abo_prix_ref?: number | null;
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
  group_key: string;
  match_type: number;
  match_net: number;
  prix_abo: number;
  count: number;
  abo: number;
  conso: number;
  remises: number;
  netAbo: number;
  achat: number;
  abo_nom?: string | null;
  abo_id?: number | null;
  ligne_facture_ids?: number[];
}

interface BackendLigneGroupe {
  facture_id: number;
  group_key: string;
  ligne_type: number;
  abo_id_ref?: number | null;
  abo_nom_ref?: string | null;
  prix_abo: number;
  count: number;
  abo: number;
  remises: number;
  netAbo: number;
  conso: number;
  achat: number;
  total: number;
  ligne_facture_ids?: number[];
}

interface FactureResumeBackend {
  facture_id: number;
  facture_num: string;
  facture_date: string;
  total_ht: number;
  lignes_total: number;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  ecart: number;
}

interface AbonnementSelection {
  mode: "existing" | "new";
  abonnementId?: number | null;
  nom?: string | null;
  prix?: number | null;
  commentaire?: string | null;
}

interface FactureReferenceInfo {
  factureId?: number | null;
  factureNum?: string | null;
  factureDate?: string | null;
  sharedLinesCount?: number;
  selectedLinesCount?: number;
  referenceLinesCount?: number;
  selectionRule?: string;
}

const statutTokens: Record<StatutValeur, { bg: string; color: string; label: string }> = {
  valide: { bg: "#ecfdf3", color: "#15803d", label: "Valide" },
  conteste: { bg: "#fef2f2", color: "#b91c1c", label: "Conteste" },
  // gris pour rester coh?rent avec les exports PDF/ODT
  a_verifier: { bg: "#f3f4f6", color: "#374151", label: "A verifier" },
};

function statutIntToValeur(statut: number | null | undefined): StatutValeur {
  if (statut === 1) return "valide";
  if (statut === 2) return "conteste";
  return "a_verifier";
}

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
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoSizeMm, setLogoSizeMm] = useState<{ width: number; height: number } | null>(null);
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
  const [factureLineStatuts, setFactureLineStatuts] = useState<
    Record<number, Record<number, { aboNet: StatutValeur; achat: StatutValeur; comment?: string }>>
  >({});
  const [factureMetricComments, setFactureMetricComments] = useState<
    Record<number, { aboNet?: string; ecart?: string; achat?: string; conso?: string }>
  >({});
  const [factureGroupComments, setFactureGroupComments] = useState<Record<number, Record<string, { aboNet?: string; achat?: string }>>>({});
  const [factureGroupAnomalies, setFactureGroupAnomalies] = useState<Record<number, Record<string, LigneAnomalie[]>>>({});
  const [factureMetricReals, setFactureMetricReals] = useState<Record<number, { ecart?: string }>>({});
  const [factureGroupReals, setFactureGroupReals] = useState<Record<number, Record<string, { aboNet?: string; achat?: string }>>>({});
  const [factureGroupAbonnements, setFactureGroupAbonnements] = useState<Record<number, Record<string, AbonnementSelection>>>({});
  const [factureReferenceInfos, setFactureReferenceInfos] = useState<Record<number, FactureReferenceInfo>>({});
  const [abonnements, setAbonnements] = useState<Abonnement[]>([]);
  const [abonnementsLoading, setAbonnementsLoading] = useState(false);
  const [ligneModalId, setLigneModalId] = useState<number | null>(null);
  const [aboModal, setAboModal] = useState<{ open: boolean; groupKey: string | null; lineIds: number[] }>({
    open: false,
    groupKey: null,
    lineIds: [],
  });
  const [aboModalSaving, setAboModalSaving] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [compteMeta, setCompteMeta] = useState<{ entreprise_id: number; num: string } | null>(null);
  const [ligneSort, setLigneSort] = useState<{ field: keyof DetailLigne; direction: "asc" | "desc" } | null>(null);
  const [editedTypes, setEditedTypes] = useState<Record<number, number>>({});
  const [savingType, setSavingType] = useState<number | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<number>>(new Set());
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const [typesInitialized, setTypesInitialized] = useState(false);
  const viewportWidth = useViewportWidth();
  const isWideDialog = viewportWidth >= 1400;
  const isUltraWideDialog = viewportWidth >= 1800;
  const dialogWidth = isUltraWideDialog ? "98%" : isWideDialog ? "97%" : "96%";
  const dialogMaxWidth = isUltraWideDialog ? "1800px" : isWideDialog ? "1600px" : "1400px";
  const dialogMaxHeight = isWideDialog ? "92vh" : "90vh";
  const blockPadding = isWideDialog ? "1.5rem" : "1.1rem";
  const tabPaddingY = isWideDialog ? "1rem" : "0.9rem";
  const tabPaddingX = isWideDialog ? "1.6rem" : "1.2rem";
  const [rapportPanelCollapsed, setRapportPanelCollapsed] = useState(false);
  const [selectedSousComptesTab, setSelectedSousComptesTab] = useState<Set<string>>(new Set());
  const [sousCompteTabOpen, setSousCompteTabOpen] = useState(false);
  
  useEffect(() => {
    loadData();
  }, [compteId, mois]);

  useEffect(() => {
    if (!selectedFactureId) return;
    loadData();
  }, [selectedFactureId]);

  useEffect(() => {
    let cancelled = false;
    async function loadAbonnementsList() {
      try {
        setAbonnementsLoading(true);
        const list = await listAbonnements();
        if (!cancelled) setAbonnements(list);
      } catch (err) {
        console.error("Impossible de charger les abonnements", err);
      } finally {
        if (!cancelled) setAbonnementsLoading(false);
      }
    }
    loadAbonnementsList();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadLogo() {
      try {
        const res = await fetch("/actice_logo.png");
        if (!res.ok) return;
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          if (cancelled || typeof reader.result !== "string") return;
          const dataUrl = reader.result;
          const img = new Image();
          img.onload = () => {
            if (cancelled) return;
            const targetHeightMm = 12;
            const ratio = img.width > 0 ? img.height / img.width : 0.4;
            const heightMm = targetHeightMm;
            const widthMm = ratio > 0 ? targetHeightMm / ratio : targetHeightMm * 1.8;
            setLogoSizeMm({ width: widthMm, height: heightMm });
            setLogoDataUrl(dataUrl);
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.warn("Logo non charge", err);
      }
    }
    loadLogo();
    return () => {
      cancelled = true;
    };
  }, []);

  function formatMoisDisplay(dateKey: string): string {
    const [year, month] = dateKey.split("-");
    const moisMap: { [key: string]: string } = {
      "01": "Janvier",
      "02": "Fevrier",
      "03": "Mars",
      "04": "Avril",
      "05": "Mai",
      "06": "Juin",
      "07": "Juillet",
      "08": "Aout",
      "09": "Septembre",
      "10": "Octobre",
      "11": "Novembre",
      "12": "Decembre",
    };
    return `${moisMap[month]} ${year}`;
  }

  function mapGroupsToLegacyMaps(
    groupsInput: any,
    fallbackStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }> = {},
    fallbackComments: Record<string, { aboNet?: string; achat?: string }> = {},
    fallbackAnomalies: Record<string, LigneAnomalie[]> = {}
  ): {
    groupStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }>;
    groupComments: Record<string, { aboNet?: string; achat?: string }>;
    groupAnomalies: Record<string, LigneAnomalie[]>;
  } {
    const makeSignature = (ids: number[]) =>
      [...(ids || [])]
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id))
        .sort((a, b) => a - b)
        .join(",");

    const signatureToCurrentKey = new Map<string, string>();
    ligneGroupesFacture.forEach((g) => {
      const sig = makeSignature(g.ligne_facture_ids || []);
      if (sig) signatureToCurrentKey.set(sig, g.group_key);
    });

    const outStatuts: Record<string, { aboNet: StatutValeur; achat: StatutValeur }> = { ...(fallbackStatuts || {}) };
    const outComments: Record<string, { aboNet?: string; achat?: string }> = { ...(fallbackComments || {}) };
    const outAnomalies: Record<string, LigneAnomalie[]> = { ...(fallbackAnomalies || {}) };

    const coerceStatut = (value: any): StatutValeur => {
      if (value === "valide" || value === "conteste" || value === "a_verifier") return value;
      return "a_verifier";
    };

    if (!Array.isArray(groupsInput)) {
      return { groupStatuts: outStatuts, groupComments: outComments, groupAnomalies: outAnomalies };
    }

    groupsInput.forEach((groupItem: any) => {
      const lfIdsRaw = groupItem?.ligneFactureIds ?? groupItem?.ligne_facture_ids;
      const lfIds = Array.isArray(lfIdsRaw) ? lfIdsRaw.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id)) : [];
      const signature = makeSignature(lfIds);

      const rawKey = typeof groupItem?.groupKey === "string" ? groupItem.groupKey : typeof groupItem?.group_key === "string" ? groupItem.group_key : "";
      const key = (signature ? signatureToCurrentKey.get(signature) : undefined) || rawKey;
      if (!key) return;

      const statutRaw = groupItem?.statut || groupItem?.statuts || {};
      outStatuts[key] = {
        aboNet: coerceStatut(statutRaw?.aboNet),
        achat: coerceStatut(statutRaw?.achat),
      };

      const commentsRaw = groupItem?.comments || groupItem?.commentaires || {};
      outComments[key] = {
        aboNet: commentsRaw?.aboNet,
        achat: commentsRaw?.achat,
      };

      if (Array.isArray(groupItem?.anomalies)) {
        outAnomalies[key] = groupItem.anomalies;
      }
    });

    return { groupStatuts: outStatuts, groupComments: outComments, groupAnomalies: outAnomalies };
  }

  async function applyAutoVerification() {
    if (!factureCourante) return;
    try {
      setAutoLoading(true);
      console.log("[Auto] Debut auto-verification (frontend regroupe)", {
        facture_id: factureCourante.facture_id,
        facture_num: factureCourante.facture_num,
        csv_id: factureCourante.csv_id,
      });

      const autoResult = await runAutoVerification({
        factureId: factureCourante.facture_id,
      });
      const mappedGroups = mapGroupsToLegacyMaps(
        autoResult.groups,
        autoResult.groupStatuts,
        autoResult.groupComments,
        autoResult.groupAnomalies
      );

      setFactureStatuts((prev) => ({ ...prev, [factureCourante.facture_id]: autoResult.metricStatuts }));
      setFactureMetricComments((prev) => ({ ...prev, [factureCourante.facture_id]: autoResult.metricComments }));
      setFactureMetricReals((prev) => ({ ...prev, [factureCourante.facture_id]: autoResult.metricReals }));
      setFactureGroupStatuts((prev) => ({ ...prev, [factureCourante.facture_id]: mappedGroups.groupStatuts }));
      setFactureGroupComments((prev) => ({ ...prev, [factureCourante.facture_id]: mappedGroups.groupComments }));
      setFactureGroupAnomalies((prev) => ({
        ...prev,
        [factureCourante.facture_id]: mappedGroups.groupAnomalies,
      }));
      setFactureLineStatuts((prev) => ({
        ...prev,
        [factureCourante.facture_id]: autoResult.lineStatuts,
      }));

      console.log("[Auto] Resume calcule", autoResult);
      const {
        added,
        removed,
        modified,
        previousFactureId,
        previousFactureNum,
        previousFactureDate,
        sharedLinesCount,
        selectedLinesCount,
        referenceLinesCount,
        selectionRule,
      } = autoResult.summary;
      const prevNumFromList =
        previousFactureId !== null
          ? detailFactures.find((f) => f.facture_id === previousFactureId)?.facture_num ||
            prevFactures.find((f) => f.facture_id === previousFactureId)?.facture_num
          : null;
      const prevDisplay = previousFactureNum || prevNumFromList || previousFactureId;
      const overlapInfo =
        typeof sharedLinesCount === "number" && typeof selectedLinesCount === "number"
          ? ` (${sharedLinesCount}/${selectedLinesCount} lignes communes)`
          : "";
      setFactureReferenceInfos((prev) => ({
        ...prev,
        [factureCourante.facture_id]: {
          factureId: previousFactureId,
          factureNum: previousFactureNum ?? (typeof prevDisplay === "string" ? prevDisplay : prevDisplay ? String(prevDisplay) : null),
          factureDate: previousFactureDate || null,
          sharedLinesCount,
          selectedLinesCount,
          referenceLinesCount,
          selectionRule,
        },
      }));
      alert(
        `Auto (CSV+lignes) terminee : ${modified} ligne(s) modifiee(s), ${added} ajoutee(s), ${removed} supprimee(s)` +
          (previousFactureId
            ? ` (comparatif avec facture de reference ${prevDisplay}${overlapInfo}).`
            : " (pas de facture de reference pertinente).")
      );

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
      metricReals: factureMetricReals[factureCourante.facture_id] || {},
      metricComments: factureMetricComments[factureCourante.facture_id] || {},
      groupStatuts: Object.fromEntries(
        resolvedGroupRows.map((row) => [
          `${row.group.ligne_type}|${((row.group as any).prix_abo || 0).toFixed(2)}`,
          row.stat,
        ])
      ),
      groupComments: Object.fromEntries(
        resolvedGroupRows.map((row) => [
          `${row.group.ligne_type}|${((row.group as any).prix_abo || 0).toFixed(2)}`,
          row.comment,
        ])
      ),
      groupReals: factureGroupReals[factureCourante.facture_id] || {},
      globalComment: factureCommentaires[factureCourante.facture_id],
      logoDataUrl: logoDataUrl || undefined,
      logoWidthMm: logoSizeMm?.width,
      logoHeightMm: logoSizeMm?.height,
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
      metricReals: factureMetricReals[factureCourante.facture_id] || {},
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
    if (prev === undefined || prev === null) return { symbol: '-', color: '#6b7280', text: 'N/A' };
    if (prev === 0) return { symbol: current === 0 ? '-' : '^', color: current === 0 ? '#6b7280' : '#16a34a', text: 'N/A' };
    const delta = ((current - prev) / prev) * 100;
    const symbol = delta > 0 ? '^' : delta < 0 ? 'v' : '-';
    const color = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#6b7280';
    const text = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
    return { symbol, color, text };
  }

  async function loadData() {
    setIsLoading(true);
    try {
      // 1) Récupérer la liste des factures du périmètre (mois si fourni)
      let facturesListe: Facture[] = [];
      try {
        if (mois) {
          const [year, month] = mois.split("-");
          const start = `${year}-${month}-01`;
          const nextMonth = month === "12" ? "01" : String(Number(month) + 1).padStart(2, "0");
          const nextYear = month === "12" ? String(Number(year) + 1) : year;
          const endExclusive = `${nextYear}-${nextMonth}-01`;
          facturesListe = await fetchFactures({ compte_id: compteId, date_debut: start, date_fin: endExclusive });
          console.log("[FACTURES][LIST]", { filters: { compte_id: compteId, date_debut: start, date_fin: endExclusive }, count: facturesListe.length });
        } else {
          facturesListe = await fetchFactures({ compte_id: compteId });
          console.log("[FACTURES][LIST]", { filters: { compte_id: compteId }, count: facturesListe.length });
        }
      } catch (inner) {
        console.warn("Impossible de recuperer la liste des factures", inner);
      }
      facturesListe.sort((a, b) => {
        const dateOrder = String(b.date).localeCompare(String(a.date));
        if (dateOrder !== 0) return dateOrder;
        return Number(b.id) - Number(a.id);
      });

      let targetFactureId = selectedFactureId;
      if (!targetFactureId || !facturesListe.some((f) => f.id === targetFactureId)) {
        targetFactureId = facturesListe?.[0]?.id ?? null;
      }

      if (!targetFactureId) {
        setDetailFactures([]);
        setDetailLignes([]);
        setSelectedFactureId(null);
        setIsLoading(false);
        return;
      }

      const detailStats: FactureDetailStats = await fetchFactureDetailStats(targetFactureId);
      console.log("[FACTURE][DETAIL_STATS]", { factureId: targetFactureId, stats: detailStats });

      // 2) Stats globales
      const aggregatedStats =
        facturesListe.length > 0
          ? facturesListe.reduce(
              (acc, f) => {
                acc.total_abo += Number((f as any).abo || 0);
                acc.total_conso += Number((f as any).conso || 0);
                acc.total_remises += Number((f as any).remises || 0);
                acc.total_achat += Number((f as any).achat || 0);
                acc.total_ht += Number((f as any).total_ht || 0);
                return acc;
              },
              { total_abo: 0, total_conso: 0, total_remises: 0, total_achat: 0, total_ht: 0 }
            )
          : detailStats.stats_globales || {};
      setStatsGlobales({
        total_abo: aggregatedStats.total_abo || 0,
        total_conso: aggregatedStats.total_conso || 0,
        total_remises: aggregatedStats.total_remises || 0,
        total_achat: aggregatedStats.total_achat || 0,
        total_ht: aggregatedStats.total_ht || 0,
      });
      setPrevStatsGlobales(
        detailStats.stats_globales_prev
          ? {
              total_abo: detailStats.stats_globales_prev.total_abo || 0,
              total_conso: detailStats.stats_globales_prev.total_conso || 0,
              total_remises: detailStats.stats_globales_prev.total_remises || 0,
              total_achat: detailStats.stats_globales_prev.total_achat || 0,
              total_ht: detailStats.stats_globales_prev.total_ht || 0,
            }
          : null
      );

      // 3) Lignes + types
      const lignesRaw = detailStats.facture_detail.lignes || [];
      const lignes: DetailLigne[] = lignesRaw.map((l) => ({
        ligne_id: l.ligne_id,
        ligne_facture_id: l.ligne_facture_id,
        ligne_num: l.ligne_num,
        ligne_nom: (l as any).nom ?? null,
        ligne_type: l.ligne_type,
        sous_compte: (l as any).sous_compte ?? null,
        ligne_statut: l.statut,
        abo_id_ref: (l as any).abo_id_ref ?? null,
        abo_nom_ref: (l as any).abo_nom_ref ?? null,
        abo_prix_ref: (l as any).abo_prix_ref ?? null,
        abo: l.abo ?? 0,
        conso: l.conso ?? 0,
        remises: l.remises ?? 0,
        achat: (l as any).achat ?? 0,
        total_ht: l.total_ht ?? 0,
      }));
      setDetailLignes(lignes);
      const typesMap: Record<number, number> = {};
      lignes.forEach((l) => (typesMap[l.ligne_id] = l.ligne_type ?? 3));
      setEditedTypes(typesMap);
      // 4) Factures du périmètre (liste) + facture courante
      const f = detailStats.facture_detail.facture;
      const facturesDetail: FactureDetail[] =
        facturesListe.length > 0
          ? facturesListe.map((fa) => ({
              facture_id: fa.id,
              facture_num: fa.numero_facture,
              facture_date: String(fa.date),
              facture_statut: fa.statut,
              abo: (fa as any).abo ?? 0,
              conso: (fa as any).conso ?? 0,
              remises: (fa as any).remises ?? 0,
              achat: (fa as any).achat ?? 0,
              total_ht: (fa as any).total_ht ?? 0,
              csv_id: (fa as any).csv_id || null,
            }))
          : [
              {
                facture_id: f.id,
                facture_num: f.numero_facture,
                facture_date: String(f.date),
                facture_statut: f.statut,
                abo: f.abo,
                conso: f.conso,
                remises: f.remises,
                achat: (f as any).achat ?? 0,
                total_ht: f.total_ht,
                csv_id: f.csv_id || null,
              },
            ];
      setDetailFactures(facturesDetail);
      if (!selectedFactureId || !facturesListe.some((fa) => fa.id === selectedFactureId)) {
        setSelectedFactureId(f.id);
      }

      // 5) Résumé lignes (écarts)
      const lignesAbo = lignes.reduce((acc, l) => acc + (l.abo || 0), 0);
      const lignesConso = lignes.reduce((acc, l) => acc + (l.conso || 0), 0);
      const lignesRemises = lignes.reduce((acc, l) => acc + (l.remises || 0), 0);
      const lignesAchat = lignes.reduce((acc, l) => acc + (l.achat || 0), 0);

      if ((detailStats as any).factures_resume?.length) {
        const resumeBackend = (detailStats as any).factures_resume as FactureResumeBackend[];
        setFactureLignesResume(
          resumeBackend.map((r) => ({
            facture_id: r.facture_id,
            facture_num: r.facture_num,
            facture_date: r.facture_date,
            lignes_abo: r.abo,
            lignes_conso: r.conso,
            lignes_remises: r.remises,
            lignes_achat: r.achat,
            lignes_total_ht: r.lignes_total,
          }))
        );
      } else {
        const resumeList =
          facturesListe.length > 0
            ? facturesListe.map((fa) => {
                const isCurrent = fa.id === targetFactureId;
                const totalLignes = isCurrent
                  ? lignesAbo + lignesConso + lignesRemises + lignesAchat
                  : Number((fa as any).total_ht || 0);
                return {
                  facture_id: fa.id,
                  facture_num: fa.numero_facture,
                  facture_date: String(fa.date),
                  lignes_abo: isCurrent ? lignesAbo : Number((fa as any).abo || 0),
                  lignes_conso: isCurrent ? lignesConso : Number((fa as any).conso || 0),
                  lignes_remises: isCurrent ? lignesRemises : Number((fa as any).remises || 0),
                  lignes_achat: isCurrent ? lignesAchat : Number((fa as any).achat || 0),
                  lignes_total_ht: totalLignes,
                };
              })
            : [
                {
                  facture_id: f.id,
                  facture_num: f.numero_facture,
                  facture_date: String(f.date),
                  lignes_abo: lignesAbo,
                  lignes_conso: lignesConso,
                  lignes_remises: lignesRemises,
                  lignes_achat: lignesAchat,
                  lignes_total_ht: lignesAbo + lignesConso + lignesRemises + lignesAchat,
                },
              ];
        setFactureLignesResume(resumeList);
      }

      // 6) Meta compte (reset CSV)
      setCompteMeta({
        entreprise_id: detailStats.facture_detail.compte.entreprise_id,
        num: detailStats.facture_detail.compte.num,
      });

      // 7) Lignes précédentes (Record -> liste)
      const prevList: DetailLigne[] = Object.entries(detailStats.lignes_by_id || {}).map(([id, v]) => ({
        ligne_id: Number(id),
        ligne_facture_id: 0, // non disponible dans lignes_by_id, non utilisé pour les lignes précédentes
        ligne_num: String(id),
        ligne_nom: (v as any).nom ?? null,
        ligne_type: (v as any).ligne_type ?? 3,
        ligne_statut: (v as any).statut,
        abo: (v as any).abo ?? 0,
        conso: (v as any).conso ?? 0,
        remises: (v as any).remises ?? 0,
        achat: (v as any).achat ?? 0,
        total_ht: (v as any).total_ht ?? 0,
      }));
      setPrevLignes(prevList);
      setPrevFactures([]); // pas de données historiques dans la vue

      // 8) Groupes par type (FactureLigneGroupe)
      const groupesMap: Record<string, FactureLigneGroupe> = {};
      lignes.forEach((l) => {
        const key = `${f.id}-${l.ligne_type}`;
        if (!groupesMap[key]) {
          groupesMap[key] = {
            facture_id: f.id,
            facture_num: f.numero_facture,
            facture_date: String(f.date),
            ligne_type: l.ligne_type,
            group_key: key,
            match_type: l.ligne_type,
            match_net: 0,
            prix_abo: 0,
            count: 0,
            abo: 0,
            conso: 0,
            remises: 0,
            netAbo: 0,
            achat: 0,
          };
        }
        const g = groupesMap[key];
        g.count += 1;
        g.abo += l.abo || 0;
        g.remises += l.remises || 0;
        g.netAbo += (l.abo || 0) + (l.remises || 0);
        g.conso += l.conso || 0;
        g.achat += l.achat || 0;
      });
      const groupes = Object.values(groupesMap).map((g) => {
        const unitNet = g.count ? g.netAbo / g.count : 0;
        return { ...g, prix_abo: unitNet, match_net: unitNet };
      });
// Construit la map groupKey → ligne_facture_ids depuis lignesRaw (même logique que le backend)
      const lfIdsByGroupKey: Record<string, number[]> = {};
      lignesRaw.forEach((l) => {
        const netUnit = Number((l.abo + l.remises).toFixed(2));
        const key = l.abo_id_ref
          ? `abo|${l.abo_id_ref}|${l.ligne_type}|${netUnit.toFixed(2)}`
          : `price|${l.ligne_type}|${netUnit.toFixed(2)}`;
        if (!lfIdsByGroupKey[key]) lfIdsByGroupKey[key] = [];
        lfIdsByGroupKey[key].push(l.ligne_facture_id);
      });

      if ((detailStats as any).ligne_groupes?.length) {
        const fromBackend = (detailStats as any).ligne_groupes as BackendLigneGroupe[];
        setFactureLigneGroupes(
          fromBackend.map((g) => ({
            facture_id: g.facture_id,
            facture_num: f.numero_facture,
            facture_date: String(f.date),
            ligne_type: g.ligne_type,
            group_key: g.group_key,
            match_type: g.ligne_type,
            match_net: g.count ? g.netAbo / g.count : g.prix_abo,
            prix_abo: g.prix_abo,
            count: g.count,
            abo: g.abo,
            conso: g.conso,
            remises: g.remises,
            netAbo: g.netAbo,
            achat: g.achat,
            abo_nom: g.abo_nom_ref,
            abo_id: g.abo_id_ref,
            ligne_facture_ids: lfIdsByGroupKey[g.group_key] ?? g.ligne_facture_ids ?? [],
          }))
        );
      } else {
        setFactureLigneGroupes(groupes.map((g) => ({
          ...g,
          ligne_facture_ids: lfIdsByGroupKey[g.group_key] ?? [],
        })));
      }
    } catch (err) {
      console.error("Erreur lors du chargement des donnees detaillees", err);
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

  const typesDisponibles = Array.from(
    new Set(detailLignes.map((l) => (l.ligne_type ?? 3)))
  ).sort((a, b) => a - b);

  const sousComptesDisponiblesTab = useMemo(
    () => Array.from(new Set(detailLignes.map((l) => l.sous_compte || "__sans__"))),
    [detailLignes]
  );

  useEffect(() => {
    // Initialise ou synchronise la sélection sous-compte (onglet lignes) en fonction des données disponibles
    if (sousComptesDisponiblesTab.length === 0) {
      setSelectedSousComptesTab(new Set());
      return;
    }
    // Conserve seulement les sous-comptes encore disponibles
    const intersection = new Set<string>();
    selectedSousComptesTab.forEach((s) => {
      if (sousComptesDisponiblesTab.includes(s)) intersection.add(s);
    });
    if (intersection.size === 0) {
      setSelectedSousComptesTab(new Set(sousComptesDisponiblesTab));
    } else if (intersection.size !== selectedSousComptesTab.size) {
      setSelectedSousComptesTab(intersection);
    }
  }, [sousComptesDisponiblesTab, selectedSousComptesTab]);

  const lignesFiltrees = useMemo(() => {
    const hasTypeFilter = selectedTypes.size > 0;
    const hasSousCompteFilter = selectedSousComptesTab.size > 0;
    return detailLignes.filter((l) => {
      const matchType = hasTypeFilter ? selectedTypes.has(l.ligne_type ?? 3) : true;
      const matchSous = hasSousCompteFilter ? selectedSousComptesTab.has(l.sous_compte || "__sans__") : true;
      return matchType && matchSous;
    });
  }, [detailLignes, selectedTypes, selectedSousComptesTab]);

  const statsAffichees = statsGlobales;
  const prevStatsAffichees = prevStatsGlobales;

  const lignesGroupes: LigneGroupeSynthese[] = Object.values(
      lignesFiltrees.reduce((acc, ligne) => {
        const typeLabel = decodeLineType(ligne.ligne_type);
        const netUnit = Number(((ligne.abo || 0) + (ligne.remises || 0)).toFixed(2));
        const groupType = ligne.ligne_type ?? 3;

        // Clef de regroupement :
        // - si abonnement renseigné : grouper par abonnement + type (même mois)
        // - sinon : grouper par type + net unit identique
      const key = ligne.abo_id_ref
        ? `abo|${ligne.abo_id_ref}|${groupType}|${netUnit}`
        : `price|${groupType}|${netUnit}`;

      if (!acc[key]) {
        acc[key] = {
          type: typeLabel,
          prixAbo: netUnit,
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

  useEffect(() => {
    // Initialise le filtre type une seule fois avec tous les types presents,
    // puis ajoute uniquement les nouveaux types si besoin.
    if (!typesInitialized) {
      if (typesDisponibles.length > 0) {
        setSelectedTypes(new Set(typesDisponibles));
        setTypesInitialized(true);
      }
      return;
    }
    // Si aucun type n'est selectionne (choix utilisateur), ne pas reactiver automatiquement
    if (selectedTypes.size === 0) return;

    // Synchronise avec les types disponibles : supprime les types absents, ajoute les nouveaux
    const next = new Set<number>();
    typesDisponibles.forEach((t) => {
      if (selectedTypes.has(t)) {
        next.add(t);
      }
    });
    let updated = next.size !== selectedTypes.size;
    typesDisponibles.forEach((t) => {
      if (!next.has(t)) {
        next.add(t);
        updated = true;
      }
    });
    if (updated) setSelectedTypes(next);
  }, [typesDisponibles, typesInitialized, selectedTypes]);

  // plus de filtre sous-compte

  const facturesAvecEcart = detailFactures.map((facture) => {
    const lignes = factureLignesResume.find((fl) => fl.facture_id === facture.facture_id);
    const lignesTotal = lignes?.lignes_total_ht ?? facture.total_ht ?? 0;
    const ecart = Number(facture.total_ht || 0) - lignesTotal;
    return {
      facture_id: facture.facture_id,
      facture_num: facture.facture_num,
      facture_date: facture.facture_date,
      facture_statut: facture.facture_statut,
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

  const factureCourante = facturesAvecEcart.find((f) => f.facture_id === selectedFactureId) || null;
  const referenceInfoCourante = factureCourante ? factureReferenceInfos[factureCourante.facture_id] : undefined;
  const ligneGroupesFacture = factureLigneGroupes.filter((g) => g.facture_id === selectedFactureId);
  const resumeFacture = factureLignesResume.find((r) => r.facture_id === selectedFactureId) || null;
  const totalLignesFactureHt = resumeFacture?.lignes_total_ht || 0;
  const totalFactureHt = factureCourante ? Number(factureCourante.facture_total || 0) : 0;
  const totalFactureConso = factureCourante ? Number(factureCourante.conso || 0) : 0;
  const totalFactureRemises = factureCourante ? Number(factureCourante.remises || 0) : 0;
  const totalFactureAchat = factureCourante ? Number(factureCourante.achat || 0) : 0;
  const totalLignesHt = detailLignes.reduce((acc, l) => acc + Number(l.total_ht || 0), 0);
  const ecartGlobal = totalFactureHt - totalLignesHt;
  const totalAboBrut = lignesGroupes.reduce((acc, g) => acc + g.abo, 0);
  const totalAboNet = lignesGroupes.reduce((acc, g) => acc + g.netAbo, 0);
  const totalConsoLignes = lignesGroupes.reduce((acc, g) => acc + g.conso, 0);

  const resolvedGroupRows = useMemo(() => {
    if (!factureCourante) return [];
    const fid = factureCourante.facture_id;
    const groupStatutsMap = factureGroupStatuts[fid] || {};
    const groupCommentsMap = factureGroupComments[fid] || {};
    const lineStatuts = factureLineStatuts[fid] || {};
    const anomaliesMap = factureGroupAnomalies[fid] || {};
    const aboSelectMap = factureGroupAbonnements[fid] || {};

    const worstCase = (vals: string[]): StatutValeur => {
      if (vals.includes("conteste")) return "conteste";
      if (vals.includes("a_verifier")) return "a_verifier";
      return "valide";
    };

    const COMMENT_THRESHOLD = 5;

    return ligneGroupesFacture
      .filter((g) => g.facture_id === fid)
      .map((g) => {
        const explicitStat = groupStatutsMap[g.group_key];
        const explicitComment = groupCommentsMap[g.group_key] || {};
        const lfIds: number[] = (g as any).ligne_facture_ids || [];
        const lineData = lfIds.map((id) => lineStatuts[id]).filter(Boolean);

        const fallbackAboNetStatut = lineData.length > 0
          ? worstCase(lineData.map((s) => s.aboNet))
          : "a_verifier";
        const fallbackAchatStatut = lineData.length > 0
          ? worstCase(lineData.map((s) => s.achat))
          : "a_verifier";

        const commentCounts: Record<string, number> = {};
        lineData.forEach((s) => {
          if (s.comment) commentCounts[s.comment] = (commentCounts[s.comment] || 0) + 1;
        });
        const fallbackAboNetComment = Object.entries(commentCounts)
          .map(([text, count]) => (count > COMMENT_THRESHOLD ? `${count} lignes: ${text}` : text))
          .join("\n") || undefined;
        const aboNetStatut = explicitStat?.aboNet ?? fallbackAboNetStatut;
        const achatStatut = explicitStat?.achat ?? fallbackAchatStatut;
        const aboNetComment = explicitComment.aboNet ?? fallbackAboNetComment;
        const achatComment = explicitComment.achat ?? undefined;

        return {
          key: g.group_key,
          group: { ...g, netUnit: g.count ? (g.netAbo || 0) / g.count : 0 },
          stat: { aboNet: aboNetStatut, achat: achatStatut },
          comment: { aboNet: aboNetComment, achat: achatComment },
          anomalies: anomaliesMap[g.group_key] || [],
          aboSelection: aboSelectMap[g.group_key],
        };
      });
  }, [
    factureCourante,
    factureGroupStatuts,
    factureGroupComments,
    factureLineStatuts,
    factureGroupAnomalies,
    factureGroupAbonnements,
    ligneGroupesFacture,
  ]);

  const modalGroupKey = aboModal.groupKey;
  function parseGroupKey(key: string | null) {
    if (!key) return { groupType: null as number | null, targetNet: null as number | null, aboId: null as number | null };
    const parts = key.split("|");
    if (parts[0] === "abo") {
      const aboId = Number(parts[1]);
      const groupType = parts.length >= 3 ? Number(parts[2]) : null;
      const targetNet = parts.length >= 4 ? Number(parts[3]) : null;
      return {
        groupType: Number.isFinite(groupType) ? groupType : null,
        targetNet: Number.isFinite(targetNet) ? targetNet : null,
        aboId: Number.isFinite(aboId) ? aboId : null,
      };
    }
    if (parts[0] === "price") {
      const groupType = Number(parts[1]);
      const targetNet = Number(parts[2]);
      return {
        groupType: Number.isFinite(groupType) ? groupType : null,
        targetNet: Number.isFinite(targetNet) ? targetNet : null,
        aboId: null,
      };
    }
    return { groupType: null, targetNet: null, aboId: null };
  }

  const modalGroup =
    modalGroupKey && selectedFactureId
      ? ligneGroupesFacture.find((g) => g.group_key === modalGroupKey && g.facture_id === selectedFactureId) || null
      : null;
  const modalSelection =
    modalGroupKey && selectedFactureId ? factureGroupAbonnements[selectedFactureId]?.[modalGroupKey] : undefined;
  const modalDefaultPrice = modalGroup ? Number((modalGroup.count ? modalGroup.netAbo / modalGroup.count : modalGroup.netAbo || 0).toFixed(2)) : 0;

  async function persistAbonnementForGroup(groupKey: string, overrideLineIds: number[] = []) {
    if (!selectedFactureId) return;
    const selection = factureGroupAbonnements[selectedFactureId]?.[groupKey];
    const group = ligneGroupesFacture.find((g) => g.group_key === groupKey);
    const parsed = parseGroupKey(groupKey);
    const groupType = group?.match_type ?? parsed.groupType;
    const targetNet = group?.match_net ?? parsed.targetNet;
    if (!selection) {
      alert("Choisis d'abord un abonnement.");
      return;
    }
    if (groupType === null || targetNet === null) {
      alert("Impossible de determiner le groupe.");
      return;
    }

    let lineIds: number[] = overrideLineIds;
    if (!lineIds || lineIds.length === 0) {
      let lignesFacture: any[] = [];
      try {
        lignesFacture = await listLignesFactures({ facture_id: selectedFactureId });
      } catch (err) {
        console.error("Impossible de recuperer les lignes de la facture", err);
        alert((err as Error).message || "Impossible de charger les lignes de la facture");
        return;
      }

      lineIds = lignesFacture
        .filter((lf) => {
          const type = editedTypes[lf.ligne_id];
          if (type === undefined || type === null) return false;
          const netVal = Number((Number(lf.abo || 0) + Number(lf.remises || 0)).toFixed(2));
          return type === groupType && netVal === Number(targetNet.toFixed(2));
        })
        .map((lf) => lf.ligne_id);
    }

    if (lineIds.length === 0) {
      alert("Aucune ligne correspondante trouvee pour ce groupe.");
      return;
    }

    if (selection.mode === "existing" && !selection.abonnementId) {
      alert("Selectionne un abonnement existant ou saisis un nouveau nom.");
      return;
    }
    if (selection.mode === "new" && !selection.nom) {
      alert("Le nom du nouvel abonnement est requis.");
      return;
    }

    const cleanNom = (selection.nom || "").trim();
    const prixNumber = Number(selection.prix ?? targetNet);
    const payload: any = {
      ligne_ids: lineIds,
      date: factureCourante?.facture_date ? factureCourante.facture_date.slice(0, 10) : undefined,
      prix: Number.isFinite(prixNumber) ? prixNumber : undefined,
      commentaire: selection.commentaire?.trim() || undefined,
    };
    if (selection.mode === "existing" && selection.abonnementId) {
      payload.abonnement_id = selection.abonnementId;
    } else if (selection.mode === "new" && cleanNom) {
      payload.nom = cleanNom;
    }

    try {
      setAboModalSaving(true);
      const resp = await attachAbonnementToLines(payload);
      if (!resp || !resp.abonnement || typeof resp.abonnement.id === "undefined") {
        throw new Error("Réponse attachement abonnement invalide");
      }
      const newKey = `abo|${resp.abonnement.id}|${groupType ?? ""}|${(targetNet ?? 0).toFixed(2)}`;
      setAbonnements((prev) => {
        const existing = prev.find((a) => a.id === resp.abonnement.id);
        if (existing) {
          return prev.map((a) => (a.id === resp.abonnement.id ? resp.abonnement : a));
        }
        return [...prev, resp.abonnement].sort((a, b) => a.nom.localeCompare(b.nom));
      });
      setFactureGroupAbonnements((prev) => ({
        ...prev,
        [selectedFactureId]: {
          ...(prev[selectedFactureId] || {}),
          // on stocke aussi sous la nouvelle cle pour rester coherent avec le regroupement DB
          [groupKey]: {
            mode: "existing",
            abonnementId: resp.abonnement.id,
            nom: resp.abonnement.nom,
            prix: resp.abonnement.prix,
            commentaire: resp.abonnement.commentaire ?? null,
          },
          [newKey]: {
            mode: "existing",
            abonnementId: resp.abonnement.id,
            nom: resp.abonnement.nom,
            prix: resp.abonnement.prix,
            commentaire: resp.abonnement.commentaire ?? null,
          },
        },
      }));
      setFactureLigneGroupes((prev) =>
        prev.map((g) => {
          if (g.facture_id === selectedFactureId && g.group_key === groupKey) {
            const sameNet = Number((g.match_net || 0).toFixed(2)) === Number((targetNet ?? 0).toFixed(2));
            return {
              ...g,
              group_key: sameNet ? newKey : g.group_key,
              abo_nom: resp.abonnement.nom,
              abo_id: resp.abonnement.id,
            };
          }
          return g;
        })
      );
      if (!group) {
        // Injecte un groupe synthetique pour coherence locale
        setFactureLigneGroupes((prev) => [
          ...prev,
          {
            facture_id: selectedFactureId,
            facture_num: "",
            facture_date: factureCourante?.facture_date || "",
            ligne_type: groupType ?? 3,
            group_key: newKey,
            match_type: groupType ?? 3,
            match_net: targetNet ?? 0,
            prix_abo: targetNet ?? 0,
            count: lineIds.length,
            abo: 0,
            conso: 0,
            remises: 0,
            netAbo: (targetNet ?? 0) * lineIds.length,
            achat: 0,
            abo_nom: resp.abonnement.nom,
            abo_id: resp.abonnement.id,
          },
        ]);
      }
      // Rafraichit immediatement la colonne "Abonnement (ref)" pour les lignes concernees
      setDetailLignes((prev) =>
        prev.map((l) =>
          lineIds.includes(l.ligne_id)
            ? {
                ...l,
                abo_id_ref: resp.abonnement.id,
                abo_nom_ref: resp.abonnement.nom,
                abo_prix_ref: resp.abonnement.prix,
              }
            : l
        )
      );
      // Recharge les donnees pour synchroniser onglet Rapport et Detail lignes avec la base
      const currentFactureId = selectedFactureId;
      await loadData();
      if (currentFactureId) {
        setSelectedFactureId(currentFactureId);
      }
      alert("Abonnement enregistre pour ce groupe.");
    } catch (err) {
      console.error("Erreur attachement abonnement", err);
      alert((err as Error).message || "Impossible d'attacher l'abonnement");
    } finally {
      setAboModalSaving(false);
    }
  }

  useEffect(() => {
    // Selection par defaut de la premiere facture du mois des que les donnees sont chargees
    if (selectedFactureId === null && detailFactures.length > 0) {
      setSelectedFactureId(detailFactures[0].facture_id);
    }
  }, [detailFactures, selectedFactureId]);

  useEffect(() => {
    async function fetchRapport() {
      if (!selectedFactureId) return;
      try {
        const rapport = await getFactureRapport(selectedFactureId);
        if (rapport) {
          setFactureCommentaires((prev) => ({ ...prev, [selectedFactureId]: rapport.commentaire || "" }));
          const data = rapport.data || {};
          const mappedGroups = mapGroupsToLegacyMaps(
            data.groups,
            data.groupStatuts || {},
            data.groupComments || {},
            data.groupAnomalies || {}
          );
          if (data.metricStatuts) {
            setFactureStatuts((prev) => ({ ...prev, [selectedFactureId]: data.metricStatuts }));
          }
          setFactureGroupStatuts((prev) => ({ ...prev, [selectedFactureId]: mappedGroups.groupStatuts }));
          if (data.metricComments) {
            setFactureMetricComments((prev) => ({ ...prev, [selectedFactureId]: data.metricComments }));
          }
          setFactureGroupComments((prev) => ({ ...prev, [selectedFactureId]: mappedGroups.groupComments }));
          if (data.metricReals) {
            setFactureMetricReals((prev) => ({ ...prev, [selectedFactureId]: data.metricReals }));
          }
          if (data.groupReals) {
            setFactureGroupReals((prev) => ({ ...prev, [selectedFactureId]: data.groupReals }));
          }
          setFactureGroupAnomalies((prev) => ({ ...prev, [selectedFactureId]: mappedGroups.groupAnomalies }));
          if (data.lineStatuts) {
            setFactureLineStatuts((prev) => ({ ...prev, [selectedFactureId]: data.lineStatuts }));
          }
          if (data.groupAbonnements) {
            setFactureGroupAbonnements((prev) => ({ ...prev, [selectedFactureId]: data.groupAbonnements }));
          }
          if (data.referenceInfo) {
            setFactureReferenceInfos((prev) => ({
              ...prev,
              [selectedFactureId]: data.referenceInfo,
            }));
          }
        }
      } catch (err) {
        console.error("Erreur chargement rapport", err);
      }
    }
    fetchRapport();
  }, [selectedFactureId]);

  useEffect(() => {
    let cancelled = false;
    async function fetchFactureAbonnements() {
      if (!selectedFactureId) return;
      try {
        const links = await getFactureAbonnements(selectedFactureId);
        if (cancelled || !links) return;
        const autoSelection: Record<string, AbonnementSelection> = {};
        links.forEach((link) => {
          const key = link.abonnement?.id
            ? `abo|${link.abonnement.id}`
            : `price|${link.ligne_type}|${Number(link.prix_abo || 0).toFixed(2)}`;
          const existing = autoSelection[key];
          const selection: AbonnementSelection = {
            mode: "existing",
            abonnementId: link.abonnement?.id || null,
            nom: link.abonnement?.nom || null,
            prix: link.abonnement?.prix ?? link.prix_abo,
            commentaire: link.abonnement?.commentaire ?? null,
          };
          if (!existing) {
            autoSelection[key] = selection;
          } else if (existing.abonnementId !== selection.abonnementId) {
            autoSelection[key] = { ...existing, abonnementId: null }; // valeurs mixtes, on ne pre-remplit pas
          }
        });
        setFactureGroupAbonnements((prev) => {
          const prevForFacture = prev[selectedFactureId] || {};
          const merged = { ...prevForFacture };
          Object.entries(autoSelection).forEach(([k, v]) => {
            if (!merged[k]) merged[k] = v;
          });
          return { ...prev, [selectedFactureId]: merged };
        });
      } catch (err) {
        console.error("Erreur chargement abonnements facture", err);
      }
    }
    fetchFactureAbonnements();
    return () => {
      cancelled = true;
    };
  }, [selectedFactureId]);

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
    const resolvedCurrent = resolvedGroupRows.find((row) => row.key === groupKey)?.stat || {
      aboNet: "a_verifier",
      achat: "a_verifier",
    };
    setFactureGroupStatuts((prev) => ({
      ...prev,
      [factureId]: {
        ...(prev[factureId] || {}),
        [groupKey]: {
          ...(prev[factureId]?.[groupKey] || resolvedCurrent),
          [key]: value,
        },
      },
    }));

// Propage le statut aux lignes du groupe via ligne_facture_ids
    const group = ligneGroupesFacture.find((g) => g.facture_id === factureId && g.group_key === groupKey);
    const lfIds: number[] = group?.ligne_facture_ids ?? [];

    if (lfIds.length > 0) {
      setFactureLineStatuts((prev) => {
        const current = prev[factureId] || {};
        const updated = { ...current };
        lfIds.forEach((id) => {
          updated[id] = {
            ...(current[id] || resolvedCurrent),
            [key]: value,
          };
        });
        return { ...prev, [factureId]: updated };
      });
    }

    if (key === "aboNet") {
      applyGroupStatutToLines(factureId, groupKey, value).catch((err) => {
        console.error("Erreur maj statut lignesFactures", err);
      });
    }
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

  function updateGroupAbonnement(factureId: number, groupKey: string, update: Partial<AbonnementSelection>) {
    setFactureGroupAbonnements((prev) => ({
      ...prev,
      [factureId]: {
        ...(prev[factureId] || {}),
        [groupKey]: {
          ...(prev[factureId]?.[groupKey] || {}),
          mode: update.mode ?? prev[factureId]?.[groupKey]?.mode ?? "existing",
          ...update,
        },
      },
    }));
  }


  const statutToCode: Record<StatutValeur, number> = { a_verifier: 0, valide: 1, conteste: 2 };

  function openAboModal(
    groupKey: string,
    lineIds: number[] = [],
    prefill?: { aboId?: number | null; nom?: string | null; prix?: number | null }
  ) {
    if (selectedFactureId) {
      const group = ligneGroupesFacture.find((g) => g.group_key === groupKey);
      const current = factureGroupAbonnements[selectedFactureId]?.[groupKey];

      const applyPrefill = () => {
        if (prefill?.aboId) {
          updateGroupAbonnement(selectedFactureId, groupKey, {
            mode: "existing",
            abonnementId: prefill.aboId,
            nom: prefill.nom ?? "",
            prix: prefill.prix ?? undefined,
          });
          return true;
        }
        return false;
      };

      const hasPrefill = applyPrefill();

      if (!hasPrefill && !current) {
        if (group?.abo_id && group.abo_nom) {
          updateGroupAbonnement(selectedFactureId, groupKey, {
            mode: "existing",
            abonnementId: group.abo_id,
            nom: group.abo_nom,
            prix: group.match_net,
          });
        } else if (group) {
          updateGroupAbonnement(selectedFactureId, groupKey, {
            mode: "new",
            abonnementId: null,
            nom: "",
            prix: group.match_net,
          });
        } else {
          const { groupType, targetNet, aboId } = parseGroupKey(groupKey);
          if (aboId) {
            updateGroupAbonnement(selectedFactureId, groupKey, {
              mode: "existing",
              abonnementId: aboId,
              prix: targetNet ?? undefined,
            });
          } else {
            updateGroupAbonnement(selectedFactureId, groupKey, {
              mode: "new",
              abonnementId: null,
              nom: "",
              prix: targetNet ?? undefined,
            });
          }
        }
      }
    }
    setAboModal({ open: true, groupKey, lineIds });
  }

  function openAboFromLine(ligne: DetailLigne) {
    const currentType = editedTypes[ligne.ligne_id] ?? ligne.ligne_type ?? 3;
    const netVal = Number((Number(ligne.abo || 0) + Number(ligne.remises || 0)).toFixed(2));
    const candidate =
      ligneGroupesFacture.find(
        (g) =>
          g.match_type === currentType &&
          Number((g.match_net || 0).toFixed(2)) === Number(netVal.toFixed(2))
      ) || null;
    const key = candidate
      ? candidate.group_key
      : ligne.abo_id_ref
      ? `abo|${ligne.abo_id_ref}|${currentType}|${netVal.toFixed(2)}`
      : `price|${currentType}|${netVal.toFixed(2)}`;
    openAboModal(
      key,
      [ligne.ligne_id],
      ligne.abo_id_ref || ligne.abo_nom_ref
        ? {
            aboId: ligne.abo_id_ref ?? undefined,
            nom: ligne.abo_nom_ref ?? undefined,
            prix: ligne.abo_prix_ref ?? undefined,
          }
        : undefined
    );
  }

  function closeAboModal() {
    setAboModal({ open: false, groupKey: null, lineIds: [] });
  }


  async function applyGroupStatutToLines(factureId: number, groupKey: string, value: StatutValeur) {
    const group = ligneGroupesFacture.find((g) => g.group_key === groupKey);
    const groupType = group?.match_type ?? null;
    const targetNet = group?.match_net ?? null;
    if (groupType === null || targetNet === null) return;
    try {
      const lignes = await listLignesFactures({ facture_id: factureId });
      const toUpdate = lignes.filter((lf) => {
        const type = editedTypes[lf.ligne_id];
        if (type === undefined || type === null) return false;
        const net = Number((Number(lf.abo || 0) + Number(lf.remises || 0)).toFixed(2));
        return type === groupType && net === Number(targetNet.toFixed(2));
      });
      await Promise.all(
        toUpdate.map((lf) =>
          updateLigneFacture(lf.id, {
            statut: statutToCode[value],
          })
        )
      );
    } catch (err) {
      console.error("Impossible de mettre a jour le statut des lignesFactures du groupe", err);
    }
  }

  async function saveRapport() {
    if (!selectedFactureId) return;
    console.log("[RAPPORT][SAVE][START]", { factureId: selectedFactureId });
    const groupAbos = factureGroupAbonnements[selectedFactureId] || {};
    const groupStatuts = factureGroupStatuts[selectedFactureId] || {};
    const contestedGroups = Object.entries(groupStatuts).filter(([, stat]) => stat.aboNet === "conteste");
    const attachedSelections: Record<string, AbonnementSelection> = {};

    if (contestedGroups.length > 0) {
      let lignesFacture: any[] = [];
      try {
        lignesFacture = await listLignesFactures({ facture_id: selectedFactureId });
      } catch (err) {
        console.error("Impossible de recuperer les lignes de la facture", err);
        alert((err as Error).message || "Impossible de charger les lignes de la facture");
        return;
      }
      // Contestation : on attache un abonnement uniquement si une sélection est fournie; sinon on laisse vide.
      for (const [groupKey] of contestedGroups) {
        const selection = groupAbos[groupKey];
        if (!selection) continue;
        const group = ligneGroupesFacture.find((g) => g.group_key === groupKey);
        const groupType = group?.match_type ?? null;
        const targetNet = group?.match_net ?? null;
        if (groupType === null || targetNet === null) continue;
        const lineIds = lignesFacture
          .filter((lf) => {
            const type = editedTypes[lf.ligne_id];
            if (type === undefined || type === null) return false;
            const netVal = Number((Number(lf.abo || 0) + Number(lf.remises || 0)).toFixed(2));
            return type === groupType && Number(netVal.toFixed(2)) === Number(targetNet.toFixed(2));
          })
          .map((lf) => lf.ligne_id);

        if (lineIds.length === 0) continue;
        const attachPayload = {
          ligne_ids: lineIds,
          date: factureCourante?.facture_date || undefined,
          prix: selection.prix ?? targetNet,
          commentaire: selection.commentaire ?? undefined,
        } as any;

        if (selection.mode === "existing" && selection.abonnementId) {
          attachPayload.abonnement_id = selection.abonnementId;
        } else if (selection.mode === "new" && selection.nom) {
          attachPayload.nom = selection.nom;
        }
        // si aucune info abo, on laisse le groupe contesté sans attachement
        if (!attachPayload.abonnement_id && !attachPayload.nom) {
          continue;
        }

        try {
          const resp = await attachAbonnementToLines(attachPayload);
          attachedSelections[groupKey] = {
            mode: "existing",
            abonnementId: resp.abonnement.id,
            nom: resp.abonnement.nom,
            prix: resp.abonnement.prix,
            commentaire: resp.abonnement.commentaire ?? null,
          };
          setAbonnements((prev) => {
            const existing = prev.find((a) => a.id === resp.abonnement.id);
            if (existing) {
              return prev.map((a) => (a.id === resp.abonnement.id ? resp.abonnement : a));
            }
            return [...prev, resp.abonnement].sort((a, b) => a.nom.localeCompare(b.nom));
          });
        } catch (err) {
          console.error("Erreur attachement abonnement", err);
          alert((err as Error).message || "Impossible d'attacher l'abonnement aux lignes");
          return;
        }
      }

      if (Object.keys(attachedSelections).length > 0) {
        setFactureGroupAbonnements((prev) => ({
          ...prev,
          [selectedFactureId]: { ...(prev[selectedFactureId] || {}), ...attachedSelections },
        }));
      }
    }

    const finalGroupAbonnements = { ...groupAbos, ...attachedSelections };
    const groupsPayload = resolvedGroupRows.map((row) => ({
      groupKey: row.key,
      ligneFactureIds: (row.group as any).ligne_facture_ids || [],
      statut: {
        aboNet: row.stat?.aboNet || "a_verifier",
        achat: row.stat?.achat || "a_verifier",
      },
      comments: {
        aboNet: row.comment?.aboNet,
        achat: row.comment?.achat,
      },
      anomalies: row.anomalies || [],
    }));
    const payload = {
      facture_id: selectedFactureId,
      commentaire: factureCommentaires[selectedFactureId] || null,
      data: {
        metricStatuts: { ecart: factureStatuts[selectedFactureId]?.ecart || "a_verifier" },
        groups: groupsPayload,
        groupStatuts: factureGroupStatuts[selectedFactureId] || {},
        groupComments: factureGroupComments[selectedFactureId] || {},
        lineStatuts: factureLineStatuts[selectedFactureId] || {},
        metricComments: factureMetricComments[selectedFactureId] || {},
        metricReals: factureMetricReals[selectedFactureId] || {},
        groupReals: factureGroupReals[selectedFactureId] || {},
        groupAnomalies: factureGroupAnomalies[selectedFactureId] || {},
        groupAbonnements: finalGroupAbonnements,
        referenceInfo: factureReferenceInfos[selectedFactureId] || null,
      },
    };
    try {
      console.log("[RAPPORT][SAVE][UPSERT_PAYLOAD]", payload);
      await upsertFactureRapport(payload);
      // Determine statut facture: conteste > valide > importe
      // Les statuts globaux: on ne prend en compte que l'ecart (aboNet/achat sont geres par groupe)
      const ecartStatut = factureStatuts[selectedFactureId]?.ecart || "a_verifier";
      const lineStatutsForFact = Object.values(factureLineStatuts[selectedFactureId] || {});

      const hasConteste =
        ecartStatut === "conteste" ||
        lineStatutsForFact.some((l) => l.aboNet === "conteste" || l.achat === "conteste");

      const hasPending =
        ecartStatut === "a_verifier" ||
        lineStatutsForFact.some((l) => l.aboNet === "a_verifier" || l.achat === "a_verifier");

      const allValide = !hasConteste && !hasPending;

      // Codes statut alignes backend: 0=importe,1=valide,2=conteste
      let newStatut: number | null = null;
      if (hasConteste) newStatut = 2;
      else if (allValide) newStatut = 1;
      else newStatut = 0;

      if (newStatut !== null) {
        // On ne pousse plus le statut au backend ici : le backend recalcule et applique le statut à partir des lignes/rapport.
        const statMapRaw = factureGroupStatuts[selectedFactureId] || {};
        const normalizeGroupKey = (key: string) => {
          if (key.startsWith("price|") || key.startsWith("abo|")) return key;
          const parts = key.split("|");
          if (parts.length === 2) {
            const [type, net] = parts;
            return `price|${type}|${Number(net).toFixed(2)}`;
          }
          return key;
        };
        // Les statuts de regroupement seront appliqués côté backend (upsert rapport)
        // Recharge les donnees pour refleter le nouveau statut
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
      alert("Rapport enregistre");
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
      alert((err as Error).message || "Erreur lors de la mise a jour du type");
    } finally {
      setSavingType(null);
    }
  }

  async function resetFromCsv() {
    if (!factureCourante?.csv_id) {
      alert("Aucun CSV associe a cette facture.");
      return;
    }
    try {
      setResetLoading(true);
      const entrepriseId = compteMeta?.entreprise_id;
      const compteNumDb = compteMeta?.num;
      if (!entrepriseId || !compteNumDb) {
        alert("Impossible de trouver l'entreprise ou le compte pour ce reset CSV.");
        return;
      }
      const csvText = await fetchUploadContent(factureCourante.csv_id);
      const file = new File([csvText], `${factureCourante.facture_num || "facture"}.csv`, { type: "text/csv" });
      await importCSV(file, entrepriseId, undefined, new Set([compteNumDb || compteNum]));
      await loadData();
      alert("Reset CSV termine : donnees re-analysees pour ce compte.");
    } catch (err) {
      console.error("Reset CSV error", err);
      alert("Reset CSV impossible : " + (err as Error).message);
    } finally {
      setResetLoading(false);
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
          width: dialogWidth,
          maxWidth: dialogMaxWidth,
          maxHeight: dialogMaxHeight,
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
              padding: "0.5rem 0.7rem",
              cursor: "pointer",
              boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
              fontWeight: 700,
              fontSize: "1.1rem",
            }}
          aria-label="Precedent"
        >
          {"<"}
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
              padding: "0.5rem 0.7rem",
              cursor: "pointer",
              boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
              fontWeight: 700,
              fontSize: "1.1rem",
            }}
          aria-label="Suivant"
        >
          {">"}
          </button>
        )}

      {ligneModalId !== null && <LigneInsightModal ligneId={ligneModalId} onClose={() => setLigneModalId(null)} />}

        {/* Header */}
        <div
          style={{
            padding: blockPadding,
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
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
              padding: `${tabPaddingY} ${tabPaddingX}`,
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
              padding: `${tabPaddingY} ${tabPaddingX}`,
              border: "none",
              background: activeTab === "factures" ? "white" : "transparent",
              borderBottom: activeTab === "factures" ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: activeTab === "factures" ? "600" : "normal",
              color: activeTab === "factures" ? "#3b82f6" : "#6b7280",
            }}
          >
            Detail par factures
          </button>
          <button
            onClick={() => setActiveTab("lignes")}
            style={{
              padding: `${tabPaddingY} ${tabPaddingX}`,
              border: "none",
              background: activeTab === "lignes" ? "white" : "transparent",
              borderBottom: activeTab === "lignes" ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: activeTab === "lignes" ? "600" : "normal",
              color: activeTab === "lignes" ? "#3b82f6" : "#6b7280",
            }}
          >
            Detail par ligne
          </button>
          <button
            onClick={() => setActiveTab("rapport")}
            style={{
              padding: `${tabPaddingY} ${tabPaddingX}`,
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
        <div style={{ padding: blockPadding, overflow: "auto", flex: 1 }}>
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

                  {/* Graphique de repartition (simple) */}
                  <div>
                    <h3 style={{ marginBottom: "1rem" }}>Repartition</h3>
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
              {/* TAB: Detail par facture */}
              {activeTab === "factures" && (
                <div>
                  <h3 style={{ marginBottom: "1rem" }}>
                    {detailFactures.length} facture(s)
                  </h3>
                  <div style={{ overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                          <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Numero</th>
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
                                  <StatutBadge value={statutIntToValeur(facture.facture_statut)} />
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
                              Aucune facture pour ce perimetre.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB: Detail par ligne */}
              {activeTab === "lignes" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                      <h3 style={{ margin: 0 }}>
                        {lignesFiltrees.length} ligne(s) telecom
                        {selectedTypes.size === typesDisponibles.length && selectedSousComptesTab.size === sousComptesDisponiblesTab.length
                          ? ""
                          : ` / ${detailLignes.length}`}
                      </h3>
                      <div style={{ position: "relative" }}>
                        <button
                          className="secondary-button"
                          style={{ padding: "0.3rem 0.55rem", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                          onClick={() => setSousCompteTabOpen((prev) => !prev)}
                        >
                          Sous-compte
                          {selectedSousComptesTab.size > 0 && selectedSousComptesTab.size < sousComptesDisponiblesTab.length && (
                            <span style={{ background: "#e0f2fe", color: "#0369a1", padding: "0.05rem 0.4rem", borderRadius: "999px", fontWeight: 700 }}>
                              {selectedSousComptesTab.size}/{sousComptesDisponiblesTab.length}
                            </span>
                          )}
                        </button>
                        {sousCompteTabOpen && (
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 0.4rem)",
                              left: 0,
                              background: "white",
                              border: "1px solid #e5e7eb",
                              borderRadius: "0.5rem",
                              boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
                              padding: "0.65rem",
                              zIndex: 20,
                              minWidth: "220px",
                            }}
                          >
                            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.45rem", flexWrap: "wrap" }}>
                              <button
                                className="secondary-button"
                                style={{ padding: "0.3rem 0.55rem", fontWeight: 600 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSousComptesTab(new Set(sousComptesDisponiblesTab));
                                }}
                              >
                                Tout
                              </button>
                              <button
                                className="secondary-button"
                                style={{ padding: "0.3rem 0.55rem", fontWeight: 600 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSousComptesTab(new Set());
                                }}
                              >
                                Aucun
                              </button>
                            </div>
                            <div style={{ display: "grid", gap: "0.35rem", maxHeight: "220px", overflowY: "auto" }}>
                              {sousComptesDisponiblesTab.map((s) => {
                                const checked = selectedSousComptesTab.has(s);
                                const label = s === "__sans__" ? "Sans sous-compte" : s;
                                return (
                                  <label key={`souscompte-tab-${s}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        setSelectedSousComptesTab((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(s)) next.delete(s);
                                          else next.add(s);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span>{label}</span>
                                  </label>
                                );
                              })}
                              {sousComptesDisponiblesTab.length === 0 && <span style={{ color: "#9ca3af" }}>Aucun sous-compte</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
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
                        Numero {ligneSort?.field === "ligne_num" ? (ligneSort.direction === "asc" ? "?" : "?") : ""}
                      </th>
                      <th
                        style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600", cursor: "pointer", minWidth: "180px" }}
                        onClick={() =>
                          setLigneSort((prev) =>
                            prev?.field === ("nom" as keyof DetailLigne)
                              ? { field: "nom" as keyof DetailLigne, direction: prev.direction === "asc" ? "desc" : "asc" }
                              : { field: "nom" as keyof DetailLigne, direction: "asc" }
                          )
                        }
                      >
                        Nom de la ligne {ligneSort?.field === ("nom" as keyof DetailLigne) ? (ligneSort.direction === "asc" ? "?" : "?") : ""}
                      </th>
                      <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600", position: "relative", minWidth: "180px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span>Type</span>
                          <button
                            className="secondary-button"
                            style={{ padding: "0.15rem 0.4rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.2rem" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setTypeFilterOpen((prev) => !prev);
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>⏷</span>
                          </button>
                        </div>
                        {typeFilterOpen && (
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 0.35rem)",
                              left: 0,
                              background: "white",
                              border: "1px solid #e5e7eb",
                              borderRadius: "0.5rem",
                              boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
                              padding: "0.75rem",
                              zIndex: 25,
                              minWidth: "220px",
                            }}
                          >
                            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                              <button
                                className="secondary-button"
                                style={{ padding: "0.3rem 0.55rem", fontWeight: 600 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTypes(new Set(typesDisponibles));
                                }}
                              >
                                Tout
                              </button>
                              <button
                                className="secondary-button"
                                style={{ padding: "0.3rem 0.55rem", fontWeight: 600 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTypes(new Set());
                                }}
                              >
                                Aucun
                              </button>
                            </div>
                            <div style={{ display: "grid", gap: "0.35rem" }}>
                              {typesDisponibles.map((t) => {
                                const checked = selectedTypes.has(t);
                                return (
                                  <label key={`type-filter-${t}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        setSelectedTypes((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(t)) next.delete(t);
                                          else next.add(t);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span>{decodeLineType(t)}</span>
                                  </label>
                                );
                              })}
                              {typesDisponibles.length === 0 && <span style={{ color: "#9ca3af" }}>Aucun type disponible</span>}
                            </div>
                          </div>
                        )}
                      </th>
                      <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Statut</th>
                      <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Abonnement (ref)</th>
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
                        {([...lignesFiltrees]
                          .sort((a, b) => {
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
                          <td
                            style={{ padding: "0.75rem", fontWeight: "500", cursor: "pointer", color: "#0f172a" }}
                            onClick={() => setLigneModalId(ligne.ligne_id)}
                          >
                            {ligne.ligne_num}
                          </td>
                            <td style={{ padding: "0.75rem", color: "#4b5563", fontSize: "0.9rem" }}>
                              {ligne.ligne_nom || "—"}
                            </td>
                            <td style={{ padding: "0.75rem", color: "#6b7280", fontSize: "0.875rem" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                {(() => {
                                  const baseTypes = [0, 1, 2, 3];
                                  const currentType = editedTypes[ligne.ligne_id] ?? ligne.ligne_type ?? 3;
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
                            <td style={{ padding: "0.75rem" }}><StatutBadge value={statutIntToValeur(ligne.ligne_statut)} /></td>
                            <td
                              style={{ padding: "0.75rem", color: "#0f172a", cursor: "pointer" }}
                              onClick={() => openAboFromLine(ligne)}
                              title="Choisir / modifier l'abonnement"
                            >
                              <div style={{ fontWeight: 700 }}>{ligne.abo_nom_ref || "Non renseigne"}</div>
                              <div style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                                {ligne.abo_prix_ref !== null && ligne.abo_prix_ref !== undefined
                                  ? `${Number(ligne.abo_prix_ref || 0).toFixed(2)} €`
                                  : ""}
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
                        {lignesFiltrees.length > 0 && (
                          <tr style={{ background: "#f9fafb", fontWeight: 700 }}>
                            <td style={{ padding: "0.65rem" }} colSpan={5}>
                              Total affiché
                            </td>
                            <td style={{ padding: "0.65rem", textAlign: "right" }}>
                              {lignesFiltrees.reduce((acc, l) => acc + Number(l.abo || 0), 0).toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.65rem", textAlign: "right" }}>
                              {lignesFiltrees.reduce((acc, l) => acc + Number(l.conso || 0), 0).toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.65rem", textAlign: "right" }}>
                              {lignesFiltrees.reduce((acc, l) => acc + Number(l.remises || 0), 0).toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.65rem", textAlign: "right" }}>
                              {lignesFiltrees.reduce((acc, l) => acc + Number(l.achat || 0), 0).toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.65rem", textAlign: "right" }}>
                              {lignesFiltrees.reduce((acc, l) => acc + Number(l.total_ht || 0), 0).toFixed(2)} €
                            </td>
                            <td />
                          </tr>
                        )}
                        {lignesFiltrees.length === 0 && (
                          <tr>
                            <td colSpan={8} style={{ padding: "1rem", textAlign: "center", color: "#6b7280" }}>
                              Aucune ligne a afficher avec ce filtre.
                              {typesDisponibles.length > 0 && (
                                <div style={{ marginTop: "0.5rem" }}>
                                  <button
                                    className="secondary-button"
                                    style={{ padding: "0.4rem 0.75rem", fontWeight: 600 }}
                                    onClick={() => {
                                      setSelectedTypes(new Set(typesDisponibles));
                                      setTypeFilterOpen(true);
                                    }}
                                  >
                                    Reactiver tous les types
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
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
                        title="Reduire la liste"
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
                        <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>{facturesAvecEcart.length} elements</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                        {facturesAvecEcart.map((f) => {
                          const isActive = f.facture_id === selectedFactureId;
                          const statusColor = STATUS_COLORS[f.facture_statut as 0 | 1 | 2] || STATUS_COLORS[0];
                          return (
                            <button
                              key={f.facture_id}
                              onClick={() => setSelectedFactureId(f.facture_id)}
                              style={{
                                textAlign: "left",
                                padding: "0.55rem 0.7rem",
                                borderRadius: "0.55rem",
                                border: isActive ? `1px solid ${statusColor}` : `1px solid ${statusColor}66`,
                                background: isActive ? `${statusColor}2A` : `${statusColor}14`,
                                cursor: "pointer",
                                color: "#0f172a",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "0.5rem",
                                boxShadow: "none",
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 700 }}>{f.facture_num}</div>
                                <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{f.facture_date}</div>
                                <div style={{ fontSize: "0.78rem", color: statusColor, fontWeight: 700 }}>{decodeFactureStatus(f.facture_statut)}</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                 <div style={{ fontWeight: 700 }}>{Number(f.facture_total || 0).toFixed(2)} €</div>
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
                              {autoLoading ? "Auto en cours..." : "Auto"}
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
            <th style={{ textAlign: "left", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Abonnement</th>
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
                                {resolvedGroupRows.map((row, idx) => {
                                    const g = row.group as any;
                                    const netUnitVal = g.count ? g.netAbo / g.count : Number(g.netAbo || g.netUnit || 0);
                                    const achatUnit = g.count ? g.achat / g.count : Number(g.achat || 0);
                                    const key = row.key;
                                    const stat = row.stat;
                                    const aboSelection = row.aboSelection;
                                    const comment = row.comment?.aboNet || "";
                                    const commentAchat = row.comment?.achat || "";
                                    const anomaliesForGroup = row.anomalies || [];
                                  const counts = anomaliesForGroup.reduce(
                                    (acc: Record<string, number>, a: any) => {
                                      if (a?.kind && acc[a.kind] !== undefined) acc[a.kind] += 1;
                                      return acc;
                                    },
                                    { added: 0, removed: 0, net_change: 0 }
                                  );
                                  const summaryParts: string[] = [];
                                  if (counts.added > 5) summaryParts.push(`${counts.added} ligne(s) ajoutee(s)`);
                                  if (counts.removed > 5) summaryParts.push(`${counts.removed} ligne(s) supprimee(s)`);
                                  if (counts.net_change > 5) summaryParts.push(`${counts.net_change} ligne(s) modifiee(s)`);
                                  const autoSummary = summaryParts.join(" ; ");
                                  const commentDisplay = autoSummary || comment;
                                  const commentAchatDisplay = autoSummary || commentAchat;
                                  const rowBg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
                                  return (
                                    <tr key={`${key}-${idx}`} style={{ background: rowBg, borderBottom: "1px solid #e5e7eb", verticalAlign: "top" }}>
                                      <td style={{ padding: "0.65rem" }}>
                                        <div style={{ fontWeight: 700 }}>{decodeLineType(g.ligne_type)}</div>
                                      </td>
                                      <td
                                        style={{ padding: "0.65rem", cursor: "pointer" }}
                                        onClick={() => openAboModal(key)}
                                      >
                                        <div style={{ fontWeight: 800, color: "#0f172a" }}>
                                          {g.abo_nom || aboSelection?.nom || "Non renseigne"}
                                        </div>
                                      </td>
                                      <td
                                        style={{ padding: "0.65rem", textAlign: "right", fontWeight: 700, cursor: "pointer" }}
                                        onClick={() => openAboModal(key)}
                                      >
                                        {g.count}
                                      </td>
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
                                            placeholder="Commentaire"
                                            value={commentDisplay}
                                            onChange={(e) => updateGroupComment(factureCourante.facture_id, key, "aboNet", e.target.value)}
                                            style={{ width: "100%", padding: "0.42rem", borderRadius: "0.45rem", border: "1px solid #cbd5e1", minHeight: "60px", resize: "vertical", background: "#f8fafc" }}
                                          />
                                          {(stat?.aboNet || "a_verifier") === "conteste" && (
                                            <div style={{ padding: "0.5rem", borderRadius: "0.45rem", border: "1px dashed #cbd5e1", background: "#f9fafb", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                                              <div style={{ fontWeight: 800, color: "#0f172a" }}>
                                                {aboSelection?.nom ? aboSelection.nom : "Abonnement non defini"}
                                              </div>
                                              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                                                <button
                                                  onClick={() =>
                                                    openAboModal(key, [], {
                                                      aboId: g.abo_id || aboSelection?.abonnementId || undefined,
                                                      nom: g.abo_nom || aboSelection?.nom || undefined,
                                                      prix: g.match_net || aboSelection?.prix || undefined,
                                                    })
                                                  }
                                                  style={{ padding: "0.45rem 0.75rem", borderRadius: "0.45rem", background: "#3b82f6", color: "white", border: "none", cursor: "pointer", fontWeight: 700 }}
                                                >
                                                  Choisir / editer l'abonnement
                                                </button>
                                                {aboSelection?.mode === "new" && <span style={{ color: "#c2410c", fontSize: "0.9rem" }}>Nouveau type en cours de creation</span>}
                                              </div>
                                            </div>
                                          )}
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
                                            placeholder="Commentaire"
                                            value={commentAchatDisplay}
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

                          {/* Comparatif avant/apres pour les lignes modifiees (point de vue ligne) */}
                          <div style={{ ...rapportCardStyle, padding: "1rem" }}>
                            <div style={{ marginBottom: "0.6rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                              <h4 style={{ margin: 0 }}>Comparatif avant / apres (lignes modifiees)</h4>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.2rem" }}>
                                <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>Vu côte ligne (prix/groupe avant → apres)</span>
                                <span style={{ color: "#334155", fontSize: "0.85rem", fontWeight: 600 }}>
                                  {referenceInfoCourante?.factureNum
                                    ? `Facture de reference: ${referenceInfoCourante.factureNum}${
                                        referenceInfoCourante.factureDate ? ` (${String(referenceInfoCourante.factureDate).slice(0, 10)})` : ""
                                      }`
                                    : "Facture de reference: non disponible"}
                                </span>
                                <span style={{ color: "#64748b", fontSize: "0.82rem" }}>
                                  {typeof referenceInfoCourante?.sharedLinesCount === "number" &&
                                  typeof referenceInfoCourante?.selectedLinesCount === "number"
                                    ? `Lignes communes / lignes selectionnees: ${referenceInfoCourante.sharedLinesCount}/${referenceInfoCourante.selectedLinesCount}`
                                    : "Lignes communes / lignes selectionnees: n/a"}
                                </span>
                              </div>
                            </div>
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", minWidth: "900px", borderCollapse: "separate", borderSpacing: 0, fontSize: "0.86rem" }}>
                                <thead>
                                  <tr style={{ background: "#f8fafc", color: "#0f172a" }}>
                                    <th style={{ textAlign: "left", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Ligne</th>
                                    <th style={{ textAlign: "left", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Statut</th>
                                    <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Avant (net)</th>
                                    <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Apres (net)</th>
                                    <th style={{ textAlign: "right", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Delta</th>
                                    <th style={{ textAlign: "left", padding: "0.65rem", borderBottom: "1px solid #e5e7eb" }}>Commentaire</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const anomaliesByGroup = factureGroupAnomalies[factureCourante.facture_id] || {};
                                    const rowsByLine: Record<string, any> = {};
                                    Object.entries(anomaliesByGroup).forEach(([gKey, arr]) => {
                                      (arr || []).forEach((a: any) => {
                                        if (["net_change", "added", "removed"].includes(a.kind)) {
                                          const lineKey = String(a.line || a.detail || `${gKey}-${a.kind}`);
                                          const curr =
                                            rowsByLine[lineKey] ||
                                            {
                                              line: a.line || "n/a",
                                              before: null,
                                              after: null,
                                              kind: a.kind,
                                              detail: a.detail || "",
                                            };
                                          if (a.kind === "removed") {
                                            curr.before = Number(a.prev_net || 0);
                                          } else if (a.kind === "added") {
                                            curr.after = Number(a.curr_net || 0);
                                          } else if (a.kind === "net_change") {
                                            curr.before = Number(a.prev_net || 0);
                                            curr.after = Number(a.curr_net || 0);
                                          }
                                          rowsByLine[lineKey] = curr;
                                        }
                                      });
                                    });
                                    const rowList = Object.values(rowsByLine);
                                    if (rowList.length === 0) {
                                      return (
                                        <tr>
                                          <td colSpan={8} style={{ padding: "0.85rem", textAlign: "center", color: "#6b7280" }}>
                                            Aucune variation detectee sur les lignes.
                                          </td>
                                        </tr>
                                      );
                                    }
                                    return rowList.map((row: any, idx: number) => {
                                      const beforeVal = row.before !== null ? Number(row.before || 0).toFixed(2) : "";
                                      const afterVal = row.after !== null ? Number(row.after || 0).toFixed(2) : "";
                                      const deltaNum =
                                        row.before !== null && row.after !== null
                                          ? Number(row.after) - Number(row.before)
                                          : row.after !== null
                                          ? Number(row.after)
                                          : row.before !== null
                                          ? -Number(row.before)
                                          : 0;
                                      const delta =
                                        row.before !== null && row.after !== null
                                          ? deltaNum.toFixed(2)
                                          : row.after !== null
                                          ? `+${Number(row.after).toFixed(2)}`
                                          : row.before !== null
                                          ? `-${Number(row.before).toFixed(2)}`
                                          : "";
                                      const rowBg =
                                        row.kind === "added"
                                          ? "#ecfdf3"
                                          : row.kind === "removed"
                                          ? "#fef2f2"
                                          : idx % 2 === 0
                                          ? "#ffffff"
                                          : "#f9fafb";
                                      const deltaColor = deltaNum > 0 ? "#16a34a" : deltaNum < 0 ? "#dc2626" : "#374151";
                                      return (
                                        <tr key={`anom-${idx}`} style={{ background: rowBg, borderBottom: "1px solid #e5e7eb" }}>
                                          <td style={{ padding: "0.65rem", fontWeight: 600 }}>{row.line || "n/a"}</td>
                                          <td style={{ padding: "0.65rem" }}>{row.kind === "added" ? "Nouvelle ligne" : row.kind === "removed" ? "Supprimee" : "Modifiee"}</td>
                                          <td style={{ padding: "0.65rem", textAlign: "right", color: "#9ca3af" }}>{beforeVal}</td>
                                          <td style={{ padding: "0.65rem", textAlign: "right", color: "#0f172a" }}>{afterVal}</td>
                                          <td style={{ padding: "0.65rem", textAlign: "right", fontWeight: 700, color: deltaColor }}>{delta}</td>
                                          <td style={{ padding: "0.65rem", maxWidth: "360px" }}>{row.detail || ""}</td>
                                        </tr>
                                      );
                                    });
                                  })()}
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
        {aboModal.open && modalGroupKey && selectedFactureId && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15,23,42,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: "1rem",
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: "0.75rem",
                padding: "1.25rem",
                boxShadow: "0 24px 60px rgba(15, 23, 42, 0.25)",
                width: "min(640px, 96vw)",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <div>
                  <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>Type d'abonnement pour</div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>
                    {decodeLineType(modalGroup ? modalGroup.ligne_type : 3)} — net unitaire {modalDefaultPrice.toFixed(2)} €
                  </div>
                </div>
                <button
                  onClick={closeAboModal}
                  style={{ border: "none", background: "transparent", fontSize: "1.2rem", cursor: "pointer", color: "#6b7280" }}
                  aria-label="Fermer"
                >
                  ×
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.75rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <label style={{ fontWeight: 700, color: "#0f172a" }}>Abonnement existant</label>
                  <select
                    value={
                      modalSelection?.mode === "new"
                        ? "new"
                        : modalSelection?.abonnementId
                        ? String(modalSelection.abonnementId)
                        : ""
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "new") {
                        updateGroupAbonnement(selectedFactureId, modalGroupKey, {
                          mode: "new",
                          abonnementId: null,
                          nom: modalSelection?.nom || "",
                          prix: modalSelection?.prix ?? modalDefaultPrice,
                        });
                      } else {
                        const id = val ? Number(val) : null;
                        const abo = abonnements.find((a) => a.id === id);
                        updateGroupAbonnement(selectedFactureId, modalGroupKey, {
                          mode: "existing",
                          abonnementId: id,
                          nom: abo?.nom ?? null,
                          prix: abo?.prix ?? null,
                          commentaire: abo?.commentaire ?? null,
                        });
                      }
                    }}
                    style={{ padding: "0.6rem", borderRadius: "0.55rem", border: "1px solid #cbd5e1", background: "#f8fafc" }}
                  >
                    <option value="">{abonnementsLoading ? "Chargement..." : "Selectionner"}</option>
                    {abonnements.map((abo) => (
                      <option key={abo.id} value={abo.id}>
                        {abo.nom} ({Number(abo.prix || 0).toFixed(2)} €)
                      </option>
                    ))}
                    <option value="new">+ Nouveau type...</option>
                  </select>
                </div>

                {(modalSelection?.mode === "new" || (!modalSelection && abonnements.length === 0)) && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                      <label style={{ fontWeight: 700, color: "#0f172a" }}>Nom du nouvel abonnement</label>
                      <input
                        type="text"
                        placeholder="Nom"
                        value={modalSelection?.nom || ""}
                        onChange={(e) =>
                          updateGroupAbonnement(selectedFactureId, modalGroupKey, {
                            mode: "new",
                            nom: e.target.value,
                            prix: modalSelection?.prix ?? modalDefaultPrice,
                          })
                        }
                        style={{ padding: "0.6rem", borderRadius: "0.55rem", border: "1px solid #cbd5e1", background: "#fff" }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                        <label style={{ fontWeight: 700, color: "#0f172a" }}>Prix (HT)</label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder={modalDefaultPrice ? modalDefaultPrice.toFixed(2) : "0.00"}
                          value={
                            modalSelection?.prix === null || modalSelection?.prix === undefined
                              ? ""
                              : modalSelection.prix
                          }
                          onChange={(e) =>
                            updateGroupAbonnement(selectedFactureId, modalGroupKey, {
                              mode: "new",
                              prix: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          style={{ padding: "0.6rem", borderRadius: "0.55rem", border: "1px solid #cbd5e1", background: "#fff" }}
                        />
                      </div>
                      <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                        <label style={{ fontWeight: 700, color: "#0f172a" }}>Commentaire (optionnel)</label>
                        <textarea
                          placeholder="Notes sur l'abonnement"
                          value={modalSelection?.commentaire || ""}
                          onChange={(e) =>
                            updateGroupAbonnement(selectedFactureId, modalGroupKey, {
                              mode: "new",
                              commentaire: e.target.value,
                            })
                          }
                          style={{
                            padding: "0.6rem",
                            borderRadius: "0.55rem",
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            minHeight: "80px",
                            resize: "vertical",
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    onClick={() => modalGroupKey && persistAbonnementForGroup(modalGroupKey, aboModal.lineIds)}
                    disabled={aboModalSaving || !modalGroupKey}
                    style={{
                      padding: "0.65rem 1rem",
                      background: aboModalSaving ? "#93c5fd" : "#2563eb",
                      color: "white",
                      border: "none",
                      borderRadius: "0.45rem",
                      cursor: aboModalSaving ? "not-allowed" : "pointer",
                      fontWeight: 700,
                    }}
                  >
                    {aboModalSaving ? "Enregistrement..." : "Enregistrer l'abonnement"}
                  </button>
                  <button
                    onClick={closeAboModal}
                    style={{
                      padding: "0.65rem 1rem",
                      background: "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "0.45rem",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Fermer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
                <button
                  onClick={resetFromCsv}
                  disabled={resetLoading || autoLoading}
                  style={{
                    padding: "0.6rem 1rem",
                    background: resetLoading ? "#86efac" : "#22c55e",
                    color: "white",
                    border: "1px solid #16a34a",
                    borderRadius: "0.35rem",
                    cursor: resetLoading ? "not-allowed" : "pointer",
                    fontWeight: 600,
                  }}
                >
                  {resetLoading ? "Reset..." : "Reset"}
                </button>
              </div>
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
      summaries.push(`${contexts.length} lignes concernees`);
    }
    return summaries;
  }
