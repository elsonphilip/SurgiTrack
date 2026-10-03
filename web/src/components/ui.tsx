import type { CSSProperties, ReactNode } from "react";

export function Demo() {
  return <span className="demo">DEMO</span>;
}

export function CardHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <span className="card-title">{title}</span>
      {right ?? <span className="muted" style={{ letterSpacing: ".15em" }}>···</span>}
    </div>
  );
}

export function Stat({ value, label, trend }: { value: ReactNode; label: string; trend?: { text: string; color: string } }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {trend && <span style={{ fontSize: 13, color: trend.color }}>{trend.text}</span>}
      <span className="big">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** Dot-matrix columns: each column is `lit` of 6 dots, bottom-up. */
export function DotMatrix({ cols }: { cols: { lit: number; color: string }[] }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 4, paddingBottom: 22 }}>
      {cols.map((c, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column-reverse", gap: 6 }}>
          {Array.from({ length: 6 }, (_, j) => (
            <span
              key={j}
              style={{ width: 11, height: 11, borderRadius: "50%", background: j < c.lit ? c.color : "var(--grid)" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Full-bleed polyline chart that spills past the card padding. */
export function BleedLines({ lines }: { lines: { path: string; color: string }[] }) {
  return (
    <svg viewBox="0 0 300 80" preserveAspectRatio="none" style={{ width: "calc(100% + 56px)", margin: "0 -28px", height: 90, display: "block" }}>
      {lines.map((l, i) => (
        <path key={i} d={l.path} fill="none" stroke={l.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

export function svgLine(vals: number[], w: number, h: number): string {
  if (vals.length < 2) return "";
  let mn = Math.min(...vals);
  let mx = Math.max(...vals);
  const pad = (mx - mn) * 0.25 || 1;
  mn -= pad;
  mx += pad;
  return "M" + vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)} ${(h - ((v - mn) / (mx - mn)) * h).toFixed(1)}`).join(" L");
}

export const LEGEND_DOT = (color: string): CSSProperties => ({
  width: 14,
  height: 14,
  borderRadius: "50%",
  border: `4px solid ${color}`,
});

export function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
