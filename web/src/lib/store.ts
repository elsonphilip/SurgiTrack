import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { computeScore, levelFromSessions, MAX_LEVEL } from "./scoring";
import { getPath } from "./paths";
import type { Baseline, DataSource, Profile, RawSample, Session, SessionMetrics } from "./types";

/**
 * Tiny JSON-file store (fine for a single Pi / demo). Swap for SQLite/Postgres later —
 * everything goes through the functions below.
 * Data lives in web/data/ (gitignored). Raw sensor traces go in data/raw/<sessionId>.json.
 *
 * Counting rule: a session only counts toward a profile's best score, level and the leaderboard
 * when its `source` matches the profile's `source`. So simulated sessions run on a REAL profile
 * are kept (flagged DEMO) but never pollute the real numbers.
 */
const DIR = process.env.SURGITRACK_DATA_DIR ?? path.join(process.cwd(), "data");
const DB = path.join(DIR, "db.json");
const RAW = path.join(DIR, "raw");

interface Db {
  profiles: Profile[];
  sessions: Session[];
}

let queue: Promise<unknown> = Promise.resolve();
/** Serialise read-modify-write so concurrent requests can't clobber each other. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Db> {
  try {
    return JSON.parse(await fs.readFile(DB, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { profiles: [], sessions: [] };
    throw e;
  }
}

async function write(db: Db) {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${DB}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DB);
}

const counts = (p: Profile, s: Session) => s.userId === p.id && s.source === p.source;

function refresh(db: Db, p: Profile) {
  const mine = db.sessions.filter((s) => counts(p, s)).sort((a, b) => a.date.localeCompare(b.date));
  p.bestScore = mine.reduce((m, s) => Math.max(m, s.score), 0);
  p.level = levelFromSessions(mine);
}

export async function listProfiles(): Promise<Profile[]> {
  return (await read()).profiles.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getProfile(id: string) {
  return (await read()).profiles.find((p) => p.id === id) ?? null;
}

export async function createProfile(name: string, source: DataSource = "device", id?: string): Promise<Profile> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error("Name required");
  return locked(async () => {
    const db = await read();
    let pid = id;
    while (!pid || db.profiles.some((p) => p.id === pid)) {
      if (id && db.profiles.some((p) => p.id === id)) throw new Error("Profile exists");
      pid = `ST-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    }
    const p: Profile = { id: pid, name: clean, level: 1, bestScore: 0, createdAt: new Date().toISOString(), source };
    db.profiles.push(p);
    await write(db);
    return p;
  });
}

/** Oldest → newest. `counted` limits to sessions that count for the profile (same source). */
export async function listSessions(userId?: string, opts: { counted?: boolean } = {}): Promise<Session[]> {
  const db = await read();
  let all = userId ? db.sessions.filter((s) => s.userId === userId) : db.sessions;
  if (opts.counted) {
    const byId = new Map(db.profiles.map((p) => [p.id, p]));
    all = all.filter((s) => {
      const p = byId.get(s.userId);
      return p && counts(p, s);
    });
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getSession(id: string) {
  return (await read()).sessions.find((s) => s.id === id) ?? null;
}

export async function getRaw(id: string): Promise<RawSample[] | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(RAW, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export interface NewSession {
  userId: string;
  level: number;
  metrics: SessionMetrics;
  date?: string;
  source: DataSource;
  baseline?: Baseline;
  pathId?: string;
  screening?: { tremorProbability: number; windows: number };
  raw?: RawSample[];
}

export async function addSession(input: NewSession) {
  return locked(async () => {
    const db = await read();
    const profile = db.profiles.find((p) => p.id === input.userId);
    if (!profile) throw new Error("Unknown profile");
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > MAX_LEVEL) throw new Error("Bad level");
    // Real sessions must respect unlocks; simulated ones can try any level.
    if (input.source === "device" && input.level > profile.level) throw new Error("Level not unlocked");

    const id = randomUUID().slice(0, 12);
    const prevBest = profile.bestScore;
    const prevLevel = profile.level;
    const session: Session = {
      id,
      userId: input.userId,
      date: input.date ?? new Date().toISOString(),
      level: input.level,
      ...input.metrics,
      score: computeScore(input.metrics, input.level),
      source: input.source,
      hasRaw: !!input.raw?.length,
      samples: input.raw?.length ?? 0,
      baseline: input.baseline,
      pathId: input.pathId && getPath(input.pathId)?.level === input.level ? input.pathId : undefined,
      screening: input.screening,
    };
    db.sessions.push(session);
    refresh(db, profile);

    if (input.raw?.length) {
      await fs.mkdir(RAW, { recursive: true });
      await fs.writeFile(path.join(RAW, `${id}.json`), JSON.stringify(input.raw));
    }
    await write(db);
    const counted = session.source === profile.source;
    return {
      session,
      counted,
      isBest: counted && session.score > prevBest,
      prevBest,
      promoted: counted && profile.level > prevLevel,
    };
  });
}

/** Remove everything flagged synthetic and recompute real profiles' best/level. */
export async function clearSynthetic() {
  return locked(async () => {
    const db = await read();
    const gone = db.sessions.filter((s) => s.source === "synthetic");
    for (const s of gone) await fs.rm(path.join(RAW, `${s.id}.json`), { force: true });
    db.sessions = db.sessions.filter((s) => s.source !== "synthetic");
    const demoProfiles = db.profiles.filter((p) => p.source === "synthetic").length;
    db.profiles = db.profiles.filter((p) => p.source !== "synthetic");
    for (const p of db.profiles) refresh(db, p);
    await write(db);
    return { sessions: gone.length, profiles: demoProfiles };
  });
}
