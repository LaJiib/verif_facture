import { useEffect, useState } from "react";
import { getEntreprise, executeQuery, type Entreprise } from "../newApi";
import CompteDetailModal from "../components/CompteDetailModal";

interface EntreprisePageProps {
  entrepriseId: number;
  onBack: () => void;
}

interface MoisData {
  mois: string;
  date_key: string;
}

interface FactureInfo {
  num: string;
  statut: string;
}

interface CompteData {
  compte_id: number;
  compte_num: string;
  compte_nom: string | null;
  lot: string;
  montants_par_mois: Map<string, number>; // date_key -> total_ht
  factures_par_mois: Map<string, FactureInfo[]>; // date_key -> liste des factures
}

interface DetailModalData {
  compte_id: number;
  compte_num: string;
  compte_nom: string | null;
  mois?: string; // Si fourni, filtre sur ce mois
}

interface StatutStats {
  importé: number;
  validé: number;
  contesté: number;
}

interface LotData {
  lot: string;
  expanded: boolean;
  total_par_mois: Map<string, number>;
  statuts_par_mois: Map<string, StatutStats>; // Statistiques de statut par mois
  comptes: CompteData[];
}

export default function EntreprisePage({
  entrepriseId,
  onBack,
}: EntreprisePageProps) {
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [moisData, setMoisData] = useState<MoisData[]>([]);
  const [lotsData, setLotsData] = useState<LotData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal de détail
  const [selectedCompte, setSelectedCompte] = useState<DetailModalData | null>(null);

  useEffect(() => {
    loadData();
  }, [entrepriseId]);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const entrepriseData = await getEntreprise(entrepriseId);
      setEntreprise(entrepriseData);

      // Requête SQL pour récupérer les données détaillées par facture
      const query = `
        SELECT
          strftime('%Y-%m', f.date) as date_key,
          c.id as compte_id,
          c.num as compte_num,
          c.nom as compte_nom,
          c.lot as lot,
          f.num as facture_num,
          f.statut as facture_statut,
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
          };
          lotData.comptes.push(compteData);
        }

        // Montants
        const currentCompteTotal = compteData.montants_par_mois.get(dateKey) || 0;
        compteData.montants_par_mois.set(dateKey, currentCompteTotal + row.total_ht);

        // Factures pour le compte
        if (!compteData.factures_par_mois.has(dateKey)) {
          compteData.factures_par_mois.set(dateKey, []);
        }
        compteData.factures_par_mois.get(dateKey)!.push({
          num: row.facture_num,
          statut: row.facture_statut,
        });

        // Agrégation au niveau lot
        const currentLotTotal = lotData.total_par_mois.get(dateKey) || 0;
        lotData.total_par_mois.set(dateKey, currentLotTotal + row.total_ht);

        // Statistiques de statut pour le lot
        if (!lotData.statuts_par_mois.has(dateKey)) {
          lotData.statuts_par_mois.set(dateKey, { importé: 0, validé: 0, contesté: 0 });
        }
        const statutStats = lotData.statuts_par_mois.get(dateKey)!;
        const statut = row.facture_statut as keyof StatutStats;
        if (statut in statutStats) {
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

      setLotsData(
        Array.from(lotsMap.values()).sort((a, b) => a.lot.localeCompare(b.lot))
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
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

  function handleCompteClick(compte: CompteData, mois?: string) {
    setSelectedCompte({
      compte_id: compte.compte_id,
      compte_num: compte.compte_num,
      compte_nom: compte.compte_nom,
      mois: mois,
    });
  }

  function getStatutIcon(statut: string): string {
    switch (statut) {
      case "validé":
        return "✓";
      case "contesté":
        return "!";
      case "importé":
      default:
        return "○";
    }
  }

  function getStatutColor(statut: string): string {
    switch (statut) {
      case "validé":
        return "#10b981"; // Vert
      case "contesté":
        return "#f59e0b"; // Orange
      case "importé":
      default:
        return "#9ca3af"; // Gris
    }
  }

  function formatStatutPercentage(stats: StatutStats): string {
    const total = stats.importé + stats.validé + stats.contesté;
    if (total === 0) return "";

    const parts: string[] = [];
    if (stats.validé > 0) {
      parts.push(`${Math.round((stats.validé / total) * 100)}% ✓`);
    }
    if (stats.contesté > 0) {
      parts.push(`${Math.round((stats.contesté / total) * 100)}% !`);
    }
    if (stats.importé > 0) {
      parts.push(`${Math.round((stats.importé / total) * 100)}% ○`);
    }
    return parts.join(" · ");
  }

  if (isLoading) {
    return (
      <div className="app">
        <p className="loading">Chargement...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <button onClick={onBack} className="back-button">
          ← Retour
        </button>
        <div className="alert error">{error}</div>
      </div>
    );
  }

  if (!entreprise || moisData.length === 0) {
    return (
      <div className="app">
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
    <div className="app">
      <button onClick={onBack} className="back-button">
        ← Retour
      </button>
      <h1>{entreprise.nom}</h1>

      <section className="card">
        <h2>Vue détaillée des factures par lot</h2>

        <div
          style={{
            overflow: "auto",
            maxHeight: "calc(100vh - 250px)",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
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
                    minWidth: "200px",
                    zIndex: 11,
                  }}
                >
                  Lot / Compte
                </th>
                {moisData.map((mois) => (
                  <th
                    key={mois.date_key}
                    style={{
                      padding: "0.75rem",
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
                <>
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
                      <span style={{ marginRight: "0.5rem" }}>
                        {lot.expanded ? "▼" : "▶"}
                      </span>
                      {lot.lot}
                      <span style={{ marginLeft: "0.5rem", color: "#6b7280", fontWeight: "400" }}>
                        ({lot.comptes.length} compte{lot.comptes.length > 1 ? "s" : ""})
                      </span>
                    </td>
                    {moisData.map((mois) => {
                      const total = lot.total_par_mois.get(mois.date_key) || 0;
                      const statutStats = lot.statuts_par_mois.get(mois.date_key);
                      const percentage = statutStats ? formatStatutPercentage(statutStats) : "";

                      return (
                        <td
                          key={mois.date_key}
                          style={{
                            padding: "0.75rem",
                            textAlign: "right",
                            fontWeight: "600",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          {total > 0 ? (
                            <div>
                              <div>{total.toFixed(2)} €</div>
                              {percentage && (
                                <div style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: "400" }}>
                                  {percentage}
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
                          style={{
                            position: "sticky",
                            left: 0,
                            background: "white",
                            padding: "0.75rem 0.75rem 0.75rem 2.5rem",
                            borderRight: "1px solid #e5e7eb",
                            borderBottom: compteIdx === lot.comptes.length - 1 ? "2px solid #e5e7eb" : "1px solid #e5e7eb",
                          }}
                        >
                          <div style={{ fontWeight: "500" }}>
                            {compte.compte_nom || compte.compte_num}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                            {compte.compte_num}
                          </div>
                        </td>
                        {moisData.map((mois) => {
                          const total = compte.montants_par_mois.get(mois.date_key) || 0;
                          const factures = compte.factures_par_mois.get(mois.date_key) || [];

                          return (
                            <td
                              key={mois.date_key}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (total > 0) {
                                  handleCompteClick(compte, mois.date_key);
                                }
                              }}
                              style={{
                                padding: "0.75rem",
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
                                        key={idx}
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
                                          title={`Facture ${f.num} - ${f.statut}`}
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
                </>
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

      {selectedCompte && (
        <CompteDetailModal
          compteId={selectedCompte.compte_id}
          compteNum={selectedCompte.compte_num}
          compteNom={selectedCompte.compte_nom}
          mois={selectedCompte.mois}
          onClose={() => setSelectedCompte(null)}
        />
      )}
    </div>
  );
}
