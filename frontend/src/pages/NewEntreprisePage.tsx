import React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  getEntreprise,
  executeQuery,
  updateCompte,
  fetchFactures,
  deleteFacture,
  type Entreprise,
} from "../newApi";
import { decodeFactureStatus } from "../utils/codecs";
import { exportLotRecapPdf } from "../utils/pdfReport";
import { StatusBar } from "../utils/statusBar";
import CompteDetailModal from "../components/CompteDetailModal";

function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() => (typeof window !== "undefined" ? window.innerWidth : 1280));
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

interface EntreprisePageProps {
  entrepriseId: number;
  onBack: () => void;
}

interface MoisData {
  mois: string;
  date_key: string;
}

interface FactureInfo {
  facture_id: number;
  num: string;
  statut: number;
}

interface CompteData {
  compte_id: number;
  compte_num: string;
  compte_nom: string | null;
  lot: string;
  montants_par_mois: Map<string, number>; // date_key -> total_ht
  factures_par_mois: Map<string, FactureInfo[]>; // date_key -> liste des factures
  montants_detail_par_mois: Map<string, { abo: number; conso: number; remises: number; achat: number }>;
}

interface DetailModalData {
  compte_id: number;
  compte_num: string;
  compte_nom: string | null;
  mois?: string; // Si fourni, filtre sur ce mois
}

interface LotData {
  lot: string;
  expanded: boolean;
  total_par_mois: Map<string, number>;
  statuts_par_mois: Map<string, Record<number, number>>; // Statistiques de statut par mois
  comptes: CompteData[];
}

