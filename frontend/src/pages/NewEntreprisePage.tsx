import { useEffect, useState } from "react";
import { getEntreprise, executeQuery, type Entreprise } from "../newApi";

interface EntreprisePageProps {
  entrepriseId: number;
  onBack: () => void;
}

interface MoisData {
  mois: string;
  date_key: string;
  total_ht: number;
  par_type: {
    [type: string]: {
      total_ht: number;
      comptes: Array<{
        compte_id: string;
        abo: number;
        conso: number;
        remise: number;
        total_ht: number;
      }>;
    };
  };
}

export default function EntreprisePage({
  entrepriseId,
  onBack,
}: EntreprisePageProps) {
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [moisData, setMoisData] = useState<MoisData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedType, setExpandedType] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [entrepriseId]);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      // Récupère l'entreprise
      const entrepriseData = await getEntreprise(entrepriseId);
      setEntreprise(entrepriseData);

      // Requête SQL pour agréger les données par mois et par type
      const query = `
        SELECT
          strftime('%Y-%m', f.date) as date_key,
          strftime('%B', f.date) as mois,
          c.type,
          c.id as compte_id,
          SUM(f.abo) as abo,
          SUM(f.conso) as conso,
          SUM(f.remise) as remise,
          SUM(f.abo + f.conso + f.remise) as total_ht
        FROM factures f
        JOIN comptes c ON f.compte_id = c.id
        WHERE c.entreprise_id = ${entrepriseId}
        GROUP BY date_key, mois, c.type, c.id
        ORDER BY date_key DESC, c.type, c.id
      `;

      const result = await executeQuery(query);

      // Agrège les données par mois
      const moisMap = new Map<string, MoisData>();

      result.data.forEach((row: any) => {
        const dateKey = row.date_key;

        if (!moisMap.has(dateKey)) {
          moisMap.set(dateKey, {
            mois: formatMois(row.mois),
            date_key: dateKey,
            total_ht: 0,
            par_type: {},
          });
        }

        const moisEntry = moisMap.get(dateKey)!;
        moisEntry.total_ht += row.total_ht;

        if (!moisEntry.par_type[row.type]) {
          moisEntry.par_type[row.type] = {
            total_ht: 0,
            comptes: [],
          };
        }

        const typeEntry = moisEntry.par_type[row.type];
        typeEntry.total_ht += row.total_ht;
        typeEntry.comptes.push({
          compte_id: row.compte_id,
          abo: row.abo,
          conso: row.conso,
          remise: row.remise,
          total_ht: row.total_ht,
        });
      });

      setMoisData(Array.from(moisMap.values()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  function formatMois(mois: string): string {
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
    return moisMap[mois] || mois;
  }

  function toggleType(type: string) {
    setExpandedType(expandedType === type ? null : type);
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
        <div className="page-header-entreprise">
          <button onClick={onBack} className="back-button">
            ← Retour
          </button>
        </div>
        <h1 className="entreprise-title">{entreprise?.nom}</h1>
        <div className="card">
          <div className="empty-state">
            <p>Aucune donnée</p>
          </div>
        </div>
      </div>
    );
  }

  // Collecte tous les types uniques
  const typesSet = new Set<string>();
  moisData.forEach((mois) => {
    Object.keys(mois.par_type).forEach((type) => typesSet.add(type));
  });
  const types = Array.from(typesSet).sort();

  return (
    <div className="app">
      <div className="page-header-entreprise">
        <button onClick={onBack} className="back-button">
          ← Retour
        </button>
      </div>
      <h1 className="entreprise-title">{entreprise.nom}</h1>

      <section className="card matrix-table">
        <div className="table-container">
          <table className="data-matrix">
            <thead>
              <tr>
                <th className="type-header">Type de ligne</th>
                {moisData.map((mois) => (
                  <th key={mois.date_key} className="mois-header">
                    <div className="mois-label">{mois.mois}</div>
                    <div className="mois-key">{mois.date_key}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {types.map((type) => (
                <>
                  <tr
                    key={type}
                    className={`type-row ${expandedType === type ? "expanded" : ""}`}
                    onClick={() => toggleType(type)}
                  >
                    <td className="type-cell">
                      <div className="type-name">
                        <span className="expand-icon">
                          {expandedType === type ? "▼" : "▶"}
                        </span>
                        <span>{type}</span>
                      </div>
                    </td>
                    {moisData.map((mois) => {
                      const typeData = mois.par_type[type];
                      return (
                        <td key={`${type}-${mois.date_key}`} className="data-cell">
                          {typeData ? (
                            <div className="cell-content">
                              <div className="cell-amount">
                                {typeData.total_ht.toFixed(0)} €
                              </div>
                              <div className="cell-count">
                                {typeData.comptes.length} compte{typeData.comptes.length > 1 ? "s" : ""}
                              </div>
                            </div>
                          ) : (
                            <div className="cell-empty">-</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Détail expandable */}
                  {expandedType === type && (() => {
                    // Collecte tous les comptes pour ce type
                    const comptesMap = new Map<string, Map<string, any>>();

                    moisData.forEach((mois) => {
                      const typeData = mois.par_type[type];
                      if (typeData) {
                        typeData.comptes.forEach((compte) => {
                          if (!comptesMap.has(compte.compte_id)) {
                            comptesMap.set(compte.compte_id, new Map());
                          }
                          comptesMap.get(compte.compte_id)!.set(mois.date_key, compte);
                        });
                      }
                    });

                    const comptes = Array.from(comptesMap.entries());

                    return (
                      <tr className="detail-row">
                        <td colSpan={moisData.length + 1}>
                          <div className="detail-content">
                            <table className="detail-matrix">
                              <thead>
                                <tr>
                                  <th className="ligne-header">Compte</th>
                                  {moisData.map((mois) => (
                                    <th key={mois.date_key} className="mois-detail-header">
                                      {mois.mois}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {comptes.map(([compteId, moisMap]) => (
                                  <tr key={compteId} className="ligne-detail-row">
                                    <td className="ligne-name-cell">
                                      <div className="ligne-name">{compteId}</div>
                                    </td>
                                    {moisData.map((mois) => {
                                      const compte = moisMap.get(mois.date_key);
                                      return (
                                        <td key={mois.date_key} className="ligne-data-cell">
                                          {compte ? (
                                            <div className="ligne-total">
                                              {compte.total_ht.toFixed(0)} €
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
    </div>
  );
}
