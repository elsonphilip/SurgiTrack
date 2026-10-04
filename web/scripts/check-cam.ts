// Sanity checks for the webcam maths (src/lib/cam-session.ts): npm run check:cam
import { CamRun, HandRuler, bandRmsMm, logDimensionlessJerk, smoothnessScore, tremorIndex, type Lm } from "../src/lib/cam-session";

let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`); if (!cond) failed++; };
type Pt = [number, number, number];

// 1. band-pass RMS: an 8 Hz, 0.5 mm-amplitude wobble on both axes has RMS = 0.5/√2 per axis → 0.5 mm overall; 1 Hz drift and 20 Hz jitter are ignored
const fs = 30, n = 150;
const wob = (f: number, a: number) => Array.from({ length: n }, (_, i): Pt => [i / fs, a * Math.sin(2 * Math.PI * f * (i / fs)), a * Math.cos(2 * Math.PI * f * (i / fs))]);
ok("8 Hz wobble is measured", Math.abs(bandRmsMm(wob(8, 0.5)) - 0.5) < 0.06, `got ${bandRmsMm(wob(8, 0.5)).toFixed(3)} mm (expect ≈0.5)`);
ok("1 Hz drift is ignored", bandRmsMm(wob(1, 5)) < 0.1, `got ${bandRmsMm(wob(1, 5)).toFixed(3)}`);
const ramp = Array.from({ length: n }, (_, i): Pt => [i / fs, 4 * (i / fs), 2 * (i / fs)]); // a steady 4 mm/s stroke
ok("a steady stroke is not tremor", bandRmsMm(ramp) < 0.05, `got ${bandRmsMm(ramp).toFixed(3)} mm`);
const rampWob = ramp.map((p, i): Pt => [p[0], p[1] + 0.5 * Math.sin(2 * Math.PI * 8 * (i / fs)), p[2] + 0.5 * Math.cos(2 * Math.PI * 8 * (i / fs))]);
ok("tremor on top of a stroke is still measured", Math.abs(bandRmsMm(rampWob) - 0.5) < 0.1, `got ${bandRmsMm(rampWob).toFixed(3)} mm (expect ≈0.5)`);
ok("tremor index rises with shaking", tremorIndex(1, 0.1) === 10 && tremorIndex(0.1, 0.1) === 1 && tremorIndex(0, 0.1) === 0);

// 2. smoothness: a bell-shaped speed profile is smooth; a jittery one is not
const smooth = Array.from({ length: 90 }, (_, i): Pt => { const t = i / fs, x = 60 * (10 * (t / 3) ** 3 - 15 * (t / 3) ** 4 + 6 * (t / 3) ** 5); return [t, x, 0]; });
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
const rough = smooth.map((p): Pt => [p[0], p[1] + 6 * rnd(), 0]);
ok("minimum-jerk reach scores high", smoothnessScore(smooth) > 80, `got ${smoothnessScore(smooth)}`);
ok("jittery path scores lower", smoothnessScore(rough) < smoothnessScore(smooth), `got ${smoothnessScore(rough)}`);
ok("jerk is undefined for too little data", Number.isNaN(logDimensionlessJerk([1, 2, 3], 30)));

// 3. hand ruler: a hand of 95 mm spanning 190 px → 0.5 mm/px; image centre → centre of the 120×60 mm area; mirrored left/right
const hand = (tipX: number, tipY: number): Lm[] => { const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })); lm[0] = { x: 0.5, y: 0.7 }; lm[9] = { x: 0.5, y: 0.7 - 190 / 480 }; lm[8] = { x: tipX, y: tipY }; return lm; };
const ruler = new HandRuler(true);
for (let i = 0; i < 60; i++) ruler.map(hand(0.5, 0.5), 640, 480);
ruler.lock();
ok("scale from hand size", Math.abs(ruler.mmPerPx - 0.5) < 0.01, `${ruler.mmPerPx.toFixed(3)} mm/px`);
const c = ruler.map(hand(0.5, 0.5), 640, 480);
ok("image centre → area centre", Math.abs(c[0] - 60) < 0.5 && Math.abs(c[1] - 30) < 0.5, `[${c.map((v) => v.toFixed(1))}]`);
// a user-facing camera sees you mirrored: your hand moving to YOUR right appears at smaller x in the raw frame
const right = ruler.map(hand(0.5 - 40 / 640, 0.5), 640, 480);
ok("hand moving to your right moves the cursor right", right[0] > 60 && Math.abs(right[0] - 80) < 0.6, `x=${right[0].toFixed(1)} (expect 80)`);

// 4. a run: tracing the path exactly scores 100% with ~0 deviation; being 5 mm off scores 0%
const pts = Array.from({ length: 100 }, (_, i) => [80 + i * 8, 240]);
const run = new CamRun();
run.beginRun(pts, 3, 8);
for (let i = 0; i < 100; i++) { run.observe(i / 30, [10 + i, 30]); run.push(i / 30); }
const m = run.metrics(3.3)!;
ok("on-path run: accuracy 100%, deviation ≈ 0, no phantom tremor", m.accuracy === 100 && m.avgDeviationMm < 0.5 && m.tremor < 1, JSON.stringify(m));
const off = new CamRun(); off.beginRun(pts, 3, 8);
for (let i = 0; i < 100; i++) { off.observe(i / 30, [10 + i, 36]); off.push(i / 30); }
ok("6 mm off the path: accuracy 0%", off.metrics(3.3)!.accuracy === 0);
ok("too few samples → no metrics", new CamRun().metrics(1) === null);

// 5. anchoring: wherever the fingertip is when the run starts, it begins on the path's start; relative movement is preserved
const anc = new CamRun(); anc.beginRun(pts, 3, 8);
anc.observe(0, [97, 12]); anc.anchorTo([10, 30]);
let moved: [number, number] = [0, 0];
for (let i = 1; i <= 8; i++) moved = anc.observe(i * 0.03, [97 + 5, 12 - 3]); // settle on the new position
ok("run starts on the path start; movement is relative", Math.abs(moved[0] - 15) < 1.5 && Math.abs(moved[1] - 27) < 1.5, `[${moved.map((v) => v.toFixed(1))}] (expect ≈ [15, 27])`);

// 6. smoothing: resting landmark jitter is damped but a real stroke is followed
const jit = new CamRun(); let seed2 = 3; const r2 = () => { seed2 = (seed2 * 1664525 + 1013904223) >>> 0; return seed2 / 4294967296 - 0.5; };
const still = Array.from({ length: 60 }, (_, i) => jit.observe(i / 30, [50 + 1.2 * r2(), 30 + 1.2 * r2()]));
const spread = Math.max(...still.slice(20).map((p) => p[0])) - Math.min(...still.slice(20).map((p) => p[0]));
ok("resting jitter is damped", spread < 0.8, `spread ${spread.toFixed(2)} mm from ±0.6 raw`);
const stroke = new CamRun(); let last: [number, number] = [0, 0];
for (let i = 0; i < 30; i++) last = stroke.observe(i / 30, [i * 2, 30]); // 60 mm/s
ok("a real stroke is followed closely", Math.abs(last[0] - 58) < 6, `lag ${(58 - last[0]).toFixed(1)} mm`);

// 7. the scale freezes once locked
const fr = new HandRuler();
for (let i = 0; i < 40; i++) fr.map(hand(0.5, 0.5), 640, 480);
fr.lock(); const before = fr.mmPerPx;
const big = (): Lm[] => { const lm = hand(0.5, 0.5); lm[9] = { x: 0.5, y: 0.7 - 300 / 480 }; return lm; };
for (let i = 0; i < 40; i++) fr.map(big(), 640, 480);
ok("scale is frozen after Lock", fr.mmPerPx === before);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall webcam maths checks passed");
