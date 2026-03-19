import { useEffect, useMemo, useState, FormEvent } from "react";
import { CsvFormatConfig, CsvDateFormat, DEFAULT_CSV_FORMAT, REQUIRED_CSV_COLUMNS } from "../utils/csvFormats";
import { fetchDbPathConfig, saveDbPathConfig } from "../newApi";

interface CsvFormatsSettingsPageProps {
  formats: CsvFormatConfig[];
  onSaveFormat: (format: CsvFormatConfig) => void;
  onBack: () => void;
}

const REQUIRED_COLUMN_SET = new Set<string>(REQUIRED_CSV_COLUMNS);
const columnFields: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "numeroCompte", label: "Numéro compte" },
  { key: "numeroAcces", label: "Numéro accès" },
  { key: "numeroFacture", label: "Numéro facture" },
  { key: "date", label: "Date (colonne)" },
  { key: "montantHT", label: "Montant HT" },
  { key: "typeAcces", label: "Type d'accès" },
  { key: "libelleDetail", label: "Libellé ligne facture" },
  { key: "rubriqueFacture", label: "Rubrique facture" },
  { key: "niveauCharge", label: "Niveau de charge" },
  { key: "typeCharge", label: "Type de charge" },
  { key: "nomLigne", label: "Nom de la ligne" },
  { key: "sousCompte", label: "Numéro de sous-compte" },
].map((field) => ({ ...field, required: REQUIRED_COLUMN_SET.has(field.key) }));

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `format-${Date.now()}`
  );
}

function buildEmptyColumns() {
  return {
    numeroCompte: "",
    numeroAcces: "",
    numeroFacture: "",
    date: "",
    montantHT: "",
    typeAcces: "",
    libelleDetail: "",
    rubriqueFacture: "",
    niveauCharge: "",
    typeCharge: "",
    nomLigne: "",
    sousCompte: "",
  };
}

