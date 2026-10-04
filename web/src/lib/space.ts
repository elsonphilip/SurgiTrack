/** Space-mission theme for Game mode: mission names, scenery placement and the mission score. Cosmetic layer only. */
import { timeScore } from "./scoring";

export const MISSIONS = ["Launch", "Orbit", "Asteroid Field", "Gravity Well", "Reentry"] as const;
export const MISSION_BLURB = [
  "A wide, gentle trajectory. Get off the pad.",
  "Tighter curves around the planet.",
  "Sharp turns between the rocks.",
  "The corridor narrows as gravity pulls.",
  "Fast and precise. Don't burn up.",
] as const;
export const missionName = (level: number) => MISSIONS[Math.min(Math.max(level, 1), 5) - 1];

/**
 * Mission score = Accuracy × Stability × Speed bonus (all 0..1, ×100).
 * Stability blends smoothness and low tremor. The speed bonus is capped to 0.85–1.00, so being fast can never rescue poor accuracy.
 * Computed from the same stored metrics as everything else; the saved training score is unchanged.
 */
export function missionParts(m: { accuracy: number; smoothness: number; tremor: number; completionTimeS: number }, level: number) {
  const accuracy = Math.min(1, Math.max(0, m.accuracy / 100));
  const stability = Math.min(1, Math.max(0, 0.5 * (m.smoothness / 100) + 0.5 * (1 - m.tremor / 10)));
  const speed = 0.85 + 0.15 * (timeScore(m.completionTimeS, level) / 100);
  return { accuracy, stability, speed, score: Math.round(100 * accuracy * stability * speed) };
}

export interface Decor { kind: "planet" | "ringed" | "moon" | "asteroid" | "hole" | "earth" | "satellite"; x: number; y: number; r: number; hue: number; seed: number }

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const PLAN: Record<number, Decor["kind"][]> = {
  1: ["planet", "moon", "planet"],
  2: ["ringed", "moon", "moon", "planet"],
  3: ["asteroid", "asteroid", "asteroid", "asteroid", "asteroid", "asteroid", "asteroid", "asteroid"],
  4: ["hole", "asteroid", "asteroid", "moon"],
  5: ["earth", "satellite", "satellite", "moon"],
};

/** Scatter scenery around the course without ever touching the corridor. `pts` are canvas pixels. */
export function makeDecor(level: number, pts: number[][], tolPx: number, W = 960, H = 480): Decor[] {
  const rand = rng(level * 7919 + 13), out: Decor[] = [];
  const near = (x: number, y: number) => { let m = 1e9; for (const p of pts) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < m) m = d; } return m; };
  for (const kind of PLAN[level] ?? PLAN[1]) {
    const r = kind === "hole" ? 46 : kind === "earth" ? 52 : kind === "ringed" ? 34 : kind === "satellite" ? 14 : kind === "moon" ? 16 : kind === "asteroid" ? 12 + rand() * 12 : 26;
    for (let tries = 0; tries < 240; tries++) {
      const x = 40 + rand() * (W - 80), y = 40 + rand() * (H - 80);
      if (near(x, y) < r * (kind === "ringed" ? 1.5 : 1) + tolPx + 22) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 14)) continue;
      out.push({ kind, x, y, r, hue: Math.floor(rand() * 360), seed: Math.floor(rand() * 1e6) });
      break;
    }
  }
  return out;
}
