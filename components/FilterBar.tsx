"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

const PRESETS = [
  { v: "today", label: "Hoje" },
  { v: "yesterday", label: "Ontem" },
  { v: "3d", label: "3 dias" },
  { v: "5d", label: "5 dias" },
  { v: "7d", label: "7 dias" },
  { v: "14d", label: "14 dias" },
  { v: "30d", label: "30 dias" },
  { v: "90d", label: "90 dias" },
  { v: "this_month", label: "Este mês" },
  { v: "last_month", label: "Mês passado" },
  { v: "all", label: "Máx" },
];

export function FilterBar({ current, from, to, min, max }: { current: string; from: string; to: string; min: string; max: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(current === "custom");
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  // Preserve unrelated params (e.g. the tax toggle) when changing the period.
  const push = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params.toString());
    p.delete("preset"); p.delete("from"); p.delete("to");
    mutate(p);
    start(() => router.push(`/?${p.toString()}`, { scroll: false }));
  };
  const setPreset = (v: string) => { setOpen(false); push((p) => p.set("preset", v)); };
  const applyCustom = () => { if (f && t) push((p) => { p.set("from", f); p.set("to", t); }); };
  const refresh = () => start(() => router.refresh());

  const customActive = current === "custom";

  return (
    <div className="flex flex-col items-stretch gap-2 lg:items-end" style={{ opacity: pending ? 0.55 : 1 }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap items-center rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-1">
          {PRESETS.map((o) => {
            const active = o.v === current;
            return (
              <button
                key={o.v}
                onClick={() => setPreset(o.v)}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all"
                style={active ? { background: "linear-gradient(180deg,var(--accent),var(--accent-2))", color: "#fff", boxShadow: "0 4px 14px color-mix(in srgb,var(--accent) 40%,transparent)" } : { color: "var(--muted)" }}
              >
                {o.label}
              </button>
            );
          })}
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all"
            style={customActive ? { background: "linear-gradient(180deg,var(--accent),var(--accent-2))", color: "#fff" } : { color: open ? "var(--text)" : "var(--muted)" }}
          >
            📅 Personalizar
          </button>
        </div>

        <button
          onClick={refresh}
          title="Atualizar dados"
          className="grid h-[38px] w-[38px] place-items-center rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] text-[15px] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
        >
          <span style={{ display: "inline-block", animation: pending ? "spin 0.7s linear infinite" : "none" }}>↻</span>
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-2">
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            De
            <input type="date" value={f} min={min} max={max} onChange={(e) => setF(e.target.value)}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] px-2 py-1.5 text-[12px] text-[var(--text)] tnum [color-scheme:dark]" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            até
            <input type="date" value={t} min={min} max={max} onChange={(e) => setT(e.target.value)}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] px-2 py-1.5 text-[12px] text-[var(--text)] tnum [color-scheme:dark]" />
          </label>
          <button
            onClick={applyCustom}
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
            style={{ background: "linear-gradient(180deg,var(--accent),var(--accent-2))" }}
          >
            Aplicar
          </button>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
