import { notFound } from "next/navigation";
import { getProfile, listSessions } from "@/lib/store";
import { consistency } from "@/lib/scoring";
import { PageHeader } from "@/components/PageHeader";
import { BleedLines, CardHead, DotMatrix, LEGEND_DOT, Stat, fmtDate, svgLine } from "@/components/ui";

export const dynamic = "force-dynamic";

const LVC = ["#FDF0D5", "#669BBC", "#BE1122", "#BE1122", "#BE1122"];
const LVF = ["#002E48", "#002E48", "#FDF0D5", "#FDF0D5", "#FDF0D5"];

export default async function Progress({ params }: PageProps<"/p/[id]/progress">) {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const ss = await listSessions(id, { counted: true });

  if (ss.length === 0) {
    return (
      <>
        <PageHeader title="Progress" level={profile.level} />
        <div className="empty">No sessions yet. Run one from Live Session and your progress will show up here.</div>
      </>
    );
  }

  const first = ss[0];
  const last = ss[ss.length - 1];
  const scores = ss.map((s) => s.score);
  const cols = ss.map((s, i) => {
    const isBest = s.score > Math.max(0, ...scores.slice(0, i)); // new running personal best
    const prev = i ? ss[i - 1].score : s.score;
    const bg = isBest ? "#FDF0D5" : s.score >= prev ? "#669BBC" : "#BE1122";
    return { s, bg, fg: bg === "#BE1122" ? "#FDF0D5" : "#002E48", h: Math.round(44 + (Math.max(0, s.score - 55) / 45) * 150) };
  });
  const timeline = ss.slice(-8).reverse().map((s) => {
    const left = Math.max(0, ((s.accuracy - 50 - s.tremor * 4) / 50) * 100);
    const right = Math.min(100, ((s.accuracy - 50) / 50) * 100);
    return { s, left, w: Math.max(22, right - left) };
  });
  const f1 = (n: number) => n.toFixed(1);
  const steel = "#669BBC";

  return (
    <>
      <PageHeader title="Progress" level={profile.level} />
      <div className="row">
        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, paddingBottom: 0, display: "flex", flexDirection: "column", gap: 18, overflow: "hidden" }}>
          <CardHead title="Precision" />
          <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
            <Stat value={`${f1(last.accuracy)}%`} label="Accuracy" trend={{ text: `${last.accuracy >= first.accuracy ? "▲" : "▼"} ${f1(Math.abs(last.accuracy - first.accuracy))}`, color: last.accuracy >= first.accuracy ? steel : "#F2404F" }} />
            <Stat value={last.avgDeviationMm.toFixed(2)} label="Avg deviation, mm" trend={{ text: `${last.avgDeviationMm <= first.avgDeviationMm ? "▼" : "▲"} ${Math.abs(last.avgDeviationMm - first.avgDeviationMm).toFixed(2)}`, color: last.avgDeviationMm <= first.avgDeviationMm ? steel : "#F2404F" }} />
          </div>
          <BleedLines lines={[{ path: svgLine(ss.map((s) => s.accuracy), 300, 80), color: "#669BBC" }, { path: svgLine(ss.map((s) => s.avgDeviationMm), 300, 80), color: "#BE1122" }]} />
        </div>

        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, paddingBottom: 0, display: "flex", flexDirection: "column", gap: 18, overflow: "hidden" }}>
          <CardHead title="Stability" right={<span className="mono muted" style={{ fontSize: 11 }}>tremor / session</span>} />
          <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
            <Stat value={f1(last.tremor)} label="Tremor, /10" trend={{ text: `${last.tremor <= first.tremor ? "▼" : "▲"} ${f1(Math.abs(last.tremor - first.tremor))}`, color: last.tremor <= first.tremor ? steel : "#F2404F" }} />
            <Stat value={Math.round(last.smoothness)} label="Smoothness" trend={{ text: `${last.smoothness >= first.smoothness ? "▲" : "▼"} ${Math.round(Math.abs(last.smoothness - first.smoothness))}`, color: last.smoothness >= first.smoothness ? steel : "#F2404F" }} />
          </div>
          <DotMatrix cols={ss.slice(-14).map((s) => ({ lit: Math.min(6, Math.max(1, Math.round((s.tremor / 4) * 6))), color: s.tremor > 2.4 ? "#BE1122" : "#669BBC" }))} />
        </div>

        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          <CardHead title="Profile" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "20px 24px" }}>
            <Stat value={profile.bestScore} label="Best score" />
            <Stat value={`L${profile.level}`} label="Current level" />
            <Stat value={`±${consistency(scores).toFixed(1)}`} label="Consistency σ, last 5" />
            <Stat value={ss.length} label="Sessions" />
          </div>
        </div>
      </div>

      <div className="row">
        <div className="card" style={{ flex: "1.3 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <CardHead title="Overall score" />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 4, height: 250, overflowX: "auto" }}>
            {cols.map(({ s, bg, fg, h }) => (
              <div key={s.id} title={`${new Date(s.date).toLocaleString()} · L${s.level}`} style={{ position: "relative", flex: 1, minWidth: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "rgba(253,240,213,.12)" }} />
                <span style={{ position: "relative", width: 12, height: 12, borderRadius: "50%", background: LVC[s.level - 1] }} />
                <span className="mono" style={{ position: "relative", width: 36, height: h, borderRadius: 999, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{s.score}</span>
                <span className="mono" style={{ position: "relative", fontSize: 9.5, color: "rgba(253,240,213,.5)", whiteSpace: "nowrap" }}>{fmtDate(s.date)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap", fontSize: 13.5, fontWeight: 600 }}>
            {[["Personal best", "#FDF0D5"], ["Improved", "#669BBC"], ["Dropped", "#BE1122"]].map(([l, c]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={LEGEND_DOT(c)} />{l}</span>
            ))}
            <span className="muted" style={{ marginLeft: "auto", fontWeight: 400 }}>Average: <b style={{ color: "var(--cream)" }}>{Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}</b></span>
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 400px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          <CardHead title="Accuracy timeline" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {timeline.map(({ s, left, w }) => (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr)", alignItems: "center", gap: 12 }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{fmtDate(s.date)}</span>
                <div style={{ position: "relative", height: 40, background: "repeating-linear-gradient(90deg,rgba(253,240,213,.08) 0 1px,transparent 1px 20%)" }}>
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: `${left}%`, width: `${w}%`, borderRadius: 999, background: LVC[s.level - 1], color: LVF[s.level - 1], display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px 0 4px" }}>
                    <span className="mono" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--card)", color: "var(--cream)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600 }}>L{s.level}</span>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{s.accuracy.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr)", gap: 12 }}>
              <span />
              <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600, color: "rgba(253,240,213,.6)" }}>
                {["50", "60", "70", "80", "90", "100%"].map((t) => <span key={t}>{t}</span>)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", fontSize: 13.5, fontWeight: 600, marginTop: "auto" }}>
            {[["L1", "#FDF0D5"], ["L2", "#669BBC"], ["L3+", "#BE1122"]].map(([l, c]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={LEGEND_DOT(c)} />{l}</span>
            ))}
            <span className="muted" style={{ marginLeft: "auto", fontWeight: 400 }}>Bar: tremor-free span → accuracy</span>
          </div>
        </div>
      </div>
    </>
  );
}
