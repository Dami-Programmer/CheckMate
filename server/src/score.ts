// Turns a list of flags into a 0-10 score, where 10 = safest.
//
// Start at 10. Each risk TYPE found takes points off once, however many
// times it appears (five fee clauses are still "has extra fees"):
//   red -2, orange -1, green 0. The score never goes below 0.

import type { FlagColor } from "./checklist.js";

const PENALTY: Record<FlagColor, number> = { red: 2, orange: 1, green: 0 };

export function scoreFlags(flags: { type: number; color: FlagColor }[]): number {
  const penaltyByType = new Map<number, number>();
  for (const f of flags) penaltyByType.set(f.type, PENALTY[f.color]);
  let total = 0;
  for (const p of penaltyByType.values()) total += p;
  return Math.max(0, 10 - total);
}

// A short label for the popup.
export function scoreLabel(score: number): string {
  if (score >= 8) return "Low risk";
  if (score >= 5) return "Some risks";
  return "High risk";
}
