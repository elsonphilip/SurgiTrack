"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { VIEW_COOKIE, type View } from "@/lib/view";
import { GAME_COOKIE, rankFor } from "@/lib/game";

interface LiveCtx {
  haptic: boolean;
  setHaptic: (v: boolean) => void;
  dist: string;
  setDist: (v: string) => void;
  startSignal: number;
  view: View;
  game: boolean;
  xp: number;
}
const Ctx = createContext<LiveCtx | null>(null);
export const useLive = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLive outside Shell");
  return c;
};

function saveView(v: View) {
  document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
}

function saveGame(on: boolean) {
  document.cookie = `${GAME_COOKIE}=${on ? "on" : "off"}; path=/; max-age=31536000; samesite=lax`;
}

const GAME_LABELS: Record<string, string> = { live: "Mission Control", progress: "Progress & badges" };

const NAV: Record<View, readonly (readonly [string, string])[]> = {
  detailed: [
    ["live", "Live Session"],
    ["progress", "Progress"],
    ["sessions", "Sessions"],
    ["leaderboard", "Leaderboard"],
    ["scoring", "Scoring"],
  ],
  simple: [
    ["live", "Practice"],
    ["progress", "My Progress"],
    ["sessions", "History"],
    ["leaderboard", "Leaderboard"],
  ],
};

