import type { Session } from "./types";

/** Game mode is a cosmetic layer on top of the same data: XP, ranks, stars and badges are all derived from stored sessions. */
export const GAME_COOKIE = "st_game";

export const RANKS = [
  { name: "Student", xp: 0 },
  { name: "Intern", xp: 150 },
  { name: "Resident", xp: 400 },
  { name: "Fellow", xp: 800 },
  { name: "Attending", xp: 1400 },
  { name: "Chief", xp: 2200 },
] as const;

export function stars(score: number): 1 | 2 | 3 {
  return score >= 90 ? 3 : score >= 75 ? 2 : 1;
}

export function sessionXp(score: number): number {
  return Math.round(score) + stars(score) * 10;
}

export function totalXp(sessions: Pick<Session, "score">[]): number {
  return sessions.reduce((a, s) => a + sessionXp(s.score), 0);
}

export function rankFor(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i], next = RANKS[i + 1];
  return { name: cur.name, index: i, next: next?.name ?? null, into: xp - cur.xp, span: next ? next.xp - cur.xp : 0, pct: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1 };
}

/** Combo: every 1.5 s inside the tolerance band adds a multiplier step (max x5); leaving the band resets it. */
export const COMBO_STEP_S = 1.5;
export const COMBO_MAX = 5;

export interface Badge { id: string; name: string; desc: string; earned: boolean }

/** `ss` = counted sessions, oldest first. */
export function badgesFor(ss: Pick<Session, "score" | "accuracy" | "tremor" | "smoothness">[], level: number): Badge[] {
  const any = (f: (s: (typeof ss)[number]) => boolean) => ss.some(f);
  let run = 0, hat = false, comeback = false;
  ss.forEach((s, i) => {
    run = s.score >= 75 ? run + 1 : 0;
    if (run >= 3) hat = true;
    if (i && s.score - ss[i - 1].score >= 10) comeback = true;
  });
  return [
    { id: "first", name: "First Incision", desc: "Finish your first session", earned: ss.length >= 1 },
    { id: "line", name: "On the Line", desc: "Stay on the path 90% of the time", earned: any((s) => s.accuracy >= 90) },
    { id: "steady", name: "Steady Hands", desc: "Tremor of 2 or less", earned: any((s) => s.tremor <= 2) },
    { id: "silk", name: "Silk", desc: "Smoothness of 85 or more", earned: any((s) => s.smoothness >= 85) },
    { id: "ace", name: "Ace", desc: "Score 90 or more", earned: any((s) => s.score >= 90) },
    { id: "hat", name: "Hat Trick", desc: "Three scores of 75+ in a row", earned: hat },
    { id: "comeback", name: "Comeback", desc: "Beat your last score by 10+", earned: comeback },
    { id: "level", name: "Level Up", desc: "Unlock a new exercise", earned: level >= 2 },
    { id: "regular", name: "Regular", desc: "Finish 10 sessions", earned: ss.length >= 10 },
  ];
}

/**
 * Challenges are rules for points, combos and which path you get. They never change how accuracy, tremor,
 * smoothness or the score are measured, so every run still produces the same data for the model.
 */
export type ChallengeId = "rush" | "steady" | "maze" | "trace" | "survival" | "zen";
export interface Challenge {
  id: ChallengeId;
  name: string;
  tagline: string;
  /** Which path to use: the player's chosen one, a new random one each run, or the most complex one for the level. */
  path: "chosen" | "shuffle" | "hardest";
  /** Game band as a multiple of the level tolerance, at run progress p (0..1). Leaving it breaks the combo. */
  band: (p: number) => number;
  /** Zen: sudden jerks also break the combo. */
  calm?: boolean;
}
export const CHALLENGES: readonly Challenge[] = [
  { id: "rush", name: "Precision Rush", tagline: "Finish the path accurately. Every hit builds your combo.", path: "chosen", band: () => 1 },
  { id: "steady", name: "Steady Hand", tagline: "A tighter zone. Keep the tool inside it.", path: "chosen", band: () => 0.6 },
  { id: "maze", name: "Maze", tagline: "A new route every run.", path: "shuffle", band: () => 1 },
  { id: "trace", name: "Trace", tagline: "The most complex shape for your level.", path: "hardest", band: () => 1 },
  { id: "survival", name: "Survival", tagline: "The zone shrinks as you go.", path: "chosen", band: (p) => 1.6 - p },
  { id: "zen", name: "Zen", tagline: "Smooth and calm. Sudden jerks break the chain.", path: "chosen", band: () => 1.2, calm: true },
];
export const challengeById = (id: string): Challenge => CHALLENGES.find((c) => c.id === id) ?? CHALLENGES[0];

/** One "hit" every HIT_S seconds spent inside the game band. */
export const HIT_S = 0.25;
