import { useEffect, useMemo, useState } from "react";
import type { ConflitDecision, ConflitFacture } from "../csvImporter";

interface ConflitModalProps {
  conflits: ConflitFacture[];
  onConfirm: (decisions: ConflitDecision[]) => void;
  onCancel: () => void;
}

const MONTANT_FIELDS: Array<"abo" | "conso" | "remises" | "achat"> = ["abo", "conso", "remises", "achat"];
const FIELD_LABELS: Record<string, string> = {
  abo: "Abonnement",
  conso: "Consommation",
  remises: "Remises",
  achat: "Achat",
};

const STATUT_CONFIG: Record<number, { label: string; bg: string; color: string }> = {
  0: { label: "Importé",   bg: "#f3f4f6", color: "#6b7280" },
  1: { label: "Validé",    bg: "#ecfdf5", color: "#059669" },
  2: { label: "Contesté",  bg: "#fff7ed", color: "#d97706" },
};

function StatutPill({ statut }: { statut: number }) {
  const cfg = STATUT_CONFIG[statut] ?? { label: `Statut ${statut}`, bg: "#f3f4f6", color: "#6b7280" };
  return (
    <span style={{
      background: cfg.bg,
      color: cfg.color,
      border: `1px solid ${cfg.color}33`,
      borderRadius: "999px",
      padding: "0.15rem 0.6rem",
      fontSize: "0.78rem",
      fontWeight: 700,
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

function formatAmount(v: number): string {
  return `${(v ?? 0).toFixed(2)} €`;
}

function formatDelta(v: number): React.ReactElement {
  const sign = v >= 0 ? "+" : "";
  const color = v > 0.01 ? "#059669" : v < -0.01 ? "#dc2626" : "#6b7280";
  return <span style={{ color, fontWeight: 600 }}>{sign}{(v ?? 0).toFixed(2)} €</span>;
}

function formatDateFr(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR");
}

function totalHT(amounts: { abo: number; conso: number; remises: number; achat: number }): number {
  return (amounts.abo ?? 0) + (amounts.conso ?? 0) + (amounts.remises ?? 0) + (amounts.achat ?? 0);
}

/** Mini-tableau de comparaison ancien / nouveau / delta pour une facture ou une ligne */
function ComparaisonTable({
  ancien,
  nouveau,
  delta,
}: {
  ancien: Record<string, number>;
  nouveau: Record<string, number>;
  delta: Record<string, number>;
}) {
  const visibleFields = MONTANT_FIELDS.filter((f) => Math.abs(delta[f] ?? 0) > 0.01);
  const totalAncien  = totalHT(ancien as any);
  const totalNouveau = totalHT(nouveau as any);
  const totalDelta   = totalNouveau - totalAncien;

  const thStyle: React.CSSProperties = {
    padding: "0.3rem 0.6rem",
    textAlign: "right",
    fontWeight: 600,
    fontSize: "0.8rem",
    color: "#6b7280",
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: "0.3rem 0.6rem",
    textAlign: "right",
    fontSize: "0.85rem",
    borderBottom: "1px solid #f3f4f6",
    whiteSpace: "nowrap",
  };
  const tdLabelStyle: React.CSSProperties = { ...tdStyle, textAlign: "left", color: "#374151" };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: "left" }}>Champ</th>
          <th style={thStyle}>Actuel</th>
          <th style={thStyle}>Nouveau</th>
          <th style={thStyle}>Écart</th>
        </tr>
      </thead>
      <tbody>
        {visibleFields.map((field) => (
          <tr key={field} style={{ background: "#fffbeb" }}>
            <td style={tdLabelStyle}>{FIELD_LABELS[field]}</td>
            <td style={{ ...tdStyle, color: "#6b7280" }}>{formatAmount(ancien[field] ?? 0)}</td>
            <td style={{ ...tdStyle, fontWeight: 600 }}>{formatAmount(nouveau[field] ?? 0)}</td>
            <td style={tdStyle}>{formatDelta(delta[field] ?? 0)}</td>
          </tr>
        ))}
        {/* Ligne total toujours affichée */}
        <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f8fafc" }}>
          <td style={{ ...tdLabelStyle, fontWeight: 700 }}>Total HT</td>
          <td style={{ ...tdStyle, color: "#6b7280", fontWeight: 600 }}>{formatAmount(totalAncien)}</td>
          <td style={{ ...tdStyle, fontWeight: 700 }}>{formatAmount(totalNouveau)}</td>
          <td style={tdStyle}>{formatDelta(totalDelta)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export default function ConflitModal({ conflits, onConfirm, onCancel }: ConflitModalProps) {
  const [decisions, setDecisions] = useState<Map<number, { accept: boolean; reset_statut: boolean }>>(() => {
    const m = new Map<number, { accept: boolean; reset_statut: boolean }>();
    conflits.forEach((c) => m.set(c.facture_id, { accept: true, reset_statut: false }));
    return m;
  });
  const [openComptes,  setOpenComptes]  = useState<Set<string>>(new Set(conflits.map((c) => c.compte_num)));
  const [openFactures, setOpenFactures] = useState<Set<number>>(new Set());
  const [openLignes,   setOpenLignes]   = useState<Set<number>>(new Set());

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
      if (!map.has(c.compte_num)) map.set(c.compte_num, []);
      map.get(c.compte_num)!.push(c);
    });
    return Array.from(map.entries()).map(([compte_num, factures]) => ({
      compte_num,
      compte_nom: factures[0]?.compte_nom || "",
      factures,
    }));
  }, [conflits]);

  const total         = conflits.length;
  const acceptedCount = conflits.filter((c) => decisions.get(c.facture_id)?.accept !== false).length;

  function updateDecision(
    factureId: number,
    updater: (prev: { accept: boolean; reset_statut: boolean }) => { accept: boolean; reset_statut: boolean }
  ) {
    setDecisions((prev) => {
      const next = new Map(prev);
      const cur = next.get(factureId) ?? { accept: true, reset_statut: false };
      next.set(factureId, updater(cur));
      return next;
    });
  }

  function toggleCompteOpen(num: string) {
    setOpenComptes((p) => { const n = new Set(p); n.has(num) ? n.delete(num) : n.add(num); return n; });
  }
  function toggleFactureOpen(id: number) {
    setOpenFactures((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleLignesOpen(id: number) {
    setOpenLignes((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function setAll(accept: boolean) {
    setDecisions(() => {
      const m = new Map<number, { accept: boolean; reset_statut: boolean }>();
      conflits.forEach((c) => m.set(c.facture_id, { accept, reset_statut: false }));
      return m;
    });
  }

  function setCompteAccept(compteNum: string, accept: boolean) {
    setDecisions((prev) => {
      const next = new Map(prev);
      conflits.filter((c) => c.compte_num === compteNum)
              .forEach((c) => next.set(c.facture_id, { accept, reset_statut: false }));
      return next;
    });
  }

  function buildConfirmedDecisions(): ConflitDecision[] {
    return conflits
      .filter((c) => decisions.get(c.facture_id)?.accept !== false)
      .map((c) => {
        const dec = decisions.get(c.facture_id) ?? { accept: true, reset_statut: false };
        return {
          facture_id: c.facture_id,
          accept: true,
          reset_statut: dec.reset_statut,
          nouveau: c.nouveau,
          lignes: (c.lignes ?? []).map((l) => ({
            ligne_facture_id: l.ligne_facture_id,
            nouveau: l.nouveau,
          })),
        };
      });
  }

  /* ── Styles partagés ── */
  const sectionHeader: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.6rem 0.75rem",
    background: "#f8fafc",
    borderRadius: "0.4rem",
    marginBottom: "0.4rem",
    cursor: "pointer",
    userSelect: "none",
    border: "1px solid #e5e7eb",
  };

  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0,0,0,0.48)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1050,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "white",
          borderRadius: "0.6rem",
          padding: "1.5rem",
          maxWidth: "1200px",       /* ← élargi */
          width: "96%",
          maxHeight: "88vh",
          overflow: "auto",
          boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── En-tête ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.35rem" }}>
              Conflits détectés sur factures existantes
            </h2>
            <p style={{ margin: "0.3rem 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
              {total} facture(s) avec des montants différents dans ce CSV.
              Sélectionnez celles à mettre à jour.
            </p>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>✕</button>
        </div>

        {/* ── Actions globales ── */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => setAll(true)}  style={btnOutline}>Tout accepter</button>
          <button onClick={() => setAll(false)} style={btnOutline}>Tout refuser</button>
        </div>

        {/* ── Corps : par compte ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {groupedByCompte.map(({ compte_num, compte_nom, factures }) => {
            const isCompteOpen = openComptes.has(compte_num);
            const compteAccepted = factures.filter((f) => decisions.get(f.facture_id)?.accept !== false).length;

            return (
              <div key={compte_num} style={{ border: "1px solid #d1d5db", borderRadius: "0.5rem", overflow: "hidden" }}>

                {/* Ligne compte */}
                <div
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "0.65rem 0.9rem",
                    background: "#f1f5f9",
                    borderBottom: isCompteOpen ? "1px solid #d1d5db" : "none",
                    cursor: "pointer",
                  }}
                  onClick={() => toggleCompteOpen(compte_num)}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                    {isCompteOpen ? "▼" : "▶"}&nbsp;
                    {compte_nom ? `${compte_nom} ` : ""}
                    <span style={{ color: "#6b7280", fontWeight: 400, fontSize: "0.85rem" }}>({compte_num})</span>
                    &ensp;
                    <span style={{ fontSize: "0.8rem", color: "#6b7280", fontWeight: 400 }}>
                      {factures.length} facture(s) · {compteAccepted}/{factures.length} sélectionnée(s)
                    </span>
                  </span>
                  <div style={{ display: "flex", gap: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setCompteAccept(compte_num, true)}  style={btnMini}>Tout accepter</button>
                    <button onClick={() => setCompteAccept(compte_num, false)} style={btnMini}>Tout refuser</button>
                  </div>
                </div>

                {isCompteOpen && (
                  <div style={{ padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {factures.map((facture) => {
                      const decision      = decisions.get(facture.facture_id) ?? { accept: true, reset_statut: false };
                      const isFactOpen    = openFactures.has(facture.facture_id);
                      const isLignesOpen  = openLignes.has(facture.facture_id);
                      const nbLignesConf  = (facture.lignes ?? []).filter(
                        (l) => MONTANT_FIELDS.some((f) => Math.abs(l.delta?.[f] ?? 0) > 0.01)
                      ).length;
                      const totalActuel   = totalHT(facture.ancien);
                      const totalNouveau  = totalHT(facture.nouveau);

                      return (
                        <div key={facture.facture_id} style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: "0.4rem",
                          overflow: "hidden",
                          opacity: decision.accept ? 1 : 0.55,
                        }}>
                          {/* ── Header facture ── */}
                          <div style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            flexWrap: "wrap", gap: "0.5rem",
                            padding: "0.55rem 0.75rem",
                            background: isFactOpen ? "#f8fafc" : "#ffffff",
                            borderBottom: isFactOpen ? "1px solid #e5e7eb" : "none",
                          }}>
                            {/* Titre + méta */}
                            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => toggleFactureOpen(facture.facture_id)}
                                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 700, fontSize: "0.92rem", color: "#111827" }}
                              >
                                {isFactOpen ? "▼" : "▶"} N° {facture.num}
                              </button>
                              <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                                {formatDateFr(facture.date)}
                              </span>
                              <StatutPill statut={facture.statut_actuel} />
                              {/* Montants résumé */}
                              <span style={{ fontSize: "0.82rem", color: "#6b7280" }}>
                                Actuel&nbsp;<strong>{formatAmount(totalActuel)}</strong>
                                &ensp;→&ensp;
                                Nouveau&nbsp;<strong>{formatAmount(totalNouveau)}</strong>
                                &ensp;({formatDelta(totalNouveau - totalActuel)})
                              </span>
                            </div>

                            {/* Contrôles */}
                            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.88rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={decision.accept}
                                  onChange={(e) => updateDecision(facture.facture_id, () => ({
                                    accept: e.target.checked,
                                    reset_statut: e.target.checked ? decision.reset_statut : false,
                                  }))}
                                />
                                Importer
                              </label>
                              {facture.statut_actuel > 0 && (
                                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.88rem", cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={decision.reset_statut}
                                    disabled={!decision.accept}
                                    onChange={(e) => updateDecision(facture.facture_id, (p) => ({ ...p, reset_statut: e.target.checked }))}
                                  />
                                  Remettre à "Importé"
                                </label>
                              )}
                            </div>
                          </div>

                          {/* ── Détail facture ── */}
                          {isFactOpen && (
                            <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>

                              {/* Tableau comparaison facture */}
                              <div>
                                <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#6b7280", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                  Détail facture
                                </div>
                                <ComparaisonTable
                                  ancien={facture.ancien}
                                  nouveau={facture.nouveau}
                                  delta={facture.delta}
                                />
                              </div>

                              {/* Section lignes */}
                              {(facture.lignes ?? []).length > 0 && (
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => toggleLignesOpen(facture.facture_id)}
                                    style={{ ...sectionHeader, width: "100%", textAlign: "left", color: "#111827" }}
                                  >
                                    <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                                      {isLignesOpen ? "▼" : "▶"}&nbsp;
                                      Lignes ({facture.lignes!.length} · {nbLignesConf} avec écart)
                                    </span>
                                  </button>

                                  {isLignesOpen && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.25rem" }}>
                                      {(facture.lignes ?? []).map((ligne) => {
                                        const ligneHasDelta = MONTANT_FIELDS.some((f) => Math.abs(ligne.delta?.[f] ?? 0) > 0.01);
                                        const ligneTotal = totalHT(ligne.ancien);
                                        const ligneTotalNew = totalHT(ligne.nouveau);

                                        return (
                                          <div
                                            key={ligne.ligne_facture_id}
                                            style={{
                                              border: `1px solid ${ligneHasDelta ? "#fde68a" : "#e5e7eb"}`,
                                              borderRadius: "0.35rem",
                                              overflow: "hidden",
                                            }}
                                          >
                                            {/* Header ligne */}
                                            <div style={{
                                              display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem",
                                              padding: "0.45rem 0.65rem",
                                              background: ligneHasDelta ? "#fffbeb" : "#f9fafb",
                                              borderBottom: "1px solid #e5e7eb",
                                            }}>
                                              <span style={{ fontWeight: 600, fontSize: "0.87rem" }}>
                                                {ligne.ligne_nom || ligne.ligne_num}
                                              </span>
                                              {ligne.ligne_nom && (
                                                <span style={{
                                                  fontSize: "0.78rem",
                                                  fontFamily: "monospace",
                                                  background: "#e5e7eb",
                                                  color: "#374151",
                                                  borderRadius: "0.25rem",
                                                  padding: "0.1rem 0.4rem",
                                                }}>
                                                  {ligne.ligne_num}
                                                </span>
                                              )}
                                              <StatutPill statut={ligne.statut_actuel} />
                                              {!ligneHasDelta && (
                                                <span style={{ fontSize: "0.78rem", color: "#9ca3af" }}>Aucun écart</span>
                                              )}
                                              {ligneHasDelta && (
                                                <span style={{ fontSize: "0.82rem", color: "#6b7280" }}>
                                                  {formatAmount(ligneTotal)}&ensp;→&ensp;
                                                  {formatAmount(ligneTotalNew)}&ensp;({formatDelta(ligneTotalNew - ligneTotal)})
                                                </span>
                                              )}
                                            </div>

                                            {/* Tableau comparaison ligne (si écart) */}
                                            {ligneHasDelta && (
                                              <div style={{ padding: "0.5rem 0.65rem" }}>
                                                <ComparaisonTable
                                                  ancien={ligne.ancien}
                                                  nouveau={ligne.nouveau}
                                                  delta={ligne.delta}
                                                />
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
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

        {/* ── Footer ── */}
        <div style={{
          display: "flex", gap: "0.75rem", justifyContent: "flex-end",
          paddingTop: "0.75rem", borderTop: "1px solid #e5e7eb",
        }}>
          <button onClick={onCancel} style={btnSecondary}>Annuler</button>
          <button
            onClick={() => onConfirm(buildConfirmedDecisions())}
            style={{ ...btnPrimary, opacity: acceptedCount === 0 ? 0.5 : 1 }}
          >
            Importer les modifications sélectionnées ({acceptedCount}/{total})
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Styles boutons ── */
const btnOutline: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  background: "white",
  border: "1px solid #d1d5db",
  borderRadius: "0.3rem",
  cursor: "pointer",
  fontSize: "0.85rem",
  color: "#374151",
};
const btnMini: React.CSSProperties = {
  padding: "0.2rem 0.6rem",
  background: "white",
  border: "1px solid #d1d5db",
  borderRadius: "0.3rem",
  cursor: "pointer",
  fontSize: "0.78rem",
  color: "#374151",
};
const btnSecondary: React.CSSProperties = {
  padding: "0.5rem 1.4rem",
  background: "#e5e7eb",
  color: "#374151",
  border: "none",
  borderRadius: "0.3rem",
  cursor: "pointer",
  fontSize: "0.95rem",
};
const btnPrimary: React.CSSProperties = {
  padding: "0.5rem 1.4rem",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "0.3rem",
  cursor: "pointer",
  fontSize: "0.95rem",
  fontWeight: 600,
};
const sectionHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.45rem 0.6rem",
  background: "#f8fafc",
  color: "#111827",
  borderRadius: "0.35rem",
  cursor: "pointer",
  border: "1px solid #e5e7eb",
  userSelect: "none",
};