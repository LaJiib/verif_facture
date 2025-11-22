import { useState } from "react";
import { createEntreprise } from "../newApi";

interface CreateEntreprisePageProps {
  onBack: () => void;
  onCreated: () => void;
}

export default function CreateEntreprisePage({ onBack, onCreated }: CreateEntreprisePageProps) {
  const [nom, setNom] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    console.log("[CreateEntreprise] 🚀 Début de la soumission du formulaire");
    console.log("[CreateEntreprise] 📝 Nom saisi:", nom);

    if (!nom.trim()) {
      setError("Le nom de l'entreprise est requis");
      console.log("[CreateEntreprise] ❌ Nom vide, arrêt de la soumission");
      return;
    }

    setIsLoading(true);
    setError(null);
    console.log("[CreateEntreprise] ⏳ Appel API createEntreprise...");

    try {
      const result = await createEntreprise(nom.trim());
      console.log("[CreateEntreprise] ✅ Entreprise créée:", result);
      console.log("[CreateEntreprise] 🔄 Rechargement de la liste des entreprises...");
      await onCreated();
      console.log("[CreateEntreprise] ✅ Liste rechargée, retour à la page précédente");
      onBack();
    } catch (err) {
      console.error("[CreateEntreprise] ❌ Erreur:", err);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "2rem" }}>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: "none",
            color: "#3b82f6",
            cursor: "pointer",
            fontSize: "0.875rem",
            padding: "0.5rem 0",
            marginBottom: "1.5rem",
          }}
        >
          ← Retour
        </button>

        <h1 style={{ fontSize: "1.5rem", fontWeight: "600", marginBottom: "1.5rem" }}>
          Nouvelle entreprise
        </h1>

        {error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #ef4444",
              borderRadius: "0.375rem",
              padding: "0.75rem",
              marginBottom: "1rem",
              color: "#991b1b",
              fontSize: "0.875rem",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div
            style={{
              background: "white",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: "500",
                color: "#374151",
                marginBottom: "0.5rem",
              }}
            >
              Nom de l'entreprise
            </label>
            <input
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="Ex: Orange France"
              autoFocus
              style={{
                width: "100%",
                padding: "0.625rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
            <button
              type="submit"
              disabled={isLoading || !nom.trim()}
              style={{
                background: !nom.trim() ? "#9ca3af" : "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.625rem 1.25rem",
                cursor: !nom.trim() ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
                fontWeight: "500",
              }}
            >
              {isLoading ? "Création..." : "Créer"}
            </button>
            <button
              type="button"
              onClick={onBack}
              style={{
                background: "white",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                padding: "0.625rem 1.25rem",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
