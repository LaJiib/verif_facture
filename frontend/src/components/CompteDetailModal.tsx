import { useState, useEffect } from "react";
import { executeQuery } from "../newApi";

interface CompteDetailModalProps {
  compteId: number;
  compteNum: string;
  compteNom: string | null;
  mois?: string; // Format: YYYY-MM, optionnel pour filtrer sur un mois
  onClose: () => void;
}

interface StatsGlobales {
  total_abo: number;
  total_conso: number;
  total_remises: number;
  total_achat: number;
  total_ht: number;
}

interface DetailLigne {
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
}: CompteDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"stats" | "lignes">("stats");
  const [statsGlobales, setStatsGlobales] = useState<StatsGlobales | null>(null);
  const [detailLignes, setDetailLignes] = useState<DetailLigne[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [compteId, mois]);

  function formatMoisDisplay(dateKey: string): string {
    const [year, month] = dateKey.split("-");
    const moisMap: { [key: string]: string } = {
      "01": "Janvier", "02": "Février", "03": "Mars", "04": "Avril",
      "05": "Mai", "06": "Juin", "07": "Juillet", "08": "Août",
      "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Décembre",
    };
    return `${moisMap[month]} ${year}`;
  }

  async function loadData() {
    setIsLoading(true);
    try {
      // Condition de filtrage par mois
      const moisFilter = mois ? `AND strftime('%Y-%m', f.date) = '${mois}'` : '';

      // Requête pour stats globales
      const statsQuery = `
        SELECT
          SUM(lf.abo) as total_abo,
          SUM(lf.conso) as total_conso,
          SUM(lf.remises) as total_remises,
          SUM(lf.achat) as total_achat,
          SUM(lf.abo + lf.conso + lf.remises + lf.achat) as total_ht
        FROM factures f
        JOIN lignes_factures lf ON lf.facture_id = f.id
        WHERE f.compte_id = ${compteId}
        ${moisFilter}
      `;
      const statsResult = await executeQuery(statsQuery);
      if (statsResult.data && statsResult.data.length > 0) {
        setStatsGlobales(statsResult.data[0]);
      }

      // Requête pour détail par ligne
      const lignesQuery = `
        SELECT
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
    } catch (error) {
      console.error("Erreur lors du chargement des détails:", error);
    } finally {
      setIsLoading(false);
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
                      <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                        {statsGlobales.total_ht.toFixed(2)} €
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
                      <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                        {statsGlobales.total_abo.toFixed(2)} €
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
                      <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                        {statsGlobales.total_conso.toFixed(2)} €
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
                      <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                        {statsGlobales.total_achat.toFixed(2)} €
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
                      <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
                        {statsGlobales.total_remises.toFixed(2)} €
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
                          <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Numéro</th>
                          <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600" }}>Type</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Abo</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Conso</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Remises</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Achats</th>
                          <th style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>Total HT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLignes.map((ligne, idx) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: "1px solid #e5e7eb",
                              background: idx % 2 === 0 ? "white" : "#f9fafb",
                            }}
                          >
                            <td style={{ padding: "0.75rem", fontWeight: "500" }}>{ligne.ligne_num}</td>
                            <td style={{ padding: "0.75rem", color: "#6b7280", fontSize: "0.875rem" }}>
                              {ligne.ligne_type}
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              {ligne.abo.toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              {ligne.conso.toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", color: "#14b8a6" }}>
                              {ligne.remises.toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", color: "#ef4444" }}>
                              {ligne.achat.toFixed(2)} €
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: "600" }}>
                              {ligne.total_ht.toFixed(2)} €
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
            textAlign: "right",
          }}
        >
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
