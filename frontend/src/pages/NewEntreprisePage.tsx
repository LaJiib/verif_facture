import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteFacture,
  fetchEntrepriseMatrice,
  fetchFactures,
  getEntreprise,
  updateCompte,
  type Entreprise,
} from "../newApi";
import { decodeFactureStatus } from "../utils/codecs";
import { StatusBar } from "../utils/statusBar";
import CompteDetailModal from "../components/CompteDetailModal";

interface MoisData {
  mois: string;
  date_key: string;
}

interface FactureItem {
  facture_id: number;
  facture_num: string;
  statut: number;
  date_key: string;
  lot: string;
  compte_id: number;
  compte_num: string;
  compte_nom: string | null;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  total: number;
}

interface TreeCompte {
  compte_id: number;
  compte_num: string;
  compte_nom: string | null;
  stats: Record<number, number>;
}

interface TreeLot {
  lot: string;
  stats: Record<number, number>;
  comptes: TreeCompte[];
}

type FilterNode =
  | { type: "entreprise" }
  | { type: "lot"; lot: string }
  | { type: "compte"; lot: string; compte_id: number };

interface DetailModalData {
  compte_id: number;
  compte_num: string;
  compte_nom: string | null;
  mois?: string;
}

const EMPTY_STATS: Record<number, number> = { 0: 0, 1: 0, 2: 0 };

function cloneStats(stats?: Record<number, number>): Record<number, number> {
  return {
    0: stats?.[0] || 0,
    1: stats?.[1] || 0,
    2: stats?.[2] || 0,
  };
}

function formatMois(dateKey: string): string {
  const [year, month] = dateKey.split("-");
  const moisMap: { [key: string]: string } = {
    "01": "Jan",
    "02": "Fev",
    "03": "Mar",
    "04": "Avr",
    "05": "Mai",
    "06": "Juin",
    "07": "Juil",
    "08": "Aout",
    "09": "Sep",
    "10": "Oct",
    "11": "Nov",
    "12": "Dec",
  };
  return `${moisMap[month]} ${year}`;
}

function formatStatutPercentage(stats: Record<number, number>): string {
  const total = (stats[0] || 0) + (stats[1] || 0) + (stats[2] || 0);
  if (total === 0) return "Aucune facture";

  const parts: string[] = [];
  if (stats[1]) parts.push(`${Math.round((stats[1] / total) * 100)}% valide`);
  if (stats[2]) parts.push(`${Math.round((stats[2] / total) * 100)}% conteste`);
  if (stats[0]) parts.push(`${Math.round((stats[0] / total) * 100)}% importe`);
  return parts.join(" · ");
}

function statutMeta(statut: number) {
  switch (statut) {
    case 1:
      return { label: "Valide", color: "#10b981", bg: "#ecfdf3" };
    case 2:
      return { label: "Conteste", color: "#f59e0b", bg: "#fffbeb" };
    case 0:
    default:
      return { label: "Importe", color: "#9ca3af", bg: "#f3f4f6" };
  }
}

