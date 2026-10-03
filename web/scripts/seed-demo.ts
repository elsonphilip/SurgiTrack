/**
 * Demo data for previewing the site BEFORE real sessions exist.
 * Everything is flagged source:"synthetic" (shown with a DEMO badge) and profile ids start with "demo-".
 *   npm run seed:demo     add demo profiles + sessions
 *   npm run seed:clear    remove all synthetic data (real data is untouched)
 */
import { addSession, clearSynthetic, getProfile, seedProfile } from "../src/lib/store";
import { PROMOTION_SCORE } from "../src/lib/scoring";

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const PEOPLE = [
  { id: "demo-ava", name: "Ava (demo)", skill: 0.55, learn: 0.035 },
  { id: "demo-ben", name: "Ben (demo)", skill: 0.4, learn: 0.05 },
  { id: "demo-cam", name: "Cam (demo)", skill: 0.7, learn: 0.02 },
];

async function seed() {
  for (const [i, p] of PEOPLE.entries()) {
    if (await getProfile(p.id)) continue;
    await seedProfile({ id: p.id, name: p.name, level: 1, bestScore: 0, createdAt: new Date().toISOString() });
    const r = rng(i + 7);
    let level = 1;
    for (let n = 0; n < 14; n++) {
      // harder levels knock performance back, so progression takes several sessions
      const skill = clamp(p.skill + p.learn * n * 0.6 - (level - 1) * 0.12 + (r() - 0.5) * 0.12, 0, 0.97);
      const date = new Date(Date.now() - (14 - n) * 2 * 86400000).toISOString();
      const { session, promoted } = await addSession({
        userId: p.id,
        level,
        date,
        source: "synthetic",
        metrics: {
          accuracy: clamp(40 + skill * 58 + (r() - 0.5) * 6, 0, 100),
          avgDeviationMm: clamp(7 - skill * 5.5 + (r() - 0.5), 0.3, 20),
          tremor: clamp(60 - skill * 50 + (r() - 0.5) * 8, 0, 100),
          smoothness: clamp(35 + skill * 62 + (r() - 0.5) * 8, 0, 100),
          completionTimeS: clamp(75 - skill * 35 + (r() - 0.5) * 8, 10, 200),
        },
      });
      if (promoted) level = session.level + 1;
    }
  }
  console.log(`Seeded demo data (promotion threshold ${PROMOTION_SCORE}).`);
}

const cmd = process.argv[2];
if (cmd === "clear") clearSynthetic().then((r) => console.log("Removed", r));
else seed();
