import { getDashboardData, type Trend } from "@/lib/windsor";
import { getSalesData } from "@/lib/sales";
import { EduzzSection } from "@/components/EduzzSection";
import { brl, num, pct } from "@/lib/format";
import { KpiCard, SectionTitle } from "@/components/ui";
import { Funnel } from "@/components/Funnel";
import { DailyChart } from "@/components/DailyChart";
import { DailyTable } from "@/components/DailyTable";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { TaxToggle } from "@/components/TaxToggle";
import { CampaignFilter } from "@/components/CampaignFilter";
import { ProductToggle } from "@/components/ProductToggle";
import { CONFIG, PRODUCTS, MULTI_PRODUCT } from "@/lib/config";

export const dynamic = "force-dynamic";

const brDate = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

const TEMP_COLORS: Record<string, string> = {
  Frio: "#22d3ee",
  Morno: "#fbbf24",
  Quente: "#fb7185",
  Aberto: "#8b5cf6",
};
const tColor = (label: string) => TEMP_COLORS[label.split(" ")[0]] ?? "#6366f1";

export default async function Page({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string; to?: string; tax?: string; campaign?: string; product?: string }> }) {
  const sp = await searchParams;
  const d = await getDashboardData({ preset: sp.preset, from: sp.from, to: sp.to, tax: sp.tax === "1", campaign: sp.campaign, product: sp.product });
  const k = d.kpi;
  const taxPct = (d.taxRate * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Previous period (same length, immediately before) for the KPI trends.
  const addDays = (iso: string, n: number) => { const t = Date.parse(iso) + n * 86400000; return new Date(t).toISOString().slice(0, 10); };
  const prevTo = addDays(d.range.from, -1);
  const prevFrom = addDays(prevTo, -(d.range.days - 1));

  // Fetch current + previous-period sales (and prev dashboard) in parallel.
  const [sales, prevSalesRaw, prevD] = await Promise.all([
    getSalesData(d.range.from, d.range.to, d.campaign, d.product),
    getSalesData(prevFrom, prevTo, d.campaign, d.product),
    getDashboardData({ from: prevFrom, to: prevTo, tax: sp.tax === "1", campaign: sp.campaign, product: sp.product, lite: true }),
  ]);

  // Use real Eduzz sales for Compras/CPA/ROAS/Ticket when available.
  const useEduzz = sales.available && sales.total > 0;
  const prevSales = useEduzz ? prevSalesRaw : null;
  const prevSpend = useEduzz ? prevD.kpi.spend : undefined;

  const mkTrend = (curr: number, prev: number | undefined, lowerBetter = false): Trend => {
    if (!prev) return null;
    const v = (curr - prev) / prev;
    const dir = Math.abs(v) < 0.001 ? "flat" : v > 0 ? "up" : "down";
    return { value: v, dir, good: dir === "flat" ? true : lowerBetter ? v < 0 : v > 0 };
  };

  // Real KPIs from Eduzz (spend stays from Windsor, tax-aware).
  const eduzzCpa = sales.total ? k.spend / sales.total : 0;
  const eduzzRoas = k.spend ? sales.gross / k.spend : 0;
  const eduzzRoasLiq = k.spend ? sales.net / k.spend : 0;
  const prevCpa = prevSpend && prevSales?.total ? prevSpend / prevSales.total : undefined;
  const prevRoas = prevSpend && prevSales ? prevSales.gross / prevSpend : undefined;
  const eComprasSpark = sales.byDay.map((b) => b.count);
  const eTicketSpark = sales.byDay.map((b) => (b.count ? b.gross / b.count : 0));

  const spendSpark = d.daily.map((x) => x.spend);
  const purchSpark = d.daily.map((x) => x.purchases);
  const cpaSpark = d.daily.map((x) => x.cpa);
  const roasSpark = d.daily.map((x) => x.roas);
  const totalTempSpend = d.temperature.reduce((a, t) => a + t.spend, 0) || 1;

  // Linhas da tabela diária: investimento (Meta) + vendas reais (Eduzz) por dia.
  const salesDayMap = new Map(sales.byDay.map((b) => [b.date, b]));
  const dailyRows = d.daily.map((x) => {
    const s = salesDayMap.get(x.date);
    const vendas = useEduzz ? (s?.count ?? 0) : x.purchases;
    const fat = useEduzz ? (s?.gross ?? 0) : x.value;
    return {
      date: x.date, spend: x.spend, vendas, fat,
      cpa: vendas ? x.spend / vendas : 0,
      roas: x.spend ? fat / x.spend : 0,
      impressions: x.impressions, linkClicks: x.link_clicks, lpv: x.lpv, checkout: x.checkout,
      ctr: x.ctr, cpm: x.impressions ? (x.spend / x.impressions) * 1000 : 0,
      cplpv: x.lpv ? x.spend / x.lpv : 0,
      cpco: x.checkout ? x.spend / x.checkout : 0,
      connectRate: x.link_clicks ? x.lpv / x.link_clicks : 0,
      convRate: x.link_clicks ? vendas / x.link_clicks : 0,
    };
  });

  const updated = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="mx-auto max-w-[1600px] px-4 pb-16 pt-5 sm:px-6">
      {/* Header */}
      <header className="fade-up mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl text-[20px]" style={{ background: "linear-gradient(140deg,var(--accent),var(--accent-2))", boxShadow: "0 6px 22px color-mix(in srgb,var(--accent) 45%,transparent)" }}>📡</div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[19px] font-semibold leading-none tracking-tight">{CONFIG.appName}</h1>
              <span className="rounded-full px-2 py-[3px] text-[10px] font-semibold uppercase tracking-wide" style={{ color: d.live ? "var(--emerald)" : "var(--amber)", background: `color-mix(in srgb, ${d.live ? "var(--emerald)" : "var(--amber)"} 14%, transparent)` }}>
                {d.live ? "● Gasto ao vivo (Meta)" : "● Snapshot diário"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--muted)]">
              <span className="font-medium text-[var(--text)]">{d.account.name}</span>
              <span className="text-[var(--muted-2)]">·</span>
              <span className="rounded-md px-1.5 py-[2px] text-[10.5px] font-semibold tracking-wide" style={{ color: "var(--cyan)", background: "color-mix(in srgb,var(--cyan) 13%,transparent)" }}>{CONFIG.scopeLabel}</span>
              <span className="text-[var(--muted-2)]">·</span>
              <span className="font-medium" style={{ color: "var(--accent)" }}>{d.range.label}</span>
              <span className="text-[var(--muted-2)]">·</span>
              <span className="tnum">{brDate(d.range.from)}{d.range.days > 1 ? ` – ${brDate(d.range.to)}` : ""}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-1.5 lg:items-end">
          <span className="hidden text-right text-[11px] text-[var(--muted-2)] sm:block">Atualizado {updated}</span>
          <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
            <CampaignFilter campaigns={d.campaigns} current={d.campaign} />
            <FilterBar current={d.range.preset} from={d.range.from} to={d.range.to} min={d.bounds.min} max={d.bounds.max} />
          </div>
          <TaxToggle active={d.withTax} rate={d.taxRate} />
        </div>
      </header>

      {/* Toggle de produto — destaque acima do investimento */}
      {MULTI_PRODUCT && <ProductToggle products={PRODUCTS} current={d.product} />}

      {/* Aviso: produto selecionado sem gasto de anúncio no período (não é bug — as
          campanhas desse produto não rodaram nessas datas; vendas Eduzz seguem contando). */}
      {d.product !== "geral" && k.spend === 0 && (
        <div className="fade-up mb-3 flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]" style={{ background: "color-mix(in srgb,var(--amber) 12%,transparent)", border: "1px solid color-mix(in srgb,var(--amber) 35%,transparent)" }}>
          <span className="text-[15px] leading-none">⚠️</span>
          <span className="text-[var(--text)]">
            <b>{PRODUCTS.find((p) => p.key === d.product)?.label ?? d.product}</b> não teve investimento de anúncio neste período — as campanhas desse produto não rodaram nessas datas.
            {useEduzz && sales.total > 0 ? " As vendas abaixo (Eduzz) continuam contando." : ""} Troque pra <b>GERAL</b> ou um período que inclua os dias em que ele rodou.
          </span>
        </div>
      )}

      {/* KPI hero */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={d.withTax ? `Investimento c/ imposto` : "Investimento"} value={brl(k.spend)} sub={d.withTax ? `inclui ${taxPct}% · ${brl(k.spend / d.range.days)}/dia` : `sem imposto · ${brl(k.spend / d.range.days)}/dia`} trend={d.trends.spend} spark={spendSpark} sparkColor="var(--accent)" accent delay={0} />
        <KpiCard label={useEduzz ? "Compras · Eduzz" : "Compras"} value={num(useEduzz ? sales.total : k.purchases)} sub={useEduzz ? "vendas reais" : `${num(k.checkout)} checkouts`} trend={useEduzz ? mkTrend(sales.total, prevSales?.total) : d.trends.purchases} spark={useEduzz ? eComprasSpark : purchSpark} sparkColor="var(--cyan)" delay={60} />
        <KpiCard label={useEduzz ? "CPA · Eduzz" : "CPA"} value={brl(useEduzz ? eduzzCpa : k.cpa)} sub={useEduzz ? "gasto ÷ vendas reais" : `meta ${brl(CONFIG.cpaTarget)}`} trend={useEduzz ? mkTrend(eduzzCpa, prevCpa, true) : d.trends.cpa} spark={useEduzz ? undefined : cpaSpark} sparkColor="var(--rose)" delay={120} />
        <KpiCard label={useEduzz ? "ROAS · Eduzz" : "ROAS"} value={`${num(useEduzz ? eduzzRoas : k.roas, 2)}x`} sub={useEduzz ? `${brl(sales.gross)} • líq ${num(eduzzRoasLiq, 2)}x` : `${brl(k.revenue)} retorno`} trend={useEduzz ? mkTrend(eduzzRoas, prevRoas) : d.trends.roas} spark={useEduzz ? undefined : roasSpark} sparkColor="var(--amber)" delay={180} />
        <KpiCard label={useEduzz ? "Ticket médio · Eduzz" : "Ticket médio"} value={brl(useEduzz ? sales.avgTicket : k.ticket)} sub={useEduzz ? "real (bruto)" : `${num(k.purchases)} vendas`} trend={useEduzz ? mkTrend(sales.avgTicket, prevSales?.avgTicket) : d.trends.ticket} spark={useEduzz ? eTicketSpark : undefined} sparkColor="var(--emerald)" delay={240} />
      </section>

      {/* Vendas reais (Eduzz) */}
      {sales.available && sales.total > 0 && (
        <EduzzSection
          total={sales.total} gross={sales.gross} net={sales.net} avgTicket={sales.avgTicket}
          spend={k.spend} withTax={d.withTax} tickets={sales.tickets} byDay={sales.byDay}
        />
      )}

      {/* Funnel + secondary stats */}
      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="panel fade-up p-5" style={{ animationDelay: "120ms" }}>
          <SectionTitle icon="🫧" title="Funil de conversão" hint="da impressão à compra" />
          <Funnel stages={d.funnel} />
        </div>
        <div className="panel fade-up p-5" style={{ animationDelay: "180ms" }}>
          <SectionTitle icon="💰" title="Custo por etapa" hint="quanto custa cada passo do funil" />
          <div className="flex flex-col gap-2">
            {d.funnel.map((s) => {
              // Metas de custo (abaixo = verde ▼, acima = vermelho ▲). Só nas etapas com meta.
              const target: number | undefined = ({ lpv: 2.68, co: 15.41, pur: 30.15 } as Record<string, number>)[s.key];
              const showFlag = target != null && s.cost != null;
              const over = showFlag && (s.cost as number) > target;
              return (
                <div key={s.key} className="flex items-center justify-between rounded-xl px-3.5 py-3" style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }}>
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium text-[var(--text)]">{s.costLabel}</span>
                    <span className="text-[11px] text-[var(--muted-2)]">{s.label}</span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="flex items-center gap-1.5">
                      {showFlag && (
                        <span className="text-[13px] font-bold leading-none" style={{ color: over ? "var(--rose)" : "var(--emerald)" }}>
                          {over ? "▲" : "▼"}
                        </span>
                      )}
                      <span className="tnum text-[16px] font-semibold" style={showFlag ? { color: over ? "var(--rose)" : "var(--emerald)" } : undefined}>
                        {s.cost != null ? brl(s.cost) : "—"}
                      </span>
                    </span>
                    {showFlag && (
                      <span className="tnum text-[10.5px] text-[var(--muted-2)]">meta {brl(target)}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 rounded-xl p-3.5" style={{ background: "color-mix(in srgb,var(--accent) 9%,transparent)", border: "1px solid color-mix(in srgb,var(--accent) 22%,transparent)" }}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[var(--muted)]">Conversão geral (clique → compra)</span>
              <span className="tnum font-semibold" style={{ color: "var(--accent)" }}>{pct(k.linkClicks ? k.purchases / k.linkClicks : 0, 2)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px]">
              <span className="text-[var(--muted)]">Faturamento no período</span>
              <span className="tnum font-semibold">{brl(k.revenue)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Daily chart */}
      <section className="panel fade-up mt-4 p-5" style={{ animationDelay: "220ms" }}>
        <SectionTitle icon="📈" title="Desempenho diário" hint="dois eixos comparáveis" />
        <DailyChart data={d.daily} />
      </section>

      {/* Daily data table */}
      <section className="panel fade-up mt-4 p-5" style={{ animationDelay: "240ms" }}>
        <SectionTitle icon="🗓️" title="Dados diários" hint={useEduzz ? "vendas reais (Eduzz) por dia" : "por dia"} />
        <DailyTable rows={dailyRows} target={CONFIG.cpaTarget} />
      </section>

      {/* Pages & offers — full width */}
      <section className="panel fade-up mt-4 p-5" style={{ animationDelay: "120ms" }}>
        <SectionTitle icon="🧪" title={d.pagesBy === "adset" ? "Conjuntos da campanha" : "Páginas & ofertas (campanhas)"} hint={d.pagesBy === "adset" ? "ad sets" : "testes de página/oferta"} />
        <DataTable rows={d.pages} firstLabel={d.pagesBy === "adset" ? "Conjunto" : "Campanha / Página"} pageSize={8} target={CONFIG.cpaTarget} />
      </section>

      {/* Temperature — full width row of cards */}
      <section className="panel fade-up mt-4 p-5" style={{ animationDelay: "180ms" }}>
        <SectionTitle icon="🌡️" title="Temperatura de público" hint="por conjunto" />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {d.temperature.map((t) => {
            const c = tColor(t.label);
            const share = t.spend / totalTempSpend;
            return (
              <div key={t.label} className="panel-soft p-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                    {t.label}
                  </span>
                  <span className="tnum text-[13px] font-semibold">{brl(t.spend)}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                  <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: c }} />
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-[var(--muted)]">
                  <span className="tnum">{num(t.purchases)} compras</span>
                  <span className="tnum">CPA {t.purchases ? brl(t.cpa) : "—"}</span>
                  <span className="tnum" style={{ color: t.roas >= 1 ? "var(--emerald)" : "var(--muted)" }}>{num(t.roas, 2)}x</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Creatives — full width */}
      <section className="panel fade-up mt-4 p-5" style={{ animationDelay: "120ms" }}>
        <SectionTitle icon="🎬" title="Desempenho de criativos" hint={`${d.creatives.length} anúncios ativos`} />
        <DataTable rows={d.creatives} firstLabel="Anúncio" pageSize={8} target={CONFIG.cpaTarget} />
      </section>

      <footer className="mt-8 text-center text-[11px] text-[var(--muted-2)]">
        Dados via conector Windsor.ai · {d.account.connectorLabel} · conta {d.account.name} ({d.account.id})
        {!d.live && " · defina WINDSOR_API_KEY para atualização ao vivo"}
        <span className="mx-1.5">·</span>
        <a href="/admin" className="underline-offset-2 transition-colors hover:text-[var(--muted)] hover:underline">⚙️ Admin / Vendas Eduzz</a>
      </footer>
    </main>
  );
}
