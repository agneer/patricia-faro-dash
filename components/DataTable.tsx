"use client";

import { useMemo, useState } from "react";
import type { BreakdownRow, AdStatus } from "@/lib/windsor";
import { brl, num, pct } from "@/lib/format";

type Col = { key: keyof BreakdownRow; label: string; fmt: (r: BreakdownRow) => string };

const COLS: Col[] = [
  { key: "spend", label: "Investido", fmt: (r) => brl(r.spend) },
  { key: "purchases", label: "Compras", fmt: (r) => num(r.purchases) },
  { key: "cpa", label: "CPA", fmt: (r) => (r.purchases ? brl(r.cpa) : "—") },
  { key: "roas", label: "ROAS", fmt: (r) => (r.spend ? `${num(r.roas, 2)}x` : "—") },
  { key: "cplpv", label: "Custo/Pág", fmt: (r) => (r.lpv ? brl(r.cplpv) : "—") },
  { key: "checkout", label: "Checkouts", fmt: (r) => num(r.checkout) },
  { key: "cpco", label: "Custo/Chk", fmt: (r) => (r.checkout ? brl(r.cpco) : "—") },
  { key: "connectRate", label: "Connect", fmt: (r) => (r.linkClicks ? pct(r.connectRate, 1) : "—") },
  { key: "checkoutRate", label: "Chkout/Pág", fmt: (r) => (r.lpv ? pct(r.checkoutRate, 1) : "—") },
  { key: "closeRate", label: "Compra/Chk", fmt: (r) => (r.checkout ? pct(r.closeRate, 1) : "—") },
  { key: "convRate", label: "Tx Conv", fmt: (r) => (r.linkClicks ? pct(r.convRate, 2) : "—") },
  { key: "ctr", label: "CTR", fmt: (r) => pct(r.ctr, 2) },
  { key: "cpm", label: "CPM", fmt: (r) => brl(r.cpm) },
];

function cpaColor(cpa: number, target: number) {
  if (!cpa) return "var(--muted-2)";
  if (cpa <= target) return "var(--emerald)";
  if (cpa <= target * 1.6) return "var(--amber)";
  return "var(--rose)";
}

function StatusBadge({ status }: { status?: AdStatus }) {
  if (!status) return null;
  const color = status.active ? "var(--emerald)" : "var(--muted-2)";
  return (
    <span
      title={status.active ? "Anúncio ativo agora" : `Não está rodando agora: ${status.label.toLowerCase()}`}
      className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-[1px] text-[10px] font-semibold leading-none"
      style={{ color, background: `color-mix(in srgb,${color} 14%,transparent)` }}
    >
      {status.active ? "● " : "○ "}{status.label}
    </span>
  );
}

function Cells({ r, target }: { r: BreakdownRow; target: number }) {
  return (
    <>
      {COLS.map((c) => (
        <td
          key={String(c.key)}
          className="whitespace-nowrap px-2.5 py-2.5 text-right tnum"
          style={c.key === "cpa" ? { color: cpaColor(r.cpa, target), fontWeight: 600 } : c.key === "roas" && r.roas >= 1 ? { color: "var(--emerald)" } : undefined}
        >
          {c.fmt(r)}
        </td>
      ))}
    </>
  );
}

