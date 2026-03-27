import React from "react";

// Utilitaire pour afficher une barre de progression multi-statuts (0/1/2).
// stats: Record<number, number> où 0=importé, 1=validé, 2=contesté.

// Couleurs dans l'ordre demandé : vert (validé) -> orange (contesté) -> gris (importé)
export const STATUS_COLORS: Record<number, string> = {
  1: "#10b981", // vert
  2: "#f59e0b", // orange
  0: "#9ca3af", // gris
};

const LABELS: Record<number, string> = {
  0: "importé",
  1: "validé",
  2: "contesté",
};

export function StatusBar({
  stats,
  height = 10,
}: {
  stats: Record<number, number>;
  height?: number;
}) {
  const total = (stats[0] || 0) + (stats[1] || 0) + (stats[2] || 0);
  if (total === 0) {
    return (
      <div
        style={{
          height,
          background: "#e5e7eb",
          borderRadius: 9999,
          width: "100%",
        }}
        title="Aucune donnée"
      />
    );
  }

  // Ordre fixé : 1 (vert) à gauche, 2 (orange) au centre, 0 (gris) à droite
  const order = [1, 2, 0];
  const segments: { code: number; value: number; pct: number }[] = order
    .map((code) => ({
      code,
      value: stats[code] || 0,
      pct: ((stats[code] || 0) / total) * 100,
    }))
    .filter((s) => s.value > 0);

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        borderRadius: 9999,
        overflow: "hidden",
        height,
        background: "#e5e7eb",
      }}
      title={segments
        .map((s) => `${Math.round(s.pct)}% ${LABELS[s.code]}`)
        .join(" | ")}
    >
      {segments.map((seg) => (
        <div
          key={seg.code}
          style={{
            width: `${seg.pct}%`,
            background: STATUS_COLORS[seg.code],
          }}
        />
      ))}
    </div>
  );
}
