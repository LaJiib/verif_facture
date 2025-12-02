import { useMemo, useState, FormEvent } from "react";
import { CsvFormatConfig, CsvDateFormat, DEFAULT_CSV_FORMAT } from "../utils/csvFormats";

interface CsvFormatsSettingsPageProps {
  formats: CsvFormatConfig[];
  onSaveFormat: (format: CsvFormatConfig) => void;
  onBack: () => void;
}

const columnFields: Array<{ key: keyof CsvFormatConfig["columns"]; label: string; required?: boolean }> = [
  { key: "numeroCompte", label: "Numéro compte", required: true },
  { key: "numeroAcces", label: "Numéro accès" },
  { key: "numeroFacture", label: "Numéro facture", required: true },
  { key: "date", label: "Date (colonne)", required: true },
  { key: "montantHT", label: "Montant HT", required: true },
  { key: "typeAcces", label: "Type d'accès" },
  { key: "libelleDetail", label: "Libellé ligne facture" },
  { key: "rubriqueFacture", label: "Rubrique facture" },
  { key: "niveauCharge", label: "Niveau de charge" },
  { key: "typeCharge", label: "Type de charge" },
];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `format-${Date.now()}`;
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
  };
}

export default function CsvFormatsSettingsPage({ formats, onSaveFormat, onBack }: CsvFormatsSettingsPageProps) {
  const [name, setName] = useState("");
  const [dateFormat, setDateFormat] = useState<CsvDateFormat>("DD/MM/YYYY");
  const [columns, setColumns] = useState(buildEmptyColumns());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      if (!columns[field.key]?.trim()) {
        setError("Merci de renseigner tous les champs obligatoires.");
        return;
      }
    }

    const newFormat: CsvFormatConfig = {
      id: slugify(trimmedName),
      name: trimmedName,
      dateFormat,
      columns: {
        ...columns,
      },
    };

    onSaveFormat(newFormat);
    setSuccess("Format enregistré. Il sera proposé lors du prochain import.");
    setName("");
    setColumns(buildEmptyColumns());
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "900px" }}>
      <button onClick={onBack} style={{ marginBottom: "1rem" }}>
        ← Retour
      </button>
      <h1 style={{ margin: "0 0 1rem 0" }}>Formats d'import CSV</h1>
      <p style={{ color: "#4b5563", marginTop: 0 }}>
        Les formats sont stockés localement dans votre navigateur. Ajoutez un format pour adapter les titres et l'ordre des colonnes sans changer l'import.
      </p>

      {error && <div className="alert error" style={{ marginBottom: "1rem" }}>{error}</div>}
      {success && <div className="alert success" style={{ marginBottom: "1rem" }}>{success}</div>}

      <form onSubmit={handleSubmit} className="card" style={{ marginBottom: "1.5rem" }}>
        <h2>Ajouter un format</h2>
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
                value={columns[field.key]}
                onChange={(e) => handleChange(field.key, e.target.value)}
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
            Enregistrer le format
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{format.name}</strong>
                  <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Identifiant: {format.id}</div>
                  <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Date: {format.dateFormat || "DD/MM/YYYY"}</div>
                </div>
                <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>{Object.values(format.columns).filter(Boolean).join(", ")}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
