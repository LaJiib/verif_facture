export type VariationDirection = "up" | "down" | "neutral";

export interface VariationResult {
  direction: VariationDirection;
  deltaPct: number | null;
  label: string;
}

/**
 * Calcule une variation entre deux valeurs avec un sens (up/down/neutral) et un libellé prêt à afficher.
 */
export function computeVariation(
  current: number,
  previous?: number | null
): VariationResult {
  if (previous === undefined || previous === null) {
    return { direction: "neutral", deltaPct: null, label: "N/A" };
  }
  if (previous === 0) {
    if (current === 0) {
      return { direction: "neutral", deltaPct: 0, label: "0%" };
    }
    return { direction: "up", deltaPct: null, label: "N/A" };
  }

  const deltaPct = ((current - previous) / previous) * 100;
  const direction: VariationDirection =
    deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : "neutral";
  const label = `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`;
  return { direction, deltaPct, label };
}
