import { notFound } from "next/navigation";
import Link from "next/link";
import { getProfile, listProfiles, listSessions } from "@/lib/store";
import { LEVELS } from "@/lib/scoring";
import { PageHeader } from "@/components/PageHeader";
import { CardHead, Demo } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Leaderboard({ params, searchParams }: PageProps<"/p/[id]/leaderboard">) {
  const { id } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.level) ? sp.level[0] : sp.level;
  const filter = raw && /^[1-5]$/.test(raw) ? Number(raw) : null;
  const me = await getProfile(id);
  if (!me) notFound();
  const [profiles, sessions] = await Promise.all([listProfiles(), listSessions(undefined, { counted: true })]);

  const rows = profiles
    .map((p) => {
      const mine = sessions.filter((s) => s.userId === p.id && (!filter || s.level === filter));
      const best = mine.reduce((m, s) => Math.max(m, s.score), 0);
      const last = mine[mine.length - 1];
      return { p, best, trem: last?.tremor ?? 0, n: mine.length };
    })
    .filter((r) => r.n > 0)
    .sort((a, b) => b.best - a.best)
    .map((r, i) => {
      const isMe = r.p.id === id;
      return {
        ...r,
        rank: String(i + 1).padStart(2, "0"),
        isMe,
        ini: r.p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
        w: Math.max(30, ((r.best - 40) / 60) * 100),
        bg: isMe ? "#3D8571" : i === 0 ? "#A6CAC8" : "#5AA4D6",
        fg: isMe ? "#F1F7F6" : "#21211F",
        rankColor: isMe ? "#E3A857" : i < 3 ? "#A6CAC8" : "#5AA4D6",
      };
    });

  return (
    <>
      <PageHeader title="Leaderboard" level={me.level} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {LEVELS.map((l) => {
          const active = filter === l.level;
          const lock = l.level > me.level;
          return (
            <Link
              key={l.level}
              href={active ? `/p/${id}/leaderboard` : `/p/${id}/leaderboard?level=${l.level}`}
              className="pill hov"
              style={{ flex: "1 1 180px", height: 64, padding: "0 20px 0 8px", background: active ? "var(--cream)" : "var(--card)", color: active ? "var(--card)" : lock ? "rgba(166,202,200,.55)" : "var(--cream)", display: "flex", alignItems: "center", gap: 12 }}
            >
              <span className="head" style={{ width: 48, height: 48, borderRadius: "50%", background: active ? "var(--card)" : lock ? "var(--pill)" : "var(--steel)", color: active ? "var(--cream)" : lock ? "rgba(166,202,200,.55)" : "var(--card)", display: "grid", placeItems: "center", fontSize: 16 }}>L{l.level}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{l.name}</b>
                <span className="mono" style={{ fontSize: 10.5, opacity: 0.7 }}>±{l.toleranceMm} mm · {l.unlock}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CardHead title={filter ? `Level ${filter} · ${LEVELS[filter - 1].name}` : "MS2 surgical skills cohort"} />
        {rows.length === 0 ? (
          <div className="muted" style={{ fontSize: 14.5, padding: "12px 0" }}>No scores yet{filter ? " on this level" : ""}.</div>
        ) : (
          rows.map((b) => (
            <div key={b.p.id} style={{ display: "grid", gridTemplateColumns: "36px minmax(140px,220px) minmax(0,1fr)", gap: 14, alignItems: "center" }}>
              <span className="head" style={{ fontSize: 20, color: b.rankColor }}>{b.rank}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <b style={{ fontSize: 14.5 }}>
                  {b.p.name}{b.isMe && " (you)"}
                  {b.p.source === "synthetic" && <Demo />}
                </b>
                <span className="mono muted" style={{ fontSize: 11 }}>{b.p.id} · L{b.p.level} · trm {b.trem.toFixed(1)}</span>
              </span>
              <div style={{ position: "relative", height: 44, background: "repeating-linear-gradient(90deg,rgba(166,202,200,.08) 0 1px,transparent 1px 10%)" }}>
                <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${b.w}%`, borderRadius: 999, background: b.bg, color: b.fg, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 0 6px" }}>
                  <span className="mono" style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--card)", color: "var(--cream)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>{b.ini}</span>
                  <span className="head" style={{ fontSize: 17 }}>{b.best}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
