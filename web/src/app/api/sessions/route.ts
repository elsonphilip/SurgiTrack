import { addSession } from "@/lib/store";
import { validateMetrics } from "@/lib/scoring";
import type { RawSample } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Pi → site. Body:
 * { userId, level, metrics:{accuracy,avgDeviationMm,tremor(0-10),smoothness,completionTimeS,hapticPulses},
 *   baseline?:{pitch,roll,noiseSigma}, pathId?, date?, raw?: RawSample[] }
 * Sessions posted here are stored as source:"device". If SURGITRACK_API_KEY is set, send it as
 * `Authorization: Bearer <key>`.
 */
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
    const { session, promoted, counted } = await addSession({
      userId: b.userId,
      level: Number(b.level),
      pathId: typeof b.pathId === "string" ? b.pathId : undefined,
      metrics: b.metrics,
      date: typeof b.date === "string" && !Number.isNaN(Date.parse(b.date)) ? new Date(b.date).toISOString() : undefined,
      source: "device",
      baseline: b.baseline && typeof b.baseline === "object" ? b.baseline : undefined,
      raw,
    });
    return Response.json({ session, promoted, counted }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
