import { useEffect, useMemo, useState } from "react";
import type {
  AggregationResponse,
  SampleFile,
  Invoice,
  LineFilters,
  LinesResponse,
  SaveResponse,
} from "../api";
import {
  fetchLinesFromSample,
  fetchLinesFromUpload,
  fetchSamples,
  loadSample,
  uploadCsv,
  saveCsvUpload,
  saveCsvSample,
} from "../api";

type FlattenedInvoice = Invoice & {
  compte: string;
  lignes_telecom: number;
};

type DataSource =
  | { kind: "sample"; filename: string }
  | { kind: "upload"; file: File }
  | null;

const TYPE_LIGNE_OPTIONS = ["Internet", "Internet bas debit", "Fixe", "Fixe secondaire", "Mobile", "Autre"] as const;

interface ImportPageProps {
  onBack: () => void;
}

export default function ImportPage({ onBack }: ImportPageProps) {
  const [samples, setSamples] = useState<SampleFile[]>([]);
  const [selectedSample, setSelectedSample] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [data, setData] = useState<AggregationResponse | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>(null);
  const [lines, setLines] = useState<LinesResponse | null>(null);
  const [filters, setFilters] = useState<LineFilters>({ type_ligne: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [isFiltersLoading, setIsFiltersLoading] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveResponse, setSaveResponse] = useState<SaveResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [entrepriseName, setEntrepriseName] = useState("Par défaut");

  useEffect(() => {
    fetchSamples()
      .then(setSamples)
      .catch(() => {
        // les samples sont optionnels; ignorer silencieusement en cas d'erreur.
      });
  }, []);

  const factures = useMemo<FlattenedInvoice[]>(() => {
    if (!data) return [];
    const rows: FlattenedInvoice[] = [];
    data.accounts.forEach((account) => {
      account.factures.forEach((facture) => {
        rows.push({ ...facture, compte: account.compte, lignes_telecom: account.lignes_telecom });
      });
    });
    return rows;
  }, [data]);

  function updateFilter(key: keyof LineFilters, value: unknown) {
    setFilters((prev) => ({ ...prev, [key]: value as never }));
  }

  async function handleUploadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setError("Merci de selectionner un fichier CSV.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const response = await uploadCsv(selectedFile);
      setData(response);
      setDataSource({ kind: "upload", file: selectedFile });
      setLines(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSampleLoad() {
    if (!selectedSample) {
      setError("Merci de choisir un fichier d'exemple.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const response = await loadSample(selectedSample);
      setData(response);
      setDataSource({ kind: "sample", filename: selectedSample });
      setLines(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleApplyFilters() {
    if (!dataSource) {
      setError("Chargez un fichier ou un exemple avant d'appliquer des filtres.");
      return;
    }
    setError(null);
    setIsFiltersLoading(true);
    try {
      if (dataSource.kind === "sample") {
        const agg = await loadSample(dataSource.filename, filters);
        setData(agg);
        if (showLines) {
          const lineResp = await fetchLinesFromSample(dataSource.filename, filters);
          setLines(lineResp);
        } else {
          setLines(null);
        }
      } else {
        const agg = await uploadCsv(dataSource.file, filters);
        setData(agg);
        if (showLines) {
          const lineResp = await fetchLinesFromUpload(dataSource.file, filters);
          setLines(lineResp);
        } else {
          setLines(null);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsFiltersLoading(false);
    }
  }

  function toggleTypeLigne(option: (typeof TYPE_LIGNE_OPTIONS)[number]) {
    const current = new Set(filters.type_ligne ?? []);
    if (current.has(option)) {
      current.delete(option);
    } else {
      current.add(option);
    }
    updateFilter("type_ligne", Array.from(current));
  }

  async function handleSaveToDatabase() {
    if (!dataSource) {
      setError("Chargez un fichier ou un exemple avant de sauvegarder.");
      return;
    }
    setError(null);
    setSaveResponse(null);
    setIsSaving(true);
    try {
      let response: SaveResponse;
      if (dataSource.kind === "sample") {
        response = await saveCsvSample(dataSource.filename, entrepriseName);
      } else {
        response = await saveCsvUpload(dataSource.file, entrepriseName);
      }
      setSaveResponse(response);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
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

      <section className="actions">
        <form className="card upload-card" onSubmit={handleUploadSubmit}>
          <h2>Fichier CSV</h2>
          <label className="file-input">
            <input
              type="file"
              accept=".csv"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            {selectedFile ? selectedFile.name : "Choisir un fichier..."}
          </label>
          <button type="submit" disabled={isLoading}>
            {isLoading ? "Analyse..." : "Analyser"}
          </button>
        </form>

        <div className="card sample-card">
          <h2>Exemple</h2>
          <div className="sample-picker">
            <select value={selectedSample} onChange={(e) => setSelectedSample(e.target.value)}>
              <option value="">Sélectionner</option>
              {samples.map((sample) => (
                <option key={sample.name} value={sample.name}>
                  {sample.name} ({(sample.size / 1024).toFixed(1)} Ko)
                </option>
              ))}
            </select>
            <button onClick={handleSampleLoad} disabled={!selectedSample || isLoading}>
              Charger
            </button>
          </div>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}

      {data && (
        <>
          <section className="summary-grid">
            <SummaryCard label="Comptes" value={data.summary.total_comptes.toString()} />
            <SummaryCard label="Factures" value={data.summary.total_factures.toString()} />
            <SummaryCard
              label="Total HT"
              value={`${data.summary.total_ht.toLocaleString("fr-FR", {
                style: "currency",
                currency: "EUR",
              })}`}
            />
          </section>

          <section className="filters card">
            <div className="filters-header">
              <h2>Filtres</h2>
              <div className="filters-actions">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={showLines}
                    onChange={(e) => setShowLines(e.target.checked)}
                  />
                  <span>Afficher lignes</span>
                </label>
                <button onClick={handleApplyFilters} type="button" disabled={isFiltersLoading}>
                  {isFiltersLoading ? "Chargement..." : "Appliquer"}
                </button>
              </div>
            </div>

            <div className="filters-grid">
              <div className="field">
                <label>Date exacte</label>
                <input
                  type="date"
                  value={filters.date ?? ""}
                  onChange={(e) => updateFilter("date", e.target.value || undefined)}
                />
              </div>
              <div className="field">
                <label>Date debut</label>
                <input
                  type="date"
                  value={filters.date_debut ?? ""}
                  onChange={(e) => updateFilter("date_debut", e.target.value || undefined)}
                />
              </div>
              <div className="field">
                <label>Date fin</label>
                <input
                  type="date"
                  value={filters.date_fin ?? ""}
                  onChange={(e) => updateFilter("date_fin", e.target.value || undefined)}
                />
              </div>
              <div className="field">
                <label>Numero compte</label>
                <input
                  type="text"
                  placeholder="Ex: 002380160"
                  value={filters.numero_compte ?? ""}
                  onChange={(e) => updateFilter("numero_compte", e.target.value || undefined)}
                />
              </div>
              <div className="field">
                <label>Numero facture</label>
                <input
                  type="number"
                  placeholder="Ex: 303782319"
                  value={filters.numero_facture ?? ""}
                  onChange={(e) => updateFilter("numero_facture", e.target.value ? Number(e.target.value) : undefined)}
                />
              </div>
              <div className="field">
                <label>Numero d'accès (ligne)</label>
                <input
                  type="text"
                  placeholder="Ex: 0546982410"
                  value={filters.numero_acces ?? ""}
                  onChange={(e) => updateFilter("numero_acces", e.target.value || undefined)}
                />
              </div>
              <div className="field">
                <label>Type d'accès (texte exact)</label>
                <input
                  type="text"
                  placeholder="ex: ligne Numeris acces de base"
                  value={(filters.type_acces && filters.type_acces[0]) ?? ""}
                  onChange={(e) => updateFilter("type_acces", e.target.value ? [e.target.value] : [])}
                />
              </div>
              <div className="field">
                <label>Type de charge (texte exact)</label>
                <input
                  type="text"
                  placeholder="ex: Abonnements, forfaits, formules et options"
                  value={(filters.type_charge && filters.type_charge[0]) ?? ""}
                  onChange={(e) => updateFilter("type_charge", e.target.value ? [e.target.value] : [])}
                />
              </div>
            </div>

            <div className="chips">
              <span className="chip-label">Type de ligne</span>
              {TYPE_LIGNE_OPTIONS.map((opt) => {
                const active = (filters.type_ligne || []).includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    className={`chip ${active ? "active" : ""}`}
                    onClick={() => toggleTypeLigne(opt)}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card save-section">
            <div className="save-header">
              <h2>Sauvegarder</h2>
            </div>
            <div className="save-form">
              <div className="field">
                <label>Nom de l'entreprise</label>
                <input
                  type="text"
                  placeholder="Ex: Mon Entreprise"
                  value={entrepriseName}
                  onChange={(e) => setEntrepriseName(e.target.value)}
                />
              </div>
              <button
                onClick={handleSaveToDatabase}
                type="button"
                disabled={isSaving}
                className="save-button"
              >
                {isSaving ? "Sauvegarde..." : "Sauvegarder"}
              </button>
            </div>

            {saveResponse && (
              <div className="alert success">
                <strong>✓ Sauvegarde réussie</strong>
                <p>
                  {saveResponse.entreprise} |
                  Lignes: {saveResponse.stats.lignes_created} |
                  Records: {saveResponse.stats.records_created} |
                  Doublons: {saveResponse.stats.records_skipped}
                </p>
              </div>
            )}
          </section>

          <section className="table-section card">
            <div className="table-header">
              <h2>Factures ({factures.length})</h2>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Compte</th>
                    <th>Mois</th>
                    <th>Facture</th>
                    <th>Abonnements</th>
                    <th>Consommations</th>
                    <th>Remises</th>
                    <th>Total HT</th>
                    <th>Nb lignes</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map((facture) => (
                    <tr key={`${facture.compte}-${facture.numero_facture}`}>
                      <td>{facture.compte}</td>
                      <td>{facture.mois}</td>
                      <td>{facture.numero_facture}</td>
                      <td>{facture.montants.Abo.toFixed(2)} €</td>
                      <td>{facture.montants.Conso.toFixed(2)} €</td>
                      <td>{facture.montants.Remise.toFixed(2)} €</td>
                      <td>{facture.total.toFixed(2)} €</td>
                      <td>{facture.nb_lignes_detail}</td>
                      <td>{facture.statut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {lines && (
            <section className="card lines-card">
              <div className="table-header">
                <h2>Lignes ({lines.summary.total_lignes})</h2>
                <div className="chips-inline">
                  {Object.entries(lines.summary.par_type_ligne).map(([type, info]) => (
                    <span key={type} className="chip ghost">
                      {type}: {info.count}
                    </span>
                  ))}
                </div>
              </div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Compte</th>
                      <th>Facture</th>
                      <th>Acces</th>
                      <th>Type ligne</th>
                      <th>Type acces</th>
                      <th>Type charge</th>
                      <th>Categorie</th>
                      <th>Rubrique</th>
                      <th>Libelle</th>
                      <th>Montant HT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.rows.map((row, idx) => (
                      <tr key={`${row.compte}-${row.facture}-${idx}`}>
                        <td>{row.date?.slice(0, 10)}</td>
                        <td>{row.compte}</td>
                        <td>{row.facture}</td>
                        <td>{row.numero_acces}</td>
                        <td>{row.type_ligne}</td>
                        <td>{row.type_acces}</td>
                        <td>{row.type_charge}</td>
                        <td>{row.categorie_charge}</td>
                        <td>{row.rubrique_facture}</td>
                        <td className="libelle">{row.libelle}</td>
                        <td>{row.montant_ht.toFixed(2)} €</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card summary-card">
      <p className="summary-label">{label}</p>
      <p className="summary-value">{value}</p>
    </div>
  );
}
