import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { computeScore, MAX_LEVEL, PROMOTION_SCORE } from "./scoring";
import type { Profile, RawSample, Session, SessionMetrics, DataSource } from "./types";

/**
 * Tiny JSON-file store (fine for a single Pi / demo). Swap for SQLite/Postgres later —
 * everything goes through the functions below.
 * Data lives in web/data/ (gitignored). Raw sensor traces go in data/raw/<sessionId>.json.
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

export async function listProfiles(): Promise<Profile[]> {
  return (await read()).profiles.sort((a, b) => b.bestScore - a.bestScore);
}

export async function getProfile(id: string) {
  return (await read()).profiles.find((p) => p.id === id) ?? null;
}

export async function createProfile(name: string): Promise<Profile> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error("Name required");
  return locked(async () => {
    const db = await read();
    const p: Profile = { id: randomUUID().slice(0, 8), name: clean, level: 1, bestScore: 0, createdAt: new Date().toISOString() };
    db.profiles.push(p);
    await write(db);
    return p;
  });
}

/** Oldest → newest, for charts. */
export async function listSessions(userId?: string): Promise<Session[]> {
  const all = (await read()).sessions;
  return (userId ? all.filter((s) => s.userId === userId) : all).sort((a, b) => a.date.localeCompare(b.date));
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
  raw?: RawSample[];
}

export async function addSession(input: NewSession): Promise<{ session: Session; promoted: boolean }> {
  return locked(async () => {
    const db = await read();
    const profile = db.profiles.find((p) => p.id === input.userId);
    if (!profile) throw new Error("Unknown profile");
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > MAX_LEVEL) throw new Error("Bad level");
    if (input.level > profile.level) throw new Error("Level not unlocked");

    const id = randomUUID().slice(0, 12);
    const session: Session = {
      id,
      userId: input.userId,
      date: input.date ?? new Date().toISOString(),
      level: input.level,
      ...input.metrics,
      score: computeScore(input.metrics, input.level),
      source: input.source,
      hasRaw: !!input.raw?.length,
    };
    db.sessions.push(session);

    profile.bestScore = Math.max(profile.bestScore, session.score);
    let promoted = false;
    if (session.level === profile.level && session.score >= PROMOTION_SCORE && profile.level < MAX_LEVEL) {
      profile.level += 1;
      promoted = true;
    }
    if (input.raw?.length) {
      await fs.mkdir(RAW, { recursive: true });
      await fs.writeFile(path.join(RAW, `${id}.json`), JSON.stringify(input.raw));
    }
    await write(db);
    return { session, promoted };
  });
}

/** Remove everything flagged synthetic (sessions, their raw files, and synthetic-only profiles). */
export async function clearSynthetic() {
  return locked(async () => {
    const db = await read();
    const gone = db.sessions.filter((s) => s.source === "synthetic");
    for (const s of gone) await fs.rm(path.join(RAW, `${s.id}.json`), { force: true });
    db.sessions = db.sessions.filter((s) => s.source !== "synthetic");
    const hasReal = new Set(db.sessions.map((s) => s.userId));
    const before = db.profiles.length;
    db.profiles = db.profiles.filter((p) => !p.id.startsWith("demo-") || hasReal.has(p.id));
    await write(db);
    return { sessions: gone.length, profiles: before - db.profiles.length };
  });
}

export async function seedProfile(p: Profile) {
  return locked(async () => {
    const db = await read();
    if (!db.profiles.some((x) => x.id === p.id)) db.profiles.push(p);
    await write(db);
  });
}
