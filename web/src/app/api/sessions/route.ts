import { addSession } from "@/lib/store";
import { validateMetrics } from "@/lib/scoring";
import type { RawSample } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * tracker → site. Body:
 * { userId, level, task?:"path"|"hold", metrics:{accuracy,avgDeviationMm,tremor(0-10),smoothness,completionTimeS,hapticPulses},
 *   baseline?:{pitch,roll,noiseSigma}, pathId?, screening?:{tremorProbability,windows}, simulated?, date?, raw? }
 * Stored as source:"device" — unless `simulated: true` (the tracker's --simulate mode), which stores it as
 * source:"synthetic" (DEMO data that never counts toward real profiles). If SURGITRACK_API_KEY is set, send it as
 * `Authorization: Bearer <key>`.
 */
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
export async function POST(request: Request) {
  const key = process.env.SURGITRACK_API_KEY;
  if (key && request.headers.get("authorization") !== `Bearer ${key}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await request.json().catch(() => null);
  if (!b || typeof b.userId !== "string" || !validateMetrics(b.metrics)) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const raw: RawSample[] | undefined = Array.isArray(b.raw) ? b.raw.slice(0, 200_000) : undefined;
  try {
    const bl = b.baseline as Record<string, unknown> | undefined;
    const sc = b.screening as Record<string, unknown> | undefined;
    const { session, promoted, counted, isBest, prevBest } = await addSession({
      userId: b.userId,
      level: Number(b.level),
      pathId: typeof b.pathId === "string" ? b.pathId : undefined,
      task: b.task === "hold" ? "hold" : "path",
      metrics: b.metrics,
      date: typeof b.date === "string" && !Number.isNaN(Date.parse(b.date)) ? new Date(b.date).toISOString() : undefined,
      source: b.simulated === true ? "synthetic" : "device",
      baseline: bl && num(bl.pitch) && num(bl.roll) && num(bl.noiseSigma) ? { pitch: bl.pitch as number, roll: bl.roll as number, noiseSigma: bl.noiseSigma as number } : undefined,
      screening: sc && num(sc.tremorProbability) && (sc.tremorProbability as number) >= 0 && (sc.tremorProbability as number) <= 1
        ? { tremorProbability: sc.tremorProbability as number, windows: num(sc.windows) ? (sc.windows as number) : 0 }
        : undefined,
      raw,
    });
    return Response.json({ session, promoted, counted, isBest, prevBest }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
