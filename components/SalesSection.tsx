"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { brl, num, pct, shortDate } from "@/lib/format";
import { SectionTitle, MiniStat } from "@/components/ui";

type Ticket = { ticket: number; count: number; gross: number; net: number };
type Day = { date: string; count: number; gross: number; net: number; perTicket: Record<string, number> };

const TICKET_COLORS = ["#22d3ee", "#6366f1", "#8b5cf6", "#34d399", "#fbbf24", "#fb7185"];

export function SalesSection({
  total, gross, net, avgTicket, spend, withTax, tickets, byDay,
}: {
  total: number; gross: number; net: number; avgTicket: number; spend: number; withTax: boolean;
  tickets: Ticket[]; byDay: Day[];
}) {
  const cpa = total ? spend / total : 0;
  const roasBruto = spend ? gross / spend : 0;
  const roasLiq = spend ? net / spend : 0;

  // top tickets for the stacked chart; the rest collapse into "Outros"
  const top = tickets.slice(0, 5);
  const topKeys = top.map((t) => String(t.ticket));
  const chart = byDay.map((d) => {
    const row: Record<string, number | string> = { label: shortDate(d.date) };
    let outros = 0;
    for (const [k, v] of Object.entries(d.perTicket)) {
      if (topKeys.includes(k)) row[`t${k}`] = ((row[`t${k}`] as number) ?? 0) + v;
      else outros += v;
    }
    for (const k of topKeys) if (row[`t${k}`] == null) row[`t${k}`] = 0;
    row.outros = outros;
    return row;
  });
  const maxTicketCount = Math.max(...tickets.map((t) => t.count), 1);

  return (
    <section className="panel fade-up mt-4 p-5" style={{ borderColor: "color-mix(in srgb, var(--cyan) 30%, var(--border))" }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon="💳" title="Vendas reais · Hotmart" hint={`${num(total)} vendas no período`} />
        <span className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--cyan)", background: "color-mix(in srgb,var(--cyan) 13%,transparent)" }}>fonte: Hotmart (não pixel)</span>
      </div>

      {/* KPIs reais */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MiniStat label="Vendas" value={num(total)} hint="pagas no período" />
        <MiniStat label="Fat. Bruto" value={brl(gross)} hint="valor total das vendas" />
        <MiniStat label="Fat. Líquido" value={brl(net)} hint="bruto − taxas Hotmart" />
        <MiniStat label="Ticket médio" value={brl(avgTicket)} hint="bruto / vendas" />
        <MiniStat label="CPA real" value={total ? brl(cpa) : "—"} hint={withTax ? "gasto c/ imp ÷ vendas" : "gasto ÷ vendas"} />
        <MiniStat label="ROAS real" value={spend ? `${num(roasBruto, 2)}x` : "—"} hint={`líq. ${num(roasLiq, 2)}x`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* vendas por dia, empilhado por ticket */}
        <div>
          <h3 className="mb-3 text-[13px] font-medium text-[var(--muted)]">Vendas por dia · empilhado por ticket (com order bump)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chart} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1c2438" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#6b7795", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#1c2438" }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tick={{ fill: "#6b7795", fontSize: 11 }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#0d1322", border: "1px solid #20293f", borderRadius: 12, fontSize: 12, color: "#eef2ff" }}
                labelStyle={{ color: "#97a3c0" }}
                formatter={(v, name) => [num(Number(v)), String(name)]}
              />
              {top.map((t, i) => (
                <Bar key={t.ticket} dataKey={`t${t.ticket}`} stackId="s" fill={TICKET_COLORS[i]} name={`R$ ${t.ticket}`} radius={i === top.length - 1 ? [3, 3, 0, 0] : undefined} maxBarSize={34} />
              ))}
              <Bar dataKey="outros" stackId="s" fill="#3b4664" name="Outros" radius={[3, 3, 0, 0]} maxBarSize={34} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* quebra por ticket */}
        <div>
          <h3 className="mb-3 text-[13px] font-medium text-[var(--muted)]">Quantidade & faturamento por ticket</h3>
          <div className="flex flex-col gap-2">
            {tickets.slice(0, 8).map((t, i) => (
              <div key={t.ticket} className="panel-soft p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] font-semibold tnum">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: TICKET_COLORS[i] ?? "#3b4664" }} />
                    R$ {t.ticket}
                  </span>
                  <span className="text-[13px] font-semibold tnum">{num(t.count)} <span className="text-[11px] font-normal text-[var(--muted-2)]">vendas</span></span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                  <div className="h-full rounded-full" style={{ width: `${(t.count / maxTicketCount) * 100}%`, background: TICKET_COLORS[i] ?? "#3b4664" }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--muted-2)] tnum">
                  <span>{pct(t.count / total, 1)} das vendas</span>
                  <span>{brl(t.gross)} bruto</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