export default function EntreprisePage({
  entrepriseId,
  onBack,
}: EntreprisePageProps) {
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [moisData, setMoisData] = useState<MoisData[]>([]);
  const [moisOrder, setMoisOrder] = useState<"asc" | "desc">("asc");
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [lotsData, setLotsData] = useState<LotData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editCompte, setEditCompte] = useState<{
    compte: CompteData;
    nom: string;
    lot: string;
  } | null>(null);
  const [exportLot, setExportLot] = useState<{ lot: string; months: Set<string> } | null>(null);

  // Modal de détail
  const [selectedCompte, setSelectedCompte] = useState<DetailModalData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const viewportWidth = useViewportWidth();
  const isWideTable = viewportWidth >= 1400;
  const isUltraWideTable = viewportWidth >= 1800;
  // On privilégie l'affichage du maximum de colonnes : padding compact et colonne sticky resserrée
  const cellPadding = isUltraWideTable ? "0.55rem" : isWideTable ? "0.5rem" : "0.45rem";
  const stickyColWidth = isUltraWideTable ? "200px" : isWideTable ? "180px" : "170px";
  const tableFontSize = isWideTable ? "0.85rem" : "0.82rem";
  const tableMaxHeight = isWideTable ? "calc(100vh - 200px)" : "calc(100vh - 240px)";
  const moisAffiches = useMemo(
    () =>
      [...moisData].sort((a, b) =>
        moisOrder === "asc" ? a.date_key.localeCompare(b.date_key) : b.date_key.localeCompare(a.date_key)
      ),
    [moisData, moisOrder]
  );
  const moisFiltres = useMemo(() => {
    if (selectedMonths.size === 0) return [];
    return moisAffiches.filter((m) => selectedMonths.has(m.date_key));
  }, [moisAffiches, selectedMonths]);

  useEffect(() => {
    loadData();
  }, [entrepriseId]);

  async function loadData(preserveExpanded: boolean = false) {
    setIsLoading(true);
    setError(null);
    try {
      const expandedLots = preserveExpanded
        ? new Set(lotsData.filter((l) => l.expanded).map((l) => l.lot))
        : new Set<string>();

      const entrepriseData = await getEntreprise(entrepriseId);
      setEntreprise(entrepriseData);

      // Requête SQL pour récupérer les données détaillées par facture
      const query = `
        SELECT
          strftime('%Y-%m', f.date) as date_key,
          f.id as facture_id,
          c.id as compte_id,
          c.num as compte_num,
          c.nom as compte_nom,
          c.lot as lot,
          f.num as facture_num,
          f.statut as facture_statut,
          f.abo as abo,
          f.conso as conso,
          f.remises as remises,
          f.achat as achat,
          (f.abo + f.conso + f.remises + f.achat) as total_ht
        FROM factures f
        JOIN comptes c ON f.compte_id = c.id
        WHERE c.entreprise_id = ${entrepriseId}
        ORDER BY c.lot, c.num, date_key
      `;

      const result = await executeQuery(query);

      // Agrège les données
      const moisSet = new Set<string>();
      const lotsMap = new Map<string, LotData>();

      result.data.forEach((row: any) => {
        const dateKey = row.date_key;
        const lot = row.lot || "Non défini";

        moisSet.add(dateKey);

        // Lot
        if (!lotsMap.has(lot)) {
          lotsMap.set(lot, {
            lot: lot,
            expanded: false,
            total_par_mois: new Map(),
            statuts_par_mois: new Map(),
            comptes: [],
          });
        }
        const lotData = lotsMap.get(lot)!;

        // Compte
        let compteData = lotData.comptes.find(c => c.compte_id === row.compte_id);
        if (!compteData) {
          compteData = {
            compte_id: row.compte_id,
            compte_num: row.compte_num,
          compte_nom: row.compte_nom,
          lot: lot,
          montants_par_mois: new Map(),
          factures_par_mois: new Map(),
          montants_detail_par_mois: new Map(),
        };
        lotData.comptes.push(compteData);
      }

        // Montants
        const currentCompteTotal = compteData.montants_par_mois.get(dateKey) || 0;
        compteData.montants_par_mois.set(dateKey, currentCompteTotal + (Number(row.total_ht) || 0));
        const detail = compteData.montants_detail_par_mois.get(dateKey) || {
          abo: 0,
          conso: 0,
          remises: 0,
          achat: 0,
        };
        detail.abo += Number(row.abo) || 0;
        detail.conso += Number(row.conso) || 0;
        detail.remises += Number(row.remises) || 0;
        detail.achat += Number(row.achat) || 0;
        compteData.montants_detail_par_mois.set(dateKey, detail);

        // Factures pour le compte
        if (!compteData.factures_par_mois.has(dateKey)) {
          compteData.factures_par_mois.set(dateKey, []);
        }
        compteData.factures_par_mois.get(dateKey)!.push({
          facture_id: row.facture_id,
          num: row.facture_num,
          statut: row.facture_statut,
        });

        // Agrégation au niveau lot
        const currentLotTotal = lotData.total_par_mois.get(dateKey) || 0;
        lotData.total_par_mois.set(dateKey, currentLotTotal + row.total_ht);

        // Statistiques de statut pour le lot
        if (!lotData.statuts_par_mois.has(dateKey)) {
          lotData.statuts_par_mois.set(dateKey, { 0: 0, 1: 0, 2: 0 });
        }
        const statutStats = lotData.statuts_par_mois.get(dateKey)!;
        const statut = Number(row.facture_statut);
        if (statut === 0 || statut === 1 || statut === 2) {
          statutStats[statut]++;
        }
      });

      setMoisData(
        Array.from(moisSet)
          .sort() // Tri croissant: ancien → récent
          .map((dateKey) => ({
            date_key: dateKey,
            mois: formatMois(dateKey),
          }))
      );
      setSelectedMonths(new Set(Array.from(moisSet)));

      setLotsData(
        Array.from(lotsMap.values())
          .sort((a, b) => a.lot.localeCompare(b.lot))
          .map((lot) => ({ ...lot, expanded: expandedLots.has(lot.lot) }))
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  // Mise à jour ciblée après validation d'un rapport (évite de reconstruire toute la page)
  function handleFactureStatusUpdate({
    factureId,
    newStatut,
    mois,
    compteId,
  }: {
    factureId: number;
    newStatut: number;
    mois?: string;
    compteId: number;
  }) {
    setLotsData((prevLots) =>
      prevLots.map((lot) => {
        const comptes = lot.comptes.map((compte) => {
          if (compte.compte_id !== compteId) return compte;
          const facturesMap = new Map(compte.factures_par_mois);
          const statutsMap = new Map(lot.statuts_par_mois);

          if (mois) {
            const factures = facturesMap.get(mois) || [];
            let oldStatut: number | null = null;
            const updatedFactures = factures.map((f) => {
              if (f.facture_id === factureId) {
                oldStatut = f.statut;
                return { ...f, statut: newStatut };
              }
              return f;
            });
            facturesMap.set(mois, updatedFactures);

            if (oldStatut !== null) {
              const stats = { ...(statutsMap.get(mois) || { 0: 0, 1: 0, 2: 0 }) };
              stats[oldStatut] = Math.max(0, (stats[oldStatut] || 0) - 1);
              stats[newStatut] = (stats[newStatut] || 0) + 1;
              statutsMap.set(mois, stats);
            }
          }

          return {
            ...compte,
            factures_par_mois: facturesMap,
          };
        });
        return { ...lot, comptes: comptes };
      })
    );
  }

  function formatMois(dateKey: string): string {
    const [year, month] = dateKey.split("-");
    const moisMap: { [key: string]: string } = {
      "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
      "05": "Mai", "06": "Juin", "07": "Juil", "08": "Août",
      "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
    };
    return `${moisMap[month]} ${year}`;
  }

  function toggleLot(lotName: string) {
    setLotsData(
      lotsData.map((lot) =>
        lot.lot === lotName ? { ...lot, expanded: !lot.expanded } : lot
      )
    );
  }

  function toggleMonthVisible(dateKey: string) {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  }

  function setAllMonthsVisible(all: boolean) {
    if (all) {
      setSelectedMonths(new Set(moisAffiches.map((m) => m.date_key)));
    } else {
      setSelectedMonths(new Set());
    }
  }

  function openExportLot(lotName: string) {
    setExportLot({
      lot: lotName,
      months: new Set(moisAffiches.map((m) => m.date_key)),
    });
  }

  function toggleExportMonth(month: string) {
    setExportLot((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.months);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return { ...prev, months: next };
    });
  }

  function confirmExportLot() {
    if (!exportLot) return;
    const lotData = lotsData.find((l) => l.lot === exportLot.lot);
    if (!lotData) return;
    const months = Array.from(exportLot.months).sort();
    const comptes = lotData.comptes.map((c) => {
      const moisDetails = months.map((m) => {
        const detail = c.montants_detail_par_mois.get(m) || {
          abo: 0,
          conso: 0,
          remises: 0,
          achat: 0,
        };
        const factures = c.factures_par_mois.get(m) || [];
        const total = detail.abo + detail.conso + detail.remises + detail.achat;
        return {
          mois: m,
          abo: detail.abo,
          conso: detail.conso,
          remises: detail.remises,
          achat: detail.achat,
          total,
          factures,
        };
      });
      return { compte_num: c.compte_num, compte_nom: c.compte_nom, moisDetails };
    });
    exportLotRecapPdf({
      entrepriseNom: entreprise?.nom,
      lotNom: lotData.lot,
      moisSelectionnes: months,
      comptes,
    });
    setExportLot(null);
  }

  function handleCompteClick(compte: CompteData, mois?: string) {
    setSelectedCompte({
      compte_id: compte.compte_id,
      compte_num: compte.compte_num,
      compte_nom: compte.compte_nom,
      mois: mois,
    });
  }

  function getCompteMonths(compteId: number): string[] {
    return moisAffiches
      .map((m) => m.date_key)
      .filter((dateKey) =>
        lotsData.some((lot) =>
          lot.comptes.some(
            (c) => c.compte_id === compteId && (c.montants_par_mois.get(dateKey) || 0) > 0
          )
        )
      );
  }

  async function deleteCompteMonth(compteId: number, moisKey: string) {
    if (isDeleting) return;
    if (
      !confirm(
        `Supprimer toutes les données du compte ${compteId} pour le mois ${moisKey} ? Cette action est irréversible.`
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      // bornes de mois
      const [year, month] = moisKey.split("-");
      const start = `${year}-${month}-01`;
      const nextMonth = month === "12" ? "01" : String(Number(month) + 1).padStart(2, "0");
      const nextYear = month === "12" ? String(Number(year) + 1) : year;
      const endExclusive = `${nextYear}-${nextMonth}-01`;

      const factures = await fetchFactures({
        compte_id: compteId.toString(),
        date_debut: start,
        date_fin: endExclusive,
      });

      await Promise.all(factures.map((f) => deleteFacture(f.id)));
      await loadData();
      setSelectedCompte(null);
    } catch (err) {
      alert((err as Error).message || "Erreur lors de la suppression");
    } finally {
      setIsDeleting(false);
    }
  }

  async function deleteCompteAll(compteId: number) {
    if (isDeleting) return;
    if (
      !confirm(
        `Supprimer toutes les données du compte ${compteId} (tous les mois) ? Cette action est irréversible.`
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      const factures = await fetchFactures({ compte_id: compteId.toString() });
      await Promise.all(factures.map((f) => deleteFacture(f.id)));
      await loadData();
      setSelectedCompte(null);
      setEditCompte(null);
    } catch (err) {
      alert((err as Error).message || "Erreur lors de la suppression");
    } finally {
      setIsDeleting(false);
    }
  }

  function openEditCompte(compte: CompteData) {
    setEditCompte({
      compte,
      nom: compte.compte_nom || "",
      lot: compte.lot || "",
    });
  }

  async function handleSaveEdit() {
    if (!editCompte) return;
    const trimmedNom = editCompte.nom.trim();
    const trimmedLot = editCompte.lot.trim();
    const payload: { nom?: string | null; lot?: string | null } = {};

    if (trimmedNom !== (editCompte.compte.compte_nom || "")) {
      payload.nom = trimmedNom === "" ? null : trimmedNom;
    }
    if (trimmedLot !== (editCompte.compte.lot || "")) {
      payload.lot = trimmedLot === "" ? null : trimmedLot;
    }

    if (Object.keys(payload).length === 0) {
      setEditCompte(null);
      return;
    }

    try {
      await updateCompte(editCompte.compte.compte_id, payload);
      await loadData();
      setEditCompte(null);
    } catch (err) {
      alert((err as Error).message || "Erreur lors de la mise à jour du compte");
    }
  }

  function getStatutIcon(statut: number): string {
    switch (statut) {
      case 1:
        return "✓";
      case 2:
        return "!";
      case 0:
      default:
        return "○";
    }
  }

  function getStatutColor(statut: number): string {
    switch (statut) {
      case 1:
        return "#10b981"; // Vert
      case 2:
        return "#f59e0b"; // Orange
      case 0:
      default:
        return "#9ca3af"; // Gris
    }
  }

  function formatStatutPercentage(stats: Record<number, number>): string {
    const total = (stats[0] || 0) + (stats[1] || 0) + (stats[2] || 0);
    if (total === 0) return "";

    const parts: string[] = [];
    if (stats[1]) {
      parts.push(`${Math.round((stats[1] / total) * 100)}% valide`);
    }
    if (stats[2]) {
      parts.push(`${Math.round((stats[2] / total) * 100)}% conteste`);
    }
    if (stats[0]) {
      parts.push(`${Math.round((stats[0] / total) * 100)}% importe`);
    }
    return parts.join(" | ");
  }


  if (isLoading) {
    return (
      <div className="app app--fullwidth">
        <p className="loading">Chargement...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app app--fullwidth">
        <button onClick={onBack} className="back-button">
          ← Retour
        </button>
        <div className="alert error">{error}</div>
      </div>
    );
  }

  if (!entreprise || moisData.length === 0) {
    return (
      <div className="app app--fullwidth">
        <button onClick={onBack} className="back-button">
          ← Retour
        </button>
        <h1>{entreprise?.nom}</h1>
        <div className="card">
          <p>Aucune donnée de facturation</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app app--fullwidth">
      <button onClick={onBack} className="back-button">
        ← Retour
      </button>
      <h1>{entreprise.nom}</h1>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Vue détaillée des factures par lot</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>Tri des mois</span>
            <button
              onClick={() => setMoisOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              className="secondary-button"
              style={{ padding: "0.4rem 0.75rem", fontWeight: 600 }}
            >
              {moisOrder === "asc" ? "Ancien → Récent" : "Récent → Ancien"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            margin: "0.5rem 0 0.75rem",
          }}
        >
          <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>Mois affichés</span>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <button
              className="secondary-button"
              style={{ padding: "0.35rem 0.7rem", fontWeight: 600 }}
              onClick={() => setAllMonthsVisible(true)}
            >
              Tout
            </button>
            <button
              className="secondary-button"
              style={{ padding: "0.35rem 0.7rem", fontWeight: 600 }}
              onClick={() => setAllMonthsVisible(false)}
            >
              Aucun
            </button>
            {moisAffiches.map((m) => {
              const checked = selectedMonths.has(m.date_key);
              return (
                <label
                  key={`mois-filter-${m.date_key}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    background: checked ? "#eef2ff" : "#f8fafc",
                    border: checked ? "1px solid #c7d2fe" : "1px solid #e5e7eb",
                    borderRadius: "999px",
                    padding: "0.3rem 0.55rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMonthVisible(m.date_key)}
                    style={{ margin: 0 }}
                  />
                  <span style={{ fontSize: "0.85rem", color: "#374151" }}>{m.mois}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div
          style={{
            overflow: "auto",
            maxHeight: tableMaxHeight,
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
          }}
        >
          {moisFiltres.length === 0 && (
            <div style={{ padding: "1rem", color: "#9ca3af", textAlign: "center" }}>
              Aucun mois sélectionné. Sélectionnez au moins un mois pour afficher le tableau.
            </div>
          )}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: tableFontSize,
              tableLayout: "auto",
            }}
          >
            <thead
              style={{
                position: "sticky",
                top: 0,
                background: "#f9fafb",
                zIndex: 10,
              }}
            >
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    background: "#f9fafb",
                    padding: "0.75rem",
                    textAlign: "left",
                    borderBottom: "2px solid #e5e7eb",
                    borderRight: "1px solid #e5e7eb",
                    fontWeight: "600",
                    minWidth: stickyColWidth,
                    zIndex: 11,
                  }}
                >
                  Lot / Compte
                </th>
                {moisFiltres.map((mois) => (
                  <th
                    key={mois.date_key}
                    style={{
                      padding: cellPadding,
                      textAlign: "right",
                      borderBottom: "2px solid #e5e7eb",
                      fontWeight: "600",
                      whiteSpace: "nowrap",
                    }}
                  >
                     {mois.mois}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lotsData.map((lot, lotIdx) => (
                <React.Fragment key={`lot-frag-${lot.lot}`}>
                  {/* Ligne du lot */}
                  <tr
                    key={`lot-${lot.lot}`}
                    onClick={() => toggleLot(lot.lot)}
                    style={{
                      cursor: "pointer",
                      background: lotIdx % 2 === 0 ? "#fafafa" : "#f5f5f5",
                    }}
                    className="hover-row"
                  >
                    <td
                      style={{
                        position: "sticky",
                        left: 0,
                        background: lotIdx % 2 === 0 ? "#fafafa" : "#f5f5f5",
                        padding: "0.75rem",
                        fontWeight: "700",
                        borderRight: "1px solid #e5e7eb",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <span style={{ marginRight: "0.25rem" }}>
                          {lot.expanded ? "▼" : "▶"}
                        </span>
                        <span>
                          {lot.lot}
                          <span style={{ marginLeft: "0.5rem", color: "#6b7280", fontWeight: "400" }}>
                            ({lot.comptes.length} compte{lot.comptes.length > 1 ? "s" : ""})
                          </span>
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openExportLot(lot.lot);
                          }}
                          style={{
                            padding: isWideTable ? "0.35rem 0.6rem" : "0.25rem 0.5rem",
                            background: "#f3e8ff",
                            color: "#6b21a8",
                            border: "1px solid #e9d5ff",
                            borderRadius: "0.35rem",
                            fontSize: isWideTable ? "0.9rem" : "0.8rem",
                            cursor: "pointer",
                          }}
                        >
                          Export PDF
                        </button>
                      </div>
                    </td>
                    {moisFiltres.map((mois) => {
                      const total = lot.total_par_mois.get(mois.date_key) || 0;
                      const statutStats = lot.statuts_par_mois.get(mois.date_key);

                      return (
                        <td
                          key={mois.date_key}
                          style={{
                            padding: cellPadding,
                            textAlign: "right",
                            fontWeight: "600",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {total > 0 ? (
                            <div>
                              <div>{total.toFixed(2)} €</div>
                              {statutStats && (
                                <div style={{ marginTop: "0.25rem" }}>
                                  <StatusBar stats={statutStats} height={8} />
                                </div>
                              )}
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Lignes des comptes (si expanded) */}
                  {lot.expanded &&
                    lot.comptes.map((compte, compteIdx) => (
                      <tr
                        key={`compte-${compte.compte_id}`}
                        style={{
                          background: "white",
                        }}
                      >
                        <td
                          onClick={() => openEditCompte(compte)}
                          title="Cliquer pour éditer le nom ou le lot"
                          style={{
                            position: "sticky",
                            left: 0,
                            background: "white",
                            padding: `${cellPadding} ${cellPadding} ${cellPadding} ${isWideTable ? "2.5rem" : "1.75rem"}`,
                            borderRight: "1px solid #e5e7eb",
                            borderBottom: compteIdx === lot.comptes.length - 1 ? "2px solid #e5e7eb" : "1px solid #e5e7eb",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontWeight: "500" }}>
                            {compte.compte_nom || compte.compte_num}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                            {compte.compte_num}
                          </div>
                        </td>
                        {moisFiltres.map((mois) => {
                          const total = compte.montants_par_mois.get(mois.date_key) || 0;
                          const factures = compte.factures_par_mois.get(mois.date_key) || [];

                          return (
                            <td
                              key={`${compte.compte_id}-${mois.date_key}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (total > 0) {
                                  handleCompteClick(compte, mois.date_key);
                                }
                              }}
                              style={{
                                padding: cellPadding,
                                textAlign: "right",
                                borderBottom: compteIdx === lot.comptes.length - 1 ? "2px solid #e5e7eb" : "1px solid #e5e7eb",
                                cursor: total > 0 ? "pointer" : "default",
                              }}
                              className={total > 0 ? "hover-row" : ""}
                            >
                              {total > 0 ? (
                                <div>
                                  <div style={{ fontWeight: "600", fontSize: "0.95rem" }}>
                                    {total.toFixed(2)} €
                                  </div>
                                  <div style={{ marginTop: "0.35rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                                    {factures.map((f, idx) => (
                                      <div
                                        key={`${compte.compte_id}-${mois.date_key}-${idx}`}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "flex-end",
                                          fontSize: "0.85rem",
                                        }}
                                      >
                                        <span
                                          style={{
                                            color: getStatutColor(f.statut),
                                            marginRight: "0.35rem",
                                            fontWeight: "600",
                                          }}
                                          title={`Facture ${f.num} - ${decodeFactureStatus(f.statut)}`}
                                        >
                                          {getStatutIcon(f.statut)}
                                        </span>
                                        <span style={{ color: "#374151", fontWeight: "500" }}>
                                          {f.num}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                "-"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: "1rem", color: "#6b7280", fontSize: "0.875rem" }}>
          💡 Cliquez sur un lot pour voir/masquer ses comptes • Cliquez sur une case (mois) pour voir le détail de ce mois
        </p>
        <p style={{ marginTop: "0.5rem", color: "#6b7280", fontSize: "0.875rem" }}>
          <span style={{ color: "#10b981" }}>✓</span> Validé •
          <span style={{ color: "#f59e0b", marginLeft: "0.5rem" }}>!</span> Contesté •
          <span style={{ color: "#9ca3af", marginLeft: "0.5rem" }}>○</span> Importé
        </p>
      </section>

      {selectedCompte && (() => {
        const compteMonths = getCompteMonths(selectedCompte.compte_id);
        const currentIdx = selectedCompte.mois ? compteMonths.indexOf(selectedCompte.mois) : -1;
        const hasPrev = currentIdx > 0;
        const hasNext = currentIdx >= 0 && currentIdx < compteMonths.length - 1;

        return (
          <CompteDetailModal
            compteId={selectedCompte.compte_id}
            compteNum={selectedCompte.compte_num}
            compteNom={selectedCompte.compte_nom}
            entrepriseNom={entreprise?.nom}
            mois={selectedCompte.mois}
            onClose={() => setSelectedCompte(null)}
            onRefreshParent={handleFactureStatusUpdate}
            hasPrevMonth={hasPrev}
            hasNextMonth={hasNext}
            onPrevMonth={() => {
              if (!selectedCompte.mois || !hasPrev) return;
              const prevKey = compteMonths[currentIdx - 1];
              setSelectedCompte({ ...selectedCompte, mois: prevKey });
            }}
            onNextMonth={() => {
              if (!selectedCompte.mois || !hasNext) return;
              const nextKey = compteMonths[currentIdx + 1];
              setSelectedCompte({ ...selectedCompte, mois: nextKey });
            }}
            onDeleteMonth={
              selectedCompte.mois
                ? () => deleteCompteMonth(selectedCompte.compte_id, selectedCompte.mois!)
                : undefined
            }
          />
        );
      })()}

      {exportLot && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1090,
          }}
          onClick={() => setExportLot(null)}
        >
          <div
            style={{
              background: "white",
              borderRadius: "0.75rem",
              width: "90%",
              maxWidth: "520px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e5e7eb" }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>
                Exporter le lot {exportLot.lot}
              </h3>
              <p style={{ margin: "0.35rem 0 0", color: "#6b7280" }}>
                Sélectionnez les mois à inclure dans le PDF récapitulatif.
              </p>
            </div>
            <div
              style={{
                maxHeight: "320px",
                overflow: "auto",
                padding: "1rem 1.5rem",
                display: "grid",
                gap: "0.35rem",
              }}
            >
              {moisAffiches.map((m) => (
                <label
                  key={m.date_key}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={exportLot.months.has(m.date_key)}
                    onChange={() => toggleExportMonth(m.date_key)}
                  />
                  <span>
                    {m.mois} ({m.date_key})
                  </span>
                </label>
              ))}
              {moisAffiches.length === 0 && <div style={{ color: "#6b7280" }}>Aucun mois disponible.</div>}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.5rem",
                padding: "0.85rem 1.5rem",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <button
                onClick={() => setExportLot(null)}
                style={{
                  padding: "0.55rem 1rem",
                  border: "1px solid #d1d5db",
                  background: "white",
                  borderRadius: "0.4rem",
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                Annuler
              </button>
              <button
                onClick={confirmExportLot}
                disabled={exportLot.months.size === 0}
                style={{
                  padding: "0.55rem 1.1rem",
                  border: "none",
                  background: exportLot.months.size === 0 ? "#9ca3af" : "#2563eb",
                  color: "white",
                  borderRadius: "0.4rem",
                  cursor: exportLot.months.size === 0 ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
              >
                Exporter
              </button>
            </div>
          </div>
        </div>
      )}

      {editCompte && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
          onClick={() => setEditCompte(null)}
        >
          <div
            style={{
              background: "white",
              borderRadius: "0.75rem",
              width: "90%",
              maxWidth: "520px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
              padding: "1.5rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem" }}>
                Éditer le compte {editCompte.compte.compte_num}
              </h3>
              <button
                onClick={() => setEditCompte(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "1.25rem",
                  cursor: "pointer",
                  color: "#6b7280",
                }}
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.25rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontWeight: 600 }}>
                Nom du compte
                <input
                  value={editCompte.nom}
                  onChange={(e) => setEditCompte({ ...editCompte, nom: e.target.value })}
                  placeholder="Nom affiché (optionnel)"
                  style={{
                    padding: "0.6rem 0.75rem",
                    borderRadius: "0.5rem",
                    border: "1px solid #d1d5db",
                    fontSize: "0.95rem",
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontWeight: 600 }}>
                Lot
                {(() => {
                  const lotOptions = Array.from(
                    new Set(lotsData.map((l) => l.lot).filter((v): v is string => Boolean(v)))
                  );
                  const currentLot = editCompte.lot || "";
                  const isCustom = currentLot !== "" && !lotOptions.includes(currentLot);
                  return (
                    <>
                      <select
                        value={isCustom ? "__custom__" : currentLot}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "__custom__") {
                            setEditCompte({ ...editCompte, lot: "" });
                          } else {
                            setEditCompte({ ...editCompte, lot: val });
                          }
                        }}
                        style={{
                          padding: "0.6rem 0.75rem",
                          borderRadius: "0.5rem",
                          border: "1px solid #d1d5db",
                          fontSize: "0.95rem",
                          background: "white",
                        }}
                      >
                        {lotOptions.map((lot) => (
                          <option key={lot} value={lot}>
                            {lot}
                          </option>
                        ))}
                        <option value="__custom__">Autre (saisir)</option>
                      </select>
                      {(isCustom || currentLot === "") && (
                        <input
                          value={currentLot}
                          onChange={(e) => setEditCompte({ ...editCompte, lot: e.target.value })}
                          placeholder="Nouveau lot"
                          style={{
                            marginTop: "0.5rem",
                            padding: "0.6rem 0.75rem",
                            borderRadius: "0.5rem",
                            border: "1px solid #d1d5db",
                            fontSize: "0.95rem",
                          }}
                        />
                      )}
                    </>
                  );
                })()}
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", marginTop: "1.5rem", alignItems: "center" }}>
              <button
                onClick={() => deleteCompteAll(editCompte.compte.compte_id)}
                style={{
                  padding: "0.65rem 1rem",
                  border: "1px solid #ef4444",
                  background: "#fee2e2",
                  color: "#b91c1c",
                  borderRadius: "0.5rem",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Supprimer
              </button>
              <button
                onClick={() => setEditCompte(null)}
                style={{
                  padding: "0.65rem 1.1rem",
                  border: "1px solid #d1d5db",
                  background: "white",
                  borderRadius: "0.5rem",
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                Annuler
              </button>
              <button
                onClick={handleSaveEdit}
                style={{
                  padding: "0.65rem 1.25rem",
                  border: "none",
                  background: "#2563eb",
                  color: "white",
                  borderRadius: "0.5rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