export default function CsvFormatsSettingsPage({ formats, onSaveFormat, onBack }: CsvFormatsSettingsPageProps) {
  const [section, setSection] = useState<"db" | "csv">("db");
  const [name, setName] = useState("");
  const [dateFormat, setDateFormat] = useState<CsvDateFormat>("DD/MM/YYYY");
  const [columns, setColumns] = useState(buildEmptyColumns());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dbPath, setDbPath] = useState<string>("");
  const [dbPathCurrent, setDbPathCurrent] = useState<string>("");
  const [dbPathDefault, setDbPathDefault] = useState<string>("");
  const [dbPathSource, setDbPathSource] = useState<string>("");
  const [dbPathLoading, setDbPathLoading] = useState<boolean>(false);
  const [dbPathError, setDbPathError] = useState<string | null>(null);
  const [dbPathSuccess, setDbPathSuccess] = useState<string | null>(null);
  const [editingFormatId, setEditingFormatId] = useState<string | null>(null);
  const requiredLabels = useMemo(() => columnFields.filter((field) => field.required).map((field) => field.label), []);
  const optionalLabels = useMemo(() => columnFields.filter((field) => !field.required).map((field) => field.label), []);
  const editingFormat = useMemo(() => formats.find((f) => f.id === editingFormatId) || null, [formats, editingFormatId]);

  const formatsToDisplay = useMemo(() => {
    const unique = new Map<string, CsvFormatConfig>();
    formats.forEach((format) => unique.set(format.id, format));
    if (!unique.has(DEFAULT_CSV_FORMAT.id)) {
      unique.set(DEFAULT_CSV_FORMAT.id, DEFAULT_CSV_FORMAT);
    }
    return Array.from(unique.values());
  }, [formats]);

  function handleChange(key: keyof CsvFormatConfig["columns"], value: string) {
    setColumns((prev) => ({ ...prev, [key]: value }));
  }

  function handleEditFormat(format: CsvFormatConfig) {
    setEditingFormatId(format.id);
    setName(format.name);
    setDateFormat(format.dateFormat || "DD/MM/YYYY");
    setColumns({ ...buildEmptyColumns(), ...format.columns });
    setError(null);
    setSuccess(null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Veuillez saisir un nom de format.");
      return;
    }

    for (const field of columnFields.filter((field) => field.required)) {
      if (!columns[field.key as keyof typeof columns]?.trim()) {
        setError("Merci de renseigner tous les champs obligatoires.");
        return;
      }
    }

    const newFormat: CsvFormatConfig = {
      id: editingFormatId || slugify(trimmedName),
      name: trimmedName,
      dateFormat,
      columns: {
        ...columns,
      },
    };

    onSaveFormat(newFormat);
    setSuccess(editingFormatId ? "Format mis à jour." : "Format enregistré. Il sera proposé lors du prochain import.");
    setEditingFormatId(null);
    setName("");
    setColumns(buildEmptyColumns());
  }

  async function loadDbPath() {
    setDbPathLoading(true);
    setDbPathError(null);
    try {
      const cfg = await fetchDbPathConfig();
      setDbPath(cfg.configured_db_path || "");
      setDbPathCurrent(cfg.db_path);
      setDbPathDefault(cfg.default_db_path);
      setDbPathSource(cfg.source || "");
    } catch (err: any) {
      setDbPathError(err?.message || "Impossible de récupérer le chemin DB");
    } finally {
      setDbPathLoading(false);
    }
  }

  useEffect(() => {
    loadDbPath();
  }, []);

  async function handleSaveDbPath() {
    setDbPathError(null);
    setDbPathSuccess(null);
    setDbPathLoading(true);
    try {
      const payload = dbPath.trim();
      const resp = await saveDbPathConfig(payload.length > 0 ? payload : null);
      setDbPathSuccess(resp.message || "Chemin enregistré. Redémarrez l'application pour appliquer.");
      await loadDbPath();
    } catch (err: any) {
      setDbPathError(err?.message || "Erreur lors de l'enregistrement du chemin DB");
    } finally {
      setDbPathLoading(false);
    }
  }

  async function handleResetDbPath() {
    setDbPath("");
    await handleSaveDbPath();
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div style={{ width: "240px", borderRight: "1px solid #e5e7eb", padding: "1.5rem 1rem", background: "#f8fafc" }}>
        <button onClick={onBack} className="secondary-button" style={{ width: "100%", marginBottom: "1rem" }}>
          ← Retour
        </button>
        <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Paramètres</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <button
            className="secondary-button"
            style={{
              justifyContent: "flex-start",
              background: section === "db" ? "#e0f2fe" : "#ffffff",
              borderColor: section === "db" ? "#38bdf8" : "#e5e7eb",
            }}
            onClick={() => setSection("db")}
          >
            Base de données
          </button>
          <button
            className="secondary-button"
            style={{
              justifyContent: "flex-start",
              background: section === "csv" ? "#e0f2fe" : "#ffffff",
              borderColor: section === "csv" ? "#38bdf8" : "#e5e7eb",
            }}
            onClick={() => setSection("csv")}
          >
            Formats CSV
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: "2rem 2.5rem", maxWidth: "1100px" }}>
        {section === "db" && (
          <>
            <h1 style={{ margin: "0 0 0.75rem 0" }}>Base de données</h1>
            <p style={{ color: "#4b5563", marginTop: 0, marginBottom: "1rem" }}>
              Choisissez l'emplacement de la base (ex: partage réseau / SharePoint). Le changement est persistant et sera pris en compte au prochain redémarrage.
            </p>
            <div className="card" style={{ marginBottom: "1.5rem" }}>
              <h2>Chemin de la base</h2>
              {dbPathError && <div className="alert error" style={{ marginBottom: "0.75rem" }}>{dbPathError}</div>}
              {dbPathSuccess && <div className="alert success" style={{ marginBottom: "0.75rem" }}>{dbPathSuccess}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                <label style={{ fontWeight: 600 }}>Chemin actuel</label>
                <div style={{ padding: "0.6rem 0.75rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem", background: "#f8fafc" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.9rem" }}>{dbPathCurrent || "Chemin inconnu"}</div>
                  <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Source: {dbPathSource || "n/a"}</div>
                </div>
                <label style={{ fontWeight: 600 }}>Nouveau chemin (optionnel)</label>
                <input
                  value={dbPath}
                  onChange={(e) => setDbPath(e.target.value)}
                  placeholder={dbPathDefault || "Ex: C:\\Chemin\\vers\\invoices.db"}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                  <button type="button" onClick={handleResetDbPath} disabled={dbPathLoading} style={{ padding: "0.5rem 0.9rem" }}>
                    Rétablir par défaut
                  </button>
                  <button type="button" className="upload-button" onClick={handleSaveDbPath} disabled={dbPathLoading} style={{ padding: "0.5rem 1.1rem" }}>
                    Enregistrer le chemin
                  </button>
                </div>
                <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                  Chemin par défaut : <span style={{ fontFamily: "monospace" }}>{dbPathDefault || "non défini"}</span>.
                  {dbPathSource === "env" && " (Verrouillé par variable d'environnement)"}
                </div>
                {dbPathLoading && <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Chargement...</div>}
              </div>
            </div>
          </>
        )}

        {section === "csv" && (
          <>
            <h1 style={{ margin: "0 0 0.75rem 0" }}>Formats d'import CSV</h1>
            <p style={{ color: "#4b5563", marginTop: 0 }}>
              Les formats sont stockés localement dans votre navigateur. Ajoutez un format pour adapter les titres et l'ordre des colonnes sans changer l'import.
            </p>
            <div
              className="alert info"
              style={{ marginBottom: "1rem", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8" }}
            >
              <div style={{ fontWeight: 600 }}>Colonnes nécessaires (utilisées par l'algorithme) : {requiredLabels.join(", ")}.</div>
              <div style={{ marginTop: "0.35rem", color: "#1f2937" }}>
                Les autres colonnes sont facultatives mais améliorent la catégorisation et le rattachement des lignes : {optionalLabels.join(", ")}.
              </div>
            </div>

            {error && <div className="alert error" style={{ marginBottom: "1rem" }}>{error}</div>}
            {success && <div className="alert success" style={{ marginBottom: "1rem" }}>{success}</div>}

            <form onSubmit={handleSubmit} className="card" style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                <h2 style={{ margin: 0 }}>{editingFormat ? "Modifier un format" : "Ajouter un format"}</h2>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {editingFormat && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditingFormatId(null);
                        setName("");
                        setColumns(buildEmptyColumns());
                        setDateFormat("DD/MM/YYYY");
                        setSuccess(null);
                        setError(null);
                      }}
                    >
                      Nouveau format
                    </button>
                  )}
                </div>
              </div>
              {editingFormat && (
                <div style={{ marginTop: "0.35rem", color: "#4b5563" }}>
                  Édition du format <strong>{editingFormat.name}</strong> (id: {editingFormat.id}). L'identifiant reste inchangé pour éviter de casser les imports existants.
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div style={{ gridColumn: "1 / span 2" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem" }}>Nom du format</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Fournisseur X"
                    style={{ width: "100%", padding: "0.5rem" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem" }}>Format de date</label>
                  <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as CsvDateFormat)} style={{ width: "100%", padding: "0.5rem" }}>
                    <option value="DD/MM/YYYY">JJ/MM/AAAA (par défaut)</option>
                    <option value="YYYY-MM-DD">AAAA-MM-JJ</option>
                  </select>
                </div>
                <div />

                {columnFields.map((field) => (
                  <div key={field.key}>
                    <label style={{ display: "block", marginBottom: "0.25rem" }}>
                      {field.label} {field.required ? "*" : ""}
                    </label>
                    <input
                      value={columns[field.key as keyof typeof columns]}
                      onChange={(e) => handleChange(field.key as keyof typeof columns, e.target.value)}
                      placeholder="Titre exact de la colonne dans le CSV"
                      style={{ width: "100%", padding: "0.5rem" }}
                      required={field.required}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                <button type="button" onClick={() => setColumns(buildEmptyColumns())} style={{ padding: "0.5rem 1rem" }}>
                  Réinitialiser
                </button>
                <button type="submit" className="upload-button" style={{ padding: "0.5rem 1rem" }}>
                  {editingFormat ? "Mettre à jour le format" : "Enregistrer le format"}
                </button>
              </div>
            </form>

            <div className="card">
              <h2>Formats disponibles</h2>
              <p style={{ marginTop: 0, color: "#4b5563" }}>
                Le format par défaut Orange reste toujours disponible.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {formatsToDisplay.map((format) => (
                  <div key={format.id} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                      <div style={{ minWidth: 0 }}>
                        <strong>{format.name}</strong>
                        <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Identifiant: {format.id}</div>
                        <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Date: {format.dateFormat || "DD/MM/YYYY"}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>{Object.values(format.columns).filter(Boolean).join(", ")}</span>
                        <button type="button" className="secondary-button" onClick={() => handleEditFormat(format)}>
                          Modifier
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