export function DataTable({
  rows, firstLabel, target = 90, pageSize = 8,
}: {
  rows: BreakdownRow[];
  firstLabel: string;
  target?: number;
  pageSize?: number;
}) {
  const [sortKey, setSortKey] = useState<keyof BreakdownRow>("spend");
  const [asc, setAsc] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const hasTree = rows.some((r) => r.children && r.children.length > 1);
  const maxSpend = Math.max(...rows.map((r) => r.spend), 1);
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey] as number, bv = b[sortKey] as number;
      return asc ? av - bv : bv - av;
    });
  }, [rows, sortKey, asc]);

  const visible = expanded ? sorted : sorted.slice(0, pageSize);

  const onSort = (k: keyof BreakdownRow) => {
    if (k === sortKey) setAsc(!asc);
    else { setSortKey(k); setAsc(false); }
  };
  const toggle = (label: string) => setOpen((o) => ({ ...o, [label]: !o[label] }));

  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-[var(--muted-2)]">
              <th className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2.5 text-left font-medium">{firstLabel}</th>
              {COLS.map((c) => (
                <th
                  key={String(c.key)}
                  onClick={() => onSort(c.key)}
                  className="cursor-pointer select-none whitespace-nowrap px-2.5 py-2.5 text-right font-medium transition-colors hover:text-[var(--text)]"
                >
                  {c.label}
                  <span className="ml-1 text-[var(--accent)]">{sortKey === c.key ? (asc ? "▲" : "▼") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const canExpand = !!(r.children && r.children.length > 1);
              const isOpen = open[r.label];
              return (
                <FragmentRow key={r.label + i}>
                  <tr className="border-t border-[var(--border-soft)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]" style={r.status && !r.spend ? { opacity: 0.6 } : undefined}>
                    <td className="sticky left-0 z-10 max-w-[280px] bg-[var(--panel)] px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        {hasTree && (
                          <button
                            onClick={() => canExpand && toggle(r.label)}
                            disabled={!canExpand}
                            aria-label={isOpen ? "Recolher conjuntos" : "Ver conjuntos"}
                            className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-[12px] font-bold leading-none transition-colors"
                            style={canExpand
                              ? { color: isOpen ? "#fff" : "var(--accent)", background: isOpen ? "var(--accent)" : "color-mix(in srgb,var(--accent) 16%,transparent)", cursor: "pointer" }
                              : { color: "transparent", background: "transparent", cursor: "default" }}
                          >
                            {canExpand ? (isOpen ? "−" : "+") : ""}
                          </button>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-[var(--text)]" title={r.label}>{r.label}</span>
                            {r.postUrl && (
                              <a
                                href={r.postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Ver post do criativo"
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 rounded-md px-1.5 py-[1px] text-[10px] font-semibold leading-none transition-colors"
                                style={{ color: "var(--cyan)", background: "color-mix(in srgb,var(--cyan) 14%,transparent)" }}
                              >
                                post ↗
                              </a>
                            )}
                            <StatusBadge status={r.status} />
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <div className="h-1 w-16 overflow-hidden rounded-full bg-[var(--bg-elev)]">
                              <div className="h-full rounded-full" style={{ width: `${(r.spend / maxSpend) * 100}%`, background: "linear-gradient(90deg,var(--accent),var(--accent-2))" }} />
                            </div>
                            <span className="truncate text-[11px] text-[var(--muted-2)]">{r.sub ?? pct(r.spend / maxSpend, 0) + " do gasto"}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <Cells r={r} target={target} />
                  </tr>

                  {isOpen && r.children!.map((c, ci) => (
                    <tr key={r.label + "::" + c.label + ci} style={{ background: "color-mix(in srgb,var(--accent) 4%,transparent)" }} className="border-t border-[var(--border-soft)]">
                      <td className="sticky left-0 z-10 max-w-[280px] px-3 py-2" style={{ background: "var(--bg-elev)" }}>
                        <div className="flex items-center gap-2 pl-[26px]">
                          <span className="text-[var(--muted-2)]">↳</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[12.5px] text-[var(--muted)]" title={c.label}>{c.label}</span>
                              <StatusBadge status={c.status} />
                            </div>
                            <div className="mt-1 h-[3px] w-14 overflow-hidden rounded-full bg-[var(--bg)]">
                              <div className="h-full rounded-full" style={{ width: `${r.spend ? (c.spend / r.spend) * 100 : 0}%`, background: "var(--cyan)" }} />
                            </div>
                          </div>
                          <span className="ml-auto whitespace-nowrap text-[10.5px] text-[var(--muted-2)] tnum">{r.spend ? `${pct(c.spend / r.spend, 0)} do criativo` : "sem gasto no período"}</span>
                        </div>
                      </td>
                      <Cells r={c} target={target} />
                    </tr>
                  ))}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {hasTree && (
          <span className="text-[11px] text-[var(--muted-2)]">➕ abre a quebra por conjunto dos criativos repetidos</span>
        )}
        {sorted.length > pageSize && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto rounded-lg border border-[var(--border-soft)] px-4 py-2 text-[12px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            {expanded ? "Mostrar menos" : `Ver todos os ${sorted.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

// tbody only allows <tr> children, so group a row + its children with a fragment.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
