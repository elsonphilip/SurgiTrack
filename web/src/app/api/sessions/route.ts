import { addSession } from "@/lib/store";
import { validateMetrics } from "@/lib/scoring";
import type { RawSample } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Pi → site. Body:
 * { userId, level, metrics:{accuracy,avgDeviationMm,tremor,smoothness,completionTimeS}, date?, raw?: RawSample[] }
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
    const { session, promoted } = await addSession({
      userId: b.userId,
      level: Number(b.level),
      metrics: b.metrics,
      date: typeof b.date === "string" && !Number.isNaN(Date.parse(b.date)) ? new Date(b.date).toISOString() : undefined,
      source: "device",
      raw,
    });
    return Response.json({ session, promoted }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
