import type { Session, SessionMetrics } from "./types";

/**
 * Level definitions (from the design handoff).
 * - toleranceMm: path tolerance τ. ACCURACY = % of samples with deviation ≤ τ.
 * - targetTimeS: duration at which the TIME component is full marks.
 * - unlock: score needed, three times, on the PREVIOUS level to unlock this one.
 */
export const LEVELS = [
  { level: 1, name: "Straight Incision", toleranceMm: 3, targetTimeS: 12, unlock: "start" },
  { level: 2, name: "Curved Arc", toleranceMm: 2.5, targetTimeS: 14, unlock: "3× ≥75 on L1" },
  { level: 3, name: "Suture Zigzag", toleranceMm: 2, targetTimeS: 16, unlock: "3× ≥78 on L2" },
  { level: 4, name: "Spiral", toleranceMm: 1.5, targetTimeS: 18, unlock: "3× ≥80 on L3" },
  { level: 5, name: "Micro Circle", toleranceMm: 1, targetTimeS: 20, unlock: "3× ≥85 on L4" },
] as const;

export const MAX_LEVEL = LEVELS.length;
/** Score needed on level N (index N) to count toward unlocking N+1. */
export const UNLOCK_SCORE: Record<number, number> = { 1: 75, 2: 78, 3: 80, 4: 85 };
export const UNLOCK_COUNT = 3;

/** Overall weights. PLACEHOLDERS — retune once real sessions exist. */
export const WEIGHTS = { accuracy: 0.4, smoothness: 0.25, steadiness: 0.2, time: 0.15 };

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

/** 100 at the level's target duration, falling off linearly on either side. */
export function timeScore(completionTimeS: number, level: number): number {
  const target = LEVELS[level - 1].targetTimeS;
  return clamp(100 - (Math.abs(completionTimeS - target) / target) * 100);
}

/** SCORE = .40·ACC + .25·SM + .20·(100 − 10·TRM) + .15·TIME */
export function computeScore(m: SessionMetrics, level: number): number {
  return Math.round(
    WEIGHTS.accuracy * clamp(m.accuracy) +
      WEIGHTS.smoothness * clamp(m.smoothness) +
      WEIGHTS.steadiness * clamp(100 - m.tremor * 10) +
      WEIGHTS.time * timeScore(m.completionTimeS, level),
  );
}

export function validateMetrics(m: unknown): m is SessionMetrics {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  const ok = (k: string, lo: number, hi: number) =>
    typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi;
  return (
    ok("accuracy", 0, 100) &&
    ok("avgDeviationMm", 0, 1000) &&
    ok("tremor", 0, 10) &&
    ok("smoothness", 0, 100) &&
    ok("completionTimeS", 0, 36000) &&
    ok("hapticPulses", 0, 100000)
  );
}

/** Highest level unlocked after replaying sessions (oldest → newest). */
export function levelFromSessions(sessions: Pick<Session, "level" | "score">[]): number {
  let level = 1;
  for (let i = 0; i < sessions.length; i++) {
    if (level >= MAX_LEVEL) break;
    const n = sessions.slice(0, i + 1).filter((s) => s.level === level && s.score >= UNLOCK_SCORE[level]).length;
    if (n >= UNLOCK_COUNT) level += 1;
  }
  return level;
}

/** Population σ of the last 5 scores (lower = more consistent). */
export function consistency(scores: number[]): number {
  const last = scores.slice(-5);
  if (!last.length) return 0;
  const mean = last.reduce((a, b) => a + b, 0) / last.length;
  return Math.sqrt(last.reduce((a, b) => a + (b - mean) ** 2, 0) / last.length);
}
