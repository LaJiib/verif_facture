import { useEffect, useState } from "react";
import { AboSuggere } from "../csvImporter";

interface AbonnementConfirmationModalProps {
  abonnements: AboSuggere[];
  onConfirm: (selection: Set<number>) => void;
  onCancel: () => void;
}

export default function AbonnementConfirmationModal({ abonnements, onConfirm, onCancel }: AbonnementConfirmationModalProps) {
  const defaultSelected = () => new Set(abonnements.map((abo, idx) => ((abo.count_lignes ?? 0) >= 5 ? idx : null)).filter((v): v is number => v !== null));
  const [selected, setSelected] = useState<Set<number>>(defaultSelected());
  const [openDetails, setOpenDetails] = useState<Set<number>>(new Set());

  useEffect(() => {
    setSelected(defaultSelected());
  }, [abonnements]);

  function toggle(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(abonnements.map((_, idx) => idx)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  function toggleDetails(idx: number) {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.45)",
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
          maxWidth: "1024px",
          width: "92%",
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1.4rem" }}>
          Confirmation des abonnements détectés
        </h2>
        <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
          {abonnements.length} abonnement(s) détecté(s). Cochez ceux à créer et à lier.
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
              fontSize: "0.9rem",
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
              fontSize: "0.9rem",
            }}
          >
            Tout désélectionner
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem" }}>
          {abonnements.map((abo, idx) => (
            <div
              key={`${abo.nom}-${abo.prix}-${idx}`}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "0.5rem",
                padding: "0.75rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem",
                alignItems: "stretch",
                background: selected.has(idx) ? "#f8fafc" : "white",
                cursor: "pointer",
              }}
              onClick={() => toggle(idx)}
            >
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={selected.has(idx)}
                  onChange={() => toggle(idx)}
                  style={{ marginTop: "0.15rem" }}
                />
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    defaultValue={abo.nom}
                    onChange={(e) => {
                      abonnements[idx].nom = e.target.value;
                    }}
                    style={{
                      width: "100%",
                      padding: "0.35rem 0.45rem",
                      borderRadius: "0.35rem",
                      border: "1px solid #d1d5db",
                      fontWeight: 600,
                      color: "#111827",
                      marginBottom: "0.25rem",
                    }}
                  />
                  <div style={{ color: "#111827", marginBottom: "0.15rem" }}>{abo.prix.toFixed(2)} €</div>
                  <div style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                    Lignes concernées : {abo.count_lignes ?? 0}
                  </div>
                </div>
              </div>
              {abo.numeroAcces_list && abo.numeroAcces_list.length > 0 && (
                <div style={{ marginLeft: "2rem", background: "#f9fafb", borderRadius: "0.35rem", padding: "0.35rem" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDetails(idx);
                    }}
                    style={{
                      cursor: "pointer",
                      color: "#2563eb",
                      fontWeight: 700,
                      background: "transparent",
                      border: "none",
                      padding: "0",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    📄 Détails lignes
                  </button>
                  {openDetails.has(idx) && (
                    <div
                      style={{
                        color: "#6b7280",
                        fontSize: "0.85rem",
                        marginTop: "0.35rem",
                        maxHeight: "180px",
                        overflowY: "auto",
                        padding: "0.35rem",
                        borderTop: "1px solid #e5e7eb",
                      }}
                    >
                      {abo.numeroAcces_list.map((acc, i2) => (
                        <div key={i2}>{acc}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "0.55rem 0.9rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.35rem",
              background: "white",
              cursor: "pointer",
              color: "#111827",
            }}
          >
            Annuler
          </button>
          <button
            onClick={() => onConfirm(selected)}
            style={{
              padding: "0.55rem 1rem",
              border: "none",
              borderRadius: "0.35rem",
              background: "#10b981",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Valider
          </button>
        </div>
      </div>
    </div>
  );
}
