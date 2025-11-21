import { useEffect, useState } from "react";
import { fetchEntreprises, type Entreprise } from "../newApi";
import { importCSV, type ImportResult } from "../csvImporter";

interface ImportPageProps {
  onBack: () => void;
}

export default function ImportPage({ onBack }: ImportPageProps) {
  const [entreprises, setEntreprises] = useState<Entreprise[]>([]);
  const [selectedEntrepriseId, setSelectedEntrepriseId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    loadEntreprises();
  }, []);

  async function loadEntreprises() {
    try {
      const data = await fetchEntreprises();
      setEntreprises(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleImport() {
    if (!selectedFile) {
      setError("Veuillez sélectionner un fichier CSV");
      return;
    }

    if (!selectedEntrepriseId) {
      setError("Veuillez sélectionner une entreprise");
      return;
    }

    setIsLoading(true);
    setError(null);
    setImportResult(null);

    try {
      const result = await importCSV(selectedFile, selectedEntrepriseId);
      setImportResult(result);

      if (!result.success) {
        setError(`Import terminé avec ${result.stats.erreurs} erreur(s)`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <button onClick={onBack} className="back-button">
          ← Retour
        </button>
        <h1>Import CSV</h1>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="card">
        <h2>Sélection de l'entreprise</h2>
        <div className="entreprise-select">
          <label>Entreprise</label>
          <select
            value={selectedEntrepriseId || ""}
            onChange={(e) => setSelectedEntrepriseId(Number(e.target.value) || null)}
          >
            <option value="">Sélectionner une entreprise</option>
            {entreprises.map((entreprise) => (
              <option key={entreprise.id} value={entreprise.id}>
                {entreprise.nom}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card">
        <h2>Fichier CSV</h2>
        <div className="file-input-wrapper">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          />
          {selectedFile && <p className="filename">{selectedFile.name}</p>}
        </div>
        <button
          onClick={handleImport}
          disabled={isLoading || !selectedFile || !selectedEntrepriseId}
          className="upload-button"
        >
          {isLoading ? "Import en cours..." : "Importer"}
        </button>
      </section>

      {importResult && (
        <section className="card">
          <h2>Résultat de l'import</h2>

          {importResult.success && (
            <div className="alert success">
              <strong>✓ Import réussi</strong>
            </div>
          )}

          <div className="result-grid">
            <div className="result-card">
              <h3>Statistiques</h3>
              <p>Lignes CSV lues: {importResult.stats.lignes_csv}</p>
              <p>Comptes créés: {importResult.stats.comptes_crees}</p>
              <p>Factures créées: {importResult.stats.factures_creees}</p>
              <p>Factures doublons: {importResult.stats.factures_doublons}</p>
              {importResult.stats.erreurs > 0 && (
                <p style={{ color: "#dc2626", fontWeight: "600" }}>
                  Erreurs: {importResult.stats.erreurs}
                </p>
              )}
            </div>

            {importResult.errors.length > 0 && (
              <div className="result-card">
                <h3>Erreurs détaillées</h3>
                <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                  {importResult.errors.map((error, idx) => (
                    <p key={idx} style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>
                      {error}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
