import { useState } from "react";

interface SidebarProps {
  currentEntrepriseId: number | null;
  entreprises: Array<{ id: number; nom: string }>;
  onSelectEntreprise: (id: number) => void;
  onCreateEntreprise: () => void;
  onNavigateToSettings: () => void;
  onNavigateToImport: () => void;
}

export default function Sidebar({
  currentEntrepriseId,
  entreprises,
  onSelectEntreprise,
  onCreateEntreprise,
  onNavigateToSettings,
  onNavigateToImport,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Bouton hamburger pour ouvrir le menu */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: "fixed",
          top: "1rem",
          left: "1rem",
          zIndex: 1000,
          background: "#3b82f6",
          color: "white",
          border: "none",
          borderRadius: "0.5rem",
          padding: "0.75rem",
          cursor: "pointer",
          fontSize: "1.25rem",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}
      >
        ☰
      </button>

      {/* Overlay sombre quand le menu est ouvert */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            zIndex: 999,
          }}
        />
      )}

      {/* Menu latéral */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: isOpen ? 0 : "-320px",
          width: "320px",
          height: "100vh",
          background: "white",
          boxShadow: "2px 0 8px rgba(0,0,0,0.1)",
          zIndex: 1001,
          transition: "left 0.3s ease",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* En-tête */}
        <div
          style={{
            padding: "1.5rem",
            borderBottom: "1px solid #e5e7eb",
            background: "#f8fafc",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#1f2937" }}>
            Menu
          </h2>
        </div>

        {/* Liste des entreprises */}
        <div style={{ flex: 1, padding: "1rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "0.875rem", color: "#6b7280" }}>
                ENTREPRISES
              </h3>
              <button
                onClick={() => {
                  onCreateEntreprise();
                  setIsOpen(false);
                }}
                style={{
                  background: "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: "0.25rem",
                  padding: "0.25rem 0.5rem",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                + Nouvelle
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {entreprises.map((entreprise) => (
                <button
                  key={entreprise.id}
                  onClick={() => {
                    onSelectEntreprise(entreprise.id);
                    setIsOpen(false);
                  }}
                  style={{
                    background:
                      currentEntrepriseId === entreprise.id
                        ? "#dbeafe"
                        : "transparent",
                    color:
                      currentEntrepriseId === entreprise.id
                        ? "#1e40af"
                        : "#374151",
                    border: "none",
                    borderRadius: "0.375rem",
                    padding: "0.75rem",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.875rem",
                    fontWeight:
                      currentEntrepriseId === entreprise.id ? "600" : "400",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (currentEntrepriseId !== entreprise.id) {
                      e.currentTarget.style.background = "#f3f4f6";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentEntrepriseId !== entreprise.id) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  {entreprise.nom}
                </button>
              ))}
            </div>
          </div>

          {/* Séparateur */}
          <div
            style={{
              height: "1px",
              background: "#e5e7eb",
              margin: "1rem 0",
            }}
          />

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <button
              onClick={() => {
                onNavigateToImport();
                setIsOpen(false);
              }}
              style={{
                background: "transparent",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                padding: "0.75rem",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "0.875rem",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f3f4f6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              📥 Importer CSV
            </button>

            <button
              onClick={() => {
                onNavigateToSettings();
                setIsOpen(false);
              }}
              style={{
                background: "transparent",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                padding: "0.75rem",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "0.875rem",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f3f4f6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              ⚙️ Paramètres
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
