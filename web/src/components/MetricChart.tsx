"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Point {
  label: string; // x-axis label (e.g. "Oct 3")
  value: number;
}

interface Props {
  title: string;
  hint: string; // e.g. "Higher is better"
  unit?: string;
  data: Point[];
  domain?: [number | "auto", number | "auto"];
  decimals?: number;
}

export function MetricChart({ title, hint, unit = "", data, domain = [0, "auto"], decimals = 1 }: Props) {
  const [table, setTable] = useState(false);
  const fmt = (v: number) => `${v.toFixed(decimals)}${unit}`;
  const last = data.at(-1);

  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums">{last ? fmt(last.value) : "—"}</div>
          <button
            onClick={() => setTable((t) => !t)}
            className="text-xs text-ink2 underline-offset-2 hover:underline"
          >
            {table ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No sessions yet.</p>
      ) : table ? (
        <div className="mt-3 max-h-48 overflow-auto text-sm">
          <table className="w-full">
            <tbody>
              {data.map((d, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 text-ink2">{d.label}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
              <YAxis domain={domain} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                formatter={(v) => [fmt(Number(v)), title]}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--text)" }}
                labelStyle={{ color: "var(--text-2)" }}
                cursor={{ stroke: "var(--muted)", strokeDasharray: "0" }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--series)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 3, fill: "var(--series)", stroke: "var(--surface)", strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
