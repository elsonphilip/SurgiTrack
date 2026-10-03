"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RawSample } from "@/lib/types";

export function SessionTrace({ raw }: { raw: RawSample[] }) {
  // Movement magnitude with gravity roughly removed (mean subtracted per axis).
  const mean = (k: "ax" | "ay" | "az") => raw.reduce((s, r) => s + r[k], 0) / raw.length;
  const [mx, my, mz] = [mean("ax"), mean("ay"), mean("az")];
  const step = Math.max(1, Math.floor(raw.length / 600)); // keep the chart light
  const data = raw
    .filter((_, i) => i % step === 0)
    .map((r) => ({ t: Number(r.t.toFixed(2)), mag: Math.hypot(r.ax - mx, r.ay - my, r.az - mz) }));

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} unit="s" />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            formatter={(v) => [`${Number(v).toFixed(3)} g`, "Movement"]}
            labelFormatter={(l) => `${l}s`}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
          />
          <Line type="linear" dataKey="mag" stroke="var(--series)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
