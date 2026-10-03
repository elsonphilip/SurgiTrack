import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile, getRaw, getSession } from "@/lib/store";
import { SessionTrace } from "@/components/SessionTrace";
import { DemoBadge } from "@/components/DemoBadge";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  const { id } = await params;
  const s = await getSession(id);
  if (!s) notFound();
  const [profile, raw] = await Promise.all([getProfile(s.userId), s.hasRaw ? getRaw(s.id) : null]);

  const stats: [string, string][] = [
    ["Overall score", s.score.toFixed(1)],
    ["Accuracy", `${s.accuracy.toFixed(1)}%`],
    ["Avg deviation", `${s.avgDeviationMm.toFixed(2)} mm`],
    ["Tremor", s.tremor.toFixed(1)],
    ["Smoothness", s.smoothness.toFixed(1)],
    ["Completion time", `${s.completionTimeS.toFixed(1)} s`],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/profiles/${s.userId}`} className="text-sm text-ink2 hover:underline">
          ← {profile?.name ?? "Profile"}
        </Link>
        <h1 className="mt-1 flex items-center text-2xl font-semibold tracking-tight">
          Level {s.level} session
          {s.source === "synthetic" && <DemoBadge />}
        </h1>
        <p className="text-sm text-muted">{new Date(s.date).toLocaleString()}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-4">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Raw sensor trace</h2>
        {raw?.length ? (
          <SessionTrace raw={raw} />
        ) : (
          <p className="mt-2 text-sm text-muted">No raw sensor data stored for this session.</p>
        )}
      </section>
    </div>
  );
}
