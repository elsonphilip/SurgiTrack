import type { Session } from "./types";
import { missionParts } from "./space";

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

/** Stars are judged on the mission score (Accuracy × Stability × Speed bonus, see lib/space.ts). */
export function stars(missionScore: number): 1 | 2 | 3 {
  return missionScore >= 85 ? 3 : missionScore >= 65 ? 2 : 1;
}

type XpSession = Pick<Session, "accuracy" | "smoothness" | "tremor" | "completionTimeS" | "level">;

/** XP is derived from saved metrics only, so it is identical whenever and wherever it is recomputed. */
export function sessionXp(s: XpSession): number {
  const m = missionParts(s, s.level).score;
  return m + stars(m) * 10;
}

export function totalXp(sessions: XpSession[]): number {
  return sessions.reduce((a, s) => a + sessionXp(s), 0);
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

/** One "hit" every HIT_S seconds spent inside the game band. */
export const HIT_S = 0.25;
