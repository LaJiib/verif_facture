
import { useState, useEffect } from "react";
import {
  deleteEntreprise,
  fetchUploadsForEntreprise,
  deleteUpload,
  API_BASE_URL,
  type UploadMeta,
  fetchEntrepriseDashboard,
  fetchLignesParType,
  type LignesParTypeResponse,
} from "../newApi";
import { decodeFactureStatus, decodeLineType } from "../utils/codecs";
import { StatusBar } from "../utils/statusBar";
import LigneInsightModal from "../components/LigneInsightModal";
import { computeVariation } from "../utils/variation";

interface HomePageProps {
  entrepriseId: number;
  entrepriseNom: string;
  onNavigateToFactures: () => void;
  onNavigateToImport: () => void;
  onNavigateToAbonnements: () => void;
  onReloadEntreprises: () => void;
}

interface BaseStats {
  nb_comptes: number;
  nb_lignes: number;
  nb_factures: number;
}

interface LastMonthStats {
  mois: string;
  total_ht: number;
  nb_factures: number;
  statuts: Record<number, number>;
  deltaPct: number | null;
  trend: "up" | "down" | "flat" | null;
  categories: {
    key: "abo" | "conso" | "remises" | "achat";
    label: string;
    value: number;
    deltaPct: number | null;
    trend: "up" | "down" | "flat" | null;
  }[];
}

