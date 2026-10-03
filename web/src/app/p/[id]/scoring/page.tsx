import { notFound } from "next/navigation";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getProfile } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const DEFS = [
  { name: "Accuracy", src: "camera + IMU", f: "ACC = 100 · N(dᵢ ≤ τ) / N", body: "Share of samples where the tracked fingertip stays within the level’s tolerance band τ (3.0 mm at L1 down to 1.0 mm at L5)." },
  { name: "Path deviation", src: "mediapipe lm 8", f: "DEV = (1/N) · Σ dᵢ   [mm]", body: "Mean distance between the index-tip landmark and the nearest point on the target path. Pixels → mm using HC-SR04 height." },
  { name: "Tremor index", src: "BMI270 accel", f: "TRM = 10 · clip(RMS₄₋₁₂Hz(a) / (k · σ_base), 0, 1)", body: "Band-limited acceleration power in the involuntary tremor band, over the calibration noise floor. k is fit experimentally." },
  { name: "Smoothness", src: "BMI270 accel", f: "SM = 100 − α · LDLJ", body: "Log dimensionless jerk: controlled strokes score low jerk, hesitant or jerky strokes high. α scales onto 0–100." },
  { name: "Consistency", src: "database", f: "CON = σ(score, last 5)", body: "Lower is better. Combined with score thresholds to unlock the next level." },
  { name: "Overall score", src: "composite", f: "SCORE = .40·ACC + .25·SM + .20·(100 − 10·TRM) + .15·TIME", body: "TIME rewards finishing near the level’s target duration. Weights are a starting point to tune with real data." },
];

/** Held-out result written by pi/train.py (../models/report.json); "pending dataset" until a model is trained. */
async function testAccuracy(): Promise<string> {
  try {
    const r = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "..", "models", "report.json"), "utf8"));
    const m = r.holdout?.lightgbm;
    if (!m) return "pending dataset";
    return `F1 ${m.f1.toFixed(2)} · FPR ${m.false_positive_rate.toFixed(2)} · ${r.n_participants} people`;
  } catch {
    return "pending dataset";
  }
}

export default async function Scoring({ params }: PageProps<"/p/[id]/scoring">) {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const CHIPS = [
    ["Input", "6-ch IMU · 2 s windows"],
    ["Model", "LightGBM on Pi"],
    ["Split", "80 / 20 by participant"],
    ["Classes", "typical · elevated · refer"],
    ["Test acc.", await testAccuracy()],
  ];
  return (
    <>
      <PageHeader title="Scoring Model" level={profile.level} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 22 }}>
        {DEFS.map((d) => (
          <div key={d.name} className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span className="card-title">{d.name}</span>
              <span className="mono muted" style={{ height: 28, padding: "0 12px", borderRadius: 999, background: "var(--pill)", display: "flex", alignItems: "center", fontSize: 10.5, whiteSpace: "nowrap" }}>{d.src}</span>
            </div>
            <div className="mono" style={{ background: "var(--canvas)", borderRadius: 18, padding: "14px 16px", fontSize: 12.5, fontWeight: 500, lineHeight: 1.5 }}>{d.f}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "rgba(242,232,213,.78)", textWrap: "pretty" }}>{d.body}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--accent-dark)", borderRadius: 32, padding: "28px 30px", display: "flex", flexWrap: "wrap", gap: "24px 36px" }}>
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".1em" }}>MOVEMENT SCREENING · RESEARCH PROTOTYPE</span>
          <span className="head" style={{ fontSize: 28, lineHeight: 1.05 }}>Custom tremor classifier</span>
          <span style={{ fontSize: 14, lineHeight: 1.55, textWrap: "pretty" }}>
            Trained on our own IMU recordings to flag tremor patterns consistent with Parkinsonian or essential tremor. A screening signal that prompts a clinical evaluation — not a diagnosis.
          </span>
        </div>
        <div style={{ flex: "1 1 320px", display: "flex", flexWrap: "wrap", gap: 8, alignContent: "flex-start" }}>
          {CHIPS.map(([k, v]) => (
            <span key={k} style={{ height: 44, padding: "0 6px 0 16px", borderRadius: 999, background: "rgba(11,42,34,.45)", display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              {k}
              <span className="mono" style={{ height: 32, padding: "0 12px", borderRadius: 999, background: "var(--cream)", color: "var(--card)", display: "flex", alignItems: "center", fontSize: 11.5, fontWeight: 600 }}>{v}</span>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
