export type DataSource = "device" | "synthetic";

export interface Profile {
  id: string;
  name: string;
  level: number; // highest unlocked level
  bestScore: number;
  createdAt: string;
}

/** Metrics the Pi computes for one session. */
export interface SessionMetrics {
  /** % of path samples within the level's tolerance of the target path (0-100). */
  accuracy: number;
  /** Mean distance from the target path, mm. */
  avgDeviationMm: number;
  /** Tremor index 0-100 (higher = more tremor). */
  tremor: number;
  /** Smoothness 0-100 (higher = smoother / less jerky). */
  smoothness: number;
  /** Seconds to complete the path. */
  completionTimeS: number;
}

export interface Session extends SessionMetrics {
  id: string;
  userId: string;
  date: string;
  level: number;
  score: number; // overall 0-100, computed by lib/scoring
  source: DataSource;
  hasRaw: boolean;
}

export interface RawSample {
  t: number; // seconds
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}
