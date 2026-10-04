/** Canvas drawing for the space-mission Game mode. Pure drawing code: nothing here touches scoring or saved data. */
import type { Decor } from "./space";

export const GATES = [0.25, 0.5, 0.75] as const;
export interface SpaceGame { combo: number; streak: number; points: number; chain: number; hull: number; gates: (boolean | null)[]; gateFlash: number; perfect: number; flash: number; broke: number; heading: number }
export interface Scene {
  phase: string; level: number; mode: string; hapKind: string | null; hapUntil: number;
  pts: number[][]; trace: [number, number, boolean][]; cursor: [number, number] | null; decor: Decor[]; g: SpaceGame;
  settings: { showTolerance: boolean; traceStyle: string };
}
interface Dims { W: number; H: number; PX: number; tol: number; comboMax: number; comboStep: number }

const lcg = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const STARS = (() => { const r = lcg(42); return Array.from({ length: 120 }, () => ({ x: r() * 960, y: r() * 480, s: 0.6 + r() * 1.6, p: r() * 6.28, big: r() > 0.93 })); })();

type G = CanvasRenderingContext2D;

function face(g: G, x: number, y: number, r: number, sleepy = false) {
  g.save();
  g.fillStyle = "rgba(255,140,170,.5)";
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(x + s * r * 0.5, y + r * 0.22, r * 0.17, r * 0.1, 0, 0, 7); g.fill(); }
  g.fillStyle = "#26263a";
  for (const s of [-1, 1]) {
    g.beginPath();
    if (sleepy) { g.lineWidth = Math.max(1.5, r * 0.07); g.strokeStyle = "#26263a"; g.arc(x + s * r * 0.3, y - r * 0.05, r * 0.1, 0, Math.PI); g.stroke(); continue; }
    g.arc(x + s * r * 0.3, y - r * 0.05, r * 0.1, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(x + s * r * 0.3 + r * 0.03, y - r * 0.09, r * 0.035, 0, 7); g.fill(); g.fillStyle = "#26263a";
  }
  g.strokeStyle = "#26263a"; g.lineWidth = Math.max(1.4, r * 0.06); g.lineCap = "round";
  g.beginPath(); g.arc(x, y + r * 0.12, r * 0.14, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.restore();
}

function body(g: G, x: number, y: number, r: number, c1: string, c2: string) {
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  grad.addColorStop(0, c1); grad.addColorStop(1, c2);
  g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}

function drawDecor(g: G, d: Decor, now: number) {
  const bob = Math.sin(now / 900 + d.seed) * 1.5;
  const x = d.x, y = d.y + bob, r = d.r;
  g.save();
  if (d.kind === "planet" || d.kind === "ringed") {
    const c1 = `hsl(${d.hue},70%,72%)`, c2 = `hsl(${(d.hue + 40) % 360},60%,45%)`;
    if (d.kind === "ringed") { g.strokeStyle = "rgba(246,226,190,.7)"; g.lineWidth = 5; g.beginPath(); g.ellipse(x, y, r * 1.7, r * 0.5, -0.35, Math.PI, 2 * Math.PI); g.stroke(); }
    body(g, x, y, r, c1, c2); face(g, x, y, r);
    if (d.kind === "ringed") { g.strokeStyle = "rgba(246,226,190,.85)"; g.lineWidth = 5; g.beginPath(); g.ellipse(x, y, r * 1.7, r * 0.5, -0.35, 0, Math.PI); g.stroke(); }
  } else if (d.kind === "moon") {
    body(g, x, y, r, "#e9e6f2", "#9a96b3");
    g.fillStyle = "rgba(120,115,150,.35)"; g.beginPath(); g.arc(x + r * 0.45, y + r * 0.35, r * 0.18, 0, 7); g.arc(x - r * 0.55, y + r * 0.45, r * 0.12, 0, 7); g.fill();
    face(g, x, y - r * 0.05, r * 0.9, true);
  } else if (d.kind === "asteroid") {
    const rr = lcg(d.seed); g.save(); g.translate(x, y); g.rotate(now / 6000 * (d.seed % 2 ? 1 : -1));
    g.beginPath(); for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283, k = r * (0.78 + rr() * 0.32); if (i) g.lineTo(Math.cos(a) * k, Math.sin(a) * k); else g.moveTo(Math.cos(a) * k, Math.sin(a) * k); } g.closePath();
    const gr = g.createLinearGradient(-r, -r, r, r); gr.addColorStop(0, "#b8aec6"); gr.addColorStop(1, "#6f6785"); g.fillStyle = gr; g.fill();
    g.fillStyle = "rgba(60,55,80,.3)"; g.beginPath(); g.arc(r * 0.3, r * 0.3, r * 0.16, 0, 7); g.fill();
    face(g, 0, 0, r * 0.85); g.restore();
  } else if (d.kind === "hole") {
    for (let i = 4; i >= 1; i--) { g.strokeStyle = `rgba(150,110,230,${0.1 + (4 - i) * 0.06})`; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y, r * (0.7 + i * 0.3), r * (0.28 + i * 0.1), now / 3000 + i, 0, 6.283); g.stroke(); }
    body(g, x, y, r * 0.62, "#3b2a66", "#0c0818"); face(g, x, y, r * 0.55, true);
  } else if (d.kind === "earth") {
    g.shadowColor = "rgba(120,200,255,.55)"; g.shadowBlur = 22;
    body(g, x, y, r, "#8fd3ff", "#2f78c4"); g.shadowBlur = 0;
    g.fillStyle = "rgba(110,200,140,.85)"; g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.3, r * 0.3, r * 0.2, 0.5, 0, 7); g.ellipse(x + r * 0.4, y + r * 0.35, r * 0.25, r * 0.18, -0.4, 0, 7); g.fill();
    face(g, x, y, r);
  } else if (d.kind === "satellite") {
    g.translate(x, y); g.rotate(Math.sin(now / 1500 + d.seed) * 0.4);
    g.fillStyle = "#5aa4d6"; g.fillRect(-r * 1.9, -r * 0.3, r * 1.2, r * 0.6); g.fillRect(r * 0.7, -r * 0.3, r * 1.2, r * 0.6);
    g.fillStyle = "#e8eef0"; g.beginPath(); g.roundRect(-r * 0.6, -r * 0.6, r * 1.2, r * 1.2, r * 0.3); g.fill();
    g.fillStyle = "#26263a"; g.beginPath(); g.arc(-r * 0.2, -r * 0.05, r * 0.08, 0, 7); g.arc(r * 0.2, -r * 0.05, r * 0.08, 0, 7); g.fill();
  }
  g.restore();
}

