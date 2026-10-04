/** Write ../data/paths.json (points in mm) so the tracker computes deviation against the same shapes. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { CANVAS, LEVELS_TOL, PATHS, lengthMm, samplePath } from "../src/lib/paths-export";

const out = PATHS.map((p) => ({
  id: p.id, level: p.level, name: p.name, tolerance_mm: LEVELS_TOL[p.level],
  length_mm: Math.round(lengthMm(p) * 10) / 10,
  points_mm: samplePath(p, 320).map(([x, y]) => [Math.round((x / CANVAS.pxPerMm) * 1000) / 1000, Math.round((y / CANVAS.pxPerMm) * 1000) / 1000]),
}));
const file = path.resolve(__dirname, "../../data/paths.json");
writeFileSync(file, JSON.stringify({ canvas_mm: [CANVAS.w / CANVAS.pxPerMm, CANVAS.h / CANVAS.pxPerMm], origin: "top-left, +y down", paths: out }));
console.log(`Wrote ${out.length} paths to ${file}`);
