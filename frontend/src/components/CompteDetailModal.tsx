import { useEffect, useState } from "react";
import { executeQuery, updateLigneType } from "../newApi";

interface CompteDetailModalProps {
  compteId: number;
  compteNum: string;
  compteNom: string | null;
  mois?: string; // Format: YYYY-MM, optionnel pour filtrer sur un mois
  onClose: () => void;
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
  facture_statut: string;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  total_ht: number;
}

interface DetailLigne {
  ligne_id: number;
  ligne_num: string;
  ligne_type: string;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  total_ht: number;
}

export default function CompteDetailModal({
  compteId,
  compteNum,
  compteNom,
  mois,
  onClose,
  onPrevMonth,
  onNextMonth,
  hasPrevMonth = false,
  hasNextMonth = false,
  onDeleteMonth,
}: CompteDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"stats" | "factures" | "lignes">("stats");
  const [statsGlobales, setStatsGlobales] = useState<StatsGlobales | null>(null);
  const [prevStatsGlobales, setPrevStatsGlobales] = useState<StatsGlobales | null>(null);
  const [detailFactures, setDetailFactures] = useState<FactureDetail[]>([]);
  const [prevFactures, setPrevFactures] = useState<FactureDetail[]>([]);
  const [detailLignes, setDetailLignes] = useState<DetailLigne[]>([]);
  const [prevLignes, setPrevLignes] = useState<DetailLigne[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ligneSort, setLigneSort] = useState<{ field: keyof DetailLigne; direction: "asc" | "desc" } | null>(null);
  const [editedTypes, setEditedTypes] = useState<Record<number, string>>({});
  const [savingType, setSavingType] = useState<number | null>(null);

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
        const typesMap: Record<number, string> = {};
        lignesResult.data.forEach((l: DetailLigne) => {
          typesMap[l.ligne_id] = l.ligne_type || "";
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
      if (mois) {
        const prevFacturesQuery = `
          SELECT
            f.id as facture_id,
            f.num as facture_num,
            f.date as facture_date,
            f.statut as facture_statut,
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

  async function saveLigneType(ligneId: number, newType: string) {
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
          width: "90%",
          maxWidth: "900px",
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
                          {statsGlobales.total_ht.toFixed(2)} €
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
                          {statsGlobales.total_abo.toFixed(2)} €
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
                          {statsGlobales.total_conso.toFixed(2)} €
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
                          {statsGlobales.total_achat.toFixed(2)} €
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
                          {statsGlobales.total_remises.toFixed(2)} €
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
                                {item.value.toFixed(2)} € ({percentage.toFixed(1)}%)
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
                                {facture.facture_statut}
                              </span>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              {facture.abo.toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              {facture.conso.toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", color: "#14b8a6" }}>
                              {facture.remises.toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", color: "#ef4444" }}>
                              {facture.achat.toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>
                              {facture.total_ht.toFixed(2)} €
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
                                  const baseTypes = ["Fixe", "Mobile", "Internet", "Autre"];
                                  const currentType = editedTypes[ligne.ligne_id] ?? ligne.ligne_type;
                                  const options = baseTypes.includes(currentType)
                                    ? baseTypes
                                    : [...baseTypes, currentType];
                                  return (
                                    <select
                                      value={currentType}
                                      onChange={(e) => {
                                        const val = e.target.value;
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
                                      {options.map((type) => (
                                        <option key={`${ligne.ligne_id}-${type}`} value={type}>
                                          {type}
                                        </option>
                                      ))}
                                    </select>
                                  );
                                })()}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem" }}>
                                <span>{ligne.abo.toFixed(2)} €</span>
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
                                <span>{ligne.conso.toFixed(2)} €</span>
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
                                <span>{ligne.remises.toFixed(2)} €</span>
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
                                <span>{ligne.achat.toFixed(2)} €</span>
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
                                <span>{ligne.total_ht.toFixed(2)} €</span>
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
