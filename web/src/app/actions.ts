"use server";

import { redirect } from "next/navigation";
import { addSession, createProfile } from "@/lib/store";
import { validateMetrics, MAX_LEVEL } from "@/lib/scoring";
import type { Baseline, RawSample, SessionMetrics } from "@/lib/types";

export async function createProfileAction(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  if (!name.trim()) return;
  const p = await createProfile(name);
  redirect(`/p/${p.id}/live`);
}

/** Save a session from the in-browser webcam mode (MediaPipe hand tracking). Stored as a real device session. */
export async function saveWebcamSession(input: {
  userId: string;
  level: number;
  pathId?: string;
  metrics: SessionMetrics;
  baseline: Baseline;
}) {
  if (!validateMetrics(input.metrics) || !Number.isInteger(input.level) || input.level < 1 || input.level > MAX_LEVEL) {
    throw new Error("Invalid session");
  }
  // A real hand traced a real path in front of a real camera: stored as a device session (no raw movement data, no IMU).
  const r = await addSession({
    userId: String(input.userId),
    level: input.level,
    pathId: typeof input.pathId === "string" ? input.pathId : undefined,
    metrics: input.metrics,
    baseline: input.baseline,
    source: "device",
    task: "path",
  });
  return { id: r.session.id, score: r.session.score, samples: r.session.samples, counted: r.counted, isBest: r.isBest, prevBest: r.prevBest, promoted: r.promoted };
}

/**
 * Save a session recorded by the in-browser SIMULATOR. Always stored as source:"synthetic"
 * (demo data) — real sessions come in through POST /api/sessions from the tracker.
 */
export async function saveSimulatedSession(input: {
  userId: string;
  level: number;
  pathId?: string;
  metrics: SessionMetrics;
  baseline: Baseline;
  raw: RawSample[];
}) {
  if (!validateMetrics(input.metrics) || !Number.isInteger(input.level) || input.level < 1 || input.level > MAX_LEVEL) {
    throw new Error("Invalid session");
  }
  const r = await addSession({
    userId: String(input.userId),
    level: input.level,
    pathId: typeof input.pathId === "string" ? input.pathId : undefined,
    metrics: input.metrics,
    baseline: input.baseline,
    raw: Array.isArray(input.raw) ? input.raw.slice(0, 20000) : undefined,
    source: "synthetic",
  });
  return { id: r.session.id, score: r.session.score, samples: r.session.samples, counted: r.counted, isBest: r.isBest, prevBest: r.prevBest, promoted: r.promoted };
}