function sparkle(g: G, x: number, y: number, s: number) {
  g.beginPath(); g.moveTo(x, y - s * 2.2); g.lineTo(x + s * 0.5, y - s * 0.5); g.lineTo(x + s * 2.2, y); g.lineTo(x + s * 0.5, y + s * 0.5); g.lineTo(x, y + s * 2.2); g.lineTo(x - s * 0.5, y + s * 0.5); g.lineTo(x - s * 2.2, y); g.lineTo(x - s * 0.5, y - s * 0.5); g.closePath(); g.fill();
}

/** A cute little rocket. `angle` = direction of travel (radians). */
export function drawShip(g: G, x: number, y: number, angle: number, now: number, thrust: number, hurt: boolean) {
  g.save(); g.translate(x, y); g.rotate(angle + Math.PI / 2);
  const flick = 1 + Math.sin(now / 55) * 0.2;
  const fl = (7 + thrust * 12) * flick;
  const fg = g.createLinearGradient(0, 10, 0, 10 + fl); fg.addColorStop(0, "#fff3c4"); fg.addColorStop(0.5, "#ffb04a"); fg.addColorStop(1, "rgba(255,120,60,0)");
  g.fillStyle = fg; g.beginPath(); g.moveTo(-4.5, 10); g.quadraticCurveTo(0, 10 + fl * 1.4, 4.5, 10); g.closePath(); g.fill();
  g.fillStyle = "#3d8571"; g.beginPath(); g.moveTo(-6, 4); g.lineTo(-12, 13); g.lineTo(-5, 11); g.closePath(); g.moveTo(6, 4); g.lineTo(12, 13); g.lineTo(5, 11); g.closePath(); g.fill();
  const bg = g.createLinearGradient(-7, 0, 7, 0); bg.addColorStop(0, "#d9e6e8"); bg.addColorStop(1, "#ffffff");
  g.fillStyle = hurt ? "#ffd9a8" : bg; g.beginPath(); g.moveTo(0, -17); g.bezierCurveTo(10, -9, 8, 7, 6, 11); g.lineTo(-6, 11); g.bezierCurveTo(-8, 7, -10, -9, 0, -17); g.closePath(); g.fill();
  g.fillStyle = "#e3a857"; g.beginPath(); g.moveTo(0, -17); g.bezierCurveTo(4, -14, 5, -11, 5, -10); g.lineTo(-5, -10); g.bezierCurveTo(-5, -11, -4, -14, 0, -17); g.closePath(); g.fill();
  g.fillStyle = "#5aa4d6"; g.beginPath(); g.arc(0, -2, 4.3, 0, 7); g.fill();
  g.fillStyle = "rgba(255,255,255,.75)"; g.beginPath(); g.arc(-1.4, -3.4, 1.3, 0, 7); g.fill();
  g.restore();
}

