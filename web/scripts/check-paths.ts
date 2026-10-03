/** Sanity-check every path: finite, on the canvas, continuous, sensible length, unique ids. npm run check:paths */
import { CANVAS, PATHS, lengthMm, samplePath } from "../src/lib/paths";

const M = 30; // keep this far from the canvas edge (px)
let bad = 0;
const ids = new Set<string>();
console.log("id".padEnd(20), "level", "length(mm)", "bbox(px)");
for (const p of PATHS) {
  const errs: string[] = [];
  if (ids.has(p.id)) errs.push("duplicate id");
  ids.add(p.id);
  const pts = samplePath(p, 1000);
  let [x0, y0, x1, y1] = [1e9, 1e9, -1e9, -1e9];
  let maxStep = 0;
  pts.forEach(([x, y], i) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) errs.push("non-finite point");
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    if (i) maxStep = Math.max(maxStep, Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]));
  });
  if (x0 < M || y0 < M || x1 > CANVAS.w - M || y1 > CANVAS.h - M) errs.push(`out of bounds [${x0 | 0},${y0 | 0},${x1 | 0},${y1 | 0}]`);
  const len = lengthMm(p);
  if (len < 40 || len > 400) errs.push(`length ${len.toFixed(0)} mm outside 40–400`);
  if (maxStep > 25) errs.push(`jump of ${maxStep.toFixed(1)} px between samples`);
  console.log(p.id.padEnd(20), String(p.level).padEnd(5), len.toFixed(0).padStart(8), `  [${x0 | 0},${y0 | 0} → ${x1 | 0},${y1 | 0}]`, errs.length ? "  ✗ " + errs.join("; ") : "");
  bad += errs.length;
}
console.log(`\n${PATHS.length} paths, ${bad} problems`);
if (bad) process.exit(1);
