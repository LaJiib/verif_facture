
import { useState, useEffect } from "react";
import { executeQuery, deleteEntreprise } from "../newApi";
import { computeVariation } from "../utils/variation";

interface HomePageProps {
  entrepriseId: number;
  entrepriseNom: string;
  onNavigateToFactures: () => void;
  onNavigateToImport: () => void;
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
  statuts: Record<string, number>;
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
  onReloadEntreprises,
}: HomePageProps) {
  const [stats, setStats] = useState<BaseStats | null>(null);
  const [lastMonthStats, setLastMonthStats] = useState<LastMonthStats | null>(null);
  const [lignesParType, setLignesParType] = useState<{ type: string; count: number }[]>([]);
  const [statutsGlobal, setStatutsGlobal] = useState<Record<string, number>>({});
  const [showLignesParType, setShowLignesParType] = useState(false);
  const [showLastMonthDetail, setShowLastMonthDetail] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    loadStats();
  }, [entrepriseId]);

  async function loadStats() {
    try {
      const globalQuery = `
        SELECT
          (SELECT COUNT(*) FROM comptes c WHERE c.entreprise_id = ${entrepriseId}) as nb_comptes,
          (SELECT COUNT(*) FROM lignes l JOIN comptes c2 ON l.compte_id = c2.id WHERE c2.entreprise_id = ${entrepriseId}) as nb_lignes,
          (SELECT COUNT(*) FROM factures f JOIN comptes c3 ON f.compte_id = c3.id WHERE c3.entreprise_id = ${entrepriseId}) as nb_factures
      `;

      const lignesParTypeQuery = `
        SELECT l.type as type, COUNT(*) as count
        FROM lignes l
        JOIN comptes c ON l.compte_id = c.id
        WHERE c.entreprise_id = ${entrepriseId}
        GROUP BY l.type
        ORDER BY count DESC
      `;

      const statutsGlobalQuery = `
        SELECT f.statut as statut, COUNT(*) as count
        FROM factures f
        JOIN comptes c ON f.compte_id = c.id
        WHERE c.entreprise_id = ${entrepriseId}
        GROUP BY f.statut
      `;

      const monthsTotalsQuery = `
        SELECT strftime('%Y-%m', f.date) as mois,
               SUM(f.abo + f.conso + f.remises + f.achat) as total_ht,
               SUM(f.abo) as abo,
               SUM(f.conso) as conso,
               SUM(f.remises) as remises,
               SUM(f.achat) as achat,
               COUNT(DISTINCT f.id) as nb_factures
        FROM factures f
        JOIN comptes c ON f.compte_id = c.id
        WHERE c.entreprise_id = ${entrepriseId}
        GROUP BY mois
        ORDER BY mois DESC
        LIMIT 2
      `;

      const [globalResult, lignesResult, statutsResult, monthsTotalsResult] = await Promise.all([
        executeQuery(globalQuery),
        executeQuery(lignesParTypeQuery),
        executeQuery(statutsGlobalQuery),
        executeQuery(monthsTotalsQuery),
      ]);

      if (globalResult.data && globalResult.data.length > 0) {
        setStats({
          nb_comptes: globalResult.data[0].nb_comptes || 0,
          nb_lignes: globalResult.data[0].nb_lignes || 0,
          nb_factures: globalResult.data[0].nb_factures || 0,
        });
      }

      setLignesParType(lignesResult.data || []);

      const statutsMap: Record<string, number> = {};
      (statutsResult.data || []).forEach((row: any) => {
        statutsMap[row.statut || "Inconnu"] = row.count || 0;
      });
      setStatutsGlobal(statutsMap);

      const moisCourant = monthsTotalsResult.data?.[0];
      const moisPrecedent = monthsTotalsResult.data?.[1];

      if (moisCourant) {
        const moisKey = moisCourant.mois;
        const lastMonthStatusQuery = `
          SELECT f.statut as statut, COUNT(*) as count
          FROM factures f
          JOIN comptes c ON f.compte_id = c.id
          WHERE c.entreprise_id = ${entrepriseId}
            AND strftime('%Y-%m', f.date) = '${moisKey}'
          GROUP BY f.statut
        `;
        const lmStatusResult = await executeQuery(lastMonthStatusQuery);
        const statutsDernierMois: Record<string, number> = {};
        (lmStatusResult.data || []).forEach((row: any) => {
          statutsDernierMois[row.statut || "Inconnu"] = row.count || 0;
        });

        const variation = computeVariation(
          moisCourant.total_ht || 0,
          moisPrecedent?.total_ht ?? null
        );
        const deltaPct = variation.deltaPct;
        const trend = variation.direction === "neutral" ? "flat" : variation.direction;

        const categories: LastMonthStats["categories"] = [
          { key: "abo", label: "Abo", value: moisCourant.abo || 0, deltaPct: null, trend: "flat" },
          { key: "conso", label: "Conso", value: moisCourant.conso || 0, deltaPct: null, trend: "flat" },
          { key: "remises", label: "Remises", value: moisCourant.remises || 0, deltaPct: null, trend: "flat" },
          { key: "achat", label: "Achats", value: moisCourant.achat || 0, deltaPct: null, trend: "flat" },
        ];
        if (moisPrecedent) {
          categories.forEach((cat) => {
            const prevVal = moisPrecedent[cat.key] || null;
            const catVariation = computeVariation(cat.value, prevVal);
            cat.deltaPct = catVariation.deltaPct;
            cat.trend =
              catVariation.direction === "neutral" ? "flat" : catVariation.direction;
          });
        }

        setLastMonthStats({
          mois: moisKey,
          total_ht: moisCourant.total_ht || 0,
          nb_factures: moisCourant.nb_factures || 0,
          statuts: statutsDernierMois,
          deltaPct,
          trend,
          categories,
        });
      } else {
        setLastMonthStats(null);
      }
    } catch (error) {
      console.error("Erreur lors du chargement des stats:", error);
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

  function getStatutCount(statuts: Record<string, number>, prefix: string): number {
    const lowerPrefix = prefix.toLowerCase();
    return Object.entries(statuts).reduce((acc, [key, value]) => {
      return key && key.toLowerCase().startsWith(lowerPrefix) ? acc + value : acc;
    }, 0);
  }

  function computeValidationRatio(statuts: Record<string, number>): number {
    const valides = getStatutCount(statuts, "valid");
    const total = Object.values(statuts).reduce((acc, v) => acc + v, 0);
    if (total === 0) return 0;
    return (valides / total) * 100;
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

  const deltaText =
    lastMonthStats?.deltaPct != null
      ? `${lastMonthStats.deltaPct >= 0 ? "+" : ""}${lastMonthStats.deltaPct.toFixed(1)}%`
      : "N/A";
  const trendSymbol = lastMonthStats?.trend === "down" ? "↓" : lastMonthStats?.trend === "up" ? "↑" : "→";
  const trendColor = lastMonthStats?.trend === "down" ? "#dc2626" : lastMonthStats?.trend === "up" ? "#16a34a" : "#6b7280";

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

          <div style={{ background: "white", borderRadius: "0.5rem", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", gridColumn: "span 2" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.35rem" }}>Progression de verification</div>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#1f2937" }}>{computeValidationRatio(statutsGlobal).toFixed(0)}%</div>
              </div>
              <div style={{ color: "#6b7280", fontSize: "0.9rem", textAlign: "right" }}>Valide / Total factures</div>
            </div>
            <div style={{ marginTop: "0.75rem", background: "#e5e7eb", height: "10px", borderRadius: "9999px", overflow: "hidden" }}>
              <div style={{ width: `${computeValidationRatio(statutsGlobal)}%`, height: "100%", background: "#10b981", transition: "width 0.3s ease" }} />
            </div>
            <div style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: "0.4rem" }}>
              {statutsGlobal && Object.keys(statutsGlobal).length > 0
                ? `Validees: ${getStatutCount(statutsGlobal, "valid")} / Contestees: ${getStatutCount(statutsGlobal, "contest")} / Importees: ${getStatutCount(statutsGlobal, "import")}`
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
            onClick={() => setShowLignesParType(false)}
          >
            <div
              style={{
                background: "white",
                borderRadius: "0.75rem",
                padding: "1.5rem",
                width: "90%",
                maxWidth: "720px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ fontSize: "1.25rem", fontWeight: "600", margin: 0 }}>Lignes par type</h2>
                <button
                  onClick={() => setShowLignesParType(false)}
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
                    <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.9rem", background: "#f9fafb" }}>
                      <div style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "0.25rem" }}>{row.type || "Non renseigne"}</div>
                      <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#1f2937" }}>{row.count}</div>
                    </div>
                  ))}
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

        {/* Gestion de la base de donnees */}
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
