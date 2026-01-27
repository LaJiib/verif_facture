import { useEffect, useMemo, useState } from "react";
import { fetchEntrepriseAbonnementStats, type AbonnementStatsResponse } from "../newApi";

interface AbonnementsPageProps {
  entrepriseId: number;
  entrepriseNom: string;
  onBack: () => void;
}

export default function AbonnementsPage({ entrepriseId, entrepriseNom, onBack }: AbonnementsPageProps) {
  const [stats, setStats] = useState<AbonnementStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, [entrepriseId]);

  async function loadStats() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchEntrepriseAbonnementStats(entrepriseId);
      setStats(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const totalLines = useMemo(() => stats?.abonnements.reduce((acc, a) => acc + a.nb_lignes, 0) || 0, [stats]);

  return (
    <div style={{ padding: "2rem", background: "#f8fafc", minHeight: "100vh" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div>
            <button
              onClick={onBack}
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                borderRadius: "0.5rem",
                padding: "0.5rem 0.9rem",
                cursor: "pointer",
                color: "#111827",
              }}
            >
              ← Retour
            </button>
            <h1 style={{ margin: "0.75rem 0 0", fontSize: "1.75rem", color: "#111827" }}>
              Abonnements - {entrepriseNom}
            </h1>
            <p style={{ color: "#6b7280", margin: "0.35rem 0 0" }}>
              Répartition des abonnements sur le dernier mois disponible.
            </p>
          </div>
          <button
            onClick={loadStats}
            style={{
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.65rem 1.1rem",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Rafraîchir
          </button>
        </div>

        {error && <div style={{ color: "#b91c1c", marginBottom: "1rem" }}>{error}</div>}

        {loading && <div style={{ color: "#6b7280" }}>Chargement des statistiques...</div>}

        {!loading && stats && (
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.5rem", alignItems: "stretch" }}>
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
                padding: "1rem",
                background: "#fff",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ fontSize: "0.95rem", color: "#6b7280", marginBottom: "0.5rem" }}>
                {stats.mois ? `Mois ${stats.mois}` : "Pas de données"}
              </div>
              <Donut total={totalLines} items={stats.abonnements} />
              <div style={{ fontSize: "0.95rem", color: "#6b7280", textAlign: "center", marginTop: "0.6rem" }}>
                {stats.lignes_sans_abonnement > 0
                  ? `${stats.lignes_sans_abonnement} ligne(s) sans abonnement`
                  : "Toutes les lignes sont rattachées"}
              </div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.75rem", padding: "1rem", background: "#fff" }}>
              {stats.abonnements.length === 0 ? (
                <p style={{ color: "#6b7280" }}>Aucun abonnement utilisé sur le dernier mois.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {stats.abonnements.map((abo, idx) => {
                    const pct = totalLines > 0 ? Math.round((abo.nb_lignes / totalLines) * 100) : 0;
                    const color = ["#4f46e5", "#0ea5e9", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#14b8a6"][idx % 7];
                    return (
                      <div
                        key={abo.id}
                        style={{
                          padding: "0.85rem",
                          border: "1px solid #e5e7eb",
                          borderRadius: "0.5rem",
                          background: "#f9fafb",
                          display: "grid",
                          gridTemplateColumns: "1fr 140px 90px",
                          gap: "0.5rem",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, color: "#111827" }}>{abo.nom}</div>
                          <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                            {abo.nb_lignes} ligne(s) • {abo.nb_factures} facture(s) • {abo.prix.toFixed(2)} €/mois
                          </div>
                          {abo.commentaire ? (
                            <div style={{ fontSize: "0.9rem", color: "#9ca3af" }}>{abo.commentaire}</div>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                          <div style={{ height: 8, background: "#e5e7eb", borderRadius: 999 }}>
                            <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 999 }} />
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{pct}% des lignes abonnées</div>
                        </div>
                        <div style={{ textAlign: "right", color: "#111827", fontWeight: 700 }}>{abo.total_ht.toFixed(2)} €</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Donut({ total, items }: { total: number; items: { id: number; nb_lignes: number; nom: string }[] }) {
  const palette = ["#4f46e5", "#0ea5e9", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#14b8a6"];
  if (!items.length || total === 0) {
    return (
      <div
        style={{
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: "#e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6b7280",
        }}
      >
        Aucune ligne
      </div>
    );
  }
  const gradient = items
    .reduce<{ stops: string[]; acc: number }>((acc, item, idx) => {
      const pct = total > 0 ? (item.nb_lignes / total) * 100 : 0;
      const start = acc.acc;
      const end = acc.acc + pct;
      const color = palette[idx % palette.length];
      acc.stops.push(`${color} ${start}% ${end}%`);
      acc.acc = end;
      return acc;
    }, { stops: [], acc: 0 }).stops
    .join(", ");
  return (
    <div
      style={{
        width: 200,
        height: 200,
        borderRadius: "50%",
        background: `conic-gradient(${gradient})`,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 28,
          borderRadius: "50%",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          color: "#111827",
          fontWeight: 700,
        }}
      >
        <div style={{ fontSize: "1.25rem" }}>{total}</div>
        <div style={{ fontSize: "0.9rem", color: "#6b7280" }}>lignes</div>
      </div>
    </div>
  );
}
