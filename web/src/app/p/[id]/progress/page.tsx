import { notFound } from "next/navigation";
import { getProfile, listSessions } from "@/lib/store";
import { LEVELS, MAX_LEVEL, UNLOCK_COUNT, UNLOCK_SCORE, consistency } from "@/lib/scoring";
import { coachingTip, gradeWord } from "@/lib/coach";
import { getGame, getView } from "@/lib/view-server";
import { badgesFor, rankFor, totalXp } from "@/lib/game";
import { PageHeader } from "@/components/PageHeader";
import { BadgeIcon } from "@/components/BadgeIcon";
import { BleedLines, CardHead, DotMatrix, LEGEND_DOT, Stat, fmtDate, svgLine } from "@/components/ui";

export const dynamic = "force-dynamic";

const LVC = ["#A6CAC8", "#5AA4D6", "#3D8571", "#3D8571", "#3D8571"];
const LVF = ["#21211F", "#21211F", "#F1F7F6", "#F1F7F6", "#F1F7F6"]; // text on each level colour

export default async function Progress({ params }: PageProps<"/p/[id]/progress">) {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const ss = await listSessions(id, { counted: true });
  const simple = (await getView()) === "simple";
  const game = await getGame();
  const badges = badgesFor(ss, profile.level);
  const xp = totalXp(ss), rank = rankFor(xp);
  const gameCard = game && (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <span className="card-title">Badges · {badges.filter((b) => b.earned).length}/{badges.length}</span>
        <span className="mono muted" style={{ fontSize: 13 }}>{rank.name} · {xp} XP{rank.next ? ` · ${rank.span - rank.into} to ${rank.next}` : ""}</span>
      </div>
      <div className="badge-grid">
        {badges.map((b) => (
          <div key={b.id} className={`badge${b.earned ? "" : " locked"}`} title={b.desc}>
            <BadgeIcon id={b.id} />
            <div><div style={{ fontWeight: 700, fontSize: 14 }}>{b.name}</div><div style={{ fontSize: 12, color: "rgba(166,202,200,.7)" }}>{b.desc}</div></div>
          </div>
        ))}
      </div>
    </div>
  );

  if (ss.length === 0) {
    return (
      <>
        <PageHeader title={simple ? "My Progress" : "Progress"} level={profile.level} simple={simple} />
      {gameCard}
        <div className="empty">{simple ? "No practice sessions yet. Start one from the Practice tab and your progress will show up here." : "No sessions yet. Run one from Live Session and your progress will show up here."}</div>
      </>
    );
  }

  const first = ss[0];
  const last = ss[ss.length - 1];
  const scores = ss.map((s) => s.score);
  const cols = ss.map((s, i) => {
    const isBest = s.score > Math.max(0, ...scores.slice(0, i)); // new running personal best
    const prev = i ? ss[i - 1].score : s.score;
    const bg = isBest ? "#A6CAC8" : s.score >= prev ? "#5AA4D6" : "#3D8571";
    return { s, bg, fg: bg === "#3D8571" ? "#F1F7F6" : "#21211F", h: Math.round(44 + (Math.max(0, s.score - 55) / 45) * 150) };
  });
  if (simple) {
    const need = profile.level < MAX_LEVEL ? UNLOCK_SCORE[profile.level] : null;
    const have = need ? ss.filter((x) => x.level === profile.level && x.score >= need).length : 0;
    const change = (delta: number, unit: string) =>
      Math.abs(delta) < 1 ? { text: "About the same", color: "var(--cream)" }
        : delta > 0 ? { text: `Better by ${Math.abs(delta).toFixed(0)}${unit}`, color: "var(--steel)" }
        : { text: `Down by ${Math.abs(delta).toFixed(0)}${unit}`, color: "var(--warn)" };
    const rows = [
      ["Stayed on the path", `${last.accuracy.toFixed(0)}%`, change(last.accuracy - first.accuracy, " points")],
      ["Hand tremor (lower is better)", `${last.tremor.toFixed(1)} / 10`, change((first.tremor - last.tremor) * 10, " points")],
      ["Smoothness", `${Math.round(last.smoothness)} / 100`, change(last.smoothness - first.smoothness, " points")],
    ] as const;
    return (
      <>
        <PageHeader title="My Progress" level={profile.level} simple />
      {gameCard}
        <div className="row">
          <div className="card" style={{ flex: "1 1 240px" }}><Stat value={profile.bestScore} label="Best score" /></div>
          <div className="card" style={{ flex: "1 1 240px" }}><Stat value={gradeWord(last.score)} label={`Latest session: ${last.score}`} /></div>
          <div className="card" style={{ flex: "1 1 240px" }}><Stat value={ss.length} label={ss.length === 1 ? "Practice session" : "Practice sessions"} /></div>
        </div>
        <div className="row">
          <div className="card" style={{ flex: "1.3 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
            <CardHead title="Score over time" right={<span className="muted" style={{ fontSize: 13 }}>Beige = new personal best</span>} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 4, height: 250, overflowX: "auto" }}>
              {cols.map(({ s: x, bg, fg, h }) => (
                <div key={x.id} title={`${new Date(x.date).toLocaleString()} · ${LEVELS[x.level - 1].name}`} style={{ position: "relative", flex: 1, minWidth: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                  <span style={{ position: "relative", width: 36, height: h, borderRadius: 999, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{x.score}</span>
                  <span style={{ position: "relative", fontSize: 10.5, color: "rgba(166,202,200,.55)", whiteSpace: "nowrap" }}>{fmtDate(x.date)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card" style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            <CardHead title="Since your first session" />
            {ss.length < 2 ? (
              <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.5, margin: 0 }}>Practice a couple more times and you’ll see how you’re changing.</p>
            ) : rows.map(([k, v, c]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, borderBottom: "1px solid var(--pill)", paddingBottom: 10 }}>
                <div><div style={{ fontWeight: 700, fontSize: 15 }}>{k}</div><div style={{ fontSize: 13, color: c.color }}>{c.text}</div></div>
                <div className="head" style={{ fontSize: 22, whiteSpace: "nowrap" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CardHead title="What to work on" />
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>{coachingTip(last.accuracy, last.tremor, last.smoothness)}</p>
          {need ? (
            <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
              Next exercise: score {need}+ on {LEVELS[profile.level - 1].name} {UNLOCK_COUNT} times to unlock {LEVELS[profile.level].name}. You have {Math.min(have, UNLOCK_COUNT)} of {UNLOCK_COUNT}.
            </p>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>You’ve unlocked every exercise.</p>
          )}
        </div>
      </>
    );
  }

  const timeline = ss.slice(-8).reverse().map((s) => {
    const left = Math.max(0, ((s.accuracy - 50 - s.tremor * 4) / 50) * 100);
    const right = Math.min(100, ((s.accuracy - 50) / 50) * 100);
    return { s, left, w: Math.max(22, right - left) };
  });
  const f1 = (n: number) => n.toFixed(1);
  const steel = "#5AA4D6";

  return (
    <>
      <PageHeader title="Progress" level={profile.level} />
      {gameCard}
      <div className="row">
        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, paddingBottom: 0, display: "flex", flexDirection: "column", gap: 18, overflow: "hidden" }}>
          <CardHead title="Precision" />
          <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
            <Stat value={`${f1(last.accuracy)}%`} label="Accuracy" trend={{ text: `${last.accuracy >= first.accuracy ? "▲" : "▼"} ${f1(Math.abs(last.accuracy - first.accuracy))}`, color: last.accuracy >= first.accuracy ? steel : "#E3A857" }} />
            <Stat value={last.avgDeviationMm.toFixed(2)} label="Avg deviation, mm" trend={{ text: `${last.avgDeviationMm <= first.avgDeviationMm ? "▼" : "▲"} ${Math.abs(last.avgDeviationMm - first.avgDeviationMm).toFixed(2)}`, color: last.avgDeviationMm <= first.avgDeviationMm ? steel : "#E3A857" }} />
          </div>
          <BleedLines lines={[{ path: svgLine(ss.map((s) => s.accuracy), 300, 80), color: "#5AA4D6" }, { path: svgLine(ss.map((s) => s.avgDeviationMm), 300, 80), color: "#3D8571" }]} />
        </div>

        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, paddingBottom: 0, display: "flex", flexDirection: "column", gap: 18, overflow: "hidden" }}>
          <CardHead title="Stability" right={<span className="mono muted" style={{ fontSize: 11 }}>tremor / session</span>} />
          <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
            <Stat value={f1(last.tremor)} label="Tremor, /10" trend={{ text: `${last.tremor <= first.tremor ? "▼" : "▲"} ${f1(Math.abs(last.tremor - first.tremor))}`, color: last.tremor <= first.tremor ? steel : "#E3A857" }} />
            <Stat value={Math.round(last.smoothness)} label="Smoothness" trend={{ text: `${last.smoothness >= first.smoothness ? "▲" : "▼"} ${Math.round(Math.abs(last.smoothness - first.smoothness))}`, color: last.smoothness >= first.smoothness ? steel : "#E3A857" }} />
          </div>
          <DotMatrix cols={ss.slice(-14).map((s) => ({ lit: Math.min(6, Math.max(1, Math.round((s.tremor / 4) * 6))), color: s.tremor > 2.4 ? "#3D8571" : "#5AA4D6" }))} />
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
                <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "rgba(166,202,200,.12)" }} />
                <span style={{ position: "relative", width: 12, height: 12, borderRadius: "50%", background: LVC[s.level - 1] }} />
                <span className="mono" style={{ position: "relative", width: 36, height: h, borderRadius: 999, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{s.score}</span>
                <span className="mono" style={{ position: "relative", fontSize: 9.5, color: "rgba(166,202,200,.5)", whiteSpace: "nowrap" }}>{fmtDate(s.date)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap", fontSize: 13.5, fontWeight: 600 }}>
            {[["Personal best", "#A6CAC8"], ["Improved", "#5AA4D6"], ["Dropped", "#3D8571"]].map(([l, c]) => (
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
                <div style={{ position: "relative", height: 40, background: "repeating-linear-gradient(90deg,rgba(166,202,200,.08) 0 1px,transparent 1px 20%)" }}>
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: `${left}%`, width: `${w}%`, borderRadius: 999, background: LVC[s.level - 1], color: LVF[s.level - 1], display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px 0 4px" }}>
                    <span className="mono" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--card)", color: "var(--cream)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600 }}>L{s.level}</span>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{s.accuracy.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr)", gap: 12 }}>
              <span />
              <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 600, color: "rgba(166,202,200,.6)" }}>
                {["50", "60", "70", "80", "90", "100%"].map((t) => <span key={t}>{t}</span>)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", fontSize: 13.5, fontWeight: 600, marginTop: "auto" }}>
            {[["L1", "#A6CAC8"], ["L2", "#5AA4D6"], ["L3+", "#3D8571"]].map(([l, c]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={LEGEND_DOT(c)} />{l}</span>
            ))}
            <span className="muted" style={{ marginLeft: "auto", fontWeight: 400 }}>Bar: tremor-free span → accuracy</span>
          </div>
        </div>
      </div>
    </>
  );
}