export function Shell({
  profile,
  initialView,
  initialGame,
  xp,
  children,
}: {
  profile: { id: string; name: string; level: number; demo: boolean };
  initialView: View;
  initialGame: boolean;
  xp: number;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [haptic, setHaptic] = useState(false);
  const [dist, setDist] = useState("14.2");
  const [startSignal, setStartSignal] = useState(0);
  const [view, setViewState] = useState<View>(initialView);
  const [game, setGameState] = useState(initialGame);
  const base = `/p/${profile.id}`;
  const ctx = useMemo(() => ({ haptic, setHaptic, dist, setDist, startSignal, view, game, xp }), [haptic, dist, startSignal, view, game, xp]);
  const rank = rankFor(xp);
  const setView = (v: View) => {
    saveView(v);
    setViewState(v);
    router.refresh(); // server pages read the cookie too
  };

  const setGame = (on: boolean) => {
    saveGame(on);
    setGameState(on);
    router.refresh();
  };

  const newSession = useCallback(() => {
    if (path === `${base}/live`) setStartSignal((n) => n + 1);
    else router.push(`${base}/live?new=1`);
  }, [path, base, router]);

  const initials = profile.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  // No hardware is connected yet: the feed is simulated, so status dots are dim rather than "ok".
  const dim = "rgba(166,202,200,.25)";
  const rail = [
    ["R4", "Arduino R4 WiFi (simulated)", dim],
    ["IMU", "BMI270 (simulated)", dim],
    ["HPT", "DRV2605L haptic (simulated)", haptic ? "var(--accent)" : dim],
    ["CAM", "Camera (simulated)", dim],
    ["SR04", "HC-SR04 distance (simulated)", dim],
  ];

  return (
    <Ctx.Provider value={ctx}>
      <div data-game={game ? "on" : "off"} style={{ minHeight: "100vh", padding: "24px clamp(16px,2.4vw,32px) 40px", display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: "20px 28px", alignContent: "start" }}>
        <Link href="/profiles" title="All profiles" className="hov" style={{ width: 64, height: 64, borderRadius: "50%", background: "#FFFFFF", overflow: "hidden", display: "grid", placeItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SurgiTrack" style={{ width: "92%", height: "auto", display: "block" }} />
        </Link>

        <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          {NAV[view].map(([k, label], i) => {
            const active = path === `${base}/${k}`;
            return (
              <Link key={k} href={`${base}/${k}`} className="pill hov" style={{ height: 56, padding: "0 24px", background: active ? "var(--cream)" : "var(--card)", color: active ? "var(--card)" : "var(--cream)", display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 15 }}>
                {view === "detailed" && <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.6 }}>0{i + 1}</span>}
                {game ? GAME_LABELS[k] ?? label : label}
              </Link>
            );
          })}
          <div role="group" aria-label="Game mode" className="game-toggle" style={{ marginLeft: "auto", display: "flex", height: 40, padding: 3, borderRadius: 999, background: "var(--card)", fontSize: 13, fontWeight: 600 }}>
            {([false, true] as const).map((on) => (
              <button key={String(on)} onClick={() => game !== on && setGame(on)} aria-pressed={game === on} title={on ? "Points, combos, stars and badges" : "Regular practice mode"}
                style={{ border: 0, cursor: "pointer", padding: "0 13px", borderRadius: 999, background: game === on ? "var(--accent)" : "transparent", color: game === on ? "var(--on-accent)" : "var(--steel)", transition: "background-color .15s" }}>
                {on ? "Game" : "Standard"}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Dashboard view" style={{ display: "flex", height: 40, padding: 3, borderRadius: 999, background: "var(--card)", fontSize: 13, fontWeight: 600 }}>
            {(["simple", "detailed"] as const).map((v) => (
              <button key={v} onClick={() => view !== v && setView(v)} aria-pressed={view === v} title={v === "simple" ? "Just what you need to practise" : "Full engineering dashboard"}
                style={{ border: 0, cursor: "pointer", padding: "0 13px", borderRadius: 999, background: view === v ? "var(--cream)" : "transparent", color: view === v ? "var(--card)" : "var(--steel)", transition: "background-color .15s" }}>
                {v === "simple" ? "Simple" : "Detailed"}
              </button>
            ))}
          </div>
          {game && (
            <div className="rank-chip" title={rank.next ? `${rank.span - rank.into} XP to ${rank.next}` : "Top rank"} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 104 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, fontWeight: 700 }}><span>{rank.name}</span><span className="mono muted">{xp} XP</span></div>
              <div style={{ height: 8, borderRadius: 999, background: "var(--pill)", overflow: "hidden" }}><div style={{ width: `${Math.round(rank.pct * 100)}%`, height: "100%", background: "linear-gradient(90deg,var(--accent),var(--steel))", transition: "width .6s" }} /></div>
            </div>
          )}
          <Link href="/profiles" className="hov" style={{ display: "flex", alignItems: "center", gap: 14 }} title="Switch profile">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                {profile.name}
                {profile.demo && <span className="demo">DEMO</span>}
              </span>
              <span className="mono muted" style={{ fontSize: 12 }}>{profile.id}</span>
            </div>
            <div className="head" style={{ position: "relative", width: 60, height: 60, borderRadius: "50%", background: "var(--accent-dark)", display: "grid", placeItems: "center", fontSize: 18 }}>
              {initials}
              <span className="mono" style={{ position: "absolute", top: -2, right: -4, height: 22, minWidth: 22, padding: "0 6px", borderRadius: 999, background: "var(--accent)", border: "2px solid var(--bg)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600 }}>
                L{profile.level}
              </span>
            </div>
          </Link>
        </header>

        {view === "simple" ? <div aria-hidden /> : <aside style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", paddingTop: 96, position: "sticky", top: 24, alignSelf: "start" }}>
          {rail.map(([k, title, dot]) => (
            <div key={k} title={title} className="mono" style={{ position: "relative", width: 56, height: 56, borderRadius: "50%", background: "var(--card)", display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 600 }}>
              {k}
              <span style={{ position: "absolute", top: 4, right: 4, width: 9, height: 9, borderRadius: "50%", background: dot, border: "2px solid var(--card)" }} />
            </div>
          ))}
          <div className="mono muted" style={{ fontSize: 10, lineHeight: 1.4, textAlign: "center" }}>{dist}<br />cm</div>
          <button onClick={newSession} title="New session" className="btn btn-accent" style={{ marginTop: 24, width: 56, height: 56, justifyContent: "center", fontSize: 28, fontWeight: 300, padding: 0 }}>
            +
          </button>
        </aside>}

        <main style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>{children}</main>
      </div>
    </Ctx.Provider>
  );
}
