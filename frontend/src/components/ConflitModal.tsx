import { useEffect, useMemo, useState } from "react";
import type { ConflitDecision, ConflitFacture } from "../csvImporter";

interface ConflitModalProps {
  conflits: ConflitFacture[];
  onConfirm: (decisions: ConflitDecision[]) => void;
  onCancel: () => void;
}

const MONTANT_FIELDS: Array<"abo" | "conso" | "remises" | "achat"> = ["abo", "conso", "remises", "achat"];

function hasSignificantDelta(values: { abo: number; conso: number; remises: number; achat: number }): boolean {
  return MONTANT_FIELDS.some((field) => Math.abs(values[field] || 0) > 0.01);
}

function formatAmount(value: number): string {
  return `${(value || 0).toFixed(2)} €`;
}

function formatDelta(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value || 0).toFixed(2)} €`;
}

function formatDateFr(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("fr-FR");
}

export default function ConflitModal({ conflits, onConfirm, onCancel }: ConflitModalProps) {
  const [decisions, setDecisions] = useState<Map<number, { accept: boolean; reset_statut: boolean }>>(() => {
    const m = new Map<number, { accept: boolean; reset_statut: boolean }>();
    conflits.forEach((c) => m.set(c.facture_id, { accept: true, reset_statut: false }));
    return m;
  });
  const [openComptes, setOpenComptes] = useState<Set<string>>(new Set(conflits.map((c) => c.compte_num)));
  const [openFactures, setOpenFactures] = useState<Set<number>>(new Set());
  const [openLignes, setOpenLignes] = useState<Set<number>>(new Set());

  useEffect(() => {
    const m = new Map<number, { accept: boolean; reset_statut: boolean }>();
    conflits.forEach((c) => m.set(c.facture_id, { accept: true, reset_statut: false }));
    setDecisions(m);
    setOpenComptes(new Set(conflits.map((c) => c.compte_num)));
    setOpenFactures(new Set());
    setOpenLignes(new Set());
  }, [conflits]);

  const groupedByCompte = useMemo(() => {
    const map = new Map<string, ConflitFacture[]>();
    conflits.forEach((c) => {
      const key = c.compte_num;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(c);
    });
    return Array.from(map.entries()).map(([compte_num, factures]) => ({
      compte_num,
      compte_nom: factures[0]?.compte_nom || "",
      factures,
    }));
  }, [conflits]);

  const total = conflits.length;
  const acceptedCount = conflits.filter((c) => decisions.get(c.facture_id)?.accept !== false).length;

  function updateDecision(factureId: number, updater: (prev: { accept: boolean; reset_statut: boolean }) => { accept: boolean; reset_statut: boolean }) {
    setDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(factureId) || { accept: true, reset_statut: false };
      next.set(factureId, updater(current));
      return next;
    });
  }

  function toggleCompteOpen(compteNum: string) {
    setOpenComptes((prev) => {
      const next = new Set(prev);
      if (next.has(compteNum)) next.delete(compteNum);
      else next.add(compteNum);
      return next;
    });
  }

  function toggleFactureOpen(factureId: number) {
    setOpenFactures((prev) => {
      const next = new Set(prev);
      if (next.has(factureId)) next.delete(factureId);
      else next.add(factureId);
      return next;
    });
  }

  function toggleLignesOpen(factureId: number) {
    setOpenLignes((prev) => {
      const next = new Set(prev);
      if (next.has(factureId)) next.delete(factureId);
      else next.add(factureId);
      return next;
    });
  }

  function setAll(accept: boolean) {
    setDecisions(() => {
      const next = new Map<number, { accept: boolean; reset_statut: boolean }>();
      conflits.forEach((c) => next.set(c.facture_id, { accept, reset_statut: false }));
      return next;
    });
  }

  function setCompteAccept(compteNum: string, accept: boolean) {
    setDecisions((prev) => {
      const next = new Map(prev);
      conflits
        .filter((c) => c.compte_num === compteNum)
        .forEach((c) => next.set(c.facture_id, { accept, reset_statut: false }));
      return next;
    });
  }

  function buildConfirmedDecisions(): ConflitDecision[] {
    return conflits
      .filter((c) => decisions.get(c.facture_id)?.accept !== false)
      .map((c) => {
        const decision = decisions.get(c.facture_id) || { accept: true, reset_statut: false };
        return {
          facture_id: c.facture_id,
          accept: true,
          reset_statut: decision.reset_statut,
          nouveau: c.nouveau,
          lignes: (c.lignes || []).map((l) => ({
            ligne_facture_id: l.ligne_facture_id,
            nouveau: l.nouveau,
          })),
        };
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
        zIndex: 1050,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "white",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          maxWidth: "900px",
          width: "92%",
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1.4rem" }}>
          Conflits detectes sur factures existantes
        </h2>
        <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
          {total} conflit(s) detecte(s). Choisissez les factures a mettre a jour.
        </p>

        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => setAll(true)}
            style={{
              padding: "0.5rem 1rem",
              background: "#10b981",
              color: "white",
              border: "none",
              borderRadius: "0.25rem",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            Tout accepter
          </button>
          <button
            onClick={() => setAll(false)}
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
            Tout refuser
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {groupedByCompte.map((group) => {
            const isCompteOpen = openComptes.has(group.compte_num);
            const compteAccepted = group.factures.every((f) => decisions.get(f.facture_id)?.accept !== false);
            return (
              <div key={group.compte_num} style={{ border: "1px solid #e5e7eb", borderRadius: "0.45rem", overflow: "hidden" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.7rem 0.85rem",
                    background: "#f9fafb",
                    borderBottom: isCompteOpen ? "1px solid #e5e7eb" : "none",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleCompteOpen(group.compte_num)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                      color: "#111827",
                      padding: 0,
                    }}
                  >
                    {isCompteOpen ? "▼" : "▶"} Compte "{group.compte_nom || "Sans nom"}" ({group.compte_num})
                  </button>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#111827", fontSize: "0.9rem" }}>
                    <input
                      type="checkbox"
                      checked={compteAccepted}
                      onChange={(e) => setCompteAccept(group.compte_num, e.target.checked)}
                    />
                    Tout ce compte
                  </label>
                </div>

                {isCompteOpen && (
                  <div style={{ padding: "0.6rem 0.8rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    {group.factures.map((facture) => {
                      const decision = decisions.get(facture.facture_id) || { accept: true, reset_statut: false };
                      const isFactureOpen = openFactures.has(facture.facture_id);
                      const lignesConcernees = (facture.lignes || []).filter((l) => hasSignificantDelta(l.delta || { abo: 0, conso: 0, remises: 0, achat: 0 }));
                      return (
                        <div key={facture.facture_id} style={{ border: "1px solid #e5e7eb", borderRadius: "0.4rem", overflow: "hidden" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "0.55rem 0.7rem",
                              background: decision.accept ? "#f8fafc" : "#ffffff",
                              borderBottom: isFactureOpen ? "1px solid #e5e7eb" : "none",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => toggleFactureOpen(facture.facture_id)}
                              style={{
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                color: "#111827",
                                fontWeight: 600,
                                padding: 0,
                                textAlign: "left",
                              }}
                            >
                              {isFactureOpen ? "▼" : "▶"} Facture {facture.num} - {formatDateFr(facture.date)}
                            </button>
                            <div style={{ display: "flex", gap: "0.8rem", alignItems: "center" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem" }}>
                                <input
                                  type="checkbox"
                                  checked={decision.accept}
                                  onChange={(e) =>
                                    updateDecision(facture.facture_id, () => ({
                                      accept: e.target.checked,
                                      reset_statut: e.target.checked ? decision.reset_statut : false,
                                    }))
                                  }
                                />
                                Importer
                              </label>
                              {facture.statut_actuel > 0 && (
                                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem" }}>
                                  <input
                                    type="checkbox"
                                    checked={decision.reset_statut}
                                    disabled={!decision.accept}
                                    onChange={(e) =>
                                      updateDecision(facture.facture_id, (prev) => ({
                                        ...prev,
                                        reset_statut: e.target.checked,
                                      }))
                                    }
                                  />
                                  Remettre a Non verifie
                                </label>
                              )}
                            </div>
                          </div>

                          {isFactureOpen && (
                            <div style={{ padding: "0.65rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                              {MONTANT_FIELDS.filter((field) => Math.abs(facture.delta?.[field] || 0) > 0.01).map((field) => {
                                const delta = facture.delta?.[field] || 0;
                                const deltaColor = delta > 0 ? "#059669" : delta < 0 ? "#dc2626" : "#6b7280";
                                return (
                                  <div key={field} style={{ fontSize: "0.9rem", color: "#374151" }}>
                                    <strong style={{ textTransform: "capitalize" }}>{field}</strong>: {formatAmount(facture.ancien?.[field] || 0)} →{" "}
                                    {formatAmount(facture.nouveau?.[field] || 0)}{" "}
                                    <span style={{ color: deltaColor, fontWeight: 600 }}>({formatDelta(delta)})</span>
                                  </div>
                                );
                              })}

                              <button
                                type="button"
                                onClick={() => toggleLignesOpen(facture.facture_id)}
                                style={{
                                  marginTop: "0.25rem",
                                  alignSelf: "flex-start",
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  color: "#2563eb",
                                  fontWeight: 700,
                                  padding: 0,
                                }}
                              >
                                {openLignes.has(facture.facture_id) ? "▼" : "▶"} {lignesConcernees.length} ligne(s) concernee(s)
                              </button>

                              {openLignes.has(facture.facture_id) && (
                                <div
                                  style={{
                                    marginTop: "0.2rem",
                                    borderTop: "1px solid #e5e7eb",
                                    paddingTop: "0.45rem",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.35rem",
                                  }}
                                >
                                  {lignesConcernees.map((ligne) => (
                                    <div key={ligne.ligne_facture_id} style={{ fontSize: "0.85rem", color: "#4b5563" }}>
                                      Ligne {ligne.ligne_nom || "Sans nom"} ({ligne.ligne_num}) -{" "}
                                      {MONTANT_FIELDS.filter((field) => Math.abs(ligne.delta?.[field] || 0) > 0.01)
                                        .map((field) => {
                                          const delta = ligne.delta?.[field] || 0;
                                          const color = delta > 0 ? "#059669" : "#dc2626";
                                          return (
                                            <span key={`${ligne.ligne_facture_id}-${field}`} style={{ color, marginRight: "0.35rem" }}>
                                              {field} {formatDelta(delta)}
                                            </span>
                                          );
                                        })}
                                    </div>
                                  ))}
                                  {lignesConcernees.length === 0 && (
                                    <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>Aucune ligne avec ecart significatif.</div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
            onClick={() => onConfirm(buildConfirmedDecisions())}
            style={{
              padding: "0.55rem 1rem",
              border: "none",
              borderRadius: "0.35rem",
              background: "#10b981",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Importer les modifications selectionnees ({acceptedCount}/{total})
          </button>
        </div>
      </div>
    </div>
  );
}

