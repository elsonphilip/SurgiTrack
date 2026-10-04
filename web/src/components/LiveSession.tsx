"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LEVELS } from "@/lib/scoring";
import { coachingTip, gradeWord, smoothWord, tremorWord } from "@/lib/coach";
import { defaultPath, getPath, pathsForLevel, samplePath, type PathDef } from "@/lib/paths";
import type { RawSample } from "@/lib/types";
import { saveSimulatedSession } from "@/app/actions";
import { useLive } from "./Shell";
import { BleedLines, CardHead, Stat } from "./ui";

/*
 * Live Session screen. The sensor feed here is SIMULATED (ported from the design prototype):
 * sessions it records are saved as source:"synthetic" and never count toward a real profile.
 * To go live, replace `simulate()` with samples from the tracker WebSocket (IMU, fingertip px, distance).
 */

const W = 960, H = 480, PX = 8; // canvas logical size; 8 px = 1 mm
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const rnd = () => Math.random() - 0.5;
const pad = (s: string | number, n: number) => String(s).padStart(n, " ");

type Phase = "idle" | "calib" | "run" | "done";
interface Live { acc: string; dev: string; trem: string; smooth: string; time: string; pct: number; pulses: number }
const EMPTY: Live = { acc: "--", dev: "--", trem: "--", smooth: "--", time: "0.0", pct: 0, pulses: 0 };
interface Result {
  id: string; score: number; samples: number; counted: boolean; isBest: boolean; prevBest: number; promoted: boolean;
  acc: number; dev: number; trem: number; smooth: number; time: number; pulses: number;
  screening?: { tremorProbability: number }; demo?: boolean;
}
export interface LastSession { acc: number; dev: number; trem: number; smooth: number }
interface Settings { sessionLength: number; traceStyle: "heat" | "mono"; showTolerance: boolean; showCamera: boolean; pathId: string; source: "sim" | "pi"; piUrl: string }
const DEFAULTS: Settings = { sessionLength: 12, traceStyle: "heat", showTolerance: true, showCamera: true, pathId: "", source: "sim", piUrl: "ws://localhost:8765" };

/** "" = the level's original design path, "shuffle" = random path from the level each run, else a path id. */
function resolvePath(level: number, pathId: string, avoidId?: string): PathDef {
  if (pathId === "shuffle") {
    const all = pathsForLevel(level), pool = all.filter((p) => p.id !== avoidId);
    const list = pool.length ? pool : all;
    return list[Math.floor(Math.random() * list.length)];
  }
  const p = pathId ? getPath(pathId) : undefined;
  return p && p.level === level ? p : defaultPath(level);
}
function cachePath(r: { settings: Settings; path: PathDef; pts: number[][] }, level: number) {
  r.path = resolvePath(level, r.settings.pathId, r.path.id);
  r.pts = samplePath(r.path, 320);
}

/** Send a command to the tracker (docs/PROTOCOL.md) if connected. */
function piSend(r: { ws: WebSocket | null }, m: object) {
  if (r.ws && r.ws.readyState === 1) r.ws.send(JSON.stringify(m));
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: "1 1 160px", background: "var(--pill)", borderRadius: 20, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 13, color: "var(--steel)", fontWeight: 600 }}>{label}</span>
      <span className="head" style={{ fontSize: 30, lineHeight: 1.15 }}>{value}</span>
      {sub && <span style={{ fontSize: 12.5, color: "rgba(166,202,200,.7)" }}>{sub}</span>}
    </div>
  );
}

const CAL = [
  { title: "Strap on the wristband", body: "Fit the band snug just above the wrist bone on your instrument hand, IMU facing up. The Arduino light turns blue once data streams.", btn: "Wristband is on" },
  { title: "Neutral position", body: "Rest your forearm on the pad, palm down, fingers relaxed as if holding a scalpel. This orientation becomes your zero.", btn: "Capture orientation" },
  { title: "Stay completely still", body: "Recording your resting noise floor. Tremor is scored relative to this baseline — breathe normally, don’t move." },
  { title: "Baseline established", body: "Orientation and noise floor saved for this session.", btn: "Begin training" },
];
const CAL_LABELS = ["Wristband on", "Neutral position", "Hold still · 5 s", "Baseline locked"];
const IMU_K = ["ax g", "ay g", "az g", "gx °/s", "gy °/s", "gz °/s"];
const OFF = "rgba(166,202,200,.08)";

