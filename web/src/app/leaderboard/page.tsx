import Link from "next/link";
import { listProfiles, listSessions } from "@/lib/store";
import { LEVELS } from "@/lib/scoring";
import { DemoBadge } from "@/components/DemoBadge";

export const dynamic = "force-dynamic";

export default async function Leaderboard({ searchParams }: PageProps<"/leaderboard">) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.level) ? sp.level[0] : sp.level;
  const level = raw && /^[1-5]$/.test(raw) ? Number(raw) : null;

  const [profiles, sessions] = await Promise.all([listProfiles(), listSessions()]);
  const rows = profiles
    .map((p) => {
      const mine = sessions.filter((s) => s.userId === p.id && (!level || s.level === level));
      const best = mine.reduce<(typeof mine)[number] | null>((b, s) => (!b || s.score > b.score ? s : b), null);
      return { p, best, count: mine.length };
    })
    .filter((r) => r.best)
    .sort((a, b) => b.best!.score - a.best!.score);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/leaderboard" className={`rounded-full border px-3 py-1 ${!level ? "border-ink bg-ink text-bg" : "border-line text-ink2"}`}>
          All levels
        </Link>
        {LEVELS.map((l) => (
          <Link
            key={l.level}
            href={`/leaderboard?level=${l.level}`}
            className={`rounded-full border px-3 py-1 ${level === l.level ? "border-ink bg-ink text-bg" : "border-line text-ink2"}`}
          >
            L{l.level} {l.name}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">No scores yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Best score</th>
                <th className="px-3 py-2 font-medium">Level</th>
                <th className="px-3 py-2 font-medium">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.p.id} className="border-t border-line">
                  <td className="px-3 py-2 tabular-nums text-muted">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Link href={`/profiles/${r.p.id}`} className="font-medium hover:underline">{r.p.name}</Link>
                    {r.p.id.startsWith("demo-") && <DemoBadge />}
                  </td>
                  <td className="px-3 py-2 font-semibold tabular-nums">{r.best!.score.toFixed(1)}</td>
                  <td className="px-3 py-2">{r.p.level}</td>
                  <td className="px-3 py-2 tabular-nums">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