function dashedPath(g: G, pts: number[][]) { g.beginPath(); pts.forEach((p, i) => { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); }

export function drawSpace(g: G, r: Scene, now: number, d: Dims) {
  const { W, H, PX, tol } = d, P = r.pts, T = r.trace;
  // sky
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#0b0d24"); sky.addColorStop(1, "#1a1238");
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  for (const [cx, cy, c] of [[W * 0.18, H * 0.25, "rgba(120,90,220,.12)"], [W * 0.82, H * 0.75, "rgba(61,133,113,.14)"]] as const) {
    const n = g.createRadialGradient(cx, cy, 0, cx, cy, 260); n.addColorStop(0, c); n.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = n; g.fillRect(0, 0, W, H);
  }
  for (const s of STARS) {
    const tw = 0.55 + 0.45 * Math.sin(now / 700 + s.p);
    g.fillStyle = `rgba(230,240,255,${0.35 + tw * 0.55})`;
    if (s.big) sparkle(g, s.x, s.y, 2.2 * tw + 0.8); else { g.beginPath(); g.arc(s.x, s.y, s.s * 0.7, 0, 7); g.fill(); }
  }
  for (const o of r.decor) drawDecor(g, o, now);
  g.lineCap = "round"; g.lineJoin = "round";

  // corridor + trajectory
  if (r.settings.showTolerance) {
    dashedPath(g, P); g.strokeStyle = "rgba(90,164,214,.10)"; g.lineWidth = tol * 2 * PX + 16; g.stroke();
    dashedPath(g, P); g.strokeStyle = "rgba(90,164,214,.26)"; g.lineWidth = tol * 2 * PX; g.stroke();
  }
  g.save(); g.shadowColor = "#a6cac8"; g.shadowBlur = 8; g.setLineDash([2, 11]); dashedPath(g, P); g.strokeStyle = "rgba(220,240,240,.9)"; g.lineWidth = 2.4; g.stroke(); g.restore();

  // gates
  GATES.forEach((f, i) => {
    const k = Math.floor(f * (P.length - 1)), a = P[Math.max(0, k - 2)], b = P[Math.min(P.length - 1, k + 2)];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2, hit = r.g.gates[i];
    g.save(); g.lineWidth = 4; g.shadowBlur = hit ? 14 : 0;
    g.strokeStyle = hit === true ? "#8ff0c8" : hit === false ? "rgba(227,168,87,.55)" : "rgba(166,202,200,.7)"; g.shadowColor = g.strokeStyle as string;
    g.beginPath(); g.ellipse(P[k][0], P[k][1], tol * PX * 1.55 + 4, 7, ang, 0, 7); g.stroke(); g.restore();
  });

  // launch pad + finish ring
  const s = P[0], f = P[P.length - 1], beat = 1 + Math.sin(now / 350) * 0.12;
  g.save(); g.shadowColor = "#5aa4d6"; g.shadowBlur = 16; g.fillStyle = "#5aa4d6"; g.beginPath(); g.arc(s[0], s[1], 8 * beat, 0, 7); g.fill(); g.restore();
  g.save(); g.shadowColor = "#ffd27a"; g.shadowBlur = 16; g.strokeStyle = "#ffd27a"; g.lineWidth = 3; g.beginPath(); g.arc(f[0], f[1], 10, 0, 7); g.stroke(); g.fillStyle = "#ffd27a"; sparkle(g, f[0], f[1], 2.6); g.restore();

  // trace as an engine trail
  const heat = r.settings.traceStyle === "heat";
  g.save(); g.shadowColor = "#5aa4d6"; g.shadowBlur = 10; g.lineWidth = 2.6;
  for (let i = 1; i < T.length; i++) { g.strokeStyle = heat && T[i][2] ? "#E3A857" : "rgba(166,202,200,.85)"; g.beginPath(); g.moveTo(T[i - 1][0], T[i - 1][1]); g.lineTo(T[i][0], T[i][1]); g.stroke(); }
  g.restore();

  // ship
  const head = r.phase === "run" && T.length ? T[T.length - 1] : r.cursor ?? null;
  if (head || r.phase === "idle") {
    const pos = head ?? [s[0], s[1]];
    let target = r.g.heading;
    if (r.phase === "run" && T.length > 6) { const a = T[T.length - 6]; const dx = pos[0] - a[0], dy = pos[1] - a[1]; if (Math.hypot(dx, dy) > 1.5) target = Math.atan2(dy, dx); }
    else { const a = P[0], b = P[Math.min(6, P.length - 1)]; target = Math.atan2(b[1] - a[1], b[0] - a[0]); }
    let diff = target - r.g.heading; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    r.g.heading += diff * 0.25;
    const hot = now < r.hapUntil;
    if (hot) {
      const rr = 16 + ((now / 10) % 26), col = r.hapKind === "burst" ? "255,112,90" : r.hapKind === "tick" ? "143,200,255" : "227,168,87";
      g.strokeStyle = `rgba(${col},${1 - (rr - 16) / 26})`; g.lineWidth = 3; g.beginPath(); g.arc(pos[0], pos[1], rr, 0, 7); g.stroke();
    }
    drawShip(g, pos[0], pos[1], r.g.heading, now, r.phase === "run" ? 1 : 0.2, hot && r.hapKind !== "tick");
  }

  // HUD
  const gm = r.g;
  if (r.phase === "run") {
    const col = gm.combo >= 4 ? "#E3A857" : gm.combo >= 2 ? "#5AA4D6" : "#A6CAC8";
    g.save(); g.textBaseline = "top";
    g.font = "800 34px Montserrat, sans-serif"; g.shadowColor = col; g.shadowBlur = 14; g.fillStyle = col; g.fillText("x" + gm.combo, 24, 18);
    g.shadowBlur = 0; g.font = "700 13px Karla, sans-serif"; g.fillStyle = "rgba(166,202,200,.85)"; g.fillText("STABILITY", 70, 22);
    g.font = "700 16px Karla, sans-serif"; g.fillStyle = "#A6CAC8"; g.fillText(`${Math.round(gm.points)} pts · ${gm.chain}-hit combo`, 24, 58);
    const frac = gm.combo >= d.comboMax ? 1 : (gm.streak % d.comboStep) / d.comboStep;
    g.fillStyle = "rgba(166,202,200,.15)"; g.fillRect(24, 86, 120, 6); g.fillStyle = col; g.fillRect(24, 86, 120 * frac, 6);
    // hull
    const hw = 170, hx = W - 24 - hw, hc = gm.hull > 60 ? "#8ff0c8" : gm.hull > 30 ? "#E3A857" : "#ff705a";
    g.textAlign = "right"; g.font = "700 13px Karla, sans-serif"; g.fillStyle = "rgba(166,202,200,.85)"; g.fillText(`HULL ${Math.max(0, Math.round(gm.hull))}%`, W - 24, 22);
    g.textAlign = "left"; g.fillStyle = "rgba(166,202,200,.15)"; g.beginPath(); g.roundRect(hx, 44, hw, 10, 5); g.fill();
    g.fillStyle = hc; g.beginPath(); g.roundRect(hx, 44, Math.max(0, hw * gm.hull / 100), 10, 5); g.fill();
    const age = now - gm.flash;
    if (T.length && age < 700) { const p = T[T.length - 1]; g.strokeStyle = `rgba(227,168,87,${1 - age / 700})`; g.lineWidth = 3; g.beginPath(); g.arc(p[0], p[1], 14 + age / 10, 0, 7); g.stroke(); }
    g.restore();
  }
  const msg = now - gm.perfect < 1100 ? ["Perfect section!", gm.perfect] : now - gm.gateFlash < 900 ? ["Gate cleared!", gm.gateFlash] : null;
  if (msg && r.phase === "run") {
    const age = now - (msg[1] as number), a = Math.max(0, 1 - age / 1100), y = 56 + age / 60; // drifts down gently, well inside the canvas
    g.save(); g.globalAlpha = a; g.textAlign = "center"; g.textBaseline = "middle"; g.font = "800 24px Montserrat, sans-serif";
    const w = g.measureText(msg[0] as string).width + 36;
    g.fillStyle = "rgba(11,13,36,.72)"; g.beginPath(); g.roundRect(W / 2 - w / 2, y - 22, w, 44, 22); g.fill();
    g.fillStyle = "#8ff0c8"; g.shadowColor = "#8ff0c8"; g.shadowBlur = 14; g.fillText(msg[0] as string, W / 2, y + 1); g.restore();
  }
}