function imuSample(a: number) {
  return [0.01 + rnd() * 0.08 * a, -0.02 + rnd() * 0.08 * a, 0.998 + rnd() * 0.01, rnd() * 12 * a, rnd() * 12 * a, rnd() * 6 * a];
}
function line(vals: number[], w: number, h: number, mn: number, mx: number) {
  if (vals.length < 2) return "";
  return "M" + vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)} ${(h - ((v - mn) / (mx - mn)) * h).toFixed(1)}`).join(" L");
}

interface Props {
  profileId: string;
  startLevel: number;
  nextId: number;
  last: LastSession | null;
  autoStart: boolean;
}

export function LiveSession({ profileId, startLevel, nextId, last, autoStart }: Props) {
  const router = useRouter();
  const { setHaptic, setDist, startSignal, view } = useLive();
  const simple = view === "simple";
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [phase, setPhaseS] = useState<Phase>(autoStart ? "calib" : "idle");
  const [calStep, setCalStep] = useState(0);
  const [calCount, setCalCount] = useState(5);
  const [level, setLevelS] = useState(Math.min(Math.max(startLevel, 1), 5));
  const [live, setLive] = useState<Live>(EMPTY);
  const [imu, setImu] = useState([0, 0, 1, 0, 0, 0]);
  const [spec, setSpec] = useState<number[]>(Array(14).fill(8));
  const [hx, setHx] = useState<number[]>([]);
  const [hy, setHy] = useState<number[]>([]);
  const [hapticOn, setHapticOn] = useState(false);
  const [noise, setNoise] = useState("0.000");
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [piStatus, setPiStatus] = useState<"off" | "online" | "offline">("off");
  const [piSim, setPiSim] = useState(false);
  const [piCamera, setPiCamera] = useState(false);
  const [video, setVideo] = useState<string | null>(null);
  const [handLost, setHandLost] = useState(false);
  const [activePath, setActivePath] = useState(defaultPath(Math.min(Math.max(startLevel, 1), 5)).id);

  const cv = useRef<HTMLCanvasElement>(null);
  const R = useRef({
    phase: (autoStart ? "calib" : "idle") as Phase, level, calStep: 0, trace: [] as [number, number, boolean][], pts: [] as number[][], path: defaultPath(Math.min(Math.max(startLevel, 1), 5)),
    acc: { n: 0, in: 0, dev: 0, tr: 0, pulses: 0 }, wasOut: false, hapUntil: 0, t0: 0, m0: 0, lastUi: 0,
    hx: [] as number[], hy: [] as number[], raw: [] as RawSample[], settings: DEFAULTS, mode: "sim" as "sim" | "pi", ws: null as WebSocket | null, cursor: null as [number, number] | null, ct: 0 as unknown as ReturnType<typeof setInterval>,
  });

  const setPhase = (p: Phase) => { R.current.phase = p; setPhaseS(p); };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("surgitrack.settings");
      if (raw) {
        const merged = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
        R.current.settings = merged;
        cachePath(R.current, R.current.level);
        /* eslint-disable react-hooks/set-state-in-effect -- syncing from localStorage after mount (SSR-safe) */
        setSettings(merged);
        setActivePath(R.current.path.id);
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {}
  }, []);
  useEffect(() => {
    R.current.settings = settings;
    try { localStorage.setItem("surgitrack.settings", JSON.stringify(settings)); } catch {}
  }, [settings]);

  const finish = useCallback(async (el: number) => {
    const r = R.current, A = r.acc;
    const accuracy = Math.round((A.in / A.n) * 1000) / 10;
    const trem = Math.round(clamp(Math.sqrt(A.tr / A.n) * 7.5, 0, 10) * 10) / 10;
    const smooth = Math.round(clamp(100 - trem * 6 - (1 - accuracy / 100) * 40, 0, 100));
    const dev = Math.round((A.dev / A.n) * 100) / 100;
    const time = Math.round(el * 10) / 10;
    const metrics = { accuracy, avgDeviationMm: dev, tremor: trem, smoothness: smooth, completionTimeS: time, hapticPulses: A.pulses };
    r.phase = "done";
    setPhaseS("done");
    setHapticOn(false);
    setHaptic(false);
    setSaving(true);
    setError(null);
    try {
      const res = await saveSimulatedSession({ userId: profileId, level: r.level, pathId: r.path.id, metrics, baseline: { pitch: 2.1, roll: -1.4, noiseSigma: 0.018 }, raw: r.raw });
      setResult({ ...res, acc: accuracy, dev, trem, smooth, time, pulses: A.pulses });
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "Could not save session");
      setResult(null);
    } finally {
      setSaving(false);
    }
  }, [profileId, router, setHaptic]);

  const startRun = () => {
    const r = R.current;
    r.trace = []; r.raw = []; r.acc = { n: 0, in: 0, dev: 0, tr: 0, pulses: 0 }; r.wasOut = false; r.t0 = performance.now();
    setResult(null); setError(null);
    setPhase("run");
  };
  const startCalib = useCallback(() => {
    clearInterval(R.current.ct);
    R.current.trace = [];
    R.current.calStep = 0;
    if (R.current.mode === "pi") {
      const r = R.current;
      if (r.settings.pathId === "shuffle") { cachePath(r, r.level); setActivePath(r.path.id); }
      piSend(r, { cmd: "set", userId: profileId, level: r.level, pathId: r.path.id, sessionLength: r.settings.sessionLength });
      piSend(r, { cmd: "calibrate" });
      setResult(null); setError(null);
      return;
    }
    if (R.current.settings.pathId === "shuffle") { cachePath(R.current, R.current.level); setActivePath(R.current.path.id); }
    setCalStep(0); setCalCount(5); setResult(null); setError(null); setLive(EMPTY);
    R.current.phase = "calib"; setPhaseS("calib");
  }, [profileId]);
  const calNext = () => {
    if (R.current.mode === "pi") { piSend(R.current, { cmd: "calib_next" }); return; }
    const s = calStep;
    if (s === 0) { setCalStep(1); R.current.calStep = 1; }
    else if (s === 1) {
      setCalStep(2); R.current.calStep = 2; setCalCount(5);
      let c = 5;
      clearInterval(R.current.ct);
      R.current.ct = setInterval(() => {
        c -= 1;
        if (c <= 0) { clearInterval(R.current.ct); setCalStep(3); R.current.calStep = 3; setCalCount(0); }
        else setCalCount(c);
      }, 1000);
    } else if (s === 3) startRun();
  };
  const cancel = () => {
    if (R.current.mode === "pi") { piSend(R.current, { cmd: "stop" }); return; }
    clearInterval(R.current.ct);
    R.current.trace = [];
    setPhase("idle"); setLive(EMPTY);
  };
  const setLevel = (l: number) => {
    if (R.current.phase === "run") return;
    R.current.level = l; cachePath(R.current, l); R.current.trace = [];
    setLevelS(l); setActivePath(R.current.path.id);
    if (R.current.mode === "pi") piSend(R.current, { cmd: "set", userId: profileId, level: l, pathId: R.current.path.id });
    if (R.current.phase === "done") setPhase("idle");
  };

  // "+" in the rail / ?new=1
  const firstSignal = useRef(startSignal);
  useEffect(() => {
    if (startSignal !== firstSignal.current) { firstSignal.current = startSignal; startCalib(); }
  }, [startSignal, startCalib]);

  // Python tracker data source: the tracker (tracker/server.py) streams frames + state over a WebSocket.
  useEffect(() => {
    const r = R.current;
    if (settings.source !== "pi") return;
    r.mode = "pi";
    let ws: WebSocket | null = null, closed = false, retry: ReturnType<typeof setTimeout> | undefined;
    const handle = (m: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (m.type === "hello") {
        setPiStatus("online"); setPiSim(!!m.simulated); setPiCamera(!!m.camera);
        piSend(r, { cmd: "set", userId: profileId, level: r.level, pathId: r.path.id, sessionLength: r.settings.sessionLength });
      } else if (m.type === "state") {
        r.calStep = m.calStep; setCalStep(m.calStep); setCalCount(m.calCount); setNoise(Number(m.noise).toFixed(3));
        if (m.phase !== r.phase) {
          if (m.phase === "run") { r.trace = []; setResult(null); setError(null); }
          if (m.phase === "idle") { r.trace = []; setLive(EMPTY); }
          if (m.phase === "done") setSaving(true);
          setPhase(m.phase);
        }
        if (m.level !== r.level) { r.level = m.level; setLevelS(m.level); }
        const p = getPath(m.pathId);
        if (p && p.id !== r.path.id) { r.path = p; r.pts = samplePath(p, 320); setActivePath(p.id); }
      } else if (m.type === "frame") {
        setImu(m.imu); setSpec(m.spec);
        r.hx = [...r.hx, m.imu[0]].slice(-60); r.hy = [...r.hy, m.imu[1]].slice(-60);
        setHx(r.hx); setHy(r.hy);
        if (m.dist != null) setDist(Number(m.dist).toFixed(1));
        setHapticOn(!!m.haptic); setHaptic(!!m.haptic);
        r.cursor = m.finger ? [m.finger[0] * PX, m.finger[1] * PX] : null;
        setHandLost(!m.finger);
        if (m.phase === "run") {
          setLive({ acc: m.acc == null ? "--" : String(Math.round(m.acc)), dev: m.dev == null ? "--" : Number(m.dev).toFixed(1), trem: Number(m.trem).toFixed(1), smooth: String(m.smooth), time: Number(m.time).toFixed(1), pct: m.pct, pulses: m.pulses });
          if (m.finger && r.trace.length < 5000) r.trace.push([m.finger[0] * PX, m.finger[1] * PX, !!m.out]);
        }
      } else if (m.type === "result") {
        setSaving(false);
        if (m.uploaded) {
          const x = m.metrics;
          setResult({ id: m.session.id, score: m.session.score, samples: m.samples, counted: !!m.counted, isBest: !!m.isBest, prevBest: m.prevBest ?? 0, promoted: !!m.promoted,
            acc: x.accuracy, dev: x.avgDeviationMm, trem: x.tremor, smooth: x.smoothness, time: x.completionTimeS, pulses: x.hapticPulses, screening: m.screening ?? undefined, demo: !!m.simulated });
          setError(null);
          router.refresh();
        } else setError(m.error || "Session was not saved");
      } else if (m.type === "video") setVideo(m.jpeg);
      else if (m.type === "error") setError(m.message);
    };
    const connect = () => {
      try { ws = new WebSocket(settings.piUrl); } catch { setPiStatus("offline"); return; }
      r.ws = ws;
      ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch {} };
      ws.onclose = () => { r.ws = null; setPiStatus("offline"); if (!closed) retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true; clearTimeout(retry); ws?.close();
      r.ws = null; r.mode = "sim"; r.phase = "idle"; r.trace = []; r.cursor = null;
      setPiStatus("off"); setVideo(null); setHandLost(false); setPhaseS("idle"); setLive(EMPTY); setHapticOn(false); setHaptic(false);
    };
  }, [settings.source, settings.piUrl, profileId, router, setHaptic, setDist]);

  // Main loop: simulate sensors + draw.
  useEffect(() => {
    const r = R.current;
    r.level = level;
    cachePath(r, level);
    r.m0 = performance.now();
    let raf = 0;
    const sensors = (a: number) => {
      const s = imuSample(a);
      setImu(s);
      setSpec(Array.from({ length: 14 }, (_, i) => Math.min(100, 6 + Math.random() * 8 + Math.exp(-Math.pow((i + 1 - 8.6) / 1.2, 2)) * a * 170)));
      r.hx = [...r.hx, s[0]].slice(-60); r.hy = [...r.hy, s[1]].slice(-60);
      setHx(r.hx); setHy(r.hy);
      setDist((14.2 + rnd() * 0.3).toFixed(1));
      if (r.phase === "calib" && r.calStep === 2) setNoise((0.018 + rnd() * 0.004).toFixed(3));
    };

    const draw = (now: number) => {
      const c = cv.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#181816"; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(90,164,214,.16)";
      for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) { g.beginPath(); g.arc(x, y, 1.4, 0, 7); g.fill(); }
      const tol = LEVELS[r.level - 1].toleranceMm, P = r.pts;
      const path = () => { g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); };
      g.lineCap = "round"; g.lineJoin = "round";
      if (r.settings.showTolerance) { path(); g.strokeStyle = "rgba(90,164,214,.24)"; g.lineWidth = tol * 2 * PX; g.stroke(); }
      path(); g.setLineDash([7, 8]); g.strokeStyle = "rgba(166,202,200,.55)"; g.lineWidth = 1.6; g.stroke(); g.setLineDash([]);
      const s = P[0], f = P[P.length - 1];
      g.fillStyle = "#5AA4D6"; g.beginPath(); g.arc(s[0], s[1], 8, 0, 7); g.fill();
      g.strokeStyle = "#A6CAC8"; g.lineWidth = 3; g.beginPath(); g.arc(f[0], f[1], 8, 0, 7); g.stroke();
      const T = r.trace, heat = r.settings.traceStyle === "heat";
      g.lineWidth = 2.6;
      for (let i = 1; i < T.length; i++) {
        g.strokeStyle = heat && T[i][2] ? "#E3A857" : "#A6CAC8";
        g.beginPath(); g.moveTo(T[i - 1][0], T[i - 1][1]); g.lineTo(T[i][0], T[i][1]); g.stroke();
      }
      if (r.mode === "pi" && r.cursor && r.phase !== "run") { // live fingertip, so you can line up with the start point
        g.strokeStyle = "#5AA4D6"; g.lineWidth = 3; g.beginPath(); g.arc(r.cursor[0], r.cursor[1], 11, 0, 7); g.stroke();
        g.fillStyle = "#5AA4D6"; g.beginPath(); g.arc(r.cursor[0], r.cursor[1], 3, 0, 7); g.fill();
      }
      if (T.length && r.phase === "run") {
        const p = T[T.length - 1], hot = now < r.hapUntil;
        if (hot) { const rr = 12 + ((now / 12) % 24); g.strokeStyle = `rgba(61,133,113,${1 - (rr - 12) / 24})`; g.lineWidth = 3; g.beginPath(); g.arc(p[0], p[1], rr, 0, 7); g.stroke(); }
        g.fillStyle = hot ? "#3D8571" : "#A6CAC8"; g.beginPath(); g.arc(p[0], p[1], 7, 0, 7); g.fill();
      }
    };

    const tick = () => {
      const now = performance.now(), e = (now - r.m0) / 1000, tol = LEVELS[r.level - 1].toleranceMm;
      if (r.mode === "pi") {
        // frames arrive over the WebSocket; nothing to simulate
      } else if (r.phase === "run") {
        const len = r.settings.sessionLength;
        const el = (now - r.t0) / 1000, tt = Math.min(1, el / len);
        const [tx, ty] = r.path.at(tt);
        const slip = Math.exp(-Math.pow((tt - 0.56) / 0.035, 2)) * tol * 1.9;
        const burst = Math.sin(e * 0.8) > 0.8 ? 3.2 : 1, trAmp = 0.35 * burst;
        const dx = Math.sin(e * 0.9) * 0.7 + Math.sin(e * 2.3 + 1) * 0.45 + slip + Math.sin(e * 2 * Math.PI * 8.6) * trAmp;
        const dy = Math.cos(e * 1.1) * 0.6 + Math.sin(e * 1.7) * 0.4 + slip * 0.6 + Math.cos(e * 2 * Math.PI * 8.6 + 0.6) * trAmp;
        const x = tx + dx * PX, y = ty + dy * PX;
        let md = 1e9;
        for (const p of r.pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < md) md = d; }
        const devNow = Math.sqrt(md) / PX, out = devNow > tol;
        r.trace.push([x, y, out]);
        const A = r.acc;
        A.n++; if (!out) A.in++; A.dev += devNow; A.tr += (trAmp * 0.707) ** 2;
        if (out && !r.wasOut) A.pulses++;
        r.wasOut = out;
        if (out) r.hapUntil = now + 260;
        if (r.raw.length < 20000) {
          const s = imuSample(trAmp);
          r.raw.push({ t: +el.toFixed(3), ax: +s[0].toFixed(4), ay: +s[1].toFixed(4), az: +s[2].toFixed(4), gx: +s[3].toFixed(3), gy: +s[4].toFixed(3), gz: +s[5].toFixed(3), camX: +(x / PX).toFixed(2), camY: +(y / PX).toFixed(2), distCm: 14.2 });
        }
        if (tt >= 1) { void finish(el); draw(now); raf = requestAnimationFrame(tick); return; }
        if (now - r.lastUi > 120) {
          r.lastUi = now;
          const acc = (A.in / A.n) * 100, trem = clamp(Math.sqrt(A.tr / A.n) * 7.5, 0, 10);
          setLive({ acc: acc.toFixed(0), dev: devNow.toFixed(1), trem: trem.toFixed(1), smooth: String(Math.round(clamp(100 - trem * 6 - (1 - acc / 100) * 40, 0, 100))), time: el.toFixed(1), pct: Math.round(tt * 100), pulses: A.pulses });
          const hot = now < r.hapUntil;
          setHapticOn(hot); setHaptic(hot);
          sensors(trAmp);
        }
      } else if (now - r.lastUi > 150) {
        r.lastUi = now;
        sensors(r.phase === "calib" ? 0.12 : 0.25);
      }
      draw(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearInterval(r.ct); setHaptic(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- derived UI ----
  const lv = LEVELS[level - 1];
  const phaseLabel = { idle: "ready", calib: "calibrating", run: "recording", done: "complete" }[phase];
  const primaryLabel = (simple ? { idle: "Start practice", calib: "Cancel", run: "Stop", done: "Practice again" } : { idle: "Calibrate & start", calib: "Cancel", run: "Stop", done: "New session" })[phase];
  const steel = "#5AA4D6", bad = "#E3A857";
  const trend = (v: string, ref: number | undefined, hi: boolean, d = 1) => {
    if (v === "--" || ref === undefined) return { text: ref === undefined && v !== "--" ? "first session" : "▲ vs last", color: steel };
    const up = +v >= ref, good = hi ? up : !up;
    return { text: `${up ? "▲ " : "▼ "}${Math.abs(+v - ref).toFixed(d)} vs last`, color: good ? steel : bad };
  };
  const pk = spec.indexOf(Math.max(...spec)) + 1;
  const specCols = spec.map((h, i) => ({
    lit: Math.max(1, Math.round((h / 100) * 6)),
    color: i + 1 === pk && h > 40 ? "#3D8571" : i >= 3 && i <= 11 ? "#5AA4D6" : "#A6CAC8",
  }));
  const lcd1 = ("SCR " + pad(phase === "done" && result ? result.score : "--", 3) + " ACC" + pad(live.acc, 3) + "%").padEnd(16).slice(0, 16);
  const lcd2 = ("TRM" + pad(live.trem, 4) + " DEV" + pad(live.dev, 4)).padEnd(16).slice(0, 16);
  const cal = CAL[calStep];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "8px 0 4px" }}>
        <h1 className="head" style={{ margin: 0, fontSize: "clamp(34px,4vw,52px)", lineHeight: 1, letterSpacing: "-.01em" }}>{simple ? "Practice" : "Live Session"}</h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="ctl" onClick={() => setLevel(level % (simple ? Math.max(1, startLevel) : 5) + 1)} disabled={phase === "run" || (simple && startLevel <= 1)} title={simple ? (startLevel <= 1 ? "Reach a score of 75 three times to unlock the next exercise" : "Switch exercise") : undefined}>
            <span className="muted">{simple ? "Exercise:" : "Level:"}</span><b>{simple ? `${lv.name} (level ${level})` : `L${level} ${lv.name}`}</b>{(!simple || startLevel > 1) && <span className="muted" style={{ fontSize: 11 }}>▾</span>}
          </button>
          <div className="ctl" title={simple ? "How far you can drift from the line before the band buzzes" : undefined}><span className="muted">{simple ? "Allowed wobble:" : "Tolerance:"}</span><b>±{lv.toleranceMm} mm</b></div>
          <button className="btn btn-accent" disabled={settings.source === "pi" && piStatus !== "online"} onClick={() => (phase === "idle" || phase === "done" ? startCalib() : cancel())}>{primaryLabel}</button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "stretch" }}>
        <div className="card" style={{ flex: "2.4 1 560px", minWidth: 0, paddingBottom: 28, display: "flex", flexDirection: "column", gap: 18, ...(simple ? { maxWidth: 1040, width: "100%", margin: "0 auto" } : {}) }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
              <span className="card-title">Path trace</span>
              <span className="mono muted" style={{ fontSize: 12 }}>{simple ? phaseLabel.charAt(0).toUpperCase() + phaseLabel.slice(1) : `${phaseLabel} · session #${nextId}`}{activePath !== defaultPath(level).id && ` · ${getPath(activePath)?.name ?? ""}`}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {settings.source === "pi" ? (
                <span className="chip" title={piStatus === "online" ? (piSim ? "Tracker is using its simulated rig" : "Live from the tracker") : "Tracker not reachable — start it with: python server.py (in the tracker folder)"} style={{ color: piStatus === "online" ? steel : "var(--warn)" }}>
                  {piStatus === "online" ? (piSim ? "TRACKER · SIMULATED" : "TRACKER · LIVE") : "PI · OFFLINE"}
                </span>
              ) : (
                <span className="chip" title="No hardware connected — sensor data is generated in the browser" style={{ color: steel }}>SIMULATED</span>
              )}
              <span className="chip">{live.time}s</span>
              <span className="chip" style={{ background: hapticOn ? "var(--accent)" : "var(--pill)", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: hapticOn ? "var(--cream)" : steel }} />haptic × {live.pulses}
              </span>
            </div>
          </div>

          {simple && phase === "idle" && (
            <ol style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: 0, padding: 0, listStyle: "none", fontSize: 14 }}>
              {["Put on the wristband", "Hold still for 5 seconds", "Trace the dashed line — stay inside the band"].map((t, i) => (
                <li key={t} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--pill)", borderRadius: 999, padding: "6px 16px 6px 6px" }}>
                  <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--cream)", color: "var(--card)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>{i + 1}</span>{t}
                </li>
              ))}
            </ol>
          )}
          {settings.source === "pi" && piStatus === "online" && piCamera && handLost && phase !== "done" && (
            <div role="status" style={{ padding: "10px 16px", borderRadius: 16, background: "var(--pill)", color: "var(--warn)", fontSize: 13.5 }}>Can’t see your hand — keep it in view of the camera, palm toward it.</div>
          )}
          {error && phase !== "done" && (
            <div role="alert" style={{ padding: "10px 16px", borderRadius: 16, background: "var(--pill)", color: "var(--warn)", fontSize: 13.5 }}>{error}</div>
          )}
          <div style={{ position: "relative", borderRadius: 22, overflow: "hidden", background: "var(--canvas)" }}>
            <canvas ref={cv} style={{ display: "block", width: "100%", aspectRatio: "2/1" }} />
            {hapticOn && phase === "run" && (
              <div className="mono" style={{ position: "absolute", top: 16, right: 16, height: 34, padding: "0 16px", borderRadius: 999, background: "var(--accent)", display: "flex", alignItems: "center", fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em" }}>OFF PATH · VIBRATING</div>
            )}
            {phase === "idle" && !simple && (
              <div style={{ position: "absolute", left: 16, bottom: 16, maxWidth: "min(380px,calc(100% - 32px))", padding: "14px 20px", borderRadius: 20, background: "rgba(33,33,31,.94)", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Trace the dashed path.</div>
                <div style={{ fontSize: 13, color: "rgba(166,202,200,.75)", lineHeight: 1.45, textWrap: "pretty" }}>Stay inside the blue band. Leaving it vibrates the wristband. Calibration runs first.</div>
              </div>
            )}
            {phase === "calib" && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(24,24,22,.96)", display: "flex", flexWrap: "wrap", gap: "24px 36px", alignItems: "center", padding: "28px 32px", overflow: "auto" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "0 0 210px" }}>
                  {CAL_LABELS.map((label, i) => {
                    const done = i < calStep, act = i === calStep;
                    return (
                      <div key={label} style={{ height: 44, padding: "0 16px 0 6px", borderRadius: 999, background: act ? "var(--pill)" : "transparent", display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="mono" style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600, background: done ? steel : act ? "var(--cream)" : "var(--pill)", color: done || act ? "var(--card)" : "rgba(166,202,200,.55)" }}>{done ? "✓" : i + 1}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: done || act ? "var(--cream)" : "rgba(166,202,200,.55)" }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 260px", maxWidth: 420 }}>
                  <div className="head" style={{ fontSize: 30, lineHeight: 1.05 }}>{cal.title}</div>
                  <div style={{ fontSize: 14.5, lineHeight: 1.5, color: "rgba(166,202,200,.8)", textWrap: "pretty" }}>{cal.body}</div>
                  {calStep === 2 && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                      <span className="head" style={{ fontSize: 80, lineHeight: 1 }}>{calCount}</span>
                      <span className="mono muted" style={{ fontSize: 12 }}>noise σ {noise} g</span>
                    </div>
                  )}
                  {calStep === 3 && (
                    <div className="mono" style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, fontWeight: 500 }}>
                      {[["pitch", "+2.1°"], ["roll", "−1.4°"], ["noise", "0.018 g"]].map(([k, v]) => (
                        <span key={k} style={{ height: 34, padding: "0 14px", borderRadius: 999, background: "var(--pill)", display: "flex", alignItems: "center", gap: 8 }}><span className="muted">{k}</span>{v}</span>
                      ))}
                    </div>
                  )}
                  {"btn" in cal && cal.btn && (
                    <button className="btn btn-cream" onClick={calNext} style={{ alignSelf: "flex-start", height: 48, padding: "0 24px", fontSize: 14 }}>{cal.btn}</button>
                  )}
                </div>
              </div>
            )}
            {phase === "done" && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(24,24,22,.96)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "24px 44px", padding: "28px 36px", overflow: "auto" }}>
                {saving && <div className="mono muted" style={{ fontSize: 13 }}>Saving session…</div>}
                {error && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ color: bad, fontSize: 14.5 }}>Could not save this session: {error}</div>
                    <button className="btn btn-cream" onClick={startCalib} style={{ alignSelf: "flex-start", height: 46, padding: "0 22px", fontSize: 14 }}>Run again</button>
                  </div>
                )}
                {result && simple && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span className="head muted" style={{ fontSize: 18 }}>Your score</span>
                      <span className="head" style={{ fontSize: 112, lineHeight: 0.9 }}>{result.score}</span>
                      <span className="head" style={{ fontSize: 24 }}>{gradeWord(result.score)}</span>
                      {result.promoted && <span style={{ alignSelf: "flex-start", padding: "4px 14px", borderRadius: 999, background: "var(--cream)", color: "var(--card)", fontWeight: 700, fontSize: 13 }}>New exercise unlocked!</span>}
                      {result.counted && result.isBest && !result.promoted && <span style={{ alignSelf: "flex-start", padding: "4px 14px", borderRadius: 999, background: "var(--accent)", fontWeight: 700, fontSize: 13 }}>New personal best</span>}
                      {!result.counted && <span style={{ alignSelf: "flex-start", padding: "4px 14px", borderRadius: 999, background: "var(--pill)", fontSize: 12.5 }}>{result.demo === false ? "Not counted toward your progress" : "Practice run (simulated sensors) — not counted"}</span>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "1 1 300px", maxWidth: 520 }}>
                      {[
                        ["Stayed on the path", `${result.acc}%`, `You were within ${lv.toleranceMm} mm of the line ${result.acc}% of the time.`],
                        ["Hand tremor", tremorWord(result.trem), `${result.trem} out of 10 — lower is better.`],
                        ["Smoothness", smoothWord(result.smooth), `${result.smooth} out of 100 — higher is smoother.`],
                      ].map(([k, v, d]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, borderBottom: "1px solid var(--pill)", paddingBottom: 8 }}>
                          <div><div style={{ fontWeight: 700, fontSize: 15 }}>{k}</div><div style={{ fontSize: 13, color: "rgba(166,202,200,.7)" }}>{d}</div></div>
                          <div className="head" style={{ fontSize: 20, whiteSpace: "nowrap" }}>{v}</div>
                        </div>
                      ))}
                      <div style={{ fontSize: 14, lineHeight: 1.45 }}>{coachingTip(result.acc, result.trem, result.smooth)}</div>
                      {result.screening && (
                        <div style={{ fontSize: 12.5, color: "rgba(166,202,200,.75)" }}>Tremor screening signal: <b style={{ color: "var(--cream)" }}>{Math.round(result.screening.tremorProbability * 100)}%</b> — not a diagnosis.</div>
                      )}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button className="btn btn-cream" onClick={startCalib} style={{ height: 46, padding: "0 22px", fontSize: 14 }}>Practice again</button>
                        <button className="btn hov" onClick={() => router.push(`/p/${profileId}/progress`)} style={{ height: 46, padding: "0 22px", fontSize: 14, fontWeight: 600, background: "var(--pill)" }}>See my progress</button>
                      </div>
                    </div>
                  </>
                )}
                {result && !simple && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span className="head muted" style={{ fontSize: 18 }}>Session score</span>
                      <span className="head" style={{ fontSize: 128, lineHeight: 0.85 }}>{result.score}</span>
                      <span className="mono" style={{ alignSelf: "flex-start", height: 30, padding: "0 14px", borderRadius: 999, background: result.counted && result.isBest ? "var(--accent)" : "var(--pill)", display: "flex", alignItems: "center", fontSize: 11, fontWeight: 600, letterSpacing: ".04em" }}>
                        {!result.counted ? (result.demo === false ? "NOT COUNTED" : "SIMULATED · NOT COUNTED") : result.isBest ? "NEW PERSONAL BEST" : `BEST ${result.prevBest} · ${result.score - result.prevBest} PTS`}
                      </span>
                      {result.promoted && <span className="mono" style={{ alignSelf: "flex-start", height: 30, padding: "0 14px", borderRadius: 999, background: "var(--cream)", color: "var(--card)", display: "flex", alignItems: "center", fontSize: 11, fontWeight: 700 }}>LEVEL UP</span>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 280px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {[["Accuracy", `${result.acc}%`], ["Deviation", `${result.dev} mm`], ["Tremor", `${result.trem}/10`], ["Smoothness", String(result.smooth)], ["Time", `${result.time} s`], ["Haptic", `${result.pulses}×`]].map(([k, v], i) => (
                          <span key={k} style={{ height: 40, padding: "0 6px 0 16px", borderRadius: 999, background: "var(--pill)", display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                            <span className="muted">{k}</span>
                            <span className="mono" style={{ height: 30, padding: "0 12px", borderRadius: 999, background: i % 2 ? steel : "var(--cream)", color: "var(--card)", display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600 }}>{v}</span>
                          </span>
                        ))}
                      </div>
                      <div className="mono" style={{ fontSize: 11.5, color: "rgba(166,202,200,.6)" }}>
                        {result.demo === false ? "Saved to database" : "Saved as demo data (simulated feed)"} · session #{result.id} · {result.samples.toLocaleString()} IMU samples
                      </div>
                      {result.screening && (
                        <div style={{ fontSize: 12.5, color: "rgba(166,202,200,.75)" }} title="LightGBM screening over the session — a signal that may prompt a clinical evaluation, not a diagnosis">
                          Tremor screening signal: <b style={{ color: "var(--cream)" }}>{Math.round(result.screening.tremorProbability * 100)}%</b> · not a diagnosis
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 10 }}>
                        <button className="btn btn-cream" onClick={startCalib} style={{ height: 46, padding: "0 22px", fontSize: 14 }}>Run again</button>
                        <button className="btn hov" onClick={() => router.push(`/p/${profileId}/progress`)} style={{ height: 46, padding: "0 22px", fontSize: 14, fontWeight: 600, background: "var(--pill)" }}>View progress</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div style={{ height: 10, borderRadius: 999, background: "var(--pill)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${live.pct}%`, background: steel, borderRadius: 999 }} />
          </div>
          {simple && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <Tile label="On the line" value={live.acc === "--" ? "—" : `${live.acc}%`} sub="of the time inside the band" />
              <Tile label="Hand tremor" value={live.trem === "--" ? "—" : tremorWord(Number(live.trem))} sub={live.trem === "--" ? "lower is better" : `${live.trem} / 10`} />
              <Tile label="Smoothness" value={live.smooth === "--" ? "—" : smoothWord(Number(live.smooth))} sub={live.smooth === "--" ? "steady, controlled motion" : `${live.smooth} / 100`} />
              <Tile label="Buzzes" value={String(live.pulses)} sub="times you left the band" />
            </div>
          )}
        </div>

        {!simple && (
        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 22 }}>
          {settings.showCamera && (
            <div className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="card-title sm">Camera</span>
                <span className="mono" style={{ height: 26, padding: "0 10px", borderRadius: 999, background: "var(--accent)", display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cream)" }} />REC
                </span>
              </div>
              <div style={{ aspectRatio: "4/3", borderRadius: 20, background: "repeating-linear-gradient(135deg,#2C2C2A 0 10px,#363634 10px 20px)", display: "grid", placeItems: "center" }}>
                {video ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`data:image/jpeg;base64,${video}`} alt="Camera preview with hand landmarks" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 20 }} />
                ) : (
                  <span className="mono muted" style={{ fontSize: 11, lineHeight: 1.6, textAlign: "center" }}>camera feed<br />+ mediapipe landmarks</span>
                )}
              </div>
            </div>
          )}
          <div className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
            <span className="card-title sm">Wrist LCD</span>
            <div className="mono" style={{ background: steel, borderRadius: 16, padding: "14px 16px", fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: "var(--card)", whiteSpace: "pre", letterSpacing: ".06em", overflow: "hidden" }}>{lcd1}{"\n"}{lcd2}</div>
          </div>
        </div>
        )}
      </div>

      {!simple && (
      <>
      <div className="row">
        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, paddingBottom: 0, display: "flex", flexDirection: "column", gap: 18, overflow: "hidden" }}>
          <CardHead title="Precision" />
          <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
            <Stat value={`${live.acc}%`} label="Accuracy" trend={trend(live.acc, last?.acc, true)} />
            <Stat value={live.dev} label="Deviation, mm" trend={trend(live.dev, last?.dev, false)} />
          </div>
          <BleedLines lines={[{ path: line(hx, 300, 80, -0.09, 0.09), color: "#3D8571" }, { path: line(hy, 300, 80, -0.09, 0.09), color: "#5AA4D6" }]} />
        </div>

        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, paddingBottom: 0, display: "flex", flexDirection: "column", gap: 18, overflow: "hidden" }}>
          <CardHead title="Stability" right={<span className="mono muted" style={{ fontSize: 11 }}>peak {pk} Hz</span>} />
          <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
            <Stat value={live.trem} label="Tremor, /10" trend={trend(live.trem, last?.trem, false)} />
            <Stat value={live.smooth} label="Smoothness" trend={trend(live.smooth, last?.smooth, true, 0)} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 4, paddingBottom: 22 }}>
            {specCols.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column-reverse", gap: 6 }}>
                {Array.from({ length: 6 }, (_, j) => <span key={j} style={{ width: 11, height: 11, borderRadius: "50%", background: j < c.lit ? c.color : OFF }} />)}
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          <CardHead title="Wrist IMU" right={<span className="mono muted" style={{ fontSize: 11 }}>BMI270 · 100 Hz</span>} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
            {imu.map((v, i) => (
              <div key={i} style={{ height: 44, padding: "0 6px 0 16px", borderRadius: 999, background: "var(--pill)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span className="mono muted" style={{ fontSize: 11, fontWeight: 500 }}>{IMU_K[i]}</span>
                <span className="mono" style={{ height: 32, padding: "0 12px", borderRadius: 999, background: i < 3 ? "var(--cream)" : steel, color: "var(--card)", display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600 }}>{(v >= 0 ? "+" : "") + v.toFixed(i < 3 ? 3 : 2)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: "auto", fontSize: 13, fontWeight: 600, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: "50%", border: "3px solid #3D8571" }} />Accel X</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: "50%", border: "3px solid #5AA4D6" }} />Accel Y</span>
          </div>
        </div>
      </div>
      </>
      )}
      {!simple && (
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <details style={{ position: "relative", alignSelf: "flex-start" }}>
            <summary className="ctl" style={{ cursor: "pointer", listStyle: "none" }}><span className="muted">Settings</span> ▾</summary>
            <div style={{ position: "absolute", left: 0, bottom: 58, zIndex: 5, width: 280, background: "var(--card)", border: "1px solid var(--pill)", borderRadius: 20, padding: 18, display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                Data source
                <select value={settings.source} disabled={phase === "run"} onChange={(e) => setSettings((s) => ({ ...s, source: e.target.value as Settings["source"] }))}
                  style={{ height: 34, borderRadius: 999, border: 0, background: "var(--pill)", color: "var(--cream)", padding: "0 10px" }}>
                  <option value="sim">Simulator</option><option value="pi">Tracker (Python)</option>
                </select>
              </label>
              {settings.source === "pi" && (
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  Tracker address
                  <input type="text" value={settings.piUrl} disabled={phase === "run"} spellCheck={false} onChange={(e) => setSettings((s) => ({ ...s, piUrl: e.target.value }))}
                    style={{ width: 150, height: 34, borderRadius: 999, border: 0, background: "var(--pill)", color: "var(--cream)", padding: "0 12px" }} />
                </label>
              )}
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                Session length
                <input type="number" min={5} max={40} value={settings.sessionLength} disabled={phase === "run"}
                  onChange={(e) => setSettings((s) => ({ ...s, sessionLength: clamp(Number(e.target.value) || 12, 5, 40) }))}
                  className="mono" style={{ width: 70, height: 34, borderRadius: 999, border: 0, background: "var(--pill)", color: "var(--cream)", padding: "0 12px" }} />
              </label>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                Path
                <select
                  value={settings.pathId === "shuffle" || pathsForLevel(level).some((p) => p.id === settings.pathId) ? settings.pathId : ""}
                  disabled={phase === "run"}
                  onChange={(e) => {
                    const pathId = e.target.value;
                    R.current.settings = { ...R.current.settings, pathId };
                    cachePath(R.current, R.current.level); R.current.trace = [];
                    setActivePath(R.current.path.id);
                    setSettings((s) => ({ ...s, pathId }));
                  }}
                  style={{ maxWidth: 150, height: 34, borderRadius: 999, border: 0, background: "var(--pill)", color: "var(--cream)", padding: "0 10px" }}>
                  <option value="">Default</option>
                  <option value="shuffle">Shuffle each run</option>
                  {pathsForLevel(level).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                Trace style
                <select value={settings.traceStyle} onChange={(e) => setSettings((s) => ({ ...s, traceStyle: e.target.value as Settings["traceStyle"] }))}
                  style={{ height: 34, borderRadius: 999, border: 0, background: "var(--pill)", color: "var(--cream)", padding: "0 10px" }}>
                  <option value="heat">heat</option><option value="mono">mono</option>
                </select>
              </label>
              <label style={{ display: "flex", justifyContent: "space-between" }}>Show tolerance band
                <input type="checkbox" checked={settings.showTolerance} onChange={(e) => setSettings((s) => ({ ...s, showTolerance: e.target.checked }))} /></label>
              <label style={{ display: "flex", justifyContent: "space-between" }}>Show camera
                <input type="checkbox" checked={settings.showCamera} onChange={(e) => setSettings((s) => ({ ...s, showCamera: e.target.checked }))} /></label>
            </div>
          </details>
      </div>
      )}
    </>
  );
}
