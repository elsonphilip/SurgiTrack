/**
 * Webcam path tracing, computed in the browser from MediaPipe hand landmarks (port of tracker/scale.py HandRulerMapper and the
 * tremor / smoothness formulas in tracker/tremor.py). The fingertip is landmark 8; the hand is the ruler (wrist → middle knuckle ≈ 95 mm).
 * The tremor here is estimated from fingertip jitter in the 4-12 Hz band, relative to the resting jitter measured in calibration.
 * It is an estimate (a camera sees ~30 frames a second), not the wristband's accelerometer.
 */
export const TRACE_MM = [120, 60] as const;
const HAND_REF_MM = 95;
const K = 10, ALPHA = 4, LN_REF = 8;
const MIN_SIGMA_MM = 0.03;
const BAND: [number, number] = [4, 12];

export interface Lm { x: number; y: number; z?: number }
type Pt = [number, number, number]; // t seconds, x mm, y mm

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export class HandRuler {
  mmPerPx = 0.5;
  private spans: number[] = [];
  constructor(public mirror = true) {}

  /** Normalised landmarks + video size → fingertip on the 120 × 60 mm trace area (image centre = centre of the area). */
  map(lm: Lm[], w: number, h: number): [number, number] {
    const span = Math.hypot((lm[0].x - lm[9].x) * w, (lm[0].y - lm[9].y) * h);
    if (span > 20) {
      this.mmPerPx += 0.05 * (HAND_REF_MM / span - this.mmPerPx);
      this.spans.push(span);
      if (this.spans.length > 60) this.spans.shift();
    }
    const dx = (lm[8].x * w - w / 2) * (this.mirror ? -1 : 1);
    return [TRACE_MM[0] / 2 + dx * this.mmPerPx, TRACE_MM[1] / 2 + (lm[8].y * h - h / 2) * this.mmPerPx];
  }

  /** Fix the scale from the median hand size seen so far. */
  lock() {
    const m = median(this.spans);
    if (m > 20) this.mmPerPx = HAND_REF_MM / m;
    return this.mmPerPx;
  }
  get samples() { return this.spans.length; }
}

/**
 * RMS (mm) of the fingertip path in the 4-12 Hz band, via a DFT. Deliberate movement is removed first (subtracting a ~0.4 s moving
 * average, i.e. a gentle high-pass) and the window is tapered (Hann), otherwise a steady stroke leaks into the band and looks like tremor.
 */
export function bandRmsMm(track: Pt[], band = BAND): number {
  const n = track.length;
  if (n < 32) return 0;
  const dur = track[n - 1][0] - track[0][0];
  if (dur <= 0) return 0;
  const fs = (n - 1) / dur;
  const half = Math.max(1, Math.round(0.2 * fs));
  const win = Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const winGain = Math.sqrt(win.reduce((a, w) => a + w * w, 0) / n); // restores the RMS the taper removes
  let power = 0;
  for (const axis of [1, 2] as const) {
    const raw = track.map((p) => p[axis]);
    const x = raw.map((v, i) => {
      let sum = 0, cnt = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) { sum += raw[j]; cnt++; }
      return (v - sum / cnt) * win[i];
    });
    const kmin = Math.max(1, Math.ceil((band[0] * n) / fs)), kmax = Math.min(Math.floor(n / 2) - 1, Math.floor((band[1] * n) / fs));
    for (let k = kmin; k <= kmax; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * k * i) / n; re += x[i] * Math.cos(a); im -= x[i] * Math.sin(a); }
      power += (2 * (re * re + im * im)) / (n * n); // one-sided Parseval: each bin carries amplitude²/2
    }
  }
  return Math.sqrt(power) / winGain;
}

export const tremorIndex = (rmsMm: number, sigmaMm: number) => 10 * clamp(rmsMm / (K * Math.max(sigmaMm, MIN_SIGMA_MM)), 0, 1);

function speedSeries(track: Pt[]) {
  if (track.length < 8) return { v: [] as number[], fs: 0 };
  const dts = track.slice(1).map((p, i) => p[0] - track[i][0]);
  const fs = 1 / Math.max(median(dts), 1e-3);
  let v = track.slice(1).map((p, i) => Math.hypot(p[1] - track[i][1], p[2] - track[i][2]) * fs);
  if (v.length >= 3) v = v.map((_, i) => { const a = v[Math.max(0, i - 1)], b = v[i], c = v[Math.min(v.length - 1, i + 1)]; return (a + b + c) / 3; }); // light smoothing: landmark jitter is not hand jerk
  return { v, fs };
}

