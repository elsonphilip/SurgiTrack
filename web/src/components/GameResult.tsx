"use client";

import { rankFor, sessionXp, stars } from "@/lib/game";
import { useLive } from "./Shell";

const COLORS = ["#A6CAC8", "#5AA4D6", "#3D8571", "#E3A857", "#F1F7F6"];

/** Deterministic pseudo-random so the confetti is stable across renders. */
const r = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

export function Confetti({ n = 44 }: { n?: number }) {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ left: `${r(i, 1) * 100}%`, background: COLORS[i % COLORS.length], animationDelay: `${r(i, 2) * 0.6}s`, ["--dx" as string]: `${(r(i, 3) - 0.5) * 160}px`, ["--rot" as string]: `${(r(i, 4) - 0.5) * 900}deg` }} />
      ))}
    </div>
  );
}

interface Props {
  challenge: string;
  level: number;
  chain: number;
  acc: number;
  time: number;
  /** Detailed view only: extra measurements. */
  detail?: string[][];
  score: number;
  points: number;
  bestCombo: number;
  counted: boolean;
  isBest: boolean;
  promoted: boolean;
  demo?: boolean;
  onAgain: () => void;
  onProgress: () => void;
}

export function GameResult({ challenge, level, chain, acc, time, detail, score, points, bestCombo, counted, isBest, promoted, demo, onAgain, onProgress }: Props) {
  const { xp } = useLive();
  const n = stars(score);
  const gain = sessionXp(score);
  const rank = rankFor(xp);
  const headline = n === 3 ? "Flawless!" : n === 2 ? "Nice work!" : "Level complete";
  return (
    <>
      {n >= 2 && <Confetti />}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <span className="head muted" style={{ fontSize: 16, letterSpacing: ".04em" }}>{challenge} · Level {level}</span>
        <span className="head" style={{ fontSize: 22 }}>{headline}</span>
        <div aria-label={`${n} of 3 stars`}>
          {[1, 2, 3].map((i) => <span key={i} className={`star${i <= n ? "" : " off"}`} style={{ animationDelay: `${i * 0.18}s`, color: i <= n ? "var(--warn)" : "var(--cream)" }}>★</span>)}
        </div>
        <span className="head" style={{ fontSize: 96, lineHeight: 0.9 }}>{score}</span>
        {promoted && <span style={{ padding: "4px 14px", borderRadius: 999, background: "var(--cream)", color: "var(--card)", fontWeight: 700, fontSize: 13 }}>New exercise unlocked!</span>}
        {counted && isBest && !promoted && <span style={{ padding: "4px 14px", borderRadius: 999, background: "var(--accent)", fontWeight: 700, fontSize: 13 }}>New personal best</span>}
        {!counted && <span style={{ padding: "4px 14px", borderRadius: 999, background: "var(--pill)", fontSize: 12.5 }}>{demo === false ? "Not counted toward your progress" : "Practice run (simulated), no XP"}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 280px", maxWidth: 460 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[["Best combo", `${chain}-hit`], ["Accuracy", `${acc}%`], ["Time", `${time}s`], ["Run points", String(points)], ["Multiplier", `x${bestCombo}`], ["XP", counted ? `+${gain}` : "+0"], ...(detail ?? [])].map(([k, v]) => (
            <div key={k} style={{ flex: "1 1 110px", background: "var(--pill)", borderRadius: 20, padding: "12px 16px" }}>
              <div style={{ fontSize: 12.5, color: "var(--steel)", fontWeight: 600 }}>{k}</div>
              <div className="head" style={{ fontSize: 28 }}>{v}</div>
            </div>
          ))}
        </div>
        {counted && (
          <div style={{ fontSize: 13.5 }}>
            <b>{rank.name}</b>{rank.next ? ` · ${rank.span - rank.into} XP to ${rank.next}` : " · top rank"}
            <div style={{ height: 8, borderRadius: 999, background: "var(--pill)", overflow: "hidden", marginTop: 6 }}><div style={{ width: `${Math.round(rank.pct * 100)}%`, height: "100%", background: "linear-gradient(90deg,var(--accent),var(--steel))" }} /></div>
          </div>
        )}
        <div style={{ fontSize: 13, color: "rgba(166,202,200,.75)" }}>Stars: 75+ for two, 90+ for three. A hit is every quarter second inside the zone; the multiplier grows every 1.5 s.</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-accent" onClick={onAgain} style={{ height: 46, padding: "0 22px", fontSize: 14 }}>Play again</button>
          <button className="btn hov" onClick={onProgress} style={{ height: 46, padding: "0 22px", fontSize: 14, fontWeight: 600, background: "var(--pill)" }}>Badges & progress</button>
        </div>
      </div>
    </>
  );
}
