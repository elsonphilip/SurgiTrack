/**
 * Demo data for previewing the site BEFORE real sessions exist.
 * Everything is flagged source:"synthetic" (shown with a DEMO badge).
 *   npm run seed:demo     add demo profiles + sessions
 *   npm run seed:clear    remove all synthetic data (real data is untouched)
 */
import { addSession, clearSynthetic, createProfile, getProfile } from "../src/lib/store";
import { LEVELS } from "../src/lib/scoring";

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const PEOPLE = [
  { id: "ST-9001", name: "Maya Okafor", skill: 0.42, learn: 0.03 },
  { id: "ST-9002", name: "Daniel Reyes", skill: 0.6, learn: 0.025 },
  { id: "ST-9003", name: "Priya Natarajan", skill: 0.52, learn: 0.025 },
  { id: "ST-9004", name: "Samuel Adeyemi", skill: 0.3, learn: 0.03 },
];

async function seed() {
  for (const [i, p] of PEOPLE.entries()) {
    if (await getProfile(p.id)) continue;
    await createProfile(p.name, "synthetic", p.id);
    const r = rng(i + 7);
    let level = 1;
    for (let n = 0; n < 14; n++) {
      const skill = clamp(p.skill + p.learn * n - (level - 1) * 0.1 + (r() - 0.5) * 0.1, 0.05, 0.97);
      const tol = LEVELS[level - 1].toleranceMm;
      const trem = clamp(3.4 - skill * 3 + (r() - 0.5) * 0.5, 0.2, 10);
      const acc = clamp(55 + skill * 42 + (r() - 0.5) * 6, 0, 100);
      await addSession({
        userId: p.id,
        level,
        date: new Date(Date.now() - (14 - n) * 1.55 * 864e5).toISOString(),
        source: "synthetic",
        metrics: {
          accuracy: Math.round(acc * 10) / 10,
          avgDeviationMm: Math.round(clamp(tol * (1.6 - skill) + (r() - 0.5) * 0.3, 0.2, 20) * 100) / 100,
          tremor: Math.round(trem * 10) / 10,
          smoothness: Math.round(clamp(100 - trem * 6 - (100 - acc) * 0.4, 0, 100)),
          completionTimeS: Math.round((LEVELS[level - 1].targetTimeS + (r() - 0.4) * 5) * 10) / 10,
          hapticPulses: Math.round(clamp((1 - skill) * 14 + r() * 3, 0, 60)),
        },
      });
      level = (await getProfile(p.id))!.level; // follow unlocks, like a real user
    }
  }
  console.log("Seeded demo data.");
}

if (process.argv[2] === "clear") clearSynthetic().then((r) => console.log("Removed", r));
else seed();
