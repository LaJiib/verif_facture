import { useEffect, useState } from "react";
import {
  fetchEntrepriseAggregation,
  type EntrepriseAggregationResponse,
} from "../entrepriseApi";

interface EntreprisePageProps {
  entrepriseId: number;
  onBack: () => void;
  onSelectLigne: (ligneId: number) => void;
}

export default function EntreprisePage({
  entrepriseId,
  onBack,
  onSelectLigne,
}: EntreprisePageProps) {
  const [data, setData] = useState<EntrepriseAggregationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedType, setExpandedType] = useState<string | null>(null);

  useEffect(() => {
    loadAggregation();
  }, [entrepriseId]);

  async function loadAggregation() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchEntrepriseAggregation(entrepriseId);
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
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
        <button onClick={onBack}>← Retour</button>
        <div className="alert error">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  // Trier les mois par ordre décroissant (plus récent d'abord)
  const moisKeys = Object.keys(data.aggregation_par_mois).sort((a, b) =>
    b.localeCompare(a)
  );

  // Collecter tous les types de ligne uniques
  const typesLigneSet = new Set<string>();
  Object.values(data.aggregation_par_mois).forEach((moisData) => {
    Object.keys(moisData.par_type_ligne).forEach((type) =>
      typesLigneSet.add(type)
    );
  });
  const typesLigne = Array.from(typesLigneSet).sort();

  // Fonction pour obtenir les données d'une cellule
  function getCellData(moisKey: string, typeLigne: string) {
    if (!data) return null;
    const moisData = data.aggregation_par_mois[moisKey];
    if (!moisData) return null;
    return moisData.par_type_ligne[typeLigne] || null;
  }

  function toggleType(typeLigne: string) {
    setExpandedType(expandedType === typeLigne ? null : typeLigne);
  }

  if (moisKeys.length === 0) {
    return (
      <div className="app">
        <header>
          <button onClick={onBack} className="back-button">
            ← Retour
          </button>
          <h1>{data.entreprise.nom}</h1>
        </header>
        <div className="card">
          <div className="empty-state">
            <p>Aucune donnée</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="page-header-entreprise">
        <button onClick={onBack} className="back-button">
          ← Retour
        </button>
      </div>
      <h1 className="entreprise-title">{data.entreprise.nom}</h1>

      <section className="card matrix-table">
        <div className="table-wrapper">
          <table className="data-matrix">
            <thead>
              <tr>
                <th className="type-header">Type de ligne</th>
                {moisKeys.map((moisKey) => {
                  const moisData = data.aggregation_par_mois[moisKey];
                  return (
                    <th key={moisKey} className="mois-header">
                      <div className="mois-label">
                        {moisData.mois || moisKey}
                      </div>
                      <div className="mois-key">{moisKey}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {typesLigne.map((typeLigne) => (
                <>
                  <tr
                    key={typeLigne}
                    className={`type-row ${
                      expandedType === typeLigne ? "expanded" : ""
                    }`}
                    onClick={() => toggleType(typeLigne)}
                  >
                    <td className="type-cell">
                      <div className="type-name">
                        <span className="expand-icon">
                          {expandedType === typeLigne ? "▼" : "▶"}
                        </span>
                        <span>{typeLigne}</span>
                      </div>
                    </td>
                    {moisKeys.map((moisKey) => {
                      const cellData = getCellData(moisKey, typeLigne);
                      return (
                        <td key={`${typeLigne}-${moisKey}`} className="data-cell">
                          {cellData ? (
                            <div className="cell-content">
                              <div className="cell-amount">
                                {cellData.total_ht.toLocaleString("fr-FR", {
                                  maximumFractionDigits: 0,
                                })}{" "}
                                €
                              </div>
                              <div className="cell-count">
                                {cellData.count} ligne{cellData.count > 1 ? "s" : ""}
                              </div>
                            </div>
                          ) : (
                            <div className="cell-empty">-</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Ligne de détail expandable - Tableau ligne par ligne */}
                  {expandedType === typeLigne && (() => {
                    // Collecter toutes les lignes uniques pour ce type
                    const lignesMap = new Map<number, {
                      ligne_id: number;
                      numero_acces: string;
                      nom: string | null;
                      dataByMois: Map<string, { total_ht: number }>;
                    }>();

                    moisKeys.forEach((moisKey) => {
                      const cellData = getCellData(moisKey, typeLigne);
                      if (cellData && cellData.lignes) {
                        cellData.lignes.forEach((ligne) => {
                          if (!lignesMap.has(ligne.ligne_id)) {
                            lignesMap.set(ligne.ligne_id, {
                              ligne_id: ligne.ligne_id,
                              numero_acces: ligne.numero_acces,
                              nom: ligne.nom,
                              dataByMois: new Map(),
                            });
                          }
                          const ligneData = lignesMap.get(ligne.ligne_id)!;
                          ligneData.dataByMois.set(moisKey, {
                            total_ht: ligne.total_ht || 0,
                          });
                        });
                      }
                    });

                    const lignesArray = Array.from(lignesMap.values());

                    return (
                      <tr className="detail-row">
                        <td colSpan={moisKeys.length + 1}>
                          <div className="detail-content">
                            <table className="detail-matrix">
                              <thead>
                                <tr>
                                  <th className="ligne-header">Ligne</th>
                                  {moisKeys.map((moisKey) => (
                                    <th key={moisKey} className="mois-detail-header">
                                      {data.aggregation_par_mois[moisKey].mois || moisKey}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {lignesArray.map((ligne) => (
                                  <tr key={ligne.ligne_id} className="ligne-detail-row">
                                    <td className="ligne-name-cell">
                                      <div className="ligne-name">{ligne.nom || ligne.numero_acces}</div>
                                      <div className="ligne-numero-small">{ligne.numero_acces}</div>
                                    </td>
                                    {moisKeys.map((moisKey) => {
                                      const moisData = ligne.dataByMois.get(moisKey);
                                      return (
                                        <td key={moisKey} className="ligne-data-cell">
                                          {moisData ? (
                                            <div className="ligne-total">
                                              {moisData.total_ht.toFixed(0)} €
                                            </div>
                                          ) : (
                                            <div className="cell-empty">-</div>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Résumé par mois */}
      <section className="card summary-section">
        <h2>Résumé par mois</h2>
        <div className="summary-grid">
          {moisKeys.map((moisKey) => {
            const moisData = data.aggregation_par_mois[moisKey];
            return (
              <div key={moisKey} className="summary-card">
                <h3>{moisData.mois || moisKey}</h3>
                <div className="summary-stats">
                  <div className="stat-item">
                    <span className="stat-label">Total HT</span>
                    <span className="stat-value">
                      {moisData.total_ht.toLocaleString("fr-FR", {
                        style: "currency",
                        currency: "EUR",
                      })}
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Total TTC</span>
                    <span className="stat-value">
                      {moisData.total_ttc.toLocaleString("fr-FR", {
                        style: "currency",
                        currency: "EUR",
                      })}
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Types</span>
                    <span className="stat-value">
                      {Object.keys(moisData.par_type_ligne).length}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
