import { useState } from "react";
import { analyzeCSV, importCSV, type ImportResult, type CompteACreer } from "../csvImporter";
import CompteConfirmationModal from "../components/CompteConfirmationModal";

interface ImportPageProps {
  entrepriseId: number;
  onBack: () => void;
}

export default function ImportPage({ entrepriseId, onBack }: ImportPageProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvFormat, setCsvFormat] = useState<string>("orange");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Étape de confirmation des comptes
  const [showCompteModal, setShowCompteModal] = useState(false);
  const [comptesACreer, setComptesACreer] = useState<CompteACreer[]>([]);

  // Progress tracking
  const [importProgress, setImportProgress] = useState<{
    stage: string;
    percent: number;
  } | null>(null);

  async function handleAnalyze() {
    if (!selectedFile) {
      setError("Veuillez sélectionner un fichier CSV");
      return;
    }

    setIsLoading(true);
    setError(null);
    setImportResult(null);

    try {
      const { comptesACreer } = await analyzeCSV(selectedFile, entrepriseId);

      if (comptesACreer.length > 0) {
        // Il y a des comptes à créer, afficher la modale
        setComptesACreer(comptesACreer);
        setShowCompteModal(true);
      } else {
        // Pas de nouveaux comptes, importer directement
        await proceedWithImport(new Set());
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function proceedWithImport(comptesSelectionnes: Set<string>) {
    if (!selectedFile) return;

    setShowCompteModal(false);
    setIsLoading(true);
    setError(null);
    setImportProgress({ stage: "Démarrage...", percent: 0 });

    try {
      const result = await importCSV(
        selectedFile,
        entrepriseId,
        comptesSelectionnes,
        (stage: string, percent: number) => {
          setImportProgress({ stage, percent });
        }
      );
      setImportResult(result);

      if (!result.success) {
        setError(`Import terminé avec ${result.stats.erreurs} erreur(s)`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
      setImportProgress(null);
    }
  }

  function handleCancelConfirmation() {
    setShowCompteModal(false);
    setIsLoading(false);
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
        <h2>Format CSV</h2>
        <div className="entreprise-select">
          <label>Format d'importation</label>
          <select
            value={csvFormat}
            onChange={(e) => setCsvFormat(e.target.value)}
          >
            <option value="orange">Format Orange (par défaut)</option>
            <option value="custom" disabled>Format personnalisé (à configurer)</option>
          </select>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: "0.5rem" }}>
            Le format Orange attend les colonnes: Numéro compte, Numéro accès, Numéro facture, Date, etc.
          </p>
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
          onClick={handleAnalyze}
          disabled={isLoading || !selectedFile}
          className="upload-button"
        >
          {isLoading ? "Traitement en cours..." : "Analyser et Importer"}
        </button>

        {/* Progress bar */}
        {importProgress && (
          <div style={{ marginTop: "1.5rem" }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.5rem",
              fontSize: "0.875rem",
              color: "#374151"
            }}>
              <span>{importProgress.stage}</span>
              <span style={{ fontWeight: "600" }}>{importProgress.percent}%</span>
            </div>
            <div style={{
              width: "100%",
              height: "1rem",
              background: "#e5e7eb",
              borderRadius: "0.5rem",
              overflow: "hidden",
            }}>
              <div
                style={{
                  width: `${importProgress.percent}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #3b82f6, #2563eb)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}
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
              <p>Lignes créées: {importResult.stats.lignes_creees}</p>
              <p>Factures créées: {importResult.stats.factures_creees}</p>
              <p>Lignes-factures créées: {importResult.stats.lignes_factures_creees}</p>
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

      {showCompteModal && (
        <CompteConfirmationModal
          comptesACreer={comptesACreer}
          onConfirm={proceedWithImport}
          onCancel={handleCancelConfirmation}
        />
      )}
    </div>
  );
}