export default function EntreprisePage({
  entrepriseId,
  onBack,
}: {
  entrepriseId: number;
  onBack: () => void;
}) {
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [moisData, setMoisData] = useState<MoisData[]>([]);
  const [factures, setFactures] = useState<FactureItem[]>([]);
  const [treeLots, setTreeLots] = useState<TreeLot[]>([]);
  const [globalStats, setGlobalStats] = useState<Record<number, number>>(EMPTY_STATS);
  const [selectedNode, setSelectedNode] = useState<FilterNode>({ type: "entreprise" });
  const [compteMonthsMap, setCompteMonthsMap] = useState<Map<number, Set<string>>>(new Map());
  const [selectedStatutsFilter, setSelectedStatutsFilter] = useState<Set<number>>(new Set([0, 1, 2]));
  const [selectedCompte, setSelectedCompte] = useState<DetailModalData | null>(null);
  const [editCompte, setEditCompte] = useState<{
    compte_id: number;
    compte_num: string;
    compte_nom: string | null;
    lot: string | null;
    nomValue: string;
    lotValue: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [collapsedLots, setCollapsedLots] = useState<Set<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  useEffect(() => {
    loadData();
  }, [entrepriseId]);

  async function loadData(preserveSelection: boolean = true) {
    setIsLoading(true);
    setError(null);

    try {
      const entrepriseData = await getEntreprise(entrepriseId);
      setEntreprise(entrepriseData);

      const matrice = await fetchEntrepriseMatrice(entrepriseId);

      const moisList: MoisData[] = (matrice.months || []).map((m) => ({
        date_key: m,
        mois: formatMois(m),
      }));
      setMoisData(moisList);

      const flatFactures: FactureItem[] = [];
      const lotsForTree: TreeLot[] = [];
      const monthsMap = new Map<number, Set<string>>();
      const global: Record<number, number> = cloneStats(EMPTY_STATS);

      matrice.lots.forEach((lot) => {
        const lotStats: Record<number, number> = cloneStats();
        const comptes: TreeCompte[] = lot.comptes.map((compte) => {
          const compteStats: Record<number, number> = cloneStats();

          compte.factures.forEach((f) => {
            const item: FactureItem = {
              facture_id: f.facture_id,
              facture_num: f.facture_num,
              statut: f.statut,
              date_key: f.date_key,
              lot: lot.lot,
              compte_id: compte.compte_id,
              compte_num: compte.compte_num,
              compte_nom: compte.compte_nom,
              abo: Number(f.abo || 0),
              conso: Number(f.conso || 0),
              remises: Number(f.remises || 0),
              achat: Number(f.achat || 0),
              total: Number(f.total_ht || 0),
            };
            flatFactures.push(item);

            compteStats[f.statut] = (compteStats[f.statut] || 0) + 1;
            lotStats[f.statut] = (lotStats[f.statut] || 0) + 1;
            global[f.statut] = (global[f.statut] || 0) + 1;

            if (!monthsMap.has(compte.compte_id)) {
              monthsMap.set(compte.compte_id, new Set());
            }
            monthsMap.get(compte.compte_id)!.add(f.date_key);
          });

          return {
            compte_id: compte.compte_id,
            compte_num: compte.compte_num,
            compte_nom: compte.compte_nom,
            stats: compteStats,
          };
        });

        lotsForTree.push({
          lot: lot.lot,
          stats: lotStats,
          comptes,
        });
      });

      flatFactures.sort((a, b) => b.date_key.localeCompare(a.date_key));
      lotsForTree.sort((a, b) => a.lot.localeCompare(b.lot));

      setFactures(flatFactures);
      setTreeLots(lotsForTree);
      setCompteMonthsMap(monthsMap);
      setGlobalStats(global);
      if (firstLoadRef.current) {
        setCollapsedLots(new Set(lotsForTree.map((l) => l.lot)));
        setCollapsedMonths(new Set(moisList.map((m) => m.date_key)));
        firstLoadRef.current = false;
      }

      if (!preserveSelection) {
        setSelectedNode({ type: "entreprise" });
      } else {
        const stillValid = checkSelectedNode(selectedNode, lotsForTree);
        if (!stillValid) {
          setSelectedNode({ type: "entreprise" });
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  function toggleLotCollapse(lotName: string) {
    setCollapsedLots((prev) => {
      const next = new Set(prev);
      if (next.has(lotName)) next.delete(lotName);
      else next.add(lotName);
      return next;
    });
  }

  function toggleMonthCollapse(dateKey: string) {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  function checkSelectedNode(node: FilterNode, lots: TreeLot[]): boolean {
    if (node.type === "entreprise") return true;
    if (node.type === "lot") return lots.some((l) => l.lot === node.lot);
    if (node.type === "compte") {
      return lots.some(
        (l) => l.lot === node.lot && l.comptes.some((c) => c.compte_id === node.compte_id)
      );
    }
    return false;
  }

  function handleFactureClick(item: FactureItem) {
    setSelectedCompte({
      compte_id: item.compte_id,
      compte_num: item.compte_num,
      compte_nom: item.compte_nom,
      mois: item.date_key,
    });
  }

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
    const target = factures.find((f) => f.facture_id === factureId);
    if (!target) return;
    if (target.statut === newStatut) return;
    const oldStatut = target.statut;

    setFactures((prev) =>
      prev.map((f) => (f.facture_id === factureId ? { ...f, statut: newStatut } : f))
    );

    setGlobalStats((prev) => {
      const next = cloneStats(prev);
      next[oldStatut] = Math.max(0, (next[oldStatut] || 0) - 1);
      next[newStatut] = (next[newStatut] || 0) + 1;
      return next;
    });

    setTreeLots((prev) =>
      prev.map((lot) => {
        if (lot.lot !== target.lot) return lot;
        const lotStats = cloneStats(lot.stats);
        lotStats[oldStatut] = Math.max(0, (lotStats[oldStatut] || 0) - 1);
        lotStats[newStatut] = (lotStats[newStatut] || 0) + 1;

        const comptes = lot.comptes.map((c) => {
          if (c.compte_id !== compteId) return c;
          const compteStats = cloneStats(c.stats);
          compteStats[oldStatut] = Math.max(0, (compteStats[oldStatut] || 0) - 1);
          compteStats[newStatut] = (compteStats[newStatut] || 0) + 1;
          return { ...c, stats: compteStats };
        });

        return { ...lot, stats: lotStats, comptes };
      })
    );
  }

  function getCompteMonths(compteId: number): string[] {
    const months = Array.from(compteMonthsMap.get(compteId) || []);
    const order = new Map<string, number>(moisData.map((m, idx) => [m.date_key, idx]));
    return months.sort((a, b) => {
      const ai = order.has(a) ? order.get(a)! : Number.MAX_SAFE_INTEGER;
      const bi = order.has(b) ? order.get(b)! : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
  }

  async function deleteCompteMonth(compteId: number, moisKey: string) {
    if (isDeleting) return;
    if (
      !confirm(
        `Supprimer toutes les donnees du compte ${compteId} pour le mois ${moisKey} ? Cette action est irreversible.`
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      const [year, month] = moisKey.split("-");
      const start = `${year}-${month}-01`;
      const nextMonth = month === "12" ? "01" : String(Number(month) + 1).padStart(2, "0");
      const nextYear = month === "12" ? String(Number(year) + 1) : year;
      const endExclusive = `${nextYear}-${nextMonth}-01`;

      const facturesToDelete = await fetchFactures({
        compte_id: compteId,
        date_debut: start,
        date_fin: endExclusive,
      });

      await Promise.all(facturesToDelete.map((f) => deleteFacture(f.id)));
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
        `Supprimer toutes les donnees du compte ${compteId} (tous les mois) ? Cette action est irreversible.`
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      const facturesToDelete = await fetchFactures({ compte_id: compteId });
      await Promise.all(facturesToDelete.map((f) => deleteFacture(f.id)));
      await loadData();
      setSelectedCompte(null);
      setEditCompte(null);
    } catch (err) {
      alert((err as Error).message || "Erreur lors de la suppression");
    } finally {
      setIsDeleting(false);
    }
  }

  function openEditCompteFromNode(compte: TreeCompte, lot: string) {
    setEditCompte({
      compte_id: compte.compte_id,
      compte_num: compte.compte_num,
      compte_nom: compte.compte_nom,
      lot,
      nomValue: compte.compte_nom || "",
      lotValue: lot,
    });
  }

  async function handleSaveEdit() {
    if (!editCompte) return;
    const payload: { nom?: string | null; lot?: string | null } = {};
    const trimmedNom = editCompte.nomValue.trim();
    const trimmedLot = editCompte.lotValue.trim();

    if (trimmedNom !== (editCompte.compte_nom || "")) {
      payload.nom = trimmedNom === "" ? null : trimmedNom;
    }
    if (trimmedLot !== (editCompte.lot || "")) {
      payload.lot = trimmedLot === "" ? null : trimmedLot;
    }

    if (Object.keys(payload).length === 0) {
      setEditCompte(null);
      return;
    }

    try {
      await updateCompte(editCompte.compte_id, payload);
      await loadData();
      setEditCompte(null);
    } catch (err) {
      alert((err as Error).message || "Erreur lors de la mise a jour du compte");
    }
  }

  const filteredFactures = useMemo(() => {
    const matchesNode = (f: FactureItem) => {
      if (selectedNode.type === "entreprise") return true;
      if (selectedNode.type === "lot") return f.lot === selectedNode.lot;
      return f.compte_id === selectedNode.compte_id;
    };
    return factures
      .filter((f) => selectedStatutsFilter.has(f.statut) && matchesNode(f))
      .sort((a, b) => {
        const dateComp = b.date_key.localeCompare(a.date_key);
        if (dateComp !== 0) return dateComp;
        const statutWeight: Record<number, number> = { 1: 0, 2: 1, 0: 2 };
        const statutComp = (statutWeight[a.statut] || 3) - (statutWeight[b.statut] || 3);
        if (statutComp !== 0) return statutComp;
        const lotComp = a.lot.localeCompare(b.lot);
        if (lotComp !== 0) return lotComp;
        const compteComp = a.compte_num.localeCompare(b.compte_num);
        if (compteComp !== 0) return compteComp;
        return a.facture_num.localeCompare(b.facture_num);
      });
  }, [factures, selectedNode, selectedStatutsFilter]);

  const timelineByMonth = useMemo(() => {
    const grouped = new Map<string, FactureItem[]>();
    filteredFactures.forEach((f) => {
      if (!grouped.has(f.date_key)) grouped.set(f.date_key, []);
      grouped.get(f.date_key)!.push(f);
    });
    const monthKeys = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));
    return monthKeys.map((key) => ({
      date_key: key,
      mois: formatMois(key),
      factures: grouped.get(key)!,
      stats: grouped.get(key)!.reduce(
        (acc, f) => {
          acc[f.statut] = (acc[f.statut] || 0) + 1;
          return acc;
        },
        { 0: 0, 1: 0, 2: 0 } as Record<number, number>
      ),
    }));
  }, [filteredFactures]);

  const statusFilterChips = [
    { statut: 1, label: "Valide", color: "#10b981" },
    { statut: 2, label: "Conteste", color: "#f59e0b" },
    { statut: 0, label: "Importe", color: "#9ca3af" },
  ];

  function handleStatusChipClick(statut: number, e: React.MouseEvent<HTMLButtonElement>) {
    if (e.detail === 2) {
      setSelectedStatutsFilter(new Set([statut]));
      return;
    }
    setSelectedStatutsFilter((prev) => {
      const next = new Set(prev);
      if (next.has(statut)) next.delete(statut);
      else next.add(statut);
      return next;
    });
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

  if (!entreprise) {
    return (
      <div className="app app--fullwidth">
        <button onClick={onBack} className="back-button">
          ← Retour
        </button>
        <div className="card">
          <p>Aucune donnee de facturation</p>
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

      <section
        className="card"
        style={{
          padding: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 320px) 1fr",
            gap: "1px",
            background: "#e5e7eb",
          }}
        >
          <aside
            style={{
              background: "#f9fafb",
              padding: "1.25rem",
              minHeight: "60vh",
            }}
          >
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>Navigation</div>
              <h3 style={{ margin: "0.15rem 0 0.35rem", fontSize: "1.1rem" }}>
                {entreprise.nom}
              </h3>
              <div style={{ marginBottom: "0.65rem", color: "#374151", fontWeight: 600 }}>
                {formatStatutPercentage(globalStats)}
              </div>
              <StatusBar stats={globalStats} height={10} />
            </div>

            <div
              style={{
                borderTop: "1px solid #e5e7eb",
                paddingTop: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem",
              }}
            >
              <button
                onClick={() => setSelectedNode({ type: "entreprise" })}
                style={{
                  textAlign: "left",
                  border: "1px solid #e5e7eb",
                  background: selectedNode.type === "entreprise" ? "#eef2ff" : "white",
                  padding: "0.65rem 0.75rem",
                  borderRadius: "0.6rem",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Toutes les factures</span>
                  <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>{factures.length}</span>
                </div>
                <div style={{ marginTop: "0.35rem" }}>
                  <StatusBar stats={globalStats} height={8} />
                </div>
              </button>

              {treeLots.map((lot) => {
                const lotCollapsed = collapsedLots.has(lot.lot);
                return (
                <div
                  key={lot.lot}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.65rem",
                    background:
                      selectedNode.type === "lot" && selectedNode.lot === lot.lot ? "#eef2ff" : "white",
                    padding: "0.65rem 0.75rem",
                    cursor: "pointer",
                    }}
                  onClick={() => toggleLotCollapse(lot.lot)}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <button
                      onClick={() => {
                        setSelectedNode({ type: "lot", lot: lot.lot });
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        textAlign: "left",
                        cursor: "pointer",
                        color: "#111827",
                        flex: 1,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#111827" }}>{lot.lot || "Lot inconnu"}</div>
                      <div style={{ color: "#4b5563", fontSize: "0.9rem" }}>
                        {formatStatutPercentage(lot.stats)}
                      </div>
                    </button>
                    <span style={{ color: "#4b5563", fontSize: "0.9rem", marginRight: "0.5rem" }}>
                      {lot.stats[0] + lot.stats[1] + lot.stats[2]}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLotCollapse(lot.lot);
                      }}
                      style={{
                        border: "1px solid #d1d5db",
                        background: "white",
                        color: "#111827",
                        borderRadius: "0.4rem",
                        padding: "0.2rem 0.45rem",
                        cursor: "pointer",
                        fontWeight: 700,
                        minWidth: "2.4rem",
                      }}
                      aria-label={lotCollapsed ? "Déplier le lot" : "Réduire le lot"}
                    >
                      {lotCollapsed ? "▼" : "▲"}
                    </button>
                  </div>

                  <div style={{ marginTop: "0.4rem", marginBottom: "0.35rem" }}>
                    <StatusBar stats={lot.stats} height={7} />
                  </div>

                  {!lotCollapsed && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                      {lot.comptes.map((compte) => {
                        const active =
                          selectedNode.type === "compte" && selectedNode.compte_id === compte.compte_id;
                      return (
                        <div
                          key={compte.compte_id}
                          style={{
                            padding: "0.45rem 0.55rem",
                              borderRadius: "0.55rem",
                              background: active ? "#eef2ff" : "#f9fafb",
                              border: active ? "1px solid #c7d2fe" : "1px solid #e5e7eb",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.25rem",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                                alignItems: "center",
                                gap: "0.5rem",
                              }}
                            >
                            <button
                              onClick={() =>
                                setSelectedNode({ type: "compte", lot: lot.lot, compte_id: compte.compte_id })
                              }
                              style={{
                                  background: "transparent",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  textAlign: "left",
                                  flex: 1,
                                  color: "#111827",
                                }}
                              >
                                <div style={{ fontWeight: 700 }}>
                                  {compte.compte_nom || compte.compte_num}
                                </div>
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>
                                  {compte.compte_num}
                                </div>
                              </button>
                              <button
                                onClick={() => openEditCompteFromNode(compte, lot.lot)}
                                style={{
                                  border: "1px solid #e5e7eb",
                                  background: "white",
                                  borderRadius: "0.4rem",
                                  padding: "0.15rem 0.35rem",
                                  cursor: "pointer",
                                  color: "#111827",
                                  fontWeight: 600,
                                }}
                              >
                                Editer
                              </button>
                            </div>
                            <StatusBar stats={compte.stats} height={6} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
              })}
            </div>
          </aside>

          <main
            style={{
              background: "white",
              padding: "1.25rem 1.5rem",
              minHeight: "60vh",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>Fil chronologique</div>
                <div style={{ fontWeight: 700 }}>
                  {filteredFactures.length} facture(s) affichee(s)
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {statusFilterChips.map((chip) => {
                  const active = selectedStatutsFilter.has(chip.statut);
                  return (
                    <button
                      key={chip.statut}
                      onClick={(e) => handleStatusChipClick(chip.statut, e)}
                      style={{
                        border: active ? `2px solid ${chip.color}` : "1px solid #d1d5db",
                        background: active ? "#f8fafc" : "white",
                        color: chip.color,
                        borderRadius: "999px",
                        padding: "0.4rem 0.75rem",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "0.9rem",
                      }}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              {timelineByMonth.length === 0 && (
                <div
                  style={{
                    padding: "1.25rem",
                    border: "1px dashed #d1d5db",
                    borderRadius: "0.75rem",
                    background: "#f9fafb",
                    color: "#6b7280",
                  }}
                >
                  Aucune facture a afficher avec les filtres actuels.
                </div>
              )}

              {timelineByMonth.map((month) => {
                const monthCollapsed = collapsedMonths.has(month.date_key);
                return (
                <section
                  key={month.date_key}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.85rem",
                    padding: "0.85rem 1rem",
                    background: "#f8fafc",
                  }}
                >
                  <div
                    onClick={() => toggleMonthCollapse(month.date_key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      marginBottom: "0.75rem",
                      justifyContent: "space-between",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "999px",
                          background: "#3b82f6",
                        }}
                      />
                      <div style={{ fontWeight: 800, fontSize: "1rem", color: "#111827" }}>
                        {month.mois} ({month.date_key})
                      </div>
                      <div style={{ color: "#4b5563", fontSize: "0.9rem" }}>
                        {month.factures.length} facture(s)
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMonthCollapse(month.date_key);
                      }}
                      style={{
                        border: "1px solid #d1d5db",
                        background: "white",
                        color: "#111827",
                        borderRadius: "0.4rem",
                        padding: "0.25rem 0.55rem",
                        cursor: "pointer",
                        fontWeight: 700,
                        minWidth: "2.6rem",
                      }}
                      aria-label={monthCollapsed ? "Déplier le mois" : "Réduire le mois"}
                    >
                      {monthCollapsed ? "▼" : "▲"}
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      flexWrap: "wrap",
                      marginBottom: "0.35rem",
                    }}
                  >
                    <StatusBar stats={month.stats} height={8} />
                    <div style={{ color: "#111827", fontSize: "0.9rem", fontWeight: 600 }}>
                      Valide: {month.stats[1] || 0} · Conteste: {month.stats[2] || 0} · Importe:{" "}
                      {month.stats[0] || 0}
                    </div>
                  </div>

                  {!monthCollapsed && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                      {month.factures.map((f) => {
                        const meta = statutMeta(f.statut);
                        return (
                          <div
                            key={`${f.facture_id}-${f.compte_id}`}
                            onClick={() => handleFactureClick(f)}
                            style={{
                              background: "white",
                              border: "1px solid #e5e7eb",
                              borderRadius: "0.75rem",
                              padding: "0.85rem 1rem",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.65rem",
                              boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "0.75rem",
                                flexWrap: "wrap",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <span
                                  style={{
                                    padding: "0.2rem 0.65rem",
                                    borderRadius: "999px",
                                    background: meta.bg,
                                    color: meta.color,
                                    fontWeight: 700,
                                    border: `1px solid ${meta.color}`,
                                    fontSize: "0.9rem",
                                  }}
                                >
                                  {meta.label}
                                </span>
                                <div style={{ fontWeight: 800, fontSize: "1rem", color: "#111827" }}>
                                  Facture {f.facture_num}
                                </div>
                              </div>
                              <div style={{ color: "#4b5563", fontSize: "0.9rem" }}>
                                {decodeFactureStatus(f.statut)}
                              </div>
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                                gap: "0.5rem",
                                alignItems: "start",
                              }}
                            >
                              <div>
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>Lot</div>
                                <div style={{ fontWeight: 700, color: "#111827" }}>{f.lot || "Non renseigne"}</div>
                              </div>
                              <div>
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>Compte</div>
                                <div style={{ fontWeight: 700, color: "#111827" }}>
                                  {f.compte_nom || f.compte_num}
                                </div>
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>
                                  {f.compte_num}
                                </div>
                              </div>
                              <div>
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>Montant HT</div>
                                <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#111827" }}>
                                  {f.total.toFixed(2)} €
                                </div>
                              </div>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                  gap: "0.3rem",
                                }}
                              >
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>Abo</div>
                                <div style={{ textAlign: "right", fontWeight: 700, color: "#111827" }}>
                                  {f.abo.toFixed(2)} €
                                </div>
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>Conso</div>
                                <div style={{ textAlign: "right", fontWeight: 700, color: "#111827" }}>
                                  {f.conso.toFixed(2)} €
                                </div>
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>Remises</div>
                                <div style={{ textAlign: "right", fontWeight: 700, color: "#111827" }}>
                                  {f.remises.toFixed(2)} €
                                </div>
                                <div style={{ color: "#4b5563", fontSize: "0.85rem" }}>Achat</div>
                                <div style={{ textAlign: "right", fontWeight: 700, color: "#111827" }}>
                                  {f.achat.toFixed(2)} €
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditCompteFromNode(
                                    {
                                      compte_id: f.compte_id,
                                      compte_num: f.compte_num,
                                      compte_nom: f.compte_nom,
                                      stats: cloneStats(),
                                    },
                                    f.lot
                                  );
                                }}
                                style={{
                                  padding: "0.5rem 0.9rem",
                                  borderRadius: "0.5rem",
                                  border: "1px solid #e5e7eb",
                                  background: "#f9fafb",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                  color: "#111827",
                                }}
                              >
                                Editer le compte
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
              })}
            </div>
          </main>
        </div>
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
                Editer le compte {editCompte.compte_num}
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
                  value={editCompte.nomValue}
                  onChange={(e) => setEditCompte({ ...editCompte, nomValue: e.target.value })}
                  placeholder="Nom affiche (optionnel)"
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
                  const lotOptions = Array.from(new Set(treeLots.map((l) => l.lot).filter(Boolean)));
                  const currentLot = editCompte.lotValue || "";
                  const isCustom = currentLot !== "" && !lotOptions.includes(currentLot);
                  return (
                    <>
                      <select
                        value={isCustom ? "__custom__" : currentLot}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "__custom__") {
                            setEditCompte({ ...editCompte, lotValue: "" });
                          } else {
                            setEditCompte({ ...editCompte, lotValue: val });
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
                          onChange={(e) => setEditCompte({ ...editCompte, lotValue: e.target.value })}
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

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.75rem",
                marginTop: "1.5rem",
                alignItems: "center",
              }}
            >
              <button
                onClick={() => deleteCompteAll(editCompte.compte_id)}
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
