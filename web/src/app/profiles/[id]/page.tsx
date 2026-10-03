import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile, listSessions } from "@/lib/store";
import { LEVELS, MAX_LEVEL, PROMOTION_SCORE } from "@/lib/scoring";
import { MetricChart, type Point } from "@/components/MetricChart";
import { DemoBadge } from "@/components/DemoBadge";

export const dynamic = "force-dynamic";

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export default async function ProfilePage({ params }: PageProps<"/profiles/[id]">) {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const sessions = await listSessions(id);

  const series = (pick: (s: (typeof sessions)[number]) => number): Point[] =>
    sessions.map((s) => ({ label: day.format(new Date(s.date)), value: pick(s) }));

  const lvl = LEVELS[profile.level - 1];
  const hasDemo = sessions.some((s) => s.source === "synthetic");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold tracking-tight">
          {profile.name}
          {profile.id.startsWith("demo-") && <DemoBadge />}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink2">
          <span>Level {profile.level} · {lvl.name} (tolerance {lvl.toleranceMm} mm)</span>
          <span>Best score {profile.bestScore ? profile.bestScore.toFixed(1) : "—"}</span>
          <span>{sessions.length} sessions</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {profile.level < MAX_LEVEL
            ? `Score ${PROMOTION_SCORE}+ on level ${profile.level} to unlock level ${profile.level + 1}.`
            : "Top level reached."}
        </p>
        {hasDemo && <p className="mt-1 text-xs text-muted">Contains demo data (synthetic).</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MetricChart title="Overall score" hint="Higher is better · 0–100" data={series((s) => s.score)} domain={[0, 100]} />
        <MetricChart title="Accuracy" hint="% of path within tolerance · higher is better" unit="%" data={series((s) => s.accuracy)} domain={[0, 100]} />
        <MetricChart title="Tremor" hint="Tremor index · lower is better" data={series((s) => s.tremor)} domain={[0, 100]} />
        <MetricChart title="Average deviation" hint="Mean distance from path · lower is better" unit=" mm" data={series((s) => s.avgDeviationMm)} decimals={2} />
        <MetricChart title="Smoothness" hint="Controlled vs. jerky · higher is better" data={series((s) => s.smoothness)} domain={[0, 100]} />
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Session history</h2>
        {sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">No sessions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  {["Date", "Level", "Score", "Accuracy", "Tremor", "Smoothness", "Time"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...sessions].reverse().map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link href={`/sessions/${s.id}`} className="underline-offset-2 hover:underline">
                        {new Date(s.date).toLocaleString()}
                      </Link>
                      {s.source === "synthetic" && <DemoBadge />}
                    </td>
                    <td className="px-3 py-2">{s.level}</td>
                    <td className="px-3 py-2 font-medium tabular-nums">{s.score.toFixed(1)}</td>
                    <td className="px-3 py-2 tabular-nums">{s.accuracy.toFixed(1)}%</td>
                    <td className="px-3 py-2 tabular-nums">{s.tremor.toFixed(1)}</td>
                    <td className="px-3 py-2 tabular-nums">{s.smoothness.toFixed(1)}</td>
                    <td className="px-3 py-2 tabular-nums">{s.completionTimeS.toFixed(0)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
