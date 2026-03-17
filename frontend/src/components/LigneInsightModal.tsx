import { useEffect, useMemo, useState } from "react";
import {
  fetchLigneTimeline,
  type LigneTimelineResponse,
  updateLigneType,
  updateLigneFacture,
  attachAbonnementToLines,
} from "../newApi";
import { decodeLineType } from "../utils/codecs";

interface LigneInsightModalProps {
  ligneId: number;
  onClose: () => void;
}

export default function LigneInsightModal({ ligneId, onClose }: LigneInsightModalProps) {
  const [data, setData] = useState<LigneTimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState(false);
  const [savingStatutId, setSavingStatutId] = useState<number | null>(null);
  const [aboForm, setAboForm] = useState<{ nom: string; prix: string; date: string }>({ nom: "", prix: "", date: "" });

  useEffect(() => {
    load();
  }, [ligneId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLigneTimeline(ligneId);
      setData(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const facturesSorted = useMemo(() => {
    if (!data) return [];
    return [...data.factures].sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "8vh",
        zIndex: 1400,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "0.75rem",
          padding: "1.25rem",
          width: "94%",
          maxWidth: "1200px",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 14px 32px rgba(0,0,0,0.28)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.35rem" }}>Détails ligne</h2>
            {data?.ligne && (
              <div style={{ color: "#6b7280", marginTop: "0.35rem", fontSize: "0.95rem" }}>
                {data.ligne.num} • {decodeLineType(data.ligne.type)} • Compte {data.ligne.compte_num}{" "}
                {data.ligne.compte_nom ? `- ${data.ligne.compte_nom}` : ""}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", fontSize: "1.2rem", cursor: "pointer", color: "#6b7280" }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        {error && <div style={{ color: "#b91c1c", marginBottom: "0.75rem" }}>{error}</div>}
        {loading && <div style={{ color: "#6b7280" }}>Chargement...</div>}

        {data && !loading && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.65rem", padding: "1rem", background: "#f9fafb" }}>
              <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>Informations</h3>
              <div style={{ color: "#111827", fontWeight: 600 }}>{data.ligne.num}</div>
              <div style={{ color: "#6b7280", fontSize: "0.95rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <div>
                  Type :
                  <select
                    value={data.ligne.type}
                    onChange={async (e) => {
                      const val = Number(e.target.value);
                      setSavingType(true);
                      try {
                        await updateLigneType(data.ligne.id, val);
                        setData((prev) => (prev ? { ...prev, ligne: { ...prev.ligne, type: val } } : prev));
                      } catch (err) {
                        alert((err as Error).message);
                      } finally {
                        setSavingType(false);
                      }
                    }}
                    disabled={savingType}
                    style={{ marginLeft: "0.5rem", padding: "0.35rem 0.5rem", borderRadius: "0.35rem", border: "1px solid #d1d5db" }}
                  >
                    {[0, 1, 2, 3].map((t) => (
                      <option key={t} value={t}>
                        {decodeLineType(t)}
                      </option>
                    ))}
                  </select>
                </div>
                {data.ligne.nom ? <div>Nom : {data.ligne.nom}</div> : null}
                {data.ligne.sous_compte ? <div>Sous-compte : {data.ligne.sous_compte}</div> : null}
              </div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.65rem", padding: "1rem", background: "#f9fafb" }}>
              <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>Abonnements liés</h3>
              {data.abonnements.length === 0 ? (
                <div style={{ color: "#6b7280" }}>Aucun abonnement enregistré.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {data.abonnements.map((a) => (
                    <div key={`${a.abonnement_id}-${a.date || "none"}`} style={{ border: "1px solid #e5e7eb", borderRadius: "0.45rem", padding: "0.6rem", background: "#fff" }}>
                      <div style={{ fontWeight: 700, color: "#111827" }}>{a.nom}</div>
                      <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                        {a.prix.toFixed(2)} €/mois {a.date ? `• Depuis ${a.date}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ gridColumn: "span 2", border: "1px solid #e5e7eb", borderRadius: "0.65rem", padding: "1rem", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>Historique factures</h3>
                <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>Montants HT et statuts par mois</div>
              </div>
              {facturesSorted.length === 0 ? (
                <div style={{ color: "#6b7280" }}>Aucune facture associée.</div>
              ) : (
                <div style={{ overflowX: "auto", paddingBottom: "0.25rem" }}>
                  <div style={{ display: "flex", gap: "0.75rem", minWidth: "600px" }}>
                    {facturesSorted.map((f) => {
                      const total = Number(f.total_ht.toFixed(2));
                      const conso = Number(f.conso.toFixed(2));
                      const abo = Number(f.abo.toFixed(2));
                      const remises = Number(f.remises.toFixed(2));
                      const achat = Number(f.achat.toFixed(2));
                      const netAbo = Number((abo + remises).toFixed(2));
                      const heightAbo = Math.min(140, Math.max(10, netAbo));
                      const heightConso = Math.min(140, Math.max(0, conso));
                      const statutColor = f.statut === 1 ? "#16a34a" : f.statut === 2 ? "#b91c1c" : "#6b7280";
                      return (
                        <div key={f.facture_id} style={{ flex: "0 0 80px", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem" }}>
                          <div style={{ height: 140, display: "flex", alignItems: "flex-end" }}>
                            <div style={{ width: 36, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                              <div
                                style={{
                                  width: "100%",
                                  height: heightConso,
                                  background: "#0ea5e9",
                                  borderTopLeftRadius: "0.25rem",
                                  borderTopRightRadius: "0.25rem",
                                }}
                                title={`Conso: ${conso.toFixed(2)}€`}
                              />
                              <div
                                style={{
                                  width: "100%",
                                  height: heightAbo,
                                  background: "#6366f1",
                                  borderBottomLeftRadius: "0.25rem",
                                  borderBottomRightRadius: "0.25rem",
                                }}
                                title={`Abo+Remises: ${netAbo.toFixed(2)}€`}
                              />
                            </div>
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "#111827", fontWeight: 700 }}>{total.toFixed(2)}€</div>
                          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{f.date.slice(0, 7)}</div>
                          <span style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.25rem",
                                        padding: "0.15rem 0.45rem",
                                        borderRadius: "999px",
                                        fontSize: "0.72rem",
                                        fontWeight: 700,
                                        background: f.ligne_statut === 1 ? "#ecfdf3" : f.ligne_statut === 2 ? "#fef2f2" : "#f3f4f6",
                                        color: statutColor,
                                      }}>
                              <span style={{ width: 6, height: 6, borderRadius: "999px", background: statutColor, display: "inline-block" }} />
                                  {f.ligne_statut === 1 ? "Validée" : f.ligne_statut === 2 ? "Contestée" : "Importée"}
                          </span>
                          <select
                            value={f.ligne_statut}
                            disabled={savingStatutId === f.ligne_facture_id}
                            onChange={async (e) => {
                              const val = Number(e.target.value);
                              setSavingStatutId(f.ligne_facture_id);
                              try {
                                await updateLigneFacture(f.ligne_facture_id, { statut: val });
                                setData((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        factures: prev.factures.map((fx) =>
                                          fx.ligne_facture_id === f.ligne_facture_id ? { ...fx, ligne_statut: val } : fx
                                        ),
                                      }
                                    : prev
                                );
                              } catch (err) {
                                alert((err as Error).message);
                              } finally {
                                setSavingStatutId(null);
                              }
                            }}
                            style={{ fontSize: "0.8rem", borderRadius: "0.35rem", padding: "0.2rem 0.35rem" }}
                          >
                            <option value={0}>Importée</option>
                            <option value={1}>Validée</option>
                            <option value={2}>Contestée</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div style={{ gridColumn: "span 2", border: "1px solid #e5e7eb", borderRadius: "0.65rem", padding: "1rem", background: "#fff" }}>
              <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>Ajouter / mettre à jour un abonnement</h3>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "#6b7280" }}>Nom</label>
                  <input
                    type="text"
                    value={aboForm.nom}
                    onChange={(e) => setAboForm((prev) => ({ ...prev, nom: e.target.value }))}
                    style={{ padding: "0.45rem", borderRadius: "0.35rem", border: "1px solid #d1d5db", minWidth: "200px" }}
                    placeholder="Nom abonnement"
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "#6b7280" }}>Prix mensuel (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={aboForm.prix}
                    onChange={(e) => setAboForm((prev) => ({ ...prev, prix: e.target.value }))}
                    style={{ padding: "0.45rem", borderRadius: "0.35rem", border: "1px solid #d1d5db", width: "140px" }}
                    placeholder="0.00"
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "#6b7280" }}>Date (optionnelle)</label>
                  <input
                    type="date"
                    value={aboForm.date}
                    onChange={(e) => setAboForm((prev) => ({ ...prev, date: e.target.value }))}
                    style={{ padding: "0.45rem", borderRadius: "0.35rem", border: "1px solid #d1d5db", width: "170px" }}
                  />
                </div>
                <button
                  onClick={async () => {
                    if (!aboForm.nom.trim()) {
                      alert("Nom d'abonnement requis");
                      return;
                    }
                    const prixNumber = Number(aboForm.prix || 0);
                    try {
                      await attachAbonnementToLines({
                        ligne_ids: [ligneId],
                        nom: aboForm.nom.trim(),
                        prix: Number.isFinite(prixNumber) ? prixNumber : undefined,
                        date: aboForm.date || undefined,
                      });
                      await load();
                      alert("Abonnement mis à jour");
                    } catch (err) {
                      alert((err as Error).message);
                    }
                  }}
                  style={{
                    background: "#3b82f6",
                    color: "white",
                    border: "none",
                    borderRadius: "0.5rem",
                    padding: "0.6rem 1rem",
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
    </div>
  );
}