export default function HomePage({
  entrepriseId,
  entrepriseNom,
  onNavigateToFactures,
  onNavigateToImport,
  onNavigateToAbonnements,
  onReloadEntreprises,
}: HomePageProps) {
  const [stats, setStats] = useState<BaseStats | null>(null);
  const [lastMonthStats, setLastMonthStats] = useState<LastMonthStats | null>(null);
  const [lignesParType, setLignesParType] = useState<{ type: number; count: number }[]>([]);
  const [statutsGlobal, setStatutsGlobal] = useState<Record<number, number>>({});
  const [showLignesParType, setShowLignesParType] = useState(false);
  const [showLastMonthDetail, setShowLastMonthDetail] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<UploadMeta | null>(null);
  const [drillType, setDrillType] = useState<number | null>(null);
  const [drillData, setDrillData] = useState<LignesParTypeResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const [expandedCompteId, setExpandedCompteId] = useState<number | null>(null);
  const [ligneModalId, setLigneModalId] = useState<number | null>(null);

  useEffect(() => {
    loadStats();
    loadUploads();
  }, [entrepriseId]);

  async function loadStats() {
    try {
      const dashboard = await fetchEntrepriseDashboard(entrepriseId);

      setStats({
        nb_comptes: dashboard.stats.nb_comptes,
        nb_lignes: dashboard.stats.nb_lignes,
        nb_factures: dashboard.stats.nb_factures,
      });

      setLignesParType(dashboard.lignes_par_type.map((row) => ({ type: Number(row.type), count: Number(row.count) })));

      const statutsMap: Record<number, number> = {};
      Object.entries(dashboard.statuts_global || {}).forEach(([k, v]) => {
        statutsMap[Number(k)] = Number(v as number);
      });
      setStatutsGlobal(statutsMap);

      if (dashboard.last_month) {
        const lm = dashboard.last_month;
        const lmStatuts: Record<number, number> = {};
        Object.entries(lm.statuts || {}).forEach(([k, v]) => {
          lmStatuts[Number(k)] = Number(v as number);
        });

        const categories: LastMonthStats["categories"] = [
          {
            key: "abo",
            label: "Abo",
            value: lm.categories.abo || 0,
            deltaPct: lm.categories_delta?.abo ?? null,
            trend:
              lm.categories_delta?.abo == null
                ? "flat"
                : lm.categories_delta.abo > 0
                ? "up"
                : lm.categories_delta.abo < 0
                ? "down"
                : "flat",
          },
          {
            key: "conso",
            label: "Conso",
            value: lm.categories.conso || 0,
            deltaPct: lm.categories_delta?.conso ?? null,
            trend:
              lm.categories_delta?.conso == null
                ? "flat"
                : lm.categories_delta.conso > 0
                ? "up"
                : lm.categories_delta.conso < 0
                ? "down"
                : "flat",
          },
          {
            key: "remises",
            label: "Remises",
            value: lm.categories.remises || 0,
            deltaPct: lm.categories_delta?.remises ?? null,
            trend:
              lm.categories_delta?.remises == null
                ? "flat"
                : lm.categories_delta.remises > 0
                ? "up"
                : lm.categories_delta.remises < 0
                ? "down"
                : "flat",
          },
          {
            key: "achat",
            label: "Achats",
            value: lm.categories.achat || 0,
            deltaPct: lm.categories_delta?.achat ?? null,
            trend:
              lm.categories_delta?.achat == null
                ? "flat"
                : lm.categories_delta.achat > 0
                ? "up"
                : lm.categories_delta.achat < 0
                ? "down"
                : "flat",
          },
        ];

        setLastMonthStats({
          mois: lm.mois,
          total_ht: lm.total_ht || 0,
          nb_factures: lm.nb_factures || 0,
          statuts: lmStatuts,
          deltaPct: lm.delta_pct ?? null,
          trend: (lm.trend as any) ?? null,
          categories,
        });
      } else {
        setLastMonthStats(null);
      }
    } catch (error) {
      console.error("Erreur lors du chargement des stats:", error);
    }
  }

  async function loadUploads() {
    setUploadsLoading(true);
    setUploadsError(null);
    try {
      const res = await fetchUploadsForEntreprise(entrepriseId, { limit: 200 });
      setUploads(res.uploads || []);
    } catch (error) {
      setUploadsError((error as Error).message);
    } finally {
      setUploadsLoading(false);
    }
  }

  function formatMois(dateKey: string): string {
    const [year, month] = dateKey.split("-");
    const moisMap: { [key: string]: string } = {
      "01": "Jan", "02": "Fev", "03": "Mar", "04": "Avr",
      "05": "Mai", "06": "Juin", "07": "Juil", "08": "Aout",
      "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
    };
    return `${moisMap[month]} ${year}`;
  }

  function getStatutCount(statuts: Record<number, number>, code: number): number {
    return statuts[code] || 0;
  }

  function computeValidationRatio(statuts: Record<number, number>): number {
    const valides = getStatutCount(statuts, 1);
    const total = Object.values(statuts).reduce((acc, v) => acc + v, 0);
    if (total === 0) return 0;
    return (valides / total) * 100;
  }

  function groupUploadsByMonth(items: UploadMeta[]): { month: string; uploads: UploadMeta[] }[] {
    const map = new Map<string, UploadMeta[]>();
    items.forEach((u) => {
      // Priorité à la date du CSV si fournie par le backend, sinon fallback upload
      const key = u.uploaded_month || "Inconnu";
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(u);
    });
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, uploads]) => ({ month, uploads }));
  }

  async function handleDeleteAllData() {
    if (deleteConfirm !== "SUPPRIMER") {
      alert("Vous devez taper 'SUPPRIMER' pour confirmer");
      return;
    }

    if (!confirm(`ATTENTION : Toutes les donnees de l'entreprise "${entrepriseNom}" seront supprimees. Cette action est irreversible. Continuer ?`)) {
      return;
    }

    try {
      await deleteEntreprise(entrepriseId);
      alert("Entreprise et toutes ses donnees supprimees avec succes");
      await onReloadEntreprises();
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
      alert("Erreur lors de la suppression de l'entreprise");
    }
  }

  async function handleDeleteUpload(uploadId: string) {
    if (!confirm("Supprimer définitivement ce fichier CSV du stockage ?")) {
      return;
    }
    try {
      await deleteUpload(uploadId);
      setUploads((prev) => prev.filter((u) => u.upload_id !== uploadId));
    } catch (error) {
      alert((error as Error).message);
    }
  }

  const deltaText =
    lastMonthStats?.deltaPct != null
      ? `${lastMonthStats.deltaPct >= 0 ? "+" : ""}${lastMonthStats.deltaPct.toFixed(1)}%`
      : "N/A";
  const trendSymbol = lastMonthStats?.trend === "down" ? "↓" : lastMonthStats?.trend === "up" ? "↑" : "→";
  const trendColor = lastMonthStats?.trend === "down" ? "#dc2626" : lastMonthStats?.trend === "up" ? "#16a34a" : "#6b7280";
  const groupedUploads = groupUploadsByMonth(uploads);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "2rem",
      }}
    >
      {/* En-tete */}
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: "bold",
            color: "#1f2937",
            marginBottom: "0.5rem",
          }}
        >
          {entrepriseNom}
        </h1>
        <p style={{ color: "#6b7280", marginBottom: "2rem" }}>
          Dashboard et gestion de l'entreprise
        </p>

        {/* Statistiques */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "1.5rem",
            marginBottom: showLignesParType ? "2rem" : "2rem",
            position: "relative",
          }}
        >
          <div style={{ background: "white", borderRadius: "0.5rem", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>Comptes de facturation</div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#1f2937" }}>{stats?.nb_comptes || 0}</div>
          </div>

          <div
            style={{ background: "white", borderRadius: "0.5rem", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", cursor: "pointer" }}
            onClick={() => setShowLignesParType((v) => !v)}
            title="Afficher le detail des lignes par type"
          >
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>Lignes telecom</div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#1f2937" }}>{stats?.nb_lignes || 0}</div>
            <div style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: "0.35rem" }}>
              {showLignesParType ? "Masquer le detail" : "Afficher par type"}
            </div>
          </div>

          <div style={{ background: "white", borderRadius: "0.5rem", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>Factures</div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#1f2937" }}>{stats?.nb_factures || 0}</div>
          </div>

          <div
            style={{ background: "white", borderRadius: "0.5rem", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", cursor: "pointer" }}
            onClick={() => setShowLastMonthDetail(true)}
          >
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>Dernier mois (HT)</div>
            <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#1f2937" }}>
              {lastMonthStats ? `${lastMonthStats.total_ht.toFixed(2)} €` : "Aucune donnee"}
            </div>
            <div style={{ color: "#6b7280", fontSize: "0.9rem", marginTop: "0.4rem" }}>
              {lastMonthStats ? `${lastMonthStats.nb_factures} facture(s) - ${formatMois(lastMonthStats.mois)}` : "Importez des factures pour voir le dernier mois."}
            </div>
            <div style={{ color: trendColor, fontSize: "0.85rem", marginTop: "0.3rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span style={{ fontWeight: 700 }}>{trendSymbol}</span>
              <span>{deltaText}</span>
            </div>
          </div>

          <div
            style={{ background: "white", borderRadius: "0.5rem", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", cursor: "pointer" }}
            onClick={onNavigateToAbonnements}
            title="Répartition des abonnements sur le dernier mois"
          >
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>Abonnements</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#1f2937" }}>Voir la répartition</div>
            <div style={{ color: "#6b7280", fontSize: "0.9rem", marginTop: "0.4rem" }}>Cliquez pour visualiser</div>
          </div>

          <div style={{ background: "white", borderRadius: "0.5rem", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", gridColumn: "span 2" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.35rem" }}>Progression de verification</div>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#1f2937" }}>{computeValidationRatio(statutsGlobal).toFixed(0)}%</div>
              </div>
              <div style={{ color: "#6b7280", fontSize: "0.9rem", textAlign: "right" }}>Valide / Total factures</div>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <StatusBar stats={statutsGlobal} height={12} />
            </div>
            <div style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: "0.4rem" }}>
              {statutsGlobal && Object.keys(statutsGlobal).length > 0
                ? `Validees: ${getStatutCount(statutsGlobal, 1)} / Contestees: ${getStatutCount(statutsGlobal, 2)} / Importees: ${getStatutCount(statutsGlobal, 0)}`
                : "Aucune facture encore importee"}
            </div>
          </div>
        </div>

        {showLignesParType && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              paddingTop: "10vh",
              zIndex: 1000,
            }}
            onClick={() => {
              setShowLignesParType(false);
              setDrillType(null);
              setDrillData(null);
              setDrillError(null);
            }}
          >
            <div
              style={{
                background: "white",
                borderRadius: "0.75rem",
                padding: "1.5rem",
                width: "90%",
                maxWidth: "900px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                maxHeight: "80vh",
                overflowY: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ fontSize: "1.25rem", fontWeight: "600", margin: 0 }}>Lignes par type</h2>
                <button
                  onClick={() => {
                    setShowLignesParType(false);
                    setDrillType(null);
                    setDrillData(null);
                    setDrillError(null);
                  }}
                  style={{ border: "none", background: "transparent", fontSize: "1.2rem", cursor: "pointer", color: "#6b7280" }}
                  aria-label="Fermer"
                >
                  ✕
                </button>
              </div>

              {lignesParType.length === 0 ? (
                <p style={{ color: "#6b7280" }}>Aucune ligne detectee pour le moment.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
                  {lignesParType.map((row, idx) => (
                    <div
                      key={idx}
                      style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.9rem", background: "#f9fafb", cursor: "pointer" }}
                      onClick={async () => {
                        setDrillType(row.type);
                        setDrillLoading(true);
                        setDrillError(null);
                        setExpandedLot(null);
                        setExpandedCompteId(null);
                        try {
                          const res = await fetchLignesParType(entrepriseId, row.type);
                          setDrillData(res);
                        } catch (err) {
                          setDrillError((err as Error).message);
                        } finally {
                          setDrillLoading(false);
                        }
                      }}
                    >
                      <div style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "0.25rem" }}>{decodeLineType(row.type)}</div>
                      <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#1f2937" }}>{row.count}</div>
                    </div>
                  ))}
                </div>
              )}

              {drillLoading && <p style={{ color: "#6b7280", marginTop: "1rem" }}>Chargement de la répartition...</p>}
              {drillError && <p style={{ color: "#b91c1c", marginTop: "1rem" }}>{drillError}</p>}

              {drillData && drillType !== null && (
                <div style={{ marginTop: "1rem" }}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.05rem" }}>
                    Répartition {decodeLineType(drillType)} par lot
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {drillData.lots.map((lot) => (
                      <div
                        key={lot.lot}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: "0.5rem",
                          padding: "0.85rem",
                          background: "#fff",
                        }}
                      >
                        <div
                          style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
                          onClick={() => {
                            setExpandedLot(expandedLot === lot.lot ? null : lot.lot);
                            setExpandedCompteId(null);
                          }}
                        >
                          <div style={{ fontWeight: 700, color: "#111827" }}>{lot.lot}</div>
                          <div style={{ color: "#6b7280" }}>{lot.total} ligne(s)</div>
                        </div>
                        {expandedLot === lot.lot && (
                          <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                            {lot.comptes.map((c) => (
                              <div
                                key={c.compte_id}
                                style={{
                                  border: "1px solid #e5e7eb",
                                  borderRadius: "0.4rem",
                                  padding: "0.6rem",
                                  background: "#f9fafb",
                                  cursor: "pointer",
                                }}
                                onClick={() => setExpandedCompteId(expandedCompteId === c.compte_id ? null : c.compte_id)}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <div>
                                    <div style={{ fontWeight: 700, color: "#111827" }}>
                                      Compte {c.compte_num} {c.compte_nom ? `- ${c.compte_nom}` : ""}
                                    </div>
                                    <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>{c.total} ligne(s)</div>
                                  </div>
                                </div>
                                {expandedCompteId === c.compte_id && (
                                  <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                                    {c.lignes.map((l) => (
                                      <div
                                        key={l.id}
                                        style={{
                                          border: "1px solid #e5e7eb",
                                          borderRadius: "0.35rem",
                                          padding: "0.45rem",
                                          background: "#fff",
                                          cursor: "pointer",
                                        }}
                                        onClick={() => setLigneModalId(l.id)}
                                      >
                                        <div style={{ fontWeight: 600, color: "#111827" }}>{l.num}</div>
                                        <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                                          {l.nom || "Sans nom"} {l.sous_compte ? `• Sous-compte: ${l.sous_compte}` : ""}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Détail dernier mois par categorie */}
        {showLastMonthDetail && lastMonthStats && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              paddingTop: "8vh",
              zIndex: 1100,
            }}
            onClick={() => setShowLastMonthDetail(false)}
          >
            <div
              style={{
                background: "white",
                borderRadius: "0.75rem",
                padding: "1.5rem",
                width: "90%",
                maxWidth: "720px",
                boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.3rem" }}>Détail du mois {formatMois(lastMonthStats.mois)}</h2>
                  <div style={{ color: "#6b7280", marginTop: "0.25rem", fontSize: "0.9rem" }}>
                    {lastMonthStats.nb_factures} facture(s) - Total {lastMonthStats.total_ht.toFixed(2)} €
                  </div>
                </div>
                <button
                  onClick={() => setShowLastMonthDetail(false)}
                  style={{ border: "none", background: "transparent", fontSize: "1.2rem", cursor: "pointer", color: "#6b7280" }}
                  aria-label="Fermer"
                >
                  ✕
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
                {lastMonthStats.categories.map((cat) => {
                  const color = cat.trend === "down" ? "#dc2626" : cat.trend === "up" ? "#16a34a" : "#6b7280";
                  const symbol = cat.trend === "down" ? "↓" : cat.trend === "up" ? "↑" : "→";
                  const delta =
                    cat.deltaPct != null && cat.deltaPct !== Infinity
                      ? `${cat.deltaPct >= 0 ? "+" : ""}${cat.deltaPct.toFixed(1)}%`
                      : "N/A";
                  return (
                    <div key={cat.key} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem", background: "#f9fafb" }}>
                      <div style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "0.35rem" }}>{cat.label}</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: "700", color: "#1f2937" }}>{cat.value.toFixed(2)} €</div>
                      <div style={{ color, fontSize: "0.9rem", marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                        <span style={{ fontWeight: 700 }}>{symbol}</span>
                        <span>{delta}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Actions rapides */}
        <div
          style={{
            background: "white",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            marginBottom: "2rem",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "1rem" }}>
            Actions rapides
          </h2>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <button
              onClick={onNavigateToFactures}
              style={{
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "500",
              }}
            >
              Voir les factures
            </button>
            <button
              onClick={onNavigateToImport}
              style={{
                background: "#10b981",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "500",
              }}
            >
              Importer CSV
            </button>
          </div>
        </div>

        {/* Explorateur CSV */}
        <div
          style={{
            background: "white",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", gap: "0.75rem", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "0.25rem" }}>
                Fichiers CSV enregistrés
              </h2>
              <p style={{ color: "#6b7280", fontSize: "0.9rem", margin: 0 }}>
                Copie des imports (uploads) classée par mois et catégorie.
              </p>
            </div>
            <button
              onClick={loadUploads}
              style={{
                background: "#0ea5e9",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.6rem 1rem",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Rafraîchir
            </button>
          </div>

          {uploadsError && (
            <div style={{ background: "#fef2f2", color: "#991b1b", padding: "0.75rem", borderRadius: "0.375rem", marginBottom: "1rem", fontSize: "0.9rem" }}>
              {uploadsError}
            </div>
          )}

          {uploadsLoading ? (
            <p style={{ color: "#6b7280" }}>Chargement des fichiers...</p>
          ) : groupedUploads.length === 0 ? (
            <p style={{ color: "#6b7280" }}>Aucun fichier stocké pour cette entreprise.</p>
          ) : (
            <div style={{ display: "grid", gap: "1rem" }}>
              {groupedUploads.map((group) => (
                <div key={group.month} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem" }}>
                  <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                    onClick={() => {
                      setExpandedMonth(expandedMonth === group.month ? null : group.month);
                      setSelectedUpload(null);
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "#111827" }}>
                      {group.month === "Inconnu" ? "Date inconnue" : formatMois(group.month)}
                    </div>
                    <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                      {group.uploads.length} fichier{group.uploads.length > 1 ? "s" : ""} {expandedMonth === group.month ? "▾" : "▸"}
                    </span>
                  </div>

                  {expandedMonth === group.month && (
                    <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
                      {group.uploads.map((u) => (
                        <div
                          key={u.upload_id}
                          onClick={() => setSelectedUpload(u)}
                          style={{
                            border: "1px dashed #e5e7eb",
                            borderRadius: "0.5rem",
                            padding: "0.75rem",
                            background: selectedUpload?.upload_id === u.upload_id ? "#e0f2fe" : "#f8fafc",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.original_name}>
                              {u.original_name}
                            </div>
                            <span style={{ background: "#e0f2fe", color: "#0369a1", padding: "0.15rem 0.5rem", borderRadius: "999px", fontWeight: 600, fontSize: "0.85rem" }}>
                              {u.category}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "#6b7280", marginTop: "0.35rem" }}>
                            <span>{u.uploaded_at ? u.uploaded_at.split("T")[0] : "?"}</span>
                            <span>{Math.round(u.size / 1024)} Ko</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {selectedUpload && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 50,
              }}
              onClick={() => setSelectedUpload(null)}
            >
              <div
                style={{
                  width: "min(90vw, 520px)",
                  background: "white",
                  borderRadius: "0.75rem",
                  boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
                  padding: "1.25rem",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem", alignItems: "center" }}>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#111827" }}>Détails du fichier</h3>
                  <button
                    onClick={() => setSelectedUpload(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: "1.1rem",
                      cursor: "pointer",
                      color: "#6b7280",
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: "grid", gap: "0.45rem", fontSize: "0.95rem", color: "#374151", marginBottom: "1rem" }}>
                  <div><strong>Nom :</strong> {selectedUpload.original_name}</div>
                  <div><strong>Catégorie :</strong> {selectedUpload.category}</div>
                  <div><strong>Date CSV :</strong> {selectedUpload.uploaded_month || "Inconnue"}</div>
                  <div><strong>Date upload :</strong> {selectedUpload.uploaded_at || "?"}</div>
                  <div><strong>Taille :</strong> {Math.round(selectedUpload.size / 1024)} Ko</div>
                  {selectedUpload.extra?.date_min && <div><strong>Date min :</strong> {selectedUpload.extra.date_min}</div>}
                  {selectedUpload.extra?.date_max && <div><strong>Date max :</strong> {selectedUpload.extra.date_max}</div>}
                  <div><strong>Fichier :</strong> {selectedUpload.saved_as}</div>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => handleDeleteUpload(selectedUpload.upload_id)}
                    style={{
                      background: "#ef4444",
                      color: "white",
                      border: "none",
                      borderRadius: "0.375rem",
                      padding: "0.5rem 0.9rem",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Supprimer
                  </button>
                  <a
                    href={`${API_BASE_URL}/v2/read/uploads/${selectedUpload.upload_id}/download`}
                    style={{
                      background: "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "0.375rem",
                      padding: "0.5rem 0.9rem",
                      cursor: "pointer",
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    Télécharger
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Gestion de la base de donnees */}

        {ligneModalId !== null && <LigneInsightModal ligneId={ligneModalId} onClose={() => setLigneModalId(null)} />}
        <div
          style={{
            background: "white",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "1rem" }}>
            Gestion de la base de donnees
          </h2>

          <div style={{ marginBottom: "1rem" }}>
            <button
              onClick={() => setShowDangerZone(!showDangerZone)}
              style={{
                background: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "500",
              }}
            >
              Zone dangereuse
            </button>
          </div>

          {showDangerZone && (
            <div
              style={{
                background: "#fef2f2",
                border: "2px solid #ef4444",
                borderRadius: "0.5rem",
                padding: "1.5rem",
                marginTop: "1rem",
              }}
            >
              <h3 style={{ color: "#991b1b", fontSize: "1rem", fontWeight: "600", marginBottom: "1rem" }}>
                Supprimer toutes les donnees
              </h3>
              <p style={{ color: "#7f1d1d", marginBottom: "1rem", fontSize: "0.875rem" }}>
                Cette action supprimera definitivement l'entreprise "{entrepriseNom}" et toutes ses donnees associees :
              </p>
              <ul style={{ color: "#7f1d1d", marginBottom: "1rem", fontSize: "0.875rem", paddingLeft: "1.5rem" }}>
                <li>Tous les comptes ({stats?.nb_comptes || 0})</li>
                <li>Toutes les factures ({stats?.nb_factures || 0})</li>
                <li>L'entreprise elle-meme</li>
              </ul>
              <p style={{ color: "#991b1b", fontWeight: "600", marginBottom: "1rem", fontSize: "0.875rem" }}>
                Cette action est IRREVERSIBLE !
              </p>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", color: "#7f1d1d", fontSize: "0.875rem" }}>
                  Tapez <strong>"SUPPRIMER"</strong> pour confirmer :
                </label>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "2px solid #ef4444",
                    borderRadius: "0.375rem",
                    fontSize: "0.875rem",
                  }}
                  placeholder="SUPPRIMER"
                />
              </div>

              <button
                onClick={handleDeleteAllData}
                disabled={deleteConfirm !== "SUPPRIMER"}
                style={{
                  background: deleteConfirm === "SUPPRIMER" ? "#dc2626" : "#9ca3af",
                  color: "white",
                  border: "none",
                  borderRadius: "0.375rem",
                  padding: "0.75rem 1.5rem",
                  cursor: deleteConfirm === "SUPPRIMER" ? "pointer" : "not-allowed",
                  fontSize: "0.875rem",
                  fontWeight: "600",
                }}
              >
                Supprimer definitivement
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
