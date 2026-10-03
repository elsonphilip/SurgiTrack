export type DataSource = "device" | "synthetic";

export interface Profile {
  id: string; // e.g. ST-0417
  name: string;
  level: number; // highest unlocked level (counted sessions only)
  bestScore: number; // counted sessions only
  createdAt: string;
  /** "synthetic" profiles are demo data. */
  source: DataSource;
}

/** Metrics the Pi (or the simulator) computes for one session. */
export interface SessionMetrics {
  /** % of path samples within the level's tolerance of the target path (0-100). */
  accuracy: number;
  /** Mean distance from the target path, mm. */
  avgDeviationMm: number;
  /** Tremor index 0-10 (higher = more tremor). */
  tremor: number;
  /** Smoothness 0-100 (higher = smoother / less jerky). */
  smoothness: number;
  /** Seconds to complete the path. */
  completionTimeS: number;
  /** Number of times the wristband buzzed (left the tolerance band). */
  hapticPulses: number;
}

export interface Baseline {
  pitch: number;
  roll: number;
  noiseSigma: number;
}

export interface Session extends SessionMetrics {
  id: string;
  userId: string;
  date: string;
  level: number;
  score: number; // overall 0-100, computed by lib/scoring
  source: DataSource;
  hasRaw: boolean;
  samples: number;
  baseline?: Baseline;
  /** Target path used (see lib/paths.ts). */
  pathId?: string;
}

export interface RawSample {
  t: number; // seconds
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  camX?: number;
  camY?: number;
  distCm?: number;
}
