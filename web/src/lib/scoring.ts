import type { SessionMetrics } from "./types";

/**
 * Level definitions. `toleranceMm` is the path-deviation tolerance used to define ACCURACY
 * (the Pi computes accuracy with the same tolerance). `targetTimeS` is the pace at which the
 * time component is full marks.
 */
export const LEVELS = [
  { level: 1, name: "Novice", toleranceMm: 8, targetTimeS: 60 },
  { level: 2, name: "Apprentice", toleranceMm: 6, targetTimeS: 50 },
  { level: 3, name: "Resident", toleranceMm: 4, targetTimeS: 40 },
  { level: 4, name: "Fellow", toleranceMm: 3, targetTimeS: 35 },
  { level: 5, name: "Attending", toleranceMm: 2, targetTimeS: 30 },
] as const;

export const MAX_LEVEL = LEVELS.length;
/** Score needed on your current level to unlock the next one. */
export const PROMOTION_SCORE = 80;

/**
 * ACCURACY: percentage of path samples whose distance from the target path is <= the level's
 * tolerance. (Defined here so the Pi and the site agree.)
 */
export function accuracyFromDeviations(devMm: number[], level: number): number {
  if (!devMm.length) return 0;
  const tol = LEVELS[level - 1].toleranceMm;
  return (100 * devMm.filter((d) => d <= tol).length) / devMm.length;
}

/**
 * Overall score weights. PLACEHOLDERS — retune once real sessions exist.
 * tremor is inverted (steadiness = 100 - tremor).
 */
export const WEIGHTS = { accuracy: 0.4, steadiness: 0.25, smoothness: 0.25, time: 0.1 };

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

export function timeScore(completionTimeS: number, level: number): number {
  const target = LEVELS[level - 1].targetTimeS;
  if (completionTimeS <= target) return 100;
  return clamp(100 - ((completionTimeS - target) / target) * 100);
}

export function computeScore(m: SessionMetrics, level: number): number {
  const s =
    WEIGHTS.accuracy * clamp(m.accuracy) +
    WEIGHTS.steadiness * clamp(100 - m.tremor) +
    WEIGHTS.smoothness * clamp(m.smoothness) +
    WEIGHTS.time * timeScore(m.completionTimeS, level);
  return Math.round(s * 10) / 10;
}

export function validateMetrics(m: unknown): m is SessionMetrics {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  const ok = (k: string, lo: number, hi: number) =>
    typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi;
  return (
    ok("accuracy", 0, 100) &&
    ok("avgDeviationMm", 0, 1000) &&
    ok("tremor", 0, 100) &&
    ok("smoothness", 0, 100) &&
    ok("completionTimeS", 0, 36000)
  );
}
