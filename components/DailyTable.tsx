"use client";

import { useMemo, useState } from "react";
import { brl, num, pct } from "@/lib/format";

export type DailyTableRow = {
  date: string; spend: number; vendas: number; fat: number; cpa: number; roas: number;
  impressions: number; linkClicks: number; lpv: number; checkout: number; ctr: number; cpm: number;
  cplpv: number; cpco: number; connectRate: number; convRate: number;
};

type Col = { key: keyof DailyTableRow; label: string; fmt: (r: DailyTableRow) => string };

const COLS: Col[] = [
  { key: "spend", label: "Investido", fmt: (r) => brl(r.spend) },
  { key: "vendas", label: "Vendas", fmt: (r) => num(r.vendas) },
  { key: "fat", label: "Faturam.", fmt: (r) => brl(r.fat) },
  { key: "cpa", label: "CPA", fmt: (r) => (r.vendas ? brl(r.cpa) : "—") },
  { key: "roas", label: "ROAS", fmt: (r) => (r.spend ? `${num(r.roas, 2)}x` : "—") },
  { key: "impressions", label: "Impr.", fmt: (r) => num(r.impressions) },
  { key: "linkClicks", label: "Cliques", fmt: (r) => num(r.linkClicks) },
  { key: "lpv", label: "Pág.", fmt: (r) => num(r.lpv) },
  { key: "cplpv", label: "Custo/Pág", fmt: (r) => (r.lpv ? brl(r.cplpv) : "—") },
  { key: "checkout", label: "Checkout", fmt: (r) => num(r.checkout) },
  { key: "cpco", label: "Custo/Chk", fmt: (r) => (r.checkout ? brl(r.cpco) : "—") },
  { key: "connectRate", label: "Connect", fmt: (r) => (r.linkClicks ? pct(r.connectRate, 1) : "—") },
  { key: "convRate", label: "Tx Conv", fmt: (r) => (r.linkClicks ? pct(r.convRate, 2) : "—") },
  { key: "ctr", label: "CTR", fmt: (r) => pct(r.ctr, 2) },
  { key: "cpm", label: "CPM", fmt: (r) => brl(r.cpm) },
];

const brDate = (iso: string) => iso.split("-").reverse().join("/");
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const weekday = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

function cpaColor(cpa: number, target: number) {
  if (!cpa) return "var(--muted-2)";
  if (cpa <= target) return "var(--emerald)";
  if (cpa <= target * 1.6) return "var(--amber)";
  return "var(--rose)";
}

function totalsOf(rows: DailyTableRow[]): DailyTableRow {
  const t = rows.reduce((a, r) => {
    a.spend += r.spend; a.vendas += r.vendas; a.fat += r.fat; a.impressions += r.impressions;
    a.linkClicks += r.linkClicks; a.lpv += r.lpv; a.checkout += r.checkout;
    return a;
  }, { date: "", spend: 0, vendas: 0, fat: 0, cpa: 0, roas: 0, impressions: 0, linkClicks: 0, lpv: 0, checkout: 0, ctr: 0, cpm: 0, cplpv: 0, cpco: 0, connectRate: 0, convRate: 0 } as DailyTableRow);
  t.cpa = t.vendas ? t.spend / t.vendas : 0;
  t.roas = t.spend ? t.fat / t.spend : 0;
  t.ctr = t.impressions ? t.linkClicks / t.impressions : 0;
  t.cpm = t.impressions ? (t.spend / t.impressions) * 1000 : 0;
  t.cplpv = t.lpv ? t.spend / t.lpv : 0;
  t.cpco = t.checkout ? t.spend / t.checkout : 0;
  t.connectRate = t.linkClicks ? t.lpv / t.linkClicks : 0;
  t.convRate = t.linkClicks ? t.vendas / t.linkClicks : 0;
  return t;
}

export function DailyTable({ rows, target = 90, pageSize = 14 }: { rows: DailyTableRow[]; target?: number; pageSize?: number }) {
  const [sortKey, setSortKey] = useState<keyof DailyTableRow>("date");
  const [asc, setAsc] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const totals = useMemo(() => totalsOf(rows), [rows]);
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === "date") return asc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      const av = a[sortKey] as number, bv = b[sortKey] as number;
      return asc ? av - bv : bv - av;
    });
  }, [rows, sortKey, asc]);

  const visible = expanded ? sorted : sorted.slice(0, pageSize);
  const onSort = (k: keyof DailyTableRow) => {
    if (k === sortKey) setAsc(!asc);
    else { setSortKey(k); setAsc(k === "date" ? true : false); }
  };

  const cell = (r: DailyTableRow) =>
    COLS.map((c) => (
      <td
        key={String(c.key)}
        className="whitespace-nowrap px-2.5 py-2.5 text-right tnum"
        style={c.key === "cpa" ? { color: cpaColor(r.cpa, target), fontWeight: 600 } : c.key === "roas" && r.roas >= 1 ? { color: "var(--emerald)" } : undefined}
      >
        {c.fmt(r)}
      </td>
    ));

  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-[var(--muted-2)]">
              <th onClick={() => onSort("date")} className="sticky left-0 z-10 cursor-pointer select-none bg-[var(--panel)] px-3 py-2.5 text-left font-medium">
                Data<span className="ml-1 text-[var(--accent)]">{sortKey === "date" ? (asc ? "▲" : "▼") : ""}</span>
              </th>
              {COLS.map((c) => (
                <th key={String(c.key)} onClick={() => onSort(c.key)} className="cursor-pointer select-none whitespace-nowrap px-2.5 py-2.5 text-right font-medium transition-colors hover:text-[var(--text)]">
                  {c.label}<span className="ml-1 text-[var(--accent)]">{sortKey === c.key ? (asc ? "▲" : "▼") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Totais do período */}
            <tr className="border-t border-[var(--border)]" style={{ background: "color-mix(in srgb,var(--accent) 8%,transparent)" }}>
              <td className="sticky left-0 z-10 px-3 py-2.5 font-semibold" style={{ background: "color-mix(in srgb,var(--accent) 12%,var(--panel))" }}>Total</td>
              {cell(totals)}
            </tr>
            {visible.map((r) => (
              <tr key={r.date} className="border-t border-[var(--border-soft)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-[var(--panel)] px-3 py-2.5">
                  <span className="font-medium text-[var(--text)] tnum">{brDate(r.date)}</span>
                  <span className="ml-1.5 text-[11px] text-[var(--muted-2)]">{weekday(r.date)}</span>
                </td>
                {cell(r)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length > pageSize && (
        <div className="mt-3 flex">
          <button onClick={() => setExpanded(!expanded)} className="ml-auto rounded-lg border border-[var(--border-soft)] px-4 py-2 text-[12px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--text)]">
            {expanded ? "Mostrar menos" : `Ver todos os ${sorted.length} dias`}
          </button>
        </div>
      )}
    </div>
  );
}
