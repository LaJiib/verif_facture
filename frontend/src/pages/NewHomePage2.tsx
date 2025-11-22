import { useState, useEffect } from "react";
import { executeQuery, deleteEntreprise } from "../newApi";

interface HomePageProps {
  entrepriseId: number;
  entrepriseNom: string;
  onNavigateToFactures: () => void;
  onNavigateToImport: () => void;
  onReloadEntreprises: () => void;
}

export default function HomePage({
  entrepriseId,
  entrepriseNom,
  onNavigateToFactures,
  onNavigateToImport,
  onReloadEntreprises,
}: HomePageProps) {
  const [stats, setStats] = useState<{
    nb_comptes: number;
    nb_lignes: number;
    nb_factures: number;
    total_ht: number;
  } | null>(null);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    loadStats();
  }, [entrepriseId]);

  async function loadStats() {
    try {
      const query = `
        SELECT
          COUNT(DISTINCT c.id) as nb_comptes,
          COUNT(DISTINCT l.id) as nb_lignes,
          COUNT(DISTINCT f.id) as nb_factures,
          SUM(f.abo + f.conso + f.remises + f.achat) as total_ht
        FROM entreprises e
        LEFT JOIN comptes c ON c.entreprise_id = e.id
        LEFT JOIN lignes l ON l.compte_id = c.id
        LEFT JOIN factures f ON f.compte_id = c.id
        WHERE e.id = ${entrepriseId}
      `;
      const result = await executeQuery(query);
      if (result.data && result.data.length > 0) {
        setStats({
          nb_comptes: result.data[0].nb_comptes || 0,
          nb_lignes: result.data[0].nb_lignes || 0,
          nb_factures: result.data[0].nb_factures || 0,
          total_ht: result.data[0].total_ht || 0,
        });
      }
    } catch (error) {
      console.error("Erreur lors du chargement des stats:", error);
    }
  }

  async function handleDeleteAllData() {
    if (deleteConfirm !== "SUPPRIMER") {
      alert("Vous devez taper 'SUPPRIMER' pour confirmer");
      return;
    }

    if (!confirm(`⚠️ ATTENTION : Toutes les données de l'entreprise "${entrepriseNom}" seront définitivement supprimées. Cette action est irréversible. Continuer ?`)) {
      return;
    }

    try {
      await deleteEntreprise(entrepriseId);
      alert("Entreprise et toutes ses données supprimées avec succès");
      await onReloadEntreprises();
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
      alert("Erreur lors de la suppression de l'entreprise");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "2rem",
      }}
    >
      {/* En-tête */}
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: "bold",
            color: "#1f2937",
            marginBottom: "0.5rem",
          }}
        >
          {entrepriseNom}
        </h1>
        <p style={{ color: "#6b7280", marginBottom: "2rem" }}>
          Dashboard et gestion de l'entreprise
        </p>

        {/* Statistiques */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "1.5rem",
            marginBottom: "2rem",
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
              Comptes de facturation
            </div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#1f2937" }}>
              {stats?.nb_comptes || 0}
            </div>
          </div>

          <div
            style={{
              background: "white",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
              Lignes télécom
            </div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#1f2937" }}>
              {stats?.nb_lignes || 0}
            </div>
          </div>

          <div
            style={{
              background: "white",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
              Factures
            </div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#1f2937" }}>
              {stats?.nb_factures || 0}
            </div>
          </div>

          <div
            style={{
              background: "white",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
              Total HT
            </div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#1f2937" }}>
              {stats?.total_ht ? `${stats.total_ht.toFixed(2)} €` : "0.00 €"}
            </div>
          </div>
        </div>

        {/* Actions rapides */}
        <div
          style={{
            background: "white",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            marginBottom: "2rem",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "1rem" }}>
            Actions rapides
          </h2>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <button
              onClick={onNavigateToFactures}
              style={{
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "500",
              }}
            >
              📊 Voir les factures
            </button>
            <button
              onClick={onNavigateToImport}
              style={{
                background: "#10b981",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "500",
              }}
            >
              📥 Importer CSV
            </button>
          </div>
        </div>

        {/* Gestion de la base de données */}
        <div
          style={{
            background: "white",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "1rem" }}>
            Gestion de la base de données
          </h2>

          <div style={{ marginBottom: "1rem" }}>
            <button
              onClick={() => setShowDangerZone(!showDangerZone)}
              style={{
                background: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "500",
              }}
            >
              ⚠️ Zone dangereuse
            </button>
          </div>

          {showDangerZone && (
            <div
              style={{
                background: "#fef2f2",
                border: "2px solid #ef4444",
                borderRadius: "0.5rem",
                padding: "1.5rem",
                marginTop: "1rem",
              }}
            >
              <h3 style={{ color: "#991b1b", fontSize: "1rem", fontWeight: "600", marginBottom: "1rem" }}>
                ⚠️ Supprimer toutes les données
              </h3>
              <p style={{ color: "#7f1d1d", marginBottom: "1rem", fontSize: "0.875rem" }}>
                Cette action supprimera définitivement l'entreprise "{entrepriseNom}" et toutes ses données associées :
              </p>
              <ul style={{ color: "#7f1d1d", marginBottom: "1rem", fontSize: "0.875rem", paddingLeft: "1.5rem" }}>
                <li>Tous les comptes ({stats?.nb_comptes || 0})</li>
                <li>Toutes les factures ({stats?.nb_factures || 0})</li>
                <li>L'entreprise elle-même</li>
              </ul>
              <p style={{ color: "#991b1b", fontWeight: "600", marginBottom: "1rem", fontSize: "0.875rem" }}>
                Cette action est IRRÉVERSIBLE !
              </p>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", color: "#7f1d1d", fontSize: "0.875rem" }}>
                  Tapez <strong>"SUPPRIMER"</strong> pour confirmer :
                </label>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "2px solid #ef4444",
                    borderRadius: "0.375rem",
                    fontSize: "0.875rem",
                  }}
                  placeholder="SUPPRIMER"
                />
              </div>

              <button
                onClick={handleDeleteAllData}
                disabled={deleteConfirm !== "SUPPRIMER"}
                style={{
                  background: deleteConfirm === "SUPPRIMER" ? "#dc2626" : "#9ca3af",
                  color: "white",
                  border: "none",
                  borderRadius: "0.375rem",
                  padding: "0.75rem 1.5rem",
                  cursor: deleteConfirm === "SUPPRIMER" ? "pointer" : "not-allowed",
                  fontSize: "0.875rem",
                  fontWeight: "600",
                }}
              >
                🗑️ Supprimer définitivement
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
