import { notFound } from "next/navigation";
import { getProfile, listSessions } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { LEVELS } from "@/lib/scoring";
import { smoothWord, tremorWord } from "@/lib/coach";
import { getView } from "@/lib/view-server";
import { CardHead, Demo, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const GRID = "64px 90px 60px repeat(4,minmax(80px,1fr)) 150px";

export default async function Sessions({ params }: PageProps<"/p/[id]/sessions">) {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const ss = (await listSessions(id)).reverse(); // newest first; includes simulated (badged)
  const simple = (await getView()) === "simple";

  if (simple) {
    const G = "64px 130px minmax(140px,1.4fr) repeat(3,minmax(90px,1fr))";
    return (
      <>
        <PageHeader title="History" level={profile.level} simple />
        {ss.length === 0 ? (
          <div className="empty">No practice sessions yet. Start one from the Practice tab.</div>
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, overflowX: "auto" }}>
            <div style={{ minWidth: 740 }}>
              <CardHead title="Your practice sessions" right={<span className="muted" style={{ fontSize: 13 }}>{ss.length} total · newest first</span>} />
            </div>
            <div className="muted" style={{ display: "grid", gridTemplateColumns: G, gap: 10, padding: "8px 10px 0", fontSize: 12.5, fontWeight: 600, minWidth: 740 }}>
              <span>Score</span><span>Date</span><span>Exercise</span><span>On the path</span><span>Hand tremor</span><span>Smoothness</span>
            </div>
            {ss.map((s) => {
              const isBest = s.score === profile.bestScore && s.source === profile.source;
              return (
                <div key={s.id} className="row-hov" style={{ display: "grid", gridTemplateColumns: G, gap: 10, alignItems: "center", height: 60, padding: "0 10px 0 6px", borderRadius: 999, fontSize: 14, minWidth: 740 }}>
                  <span className="head" style={{ width: 48, height: 48, borderRadius: "50%", background: isBest ? "var(--cream)" : "var(--card)", color: isBest ? "var(--card)" : "var(--cream)", display: "grid", placeItems: "center", fontSize: 17 }}>{s.score}</span>
                  <span>{fmtDate(s.date)}{s.source === "synthetic" && <Demo />}</span>
                  <span>{LEVELS[s.level - 1].name}</span>
                  <span>{s.accuracy.toFixed(0)}%</span>
                  <span>{tremorWord(s.tremor)}</span>
                  <span>{smoothWord(s.smoothness)}</span>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title={simple ? "History" : "Sessions"} level={profile.level} simple={simple} />
      {ss.length === 0 ? (
        <div className="empty">No sessions recorded yet.</div>
      ) : (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, overflowX: "auto" }}>
          <div style={{ minWidth: 820 }}>
            <CardHead title="Session database" right={<span className="mono muted" style={{ fontSize: 12 }}>{ss.length} rows · newest first</span>} />
          </div>
          <div className="mono muted" style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "8px 10px 0", fontSize: 10.5, fontWeight: 500, letterSpacing: ".08em", minWidth: 820 }}>
            <span>SCORE</span><span>DATE</span><span>LEVEL</span><span>ACCURACY</span><span>TREMOR</span><span>SMOOTH</span><span>AVG DEV</span><span style={{ textAlign: "right" }}>RAW DATA</span>
          </div>
          {ss.map((s) => {
            const isBest = s.score === profile.bestScore && s.source === profile.source;
            return (
              <div key={s.id} className="mono row-hov" style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center", height: 60, padding: "0 10px 0 6px", borderRadius: 999, fontSize: 13, fontWeight: 500, minWidth: 820 }}>
                <span className="head" style={{ width: 48, height: 48, borderRadius: "50%", background: isBest ? "var(--cream)" : "var(--card)", color: isBest ? "var(--card)" : "var(--cream)", display: "grid", placeItems: "center", fontSize: 17 }}>{s.score}</span>
                <span>{fmtDate(s.date)}{s.source === "synthetic" && <Demo />}</span>
                <span>L{s.level}</span>
                <span>{s.accuracy.toFixed(1)}%</span>
                <span>{s.tremor.toFixed(1)}</span>
                <span>{Math.round(s.smoothness)}</span>
                <span>{s.task === "hold" ? "hold" : `${s.avgDeviationMm.toFixed(2)} mm`}</span>
                {s.hasRaw ? (
                  <a href={`/api/sessions/${s.id}/csv`} download className="csv-chip" style={{ justifySelf: "end", height: 38, padding: "0 16px", borderRadius: 999, background: "var(--card)", display: "flex", alignItems: "center", fontSize: 11.5, color: "var(--steel)" }}>
                    {s.samples.toLocaleString()} · csv
                  </a>
                ) : (
                  <span style={{ justifySelf: "end", height: 38, padding: "0 16px", borderRadius: 999, background: "var(--card)", display: "flex", alignItems: "center", fontSize: 11.5, color: "rgba(166,202,200,.35)" }}>no raw</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
