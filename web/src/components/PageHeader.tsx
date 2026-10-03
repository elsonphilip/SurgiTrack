import type { ReactNode } from "react";
import { LEVELS } from "@/lib/scoring";

export function PageHeader({ title, level, children }: { title: string; level?: number; children?: ReactNode }) {
  const lv = level ? LEVELS[level - 1] : null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "8px 0 4px" }}>
      <h1 className="head" style={{ margin: 0, fontSize: "clamp(34px,4vw,52px)", lineHeight: 1, letterSpacing: "-.01em" }}>{title}</h1>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {children}
        {lv && (
          <>
            <div className="ctl"><span className="muted">Level:</span><b>L{lv.level} {lv.name}</b></div>
            <div className="ctl"><span className="muted">Tolerance:</span><b>±{lv.toleranceMm} mm</b></div>
          </>
        )}
      </div>
    </div>
  );
}