function gradient(y: number[], dt: number) {
  const n = y.length;
  return y.map((_, i) => (i === 0 ? (y[1] - y[0]) / dt : i === n - 1 ? (y[n - 1] - y[n - 2]) / dt : (y[i + 1] - y[i - 1]) / (2 * dt)));
}

/** ln of the dimensionless jerk of a speed profile; NaN if undefined. */
export function logDimensionlessJerk(v: number[], fs: number): number {
  if (v.length < 8) return NaN;
  const vmax = Math.max(...v);
  if (vmax <= 1e-9) return NaN;
  const dt = 1 / fs;
  const jerk = gradient(gradient(v, dt), dt);
  let integral = 0;
  for (let i = 1; i < jerk.length; i++) integral += 0.5 * (jerk[i] ** 2 + jerk[i - 1] ** 2) * dt;
  const dj = (integral * (v.length * dt) ** 3) / (vmax * vmax);
  return Math.log(Math.max(dj, 1e-12));
}

export function smoothnessScore(track: Pt[]): number {
  const { v, fs } = speedSeries(track);
  const l = logDimensionlessJerk(v, fs);
  return Number.isNaN(l) ? 0 : clamp(100 - ALPHA * Math.max(0, l - LN_REF), 0, 100);
}

export interface CamMetrics { accuracy: number; avgDeviationMm: number; tremor: number; smoothness: number; completionTimeS: number; hapticPulses: number }

/** One webcam session: calibration (hand scale + resting jitter) and the run itself. */
export class CamRun {
  ruler = new HandRuler();
  sigma = 0.1; // mm, resting fingertip jitter in the tremor band
  private still: Pt[] = [];
  private pts: number[][] = [];
  private tolMm = 3;
  private px = 8;
  private t0 = 0;
  private n = 0; private inN = 0; private devSum = 0; private pulses = 0; private wasOut = false;
  track: Pt[] = [];

  beginStill() { this.still = []; }
  pushStill(t: number, mm: [number, number]) { this.still.push([t, mm[0], mm[1]]); }
  endStill() { this.sigma = Math.max(bandRmsMm(this.still), MIN_SIGMA_MM); return this.sigma; }

  beginRun(ptsPx: number[][], tolMm: number, px: number, t0: number) {
    this.pts = ptsPx; this.tolMm = tolMm; this.px = px; this.t0 = t0;
    this.n = this.inN = this.pulses = 0; this.devSum = 0; this.wasOut = false; this.track = [];
  }

  /** One fingertip sample (t in seconds). Returns the canvas position, distance from the path and whether it is outside the band. */
  push(t: number, mm: [number, number]) {
    const x = mm[0] * this.px, y = mm[1] * this.px;
    let md = 1e18;
    for (const p of this.pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < md) md = d; }
    const dev = Math.sqrt(md) / this.px, out = dev > this.tolMm;
    this.n++; if (!out) this.inN++; this.devSum += dev;
    if (out && !this.wasOut) this.pulses++;
    this.wasOut = out;
    this.track.push([t, mm[0], mm[1]]);
    return { x, y, dev, out };
  }

  get samples() { return this.n; }

  /** Numbers for the live tiles while the run is going. */
  liveStats() {
    return {
      acc: this.n ? (100 * this.inN) / this.n : null,
      tremor: this.liveTremor(),
      smooth: smoothnessScore(this.track.slice(-90)),
      pulses: this.pulses,
    };
  }

  /** Tremor index over roughly the last three seconds, for the live display. */
  liveTremor() { return tremorIndex(bandRmsMm(this.track.slice(-90)), this.sigma); }

  metrics(elapsedS: number): CamMetrics | null {
    if (this.n < 10) return null;
    return {
      accuracy: Math.round(clamp((100 * this.inN) / this.n, 0, 100) * 10) / 10,
      avgDeviationMm: Math.round((this.devSum / this.n) * 100) / 100,
      tremor: Math.round(tremorIndex(bandRmsMm(this.track), this.sigma) * 10) / 10,
      smoothness: Math.round(smoothnessScore(this.track)),
      completionTimeS: Math.round(elapsedS * 10) / 10,
      hapticPulses: this.pulses,
    };
  }
}
