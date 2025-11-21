import { useEffect, useState } from "react";
import { fetchLigneRecords, type LigneRecordsResponse } from "../entrepriseApi";

interface LigneDetailsPageProps {
  ligneId: number;
  onBack: () => void;
}

export default function LigneDetailsPage({ ligneId, onBack }: LigneDetailsPageProps) {
  const [data, setData] = useState<LigneRecordsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRecords();
  }, [ligneId]);

  async function loadRecords() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchLigneRecords(ligneId);
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
        <p className="loading">Chargement des records...</p>
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

  const totalHT = data.records.reduce((sum, r) => sum + r.total_ht, 0);
  const totalTTC = data.records.reduce((sum, r) => sum + r.total_ttc, 0);

  return (
    <div className="app">
      <header>
        <button onClick={onBack} className="back-button">
          ← Retour
        </button>
        <div>
          <p className="eyebrow">Ligne télécom</p>
          <h1>{data.ligne.nom || data.ligne.numero_acces}</h1>
          <div className="ligne-details">
            <span className="badge">{data.ligne.type_ligne}</span>
            <span className="muted">Numéro d'accès: {data.ligne.numero_acces}</span>
            {data.ligne.adresse && (
              <span className="muted">Adresse: {data.ligne.adresse}</span>
            )}
          </div>
        </div>
      </header>

      <section className="summary-grid">
        <div className="card summary-card">
          <p className="summary-label">Records</p>
          <p className="summary-value">{data.records.length}</p>
        </div>
        <div className="card summary-card">
          <p className="summary-label">Total HT</p>
          <p className="summary-value">
            {totalHT.toLocaleString("fr-FR", {
              style: "currency",
              currency: "EUR",
            })}
          </p>
        </div>
        <div className="card summary-card">
          <p className="summary-label">Total TTC</p>
          <p className="summary-value">
            {totalTTC.toLocaleString("fr-FR", {
              style: "currency",
              currency: "EUR",
            })}
          </p>
        </div>
      </section>

      <section className="card table-section">
        <div className="table-header">
          <h2>Historique des factures</h2>
          <p>{data.records.length} records</p>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Mois</th>
                <th>Facture</th>
                <th>Compte</th>
                <th>Abonnements</th>
                <th>Consommations</th>
                <th>Remises</th>
                <th>Total HT</th>
                <th>Total TTC</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((record) => (
                <tr key={record.id}>
                  <td>{record.date?.slice(0, 10) || "-"}</td>
                  <td>{record.mois}</td>
                  <td>{record.numero_facture}</td>
                  <td>{record.numero_compte}</td>
                  <td>{record.abo.toFixed(2)} €</td>
                  <td>{record.conso.toFixed(2)} €</td>
                  <td>{record.remise.toFixed(2)} €</td>
                  <td>{record.total_ht.toFixed(2)} €</td>
                  <td>{record.total_ttc.toFixed(2)} €</td>
                  <td>{record.statut}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
