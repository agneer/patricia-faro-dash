import { ACCOUNT, CREATIVES, ALL_DATES, type DailyRow, type CreativeRow } from "./snapshot";
import { resolvePostLinks } from "./creative-posts";
import { CONFIG, CAMPAIGN_FILTER, productFilter, isBaseProduct, CODED_FILTER } from "./config";
import { getLiveRecentCreatives } from "./meta-live";
import MANUAL_PURCHASES from "./manual-purchases.json";

type PurchaseOverride = { date: string; ad: string; purchases: number; value: number };

// Override manual de compras/receita por (data, anúncio) — ex.: dia sem pixel, onde
// usamos as vendas reais da Eduzz. Aplicado na renderização (sobrevive ao cron).
function applyManualPurchases(rows: CreativeRow[]): CreativeRow[] {
  const ov = MANUAL_PURCHASES as PurchaseOverride[];
  if (!ov.length) return rows;
  return rows.map((c) => {
    const o = ov.find((x) => x.date === c.date && x.ad === c.ad);
    return o ? { ...c, purchases: o.purchases, value: o.value } : c;
  });
}

// Only campaigns matching CONFIG.campaignFilter belong in this dashboard
// (launch/webinar campaigns are excluded). All metrics — daily series included —
// are derived from these filtered rows so everything stays scope-consistent.
export { CAMPAIGN_FILTER };
const isLowTicket = (campaign: string) => CAMPAIGN_FILTER.test(campaign);

