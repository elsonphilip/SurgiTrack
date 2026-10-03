"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

interface LiveCtx {
  haptic: boolean;
  setHaptic: (v: boolean) => void;
  dist: string;
  setDist: (v: string) => void;
  startSignal: number;
}
const Ctx = createContext<LiveCtx | null>(null);
export const useLive = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLive outside Shell");
  return c;
};

const NAV = [
  ["live", "Live Session"],
  ["progress", "Progress"],
  ["sessions", "Sessions"],
  ["leaderboard", "Leaderboard"],
  ["scoring", "Scoring"],
] as const;

export function Shell({
  profile,
  children,
}: {
  profile: { id: string; name: string; level: number; demo: boolean };
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [haptic, setHaptic] = useState(false);
  const [dist, setDist] = useState("14.2");
  const [startSignal, setStartSignal] = useState(0);
  const base = `/p/${profile.id}`;
  const ctx = useMemo(() => ({ haptic, setHaptic, dist, setDist, startSignal }), [haptic, dist, startSignal]);

  const newSession = useCallback(() => {
    if (path === `${base}/live`) setStartSignal((n) => n + 1);
    else router.push(`${base}/live?new=1`);
  }, [path, base, router]);

  const initials = profile.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  // No hardware is connected yet: the feed is simulated, so status dots are dim rather than "ok".
  const dim = "rgba(242,232,213,.25)";
  const rail = [
    ["R4", "Arduino R4 WiFi (simulated)", dim],
    ["IMU", "BMI270 (simulated)", dim],
    ["HPT", "DRV2605L haptic (simulated)", haptic ? "var(--accent)" : dim],
    ["CAM", "Pi Camera (simulated)", dim],
    ["SR04", "HC-SR04 distance (simulated)", dim],
  ];

  return (
    <Ctx.Provider value={ctx}>
      <div style={{ minHeight: "100vh", padding: "24px clamp(16px,2.4vw,32px) 40px", display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: "20px 28px", alignContent: "start" }}>
        <Link href="/profiles" title="All profiles" className="hov" style={{ width: 64, height: 64, borderRadius: "50%", background: "#FFFFFF", overflow: "hidden", display: "grid", placeItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SurgiTrack" style={{ width: "92%", height: "auto", display: "block" }} />
        </Link>

        <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          {NAV.map(([k, label], i) => {
            const active = path === `${base}/${k}`;
            return (
              <Link key={k} href={`${base}/${k}`} className="pill hov" style={{ height: 56, padding: "0 24px", background: active ? "var(--cream)" : "var(--card)", color: active ? "var(--card)" : "var(--cream)", display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 15 }}>
                <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.6 }}>0{i + 1}</span>
                {label}
              </Link>
            );
          })}
          <Link href="/profiles" className="hov" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }} title="Switch profile">
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

        <aside style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", paddingTop: 96, position: "sticky", top: 24, alignSelf: "start" }}>
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
        </aside>

        <main style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>{children}</main>
      </div>
    </Ctx.Provider>
  );
}
