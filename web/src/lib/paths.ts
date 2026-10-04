/**
 * Target-path library for the trace exercise.
 *
 * Coordinates are canvas pixels on the 960×480 Live Session canvas (8 px = 1 mm, so 120 × 60 mm).
 * Each path is `at(t)` for t ∈ [0, 1] → [x, y]. The first path of each level is the original design path
 * and must not change. Run `npm run export:paths` to regenerate ../data/paths.json for the tracker, which uses the
 * same shapes to compute path deviation in mm.
 */
export type Pt = [number, number];
export interface PathDef {
  id: string;
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  blurb: string;
  at: (t: number) => Pt;
}

export const CANVAS = { w: 960, h: 480, pxPerMm: 8 } as const;
const tri = (u: number) => 2 * Math.abs(2 * (u - Math.floor(u + 0.5))) - 1;

/** Constant-speed polyline through points (parametrised by arc length). */
function poly(pts: Pt[]): (t: number) => Pt {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  return (t) => {
    const d = Math.min(1, Math.max(0, t)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const u = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
  };
}
const closed = (pts: Pt[]) => poly([...pts, pts[0]]);
const reverse = (f: (t: number) => Pt) => (t: number) => f(1 - t);

/** Scale + centre a raw curve so it fills (at most) w × h around (cx, cy), preserving aspect. */
function fit(raw: (t: number) => Pt, cx: number, cy: number, w: number, h: number): (t: number) => Pt {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i <= 400; i++) {
    const [x, y] = raw(i / 400);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const s = Math.min(w / (x1 - x0), h / (y1 - y0));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return (t) => { const [x, y] = raw(t); return [cx + (x - mx) * s, cy + (y - my) * s]; };
}

/** Inward square spiral: right, down, left, up, shrinking by `gap` each side. */
function squareSpiralIn(): Pt[] {
  let [L, T, R, B] = [290, 90, 670, 390];
  const gap = 60, pts: Pt[] = [[L, T]];
  while (R - L >= gap && B - T >= gap) {
    pts.push([R, T]); T += gap;
    if (B - T < 0) break;
    pts.push([R, B]); R -= gap;
    if (R - L < 0) break;
    pts.push([L, B]); B -= gap;
    if (B - T < 0) break;
    pts.push([L, T]); L += gap;
  }
  return pts;
}

const spiral = (t: number): Pt => {
  const a = t * 5 * Math.PI, r = 18 + 180 * t;
  return [480 + r * Math.cos(a), 240 + r * Math.sin(a)];
};

function star(r: number, cx = 480, cy = 245): Pt[] {
  const v = (k: number): Pt => [cx + r * Math.sin((2 * Math.PI * k) / 5), cy - r * Math.cos((2 * Math.PI * k) / 5)];
  return [0, 2, 4, 1, 3, 0].map(v);
}

function sawtooth(teeth: number, x0 = 120, x1 = 840, top = 140, bottom = 340): Pt[] {
  const pts: Pt[] = [[x0, bottom]], w = (x1 - x0) / teeth;
  for (let i = 0; i < teeth; i++) pts.push([x0 + w * (i + 1), top], [x0 + w * (i + 1), bottom]);
  return pts;
}
function squareWave(periods: number, x0 = 120, x1 = 840, top = 150, bottom = 330): Pt[] {
  const pts: Pt[] = [[x0, bottom]], w = (x1 - x0) / (periods * 2);
  for (let i = 0; i < periods * 2; i++) {
    const x = x0 + w * i, y = i % 2 === 0 ? bottom : top, yn = i % 2 === 0 ? top : bottom;
    pts.push([x, y], [x, yn], [x + w, yn]);
  }
  return pts;
}

export const PATHS: PathDef[] = [
  // ---- Level 1 · Straight Incision (±3 mm) ----
  { id: "l1-straight", level: 1, name: "Straight incision", blurb: "Level, left to right.", at: (t) => [120 + 720 * t, 240] },
  { id: "l1-diagonal-up", level: 1, name: "Rising diagonal", blurb: "Straight line climbing to the right.", at: poly([[140, 380], [820, 100]]) },
  { id: "l1-diagonal-down", level: 1, name: "Falling diagonal", blurb: "Straight line descending to the right.", at: poly([[140, 100], [820, 380]]) },
  { id: "l1-vertical", level: 1, name: "Vertical stroke", blurb: "Top to bottom — a different wrist angle.", at: poly([[480, 60], [480, 420]]) },
  { id: "l1-shallow-slope", level: 1, name: "Shallow slope", blurb: "Nearly level with a slight drift.", at: (t) => [100 + 760 * t, 160 + 140 * t] },

  // ---- Level 2 · Curved Arc (±2.5 mm) ----
  { id: "l2-arc", level: 2, name: "Curved arc", blurb: "A single smooth arch.", at: (t) => [120 + 720 * t, 340 - 200 * Math.sin(Math.PI * t)] },
  { id: "l2-arc-inverted", level: 2, name: "Inverted arc", blurb: "The arch flipped — a bowl.", at: (t) => [120 + 720 * t, 140 + 200 * Math.sin(Math.PI * t)] },
  { id: "l2-s-curve", level: 2, name: "S-curve incision", blurb: "One full S: curve one way then the other.", at: (t) => [120 + 720 * t, 240 - 110 * Math.sin(2 * Math.PI * t)] },
  { id: "l2-wave", level: 2, name: "Gentle wave", blurb: "One and a half slow undulations.", at: (t) => [100 + 760 * t, 240 + 90 * Math.sin(3 * Math.PI * t)] },
  { id: "l2-quarter-turn", level: 2, name: "Quarter turn", blurb: "Starts flat, ends heading up.", at: (t) => [130 + 700 * Math.sin((Math.PI * t) / 2), 420 - 360 * (1 - Math.cos((Math.PI * t) / 2))] },
  {
    id: "l2-fusiform", level: 2, name: "Fusiform excision", blurb: "Closed lens shape, like cutting out a lesion.",
    at: (t) => (t < 0.5 ? [140 + 680 * (2 * t), 240 - 110 * Math.sin(Math.PI * 2 * t)] : [820 - 680 * (2 * (t - 0.5)), 240 + 110 * Math.sin(Math.PI * 2 * (t - 0.5))]),
  },

  // ---- Level 3 · Suture Zigzag (±2 mm) ----
  { id: "l3-zigzag", level: 3, name: "Suture zigzag", blurb: "Four sharp peaks and valleys.", at: (t) => [120 + 720 * t, 240 + 100 * tri(t * 4)] },
  { id: "l3-sawtooth", level: 3, name: "Sawtooth", blurb: "Climb diagonally, drop straight down; repeat.", at: poly(sawtooth(4)) },
  { id: "l3-square-wave", level: 3, name: "Square wave", blurb: "Right-angle steps — precise corners.", at: poly(squareWave(3)) },
  { id: "l3-fine-zigzag", level: 3, name: "Fine zigzag", blurb: "Eight tight peaks, smaller amplitude.", at: (t) => [110 + 740 * t, 240 + 70 * tri(t * 8)] },
  { id: "l3-s-weave", level: 3, name: "S-weave", blurb: "Three smooth weaves, like a running stitch.", at: (t) => [100 + 760 * t, 240 + 100 * Math.sin(2 * Math.PI * 3 * t)] },

  // ---- Level 4 · Spiral (±1.5 mm) ----
  { id: "l4-spiral", level: 4, name: "Spiral", blurb: "Out from the centre, 2½ turns.", at: spiral },
  { id: "l4-spiral-inward", level: 4, name: "Inward spiral", blurb: "The same spiral traced from the outside in.", at: reverse(spiral) },
  { id: "l4-figure-eight", level: 4, name: "Figure eight", blurb: "Crosses itself once — like a surgeon’s knot loop.", at: fit((t) => [Math.sin(2 * Math.PI * t), Math.sin(2 * Math.PI * t) * Math.cos(2 * Math.PI * t)], 480, 240, 600, 300) },
  { id: "l4-clover", level: 4, name: "Three-leaf clover", blurb: "Three petals through the centre.", at: fit((t) => { const th = Math.PI * t, r = Math.cos(3 * th); return [r * Math.cos(th), r * Math.sin(th)]; }, 480, 240, 380, 380) },
  { id: "l4-square-spiral", level: 4, name: "Square spiral", blurb: "Spiral with right-angle corners.", at: poly(squareSpiralIn()) },

  // ---- Level 5 · Micro Circle (±1 mm) ----
  { id: "l5-circle", level: 5, name: "Micro circle", blurb: "One full circle, starting at the top.", at: (t) => { const a = -Math.PI / 2 + t * 2 * Math.PI; return [480 + 160 * Math.cos(a), 240 + 160 * Math.sin(a)]; } },
  { id: "l5-small-circle", level: 5, name: "Tiny circle", blurb: "Half the radius — tighter curvature.", at: (t) => { const a = -Math.PI / 2 + t * 2 * Math.PI; return [480 + 90 * Math.cos(a), 240 + 90 * Math.sin(a)]; } },
  { id: "l5-ellipse", level: 5, name: "Ellipse", blurb: "Wide oval with tight ends.", at: (t) => { const a = -Math.PI / 2 + t * 2 * Math.PI; return [480 + 260 * Math.cos(a), 240 + 120 * Math.sin(a)]; } },
  { id: "l5-triangle", level: 5, name: "Triangle", blurb: "Three straight sides, three sharp turns.", at: closed([[480, 70], [790, 400], [170, 400]]) },
  { id: "l5-pentagram", level: 5, name: "Pentagram", blurb: "Five-point star in one stroke.", at: poly(star(190)) },
  { id: "l5-trefoil", level: 5, name: "Trefoil knot", blurb: "Three-lobed loop, as in knot tying.", at: fit((t) => { const th = 2 * Math.PI * t; return [Math.sin(th) + 2 * Math.sin(2 * th), Math.cos(th) - 2 * Math.cos(2 * th)]; }, 480, 240, 420, 360) },
];

export const pathsForLevel = (level: number) => PATHS.filter((p) => p.level === level);
export const defaultPath = (level: number) => pathsForLevel(level)[0];
export const getPath = (id: string) => PATHS.find((p) => p.id === id);

export function samplePath(p: PathDef, n = 320): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => p.at(i / n));
}

/** Path length in mm. */
export function lengthMm(p: PathDef, n = 800): number {
  const pts = samplePath(p, n);
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d / CANVAS.pxPerMm;
}
