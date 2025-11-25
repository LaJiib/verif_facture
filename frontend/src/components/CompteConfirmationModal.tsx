import { useEffect, useState } from "react";

interface CompteACreer {
  num: string;
  nom: string;
  lot: string;
}

interface CompteConfirmationModalProps {
  comptesACreer: CompteACreer[];
  onConfirm: (comptesSelectionnes: Set<string>, comptesMisesAJour: CompteACreer[]) => void;
  onCancel: () => void;
}

export default function CompteConfirmationModal({
  comptesACreer,
  onConfirm,
  onCancel,
}: CompteConfirmationModalProps) {
  const [selectedComptes, setSelectedComptes] = useState<Set<string>>(new Set(comptesACreer.map((c) => c.num)));
  const [localComptes, setLocalComptes] = useState<CompteACreer[]>(comptesACreer);
  const [editing, setEditing] = useState<{ num: string; nom: string; lot: string } | null>(null);

  useEffect(() => {
    setSelectedComptes(new Set(comptesACreer.map((c) => c.num)));
    setLocalComptes(comptesACreer);
  }, [comptesACreer]);

  function toggleCompte(num: string) {
    const newSet = new Set(selectedComptes);
    if (newSet.has(num)) {
      newSet.delete(num);
    } else {
      newSet.add(num);
    }
    setSelectedComptes(newSet);
  }

  function selectAll() {
    setSelectedComptes(new Set(comptesACreer.map((c) => c.num)));
  }

  function deselectAll() {
    setSelectedComptes(new Set());
  }

  function handleConfirm() {
    onConfirm(selectedComptes, localComptes);
  }

  function openEdit(compte: CompteACreer) {
    setEditing({ num: compte.num, nom: compte.nom, lot: compte.lot });
  }

  function saveEdit() {
    if (!editing) return;
    const nom = editing.nom.trim() || `Compte ${editing.num}`;
    const lot = editing.lot.trim() || "Non défini";
    setLocalComptes((prev) =>
      prev.map((c) => (c.num === editing.num ? { ...c, nom, lot } : c))
    );
    setEditing(null);
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "white",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, marginBottom: "1rem", fontSize: "1.5rem" }}>
          Confirmation des comptes de facturation
        </h2>

        <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
          {comptesACreer.length} nouveau{comptesACreer.length > 1 ? "x" : ""} compte{comptesACreer.length > 1 ? "s" : ""} de
          facturation détecté{comptesACreer.length > 1 ? "s" : ""} dans le CSV. Sélectionnez ceux que vous souhaitez
          créer :
        </p>

        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
          <button
            onClick={selectAll}
            style={{
              padding: "0.5rem 1rem",
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "0.25rem",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Tout sélectionner
          </button>
          <button
            onClick={deselectAll}
            style={{
              padding: "0.5rem 1rem",
              background: "#6b7280",
              color: "white",
              border: "none",
              borderRadius: "0.25rem",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Tout désélectionner
          </button>
        </div>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "0.25rem",
            maxHeight: "400px",
            overflow: "auto",
          }}
        >
          {localComptes.map((compte) => (
            <div
              key={compte.num}
              style={{
                padding: "0.75rem",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                background: selectedComptes.has(compte.num) ? "#eff6ff" : "white",
              }}
              onClick={() => toggleCompte(compte.num)}
            >
              <input
                type="checkbox"
                checked={selectedComptes.has(compte.num)}
                onChange={() => toggleCompte(compte.num)}
                style={{
                  marginRight: "0.75rem",
                  width: "18px",
                  height: "18px",
                  cursor: "pointer",
                }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{ fontWeight: "600", marginBottom: "0.25rem" }}
                  title="Cliquer pour modifier nom ou lot"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(compte);
                  }}
                >
                  {compte.nom}
                </div>
                <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                  N° {compte.num} • Lot: {compte.lot}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(compte);
                }}
                style={{
                  border: "1px solid #d1d5db",
                  background: "white",
                  padding: "0.35rem 0.6rem",
                  borderRadius: "0.35rem",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  color: "#374151",
                }}
              >
                Modifier
              </button>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "1.5rem",
            display: "flex",
            gap: "0.75rem",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "0.5rem 1.5rem",
              background: "#e5e7eb",
              color: "#374151",
              border: "none",
              borderRadius: "0.25rem",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedComptes.size === 0}
            style={{
              padding: "0.5rem 1.5rem",
              background: selectedComptes.size > 0 ? "#10b981" : "#9ca3af",
              color: "white",
              border: "none",
              borderRadius: "0.25rem",
              cursor: selectedComptes.size > 0 ? "pointer" : "not-allowed",
              fontSize: "1rem",
            }}
          >
            Confirmer ({selectedComptes.size})
          </button>
        </div>
      </div>

      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{
              background: "white",
              borderRadius: "0.65rem",
              padding: "1.25rem",
              width: "90%",
              maxWidth: "450px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Éditer le compte {editing.num}</h3>
              <button
                onClick={() => setEditing(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "1.25rem",
                  cursor: "pointer",
                  color: "#6b7280",
                }}
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontWeight: 600 }}>
                Nom du compte
                <input
                  value={editing.nom}
                  onChange={(e) => setEditing({ ...editing, nom: e.target.value })}
                  style={{
                    padding: "0.6rem 0.75rem",
                    borderRadius: "0.45rem",
                    border: "1px solid #d1d5db",
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontWeight: 600 }}>
                Lot
                <input
                  value={editing.lot}
                  onChange={(e) => setEditing({ ...editing, lot: e.target.value })}
                  style={{
                    padding: "0.6rem 0.75rem",
                    borderRadius: "0.45rem",
                    border: "1px solid #d1d5db",
                  }}
                />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
              <button
                onClick={() => setEditing(null)}
                style={{
                  padding: "0.5rem 1.2rem",
                  background: "white",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.45rem",
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                Annuler
              </button>
              <button
                onClick={saveEdit}
                style={{
                  padding: "0.5rem 1.2rem",
                  background: "#2563eb",
                  color: "white",
                  border: "none",
                  borderRadius: "0.45rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
