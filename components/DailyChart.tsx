"use client";

import { useState } from "react";
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { brl, num, pct, shortDate } from "@/lib/format";

type Row = { date: string; spend: number; purchases: number; cpa: number; ctr: number; roas: number; lpv: number };

const METRICS = {
  purchases: { label: "Compras", color: "#22d3ee", fmt: (v: number) => num(v), kind: "bar" },
  spend: { label: "Investimento", color: "#6366f1", fmt: (v: number) => brl(v), kind: "area" },
  cpa: { label: "CPA", color: "#fb7185", fmt: (v: number) => brl(v), kind: "line" },
  ctr: { label: "CTR", color: "#34d399", fmt: (v: number) => pct(v, 2), kind: "line" },
  roas: { label: "ROAS", color: "#fbbf24", fmt: (v: number) => `${num(v, 2)}x`, kind: "line" },
} as const;

type Key = keyof typeof METRICS;

export function DailyChart({ data }: { data: Row[] }) {
  const [left, setLeft] = useState<Key>("spend");
  const [right, setRight] = useState<Key>("purchases");

  const rows = data.map((d) => ({ ...d, label: shortDate(d.date) }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {(Object.keys(METRICS) as Key[]).map((k) => {
          const active = k === left || k === right;
          const m = METRICS[k];
          return (
            <button
              key={k}
              onClick={() => { if (k !== left) setRight(k); }}
              onContextMenu={(e) => { e.preventDefault(); if (k !== right) setLeft(k); }}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                color: active ? "#fff" : "var(--muted)",
                background: active ? `color-mix(in srgb, ${m.color} 22%, transparent)` : "var(--bg-elev)",
                border: `1px solid ${active ? `color-mix(in srgb, ${m.color} 55%, transparent)` : "var(--border-soft)"}`,
              }}
            >
              <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: m.color }} />
              {m.label}
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-[var(--muted-2)]">clique = série secundária · clique direito = série principal</span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={rows} margin={{ top: 8, right: 6, left: 6, bottom: 0 }}>
          <defs>
            <linearGradient id="gLeft" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={METRICS[left].color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={METRICS[left].color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1c2438" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#6b7795", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#1c2438" }} interval="preserveStartEnd" minTickGap={18} />
          <YAxis yAxisId="l" tick={{ fill: "#6b7795", fontSize: 11 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => num(v)} />
          <YAxis yAxisId="r" orientation="right" tick={{ fill: "#6b7795", fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => num(v)} />
          <Tooltip
            contentStyle={{ background: "#0d1322", border: "1px solid #20293f", borderRadius: 12, fontSize: 12, color: "#eef2ff", boxShadow: "0 12px 30px rgba(0,0,0,.45)" }}
            labelStyle={{ color: "#97a3c0", marginBottom: 4 }}
            formatter={(value, name) => {
              const k = (Object.keys(METRICS) as Key[]).find((x) => METRICS[x].label === name);
              return [k ? METRICS[k].fmt(Number(value)) : String(value), String(name)];
            }}
          />
          {METRICS[left].kind === "area" ? (
            <Area yAxisId="l" type="monotone" dataKey={left} name={METRICS[left].label} stroke={METRICS[left].color} strokeWidth={2} fill="url(#gLeft)" />
          ) : METRICS[left].kind === "bar" ? (
            <Bar yAxisId="l" dataKey={left} name={METRICS[left].label} fill={METRICS[left].color} radius={[4, 4, 0, 0]} maxBarSize={26} />
          ) : (
            <Line yAxisId="l" type="monotone" dataKey={left} name={METRICS[left].label} stroke={METRICS[left].color} strokeWidth={2.4} dot={false} />
          )}
          {METRICS[right].kind === "bar" ? (
            <Bar yAxisId="r" dataKey={right} name={METRICS[right].label} fill={METRICS[right].color} radius={[4, 4, 0, 0]} maxBarSize={26} />
          ) : (
            <Line yAxisId="r" type="monotone" dataKey={right} name={METRICS[right].label} stroke={METRICS[right].color} strokeWidth={2.4} dot={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
