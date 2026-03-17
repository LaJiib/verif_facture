import { useEffect, useState } from "react";
import {
  analyzeCSV,
  importCSV,
  type ImportResult,
  type CompteACreer,
  type ConflitDecision,
  type ConflitFacture,
} from "../csvImporter";
import { CsvFormatConfig, DEFAULT_CSV_FORMAT } from "../utils/csvFormats";
import CompteConfirmationModal from "../components/CompteConfirmationModal";
import AbonnementConfirmationModal from "../components/AbonnementConfirmationModal";
import ConflitModal from "../components/ConflitModal";

interface ImportPageProps {
  entrepriseId: number;
  csvFormats: CsvFormatConfig[];
  onBack: () => void;
}

export default function ImportPage({ entrepriseId, csvFormats, onBack }: ImportPageProps) {
  const availableFormats = csvFormats.length ? csvFormats : [DEFAULT_CSV_FORMAT];
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvFormat, setCsvFormat] = useState<string>(availableFormats[0]?.id || DEFAULT_CSV_FORMAT.id);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [analyzeAbos, setAnalyzeAbos] = useState<{ enabled: boolean; types: Set<number> }>({
    enabled: false,
    types: new Set([0, 1, 2, 3]),
  });
  const [abosSuggeres, setAbosSuggeres] = useState<ImportResult["abonnementsSuggeres"]>([]);
  const [abosSelectionnes, setAbosSelectionnes] = useState<Set<number>>(new Set());
  const [showAboModal, setShowAboModal] = useState(false);
  const [pendingComptesSelection, setPendingComptesSelection] = useState<Set<string> | null>(null);
  const [pendingComptesOverrides, setPendingComptesOverrides] = useState<CompteACreer[] | undefined>(undefined);
  const [showConflitModal, setShowConflitModal] = useState(false);
  const [conflits, setConflits] = useState<ConflitFacture[]>([]);
  const [pendingConflitDecisions, setPendingConflitDecisions] = useState<ConflitDecision[] | null>(null);

  // Étape de confirmation des comptes
  const [showCompteModal, setShowCompteModal] = useState(false);
  const [comptesACreer, setComptesACreer] = useState<CompteACreer[]>([]);

  // Progress tracking
  const [importProgress, setImportProgress] = useState<{
    stage: string;
    percent: number;
  } | null>(null);
  const activeFormat = availableFormats.find((format) => format.id === csvFormat) || availableFormats[0] || DEFAULT_CSV_FORMAT;

  useEffect(() => {
    const formats = csvFormats.length ? csvFormats : [DEFAULT_CSV_FORMAT];
    if (!formats.find((format) => format.id === csvFormat)) {
      setCsvFormat(formats[0]?.id || DEFAULT_CSV_FORMAT.id);
    }
  }, [csvFormats, csvFormat]);

  async function handleAnalyze() {
    if (!selectedFile) {
      setError("Veuillez sélectionner un fichier CSV");
      return;
    }

    setIsLoading(true);
    setError(null);
    setImportResult(null);
    setPendingComptesSelection(null);
    setPendingComptesOverrides(undefined);
    setPendingConflitDecisions(null);
    setShowConflitModal(false);
    setConflits([]);

    try {
      const { comptesACreer, abonnementsSuggeres, conflits: conflitsDetectes } = await analyzeCSV(
        selectedFile,
        entrepriseId,
        activeFormat,
        analyzeAbos.enabled ? { enabled: true, types: Array.from(analyzeAbos.types) } : undefined
      );

      const defaultSel = new Set(
        (abonnementsSuggeres || [])
          .map((a, idx) => ((a.count_lignes ?? 0) >= 5 ? idx : null))
          .filter((v): v is number => v !== null)
      );
      setAbosSuggeres(abonnementsSuggeres || []);
      setAbosSelectionnes(defaultSel);
      setConflits(conflitsDetectes || []);

      if (comptesACreer.length > 0) {
        // Il y a des comptes à créer, afficher la modale
        setComptesACreer(comptesACreer);
        setShowCompteModal(true);
      } else if ((abonnementsSuggeres || []).length > 0) {
        setShowAboModal(true);
      } else if ((conflitsDetectes || []).length > 0) {
        setPendingComptesSelection(new Set());
        setPendingComptesOverrides(undefined);
        setShowConflitModal(true);
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

  function handleCompteConfirm(comptesSelectionnes: Set<string>, comptesMisesAJour: CompteACreer[]) {
    setPendingComptesSelection(comptesSelectionnes);
    setPendingComptesOverrides(comptesMisesAJour);
    setShowCompteModal(false);
    if (abosSuggeres && abosSuggeres.length > 0) {
      setShowAboModal(true);
      return;
    }
    if (conflits && conflits.length > 0) {
      setShowConflitModal(true);
      return;
    }
    proceedWithImport(comptesSelectionnes, comptesMisesAJour);
  }

  function handleAboConfirm(selection: Set<number>) {
    setAbosSelectionnes(selection);
    setShowAboModal(false);
    const comptesSel = pendingComptesSelection ?? new Set<string>();
    const comptesOverrides = pendingComptesOverrides;
    if (conflits && conflits.length > 0) {
      setShowConflitModal(true);
      return;
    }
    proceedWithImport(comptesSel, comptesOverrides);
  }

  function handleAboCancel() {
    setShowAboModal(false);
    const comptesSel = pendingComptesSelection ?? new Set<string>();
    const comptesOverrides = pendingComptesOverrides;
    setAbosSelectionnes(new Set());
    if (conflits && conflits.length > 0) {
      setShowConflitModal(true);
      return;
    }
    proceedWithImport(comptesSel, comptesOverrides);
  }

  function handleConflitConfirm(decisions: ConflitDecision[]) {
    setPendingConflitDecisions(decisions);
    setShowConflitModal(false);
    proceedWithImport(pendingComptesSelection ?? new Set(), pendingComptesOverrides, decisions);
  }

  function handleConflitCancel() {
    setPendingConflitDecisions([]);
    setShowConflitModal(false);
    proceedWithImport(pendingComptesSelection ?? new Set(), pendingComptesOverrides, []);
  }

  async function proceedWithImport(
    comptesSelectionnes: Set<string>,
    comptesMisesAJour?: CompteACreer[],
    conflitDecisions?: ConflitDecision[]
  ) {
    if (!selectedFile) return;

    setShowCompteModal(false);
    setShowAboModal(false);
    setShowConflitModal(false);
    setPendingComptesSelection(null);
    setPendingComptesOverrides(undefined);
    setPendingConflitDecisions(null);
    setIsLoading(true);
    setError(null);
    setImportProgress({ stage: "Envoi au backend...", percent: 10 });

    try {
      const result = await importCSV(
        selectedFile,
        entrepriseId,
        activeFormat,
        comptesSelectionnes,
        comptesMisesAJour,
        analyzeAbos.enabled ? { enabled: true, types: Array.from(analyzeAbos.types) } : undefined,
        abosSuggeres
          ?.map((a, idx) => ({ ...a, _idx: idx }))
          ?.filter((a) => abosSelectionnes.has(a._idx as number))
          ?.map((a) => ({ nom: a.nom, prix: a.prix })) || [],
        (stage: string, percent: number) => {
          setImportProgress({ stage, percent });
        },
        conflitDecisions ?? pendingConflitDecisions ?? undefined
      );

      if (result.comptesACreer && result.comptesACreer.length > 0) {
        setComptesACreer(result.comptesACreer);
        if (result.abonnementsSuggeres) {
          setAbosSuggeres(result.abonnementsSuggeres);
        }
        setConflits(result.conflits || []);
        setShowCompteModal(true);
        setImportProgress(null);
        setIsLoading(false);
        return;
      }

      setImportResult(result);
      setConflits(result.conflits || []);
      if (result.abonnementsSuggeres) {
        const defaultSel = new Set(
          result.abonnementsSuggeres
            .map((a, idx) => ((a.count_lignes ?? 0) >= 5 ? idx : null))
            .filter((v): v is number => v !== null)
        );
        setAbosSuggeres(result.abonnementsSuggeres);
        setAbosSelectionnes(defaultSel);
      }

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
    setShowConflitModal(false);
    setPendingComptesSelection(null);
    setPendingComptesOverrides(undefined);
    setPendingConflitDecisions(null);
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
            {csvFormats.map((format) => (
              <option key={format.id} value={format.id}>
                {format.name}
              </option>
            ))}
          </select>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: "0.5rem" }}>
            Colonnes attendues: {Object.values(activeFormat.columns).filter(Boolean).join(", ")}
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Options</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={analyzeAbos.enabled}
              onChange={(e) => setAnalyzeAbos((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            Analyser les abonnements (détection des nouveaux abo)
          </label>
          {analyzeAbos.enabled && (
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              {[{ label: "Fixe", code: 0 }, { label: "Mobile", code: 1 }, { label: "Internet", code: 2 }, { label: "Autre", code: 3 }].map((t) => (
                <label key={t.code} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <input
                    type="checkbox"
                    checked={analyzeAbos.types.has(t.code)}
                    onChange={(e) =>
                      setAnalyzeAbos((prev) => {
                        const next = new Set(prev.types);
                        if (e.target.checked) next.add(t.code);
                        else next.delete(t.code);
                        return { ...prev, types: next };
                      })
                    }
                  />
                  {t.label}
                </label>
              ))}
            </div>
          )}
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

      {showAboModal && abosSuggeres && abosSuggeres.length > 0 && (
        <AbonnementConfirmationModal
          abonnements={abosSuggeres}
          onConfirm={handleAboConfirm}
          onCancel={handleAboCancel}
        />
      )}

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
              <p>Abonnements créés: {importResult.stats.abonnements_crees ?? 0}</p>
              <p>Lignes-abonnements créées: {importResult.stats.lignes_abonnements_creees ?? 0}</p>
              <p>Factures doublons: {importResult.stats.factures_doublons}</p>
              {(importResult.stats.factures_mises_a_jour ?? 0) > 0 && (
                <p>✏️ {importResult.stats.factures_mises_a_jour} facture(s) mise(s) a jour</p>
              )}
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
          onConfirm={handleCompteConfirm}
          onCancel={handleCancelConfirmation}
        />
      )}

      {showConflitModal && conflits.length > 0 && (
        <ConflitModal
          conflits={conflits}
          onConfirm={handleConflitConfirm}
          onCancel={handleConflitCancel}
        />
      )}
    </div>
  );
}