function deriveDaily(creatives: CreativeRow[]): DailyRow[] {
  const byDate = new Map<string, DailyRow>();
  for (const c of creatives) {
    let d = byDate.get(c.date);
    if (!d) { d = { date: c.date, spend: 0, impressions: 0, clicks: 0, link_clicks: 0, purchases: 0, value: 0, checkout: 0, lpv: 0 }; byDate.set(c.date, d); }
    d.spend += c.spend; d.impressions += c.impressions; d.clicks += c.clicks; d.link_clicks += c.link_clicks;
    d.purchases += c.purchases; d.value += c.value; d.checkout += c.checkout; d.lpv += c.lpv;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const LT_CREATIVES = CREATIVES.filter((c) => isLowTicket(c.campaign));
const LT_DAILY = deriveDaily(LT_CREATIVES);

// Distinct campaigns (full name + shortened label), ordered by spend — for the filter.
const CAMPAIGNS = (() => {
  const m = new Map<string, number>();
  for (const c of LT_CREATIVES) m.set(c.campaign, (m.get(c.campaign) ?? 0) + c.spend);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => ({ value, label: shortenCampaign(value) }));
})();

export type Trend = { value: number; dir: "up" | "down" | "flat"; good: boolean } | null;

export type Kpi = {
  spend: number; purchases: number; revenue: number; cpa: number; roas: number; ticket: number;
  impressions: number; clicks: number; linkClicks: number; lpv: number; checkout: number;
  cpm: number; ctr: number; cpc: number; connectRate: number; checkoutRate: number; purchaseRate: number;
};

export type FunnelStage = { key: string; label: string; value: number; rate: number | null; hint: string; cost: number | null; costLabel: string };
export type BreakdownRow = {
  label: string; sub?: string; spend: number; purchases: number; cpa: number; roas: number;
  revenue: number; ctr: number; cpm: number; checkout: number; lpv: number; clicks: number; linkClicks: number; impressions: number;
  // funnel rates
  connectRate: number;   // lpv / link_clicks (página carregou ÷ cliques no link)
  convRate: number;      // purchases / link_clicks (conversão geral)
  checkoutRate: number;  // checkout / lpv
  closeRate: number;     // purchases / checkout
  cplpv: number;         // spend / lpv (custo por visualização de página)
  cpco: number;          // spend / checkout (custo por checkout)
  postUrl?: string;      // link do post do criativo (Instagram)
  children?: BreakdownRow[];
};

export type RangeInfo = { from: string; to: string; days: number; label: string; preset: string };

// Meta Ads reports spend net of tax; in Brazil the real cost adds ~12,15%.
export const TAX_RATE = CONFIG.taxRate;

export type DashboardData = {
  account: typeof ACCOUNT;
  range: RangeInfo;
  bounds: { min: string; max: string };
  withTax: boolean;
  taxRate: number;
  live: boolean;
  kpi: Kpi;
  trends: Record<string, Trend>;
  funnel: FunnelStage[];
  daily: (DailyRow & { cpa: number; roas: number; ctr: number })[];
  creatives: BreakdownRow[];
  pages: BreakdownRow[];
  pagesBy: "campaign" | "adset";
  temperature: BreakdownRow[];
  campaigns: { value: string; label: string }[];
  campaign: string; // "all" or the selected full campaign name
  product: string; // "geral" or a product key
};

export const ALL_CAMPAIGNS = "all";

const sum = <T>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const safeDiv = (a: number, b: number) => (b ? a / b : 0);

const MIN = ALL_DATES[0];
const MAX = ALL_DATES[ALL_DATES.length - 1];

// ── Date helpers (string YYYY-MM-DD, no Date() to stay deterministic) ──
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function firstOfMonth(iso: string) { return iso.slice(0, 8) + "01"; }

const PRESET_LABELS: Record<string, string> = {
  today: "Hoje", yesterday: "Ontem", "3d": "Últimos 3 dias", "5d": "Últimos 5 dias", "7d": "Últimos 7 dias", "14d": "Últimos 14 dias",
  "30d": "Últimos 30 dias", "90d": "Últimos 90 dias", this_month: "Este mês",
  last_month: "Mês passado", all: "Todo o período", custom: "Período personalizado",
};

export function resolveRange(params: { preset?: string; from?: string; to?: string }, maxOverride?: string): RangeInfo {
  const max = maxOverride && maxOverride > MAX ? maxOverride : MAX;
  const clamp = (iso: string) => (iso < MIN ? MIN : iso > max ? max : iso);
  let from = max, to = max, preset = params.preset ?? "30d";

  if (params.from || params.to) {
    preset = "custom";
    to = clamp(params.to || max);
    from = clamp(params.from || addDays(to, -29));
    if (from > to) [from, to] = [to, from];
  } else {
    switch (preset) {
      case "today": from = to = max; break;
      case "yesterday": from = to = clamp(addDays(max, -1)); break;
      case "3d": from = clamp(addDays(max, -2)); break;
      case "5d": from = clamp(addDays(max, -4)); break;
      case "7d": from = clamp(addDays(max, -6)); break;
      case "14d": from = clamp(addDays(max, -13)); break;
      case "30d": from = clamp(addDays(max, -29)); break;
      case "90d": from = clamp(addDays(max, -89)); break;
      case "all": from = MIN; to = max; break;
      case "this_month": from = clamp(firstOfMonth(max)); break;
      case "last_month": {
        const firstThis = firstOfMonth(max);
        to = addDays(firstThis, -1);
        from = clamp(firstOfMonth(to));
        to = clamp(to);
        break;
      }
      default: preset = "30d"; from = clamp(addDays(max, -29));
    }
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return { from, to, days, preset, label: PRESET_LABELS[preset] ?? "Período" };
}

function inRange<T extends { date: string }>(rows: T[], from: string, to: string) {
  return rows.filter((r) => r.date >= from && r.date <= to);
}

function kpiFromDaily(rows: DailyRow[]): Kpi {
  const spend = sum(rows, (r) => r.spend);
  const purchases = sum(rows, (r) => r.purchases);
  const revenue = sum(rows, (r) => r.value);
  const impressions = sum(rows, (r) => r.impressions);
  const clicks = sum(rows, (r) => r.clicks);
  const linkClicks = sum(rows, (r) => r.link_clicks);
  const lpv = sum(rows, (r) => r.lpv);
  const checkout = sum(rows, (r) => r.checkout);
  return {
    spend, purchases, revenue, impressions, clicks, linkClicks, lpv, checkout,
    cpa: safeDiv(spend, purchases), roas: safeDiv(revenue, spend), ticket: safeDiv(revenue, purchases),
    cpm: safeDiv(spend, impressions) * 1000, ctr: safeDiv(linkClicks, impressions),
    cpc: safeDiv(spend, linkClicks), connectRate: safeDiv(lpv, linkClicks),
    checkoutRate: safeDiv(checkout, lpv), purchaseRate: safeDiv(purchases, checkout),
  };
}

function trend(curr: number, prev: number | null, lowerIsBetter = false): Trend {
  if (prev == null || prev === 0) return null;
  const v = (curr - prev) / prev;
  const dir = Math.abs(v) < 0.001 ? "flat" : v > 0 ? "up" : "down";
  const good = dir === "flat" ? true : lowerIsBetter ? v < 0 : v > 0;
  return { value: v, dir, good };
}

function tempOf(adset: string): string {
  const s = adset.toLowerCase();
  if (/(remarket|retarget|rmkt|envolvi|engaj|lead|quente|aquec)/.test(s)) return "Quente · Remarketing/Engaj.";
  if (/(lookalike|\blal\b|semelh|morno)/.test(s)) return "Morno · Lookalike";
  if (/(interesse|interesses|duplicada|frio)/.test(s)) return "Frio · Interesses";
  return "Aberto · Advantage+";
}

function shortenCampaign(c: string) {
  return c.replace(/^LOW TICKET \| EBOOK_EXP_META \| /i, "").replace(/^C1 \| .*?\| /i, "").trim() || c;
}

function rollup(rows: CreativeRow[], label: string): BreakdownRow {
  let spend = 0, purchases = 0, revenue = 0, checkout = 0, lpv = 0, clicks = 0, linkClicks = 0, impressions = 0;
  for (const r of rows) {
    spend += r.spend; purchases += r.purchases; revenue += r.value;
    checkout += r.checkout; lpv += r.lpv; clicks += r.clicks; linkClicks += r.link_clicks; impressions += r.impressions;
  }
  return {
    label, spend, purchases, revenue, checkout, lpv, clicks, linkClicks, impressions,
    cpa: safeDiv(spend, purchases), roas: safeDiv(revenue, spend),
    ctr: safeDiv(clicks, impressions), cpm: safeDiv(spend, impressions) * 1000,
    connectRate: safeDiv(lpv, linkClicks),
    convRate: safeDiv(purchases, linkClicks),
    checkoutRate: safeDiv(checkout, lpv),
    closeRate: safeDiv(purchases, checkout),
    cplpv: safeDiv(spend, lpv),
    cpco: safeDiv(spend, checkout),
  };
}

function groupBy(rows: CreativeRow[], keyFn: (r: CreativeRow) => string): Map<string, CreativeRow[]> {
  const m = new Map<string, CreativeRow[]>();
  for (const r of rows) { const k = keyFn(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
}

// Aggregate rows by `keyFn`. When `childKeyFn` is given, each group also gets a
// `children` breakdown (e.g. an ad split across its ad sets) so the UI can
// expand a repeated creative and analyse it per conjunto.
function aggregate(rows: CreativeRow[], keyFn: (r: CreativeRow) => string, childKeyFn?: (r: CreativeRow) => string): BreakdownRow[] {
  return [...groupBy(rows, keyFn)]
    .map(([label, groupRows]) => {
      const row = rollup(groupRows, label);
      if (childKeyFn) {
        const children = [...groupBy(groupRows, childKeyFn)]
          .map(([childLabel, childRows]) => rollup(childRows, childLabel))
          .filter((c) => c.spend > 0)
          .sort((a, b) => b.spend - a.spend);
        row.children = children;
        row.sub = `${children.length} ${children.length === 1 ? "conjunto" : "conjuntos"}`;
      }
      return row;
    })
    .filter((g) => g.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}

function build(dailyIn: DailyRow[], creativesIn: CreativeRow[], range: RangeInfo, live: boolean, withTax: boolean, campaign: string, maxDate: string, postLinks: Record<string, string>, product: string): DashboardData {
  // When tax is on, gross up every spend value before aggregation so all
  // spend-derived metrics (CPA, CPM, CPC, ROAS, totals) become tax-inclusive.
  const f = withTax ? 1 + TAX_RATE : 1;
  let creatives = f === 1 ? creativesIn : creativesIn.map((c) => ({ ...c, spend: c.spend * f }));
  let daily = f === 1 ? dailyIn : dailyIn.map((d) => ({ ...d, spend: d.spend * f }));

  // Product filter (toggle): narrow the whole dashboard to one product. Um produto
  // codificado usa seu pattern; o produto "base" (Ebook) = tudo que NÃO casa com os
  // códigos (MOP/BCL/GOC/...).
  const productRe = productFilter(product);
  const base = isBaseProduct(product);
  const cf = CODED_FILTER;
  const matchProduct = (name: string) => base ? !(cf && cf.test(name)) : (productRe ? productRe.test(name) : true);
  if (productRe || base) {
    creatives = creatives.filter((c) => matchProduct(c.campaign));
    daily = deriveDaily(creatives);
  }
  // Campanhas do dropdown, limitadas ao produto ativo.
  const campaignsForProduct = (productRe || base) ? CAMPAIGNS.filter((c) => matchProduct(c.value)) : CAMPAIGNS;

  // Campaign filter: narrow to one campaign and re-derive the daily series from it.
  const filtered = campaign !== ALL_CAMPAIGNS;
  if (filtered) {
    creatives = creatives.filter((c) => c.campaign === campaign);
    daily = deriveDaily(creatives);
  }

  const win = inRange(daily, range.from, range.to).sort((a, b) => a.date.localeCompare(b.date));
  const prevTo = addDays(range.from, -1);
  const prevFrom = addDays(prevTo, -(range.days - 1));
  const prevWin = inRange(daily, prevFrom, prevTo);

  const kpi = kpiFromDaily(win);
  const prev = prevWin.length ? kpiFromDaily(prevWin) : null;

  const trends: Record<string, Trend> = {
    spend: trend(kpi.spend, prev?.spend ?? null),
    purchases: trend(kpi.purchases, prev?.purchases ?? null),
    cpa: trend(kpi.cpa, prev?.cpa ?? null, true),
    roas: trend(kpi.roas, prev?.roas ?? null),
    revenue: trend(kpi.revenue, prev?.revenue ?? null),
    ticket: trend(kpi.ticket, prev?.ticket ?? null),
  };

  const costPer = (v: number) => (v > 0 ? kpi.spend / v : null);
  const funnel: FunnelStage[] = [
    { key: "impr", label: "Impressões", value: kpi.impressions, rate: null, hint: "Volume de entrega", cost: kpi.impressions > 0 ? kpi.cpm : null, costLabel: "CPM" },
    { key: "lc", label: "Cliques no link", value: kpi.linkClicks, rate: safeDiv(kpi.linkClicks, kpi.impressions), hint: "CTR no link", cost: costPer(kpi.linkClicks), costLabel: "CPC" },
    { key: "lpv", label: "Visualização de página", value: kpi.lpv, rate: safeDiv(kpi.lpv, kpi.linkClicks), hint: "Conexão da página", cost: costPer(kpi.lpv), costLabel: "Custo/visualização" },
    { key: "co", label: "Checkout iniciado", value: kpi.checkout, rate: safeDiv(kpi.checkout, kpi.lpv), hint: "Tx. de checkout", cost: costPer(kpi.checkout), costLabel: "Custo/checkout" },
    { key: "pur", label: "Compras", value: kpi.purchases, rate: safeDiv(kpi.purchases, kpi.checkout), hint: "Tx. de fechamento", cost: costPer(kpi.purchases), costLabel: "Custo/compra" },
  ];

  const dailyOut = win.map((r) => ({ ...r, cpa: safeDiv(r.spend, r.purchases), roas: safeDiv(r.value, r.spend), ctr: safeDiv(r.link_clicks, r.impressions) }));
  const cWin = inRange(creatives, range.from, range.to);

  return {
    account: ACCOUNT,
    range,
    bounds: { min: MIN, max: maxDate },
    withTax,
    taxRate: TAX_RATE,
    live,
    kpi,
    trends,
    funnel,
    daily: dailyOut,
    creatives: aggregate(cWin, (r) => r.ad, (r) => `${r.adset} · ${shortenCampaign(r.campaign)}`).map((r) => ({ ...r, postUrl: postLinks[r.label] })),
    // When a campaign is selected, "Páginas & ofertas" drills into its ad sets.
    pages: filtered ? aggregate(cWin, (r) => r.adset) : aggregate(cWin, (r) => shortenCampaign(r.campaign)),
    pagesBy: filtered ? "adset" : "campaign",
    temperature: aggregate(cWin, (r) => tempOf(r.adset)),
    campaigns: campaignsForProduct,
    campaign,
    product,
  };
}

export async function getDashboardData(params: { preset?: string; from?: string; to?: string; tax?: boolean; campaign?: string; product?: string; lite?: boolean }): Promise<DashboardData> {
  const withTax = !!params.tax;
  const product = params.product && (productFilter(params.product) || isBaseProduct(params.product)) ? params.product : "geral";
  const campaign = params.campaign && CAMPAIGNS.some((c) => c.value === params.campaign) ? params.campaign : ALL_CAMPAIGNS;

  // Base = bundled snapshot (history, kept fresh by the daily cron). Then overlay
  // today's spend LIVE from Pipeboard/Meta (real-time, fixes the current-day lag).
  // `lite` (usado no período anterior, só pra KPIs de comparação) pula overlay ao
  // vivo e links de post — que são as chamadas de rede caras — e usa só o snapshot.
  // Busca dados ao vivo e links de post em paralelo (independentes) — reduz a
  // latência da requisição fria (cache expirado) pela metade.
  const [liveRows, postLinks] = await Promise.all([
    params.lite ? Promise.resolve<CreativeRow[]>([]) : getLiveRecentCreatives(),
    params.lite ? Promise.resolve<Record<string, string>>({}) : resolvePostLinks(),
  ]);
  const hasLive = liveRows.length > 0;
  const liveDates = new Set(liveRows.map((c) => c.date));

  // Overlay ao vivo: o Pipeboard só cobre a conta principal. Se removêssemos o DIA
  // inteiro do snapshot pra recolocar só o ao vivo, perderíamos o gasto das OUTRAS
  // contas (multi-conta) nesses dias. Então removemos só os pares (dia, campanha)
  // que o ao vivo traz — as campanhas de outras contas (nomes diferentes) ficam.
  const liveCampDate = new Set(liveRows.map((c) => `${c.date} ${c.campaign}`));
  const base = hasLive
    ? [...LT_CREATIVES.filter((c) => !liveCampDate.has(`${c.date} ${c.campaign}`)), ...liveRows]
    : LT_CREATIVES;
  const creatives = applyManualPurchases(base);
  const daily = creatives === LT_CREATIVES ? LT_DAILY : deriveDaily(creatives);
  const liveMax = hasLive ? [...liveDates].reduce((m, d) => (d > m ? d : m), MAX) : MAX;
  // Âncora dos presets = HOJE real (BRT), mesmo sem gasto hoje ainda — senão
  // "Hoje" cairia no último dia com dado (ontem). Data-only fica 0 até haver gasto.
  const realToday = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const maxDate = realToday > liveMax ? realToday : liveMax;

  const range = resolveRange(params, maxDate);
  return build(daily, creatives, range, hasLive, withTax, campaign, maxDate, postLinks, product);
}
