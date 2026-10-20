// Server-side reader for Hotmart sales, with aggregations for the dashboard (by
// day, by ticket value, by campaign/creative via UTM). Duas fontes, juntadas pela
// transação: o histórico importado da planilha (lib/hotmart-history.json, sem dados
// pessoais — gerado por scripts/hotmart-history.py) e o webhook gravado no Supabase.
// O webhook vence (status mais recente, ex.: estorno depois da planilha).
import { unstable_cache } from "next/cache";
import { productFilter, PRODUCTS, isBaseProduct, CODED_FILTER } from "./config";
import HISTORY from "./hotmart-history.json";

export type SaleRow = {
  invoice_id: string;
  refunded?: boolean;
  parent_transaction: string | null;
  order_bump: boolean;
  sale_date: string;
  gross_value: number;
  net_value: number;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  status: string | null;
  product_name: string | null;
};

export type TicketBucket = { ticket: number; count: number; gross: number; net: number };
export type DayBucket = { date: string; count: number; gross: number; net: number; perTicket: Record<string, number> };

export type SalesData = {
  available: boolean;
  total: number;
  gross: number;
  net: number;
  avgTicket: number;
  tickets: TicketBucket[];
  byDay: DayBucket[];
  byCampaign: Map<string, { count: number; gross: number; net: number }>;
  byCreative: Map<string, { count: number; gross: number; net: number }>;
};

// Normalizes UTM/campaign strings so Hotmart values match Windsor names despite
// URL-encoding, case, accents and stray whitespace.
export function normKey(s: string | null | undefined): string {
  if (!s) return "";
  let v = String(s);
  try { v = decodeURIComponent(v.replace(/\+/g, " ")); } catch { /* keep as-is */ }
  // Meta appends the campaign/ad id to the UTM ("...| 120238280635030760"); strip it.
  v = v.replace(/\s*\|\s*\d{6,}\s*$/, "");
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Round a ticket value to group order-bump combos cleanly (R$26,90 → 27 bucket).
const ticketKey = (v: number) => Math.round(v).toString();

async function fetchAllSalesRaw(from: string, to: string): Promise<SaleRow[] | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const cols = "invoice_id,parent_transaction,order_bump,sale_date,gross_value,net_value,utm_campaign,utm_content,utm_term,status,product_name";
  const base = `${url}/rest/v1/hotmart_sales?select=${cols}` +
    `&sale_date=gte.${from}&sale_date=lte.${to}` +
    `&refunded=eq.false&invoice_id=not.like.TEST-*&gross_value=gt.0` +
    `&order=sale_date.asc`;

  const out: SaleRow[] = [];
  const pageSize = 1000;
  // Supabase fora do ar (projeto pausado, URL errada na env) NÃO pode derrubar a
  // página inteira: cai em "sem vendas Hotmart" e o gasto continua aparecendo.
  try {
    for (let offset = 0; ; offset += pageSize) {
      const res = await fetch(`${base}&limit=${pageSize}&offset=${offset}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        console.error(`[sales] Supabase HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        return out.length ? out : null;
      }
      const rows = (await res.json()) as SaleRow[];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
  } catch (e) {
    console.error("[sales] falha ao consultar o Supabase:", e);
    return out.length ? out : null;
  }
  return out;
}

// Cacheado por intervalo (60s): trocar filtros repetidamente reusa a mesma query
// ao Supabase em vez de refazer a cada render. Webhook novo aparece em até 1 min.
const fetchAllSales = unstable_cache(fetchAllSalesRaw, ["hotmart-sales"], { revalidate: 60 });

// Na Hotmart o order bump é uma transação separada. Soma o bump na venda principal
// (valor e ticket, como "R$ 27 + bump = R$ 44") para não contar uma venda a mais;
// bump sem a principal no período (ex.: principal estornada) fica como venda própria.
function mergeOrderBumps(rows: SaleRow[]): SaleRow[] {
  const byId = new Map(rows.filter((r) => !r.order_bump).map((r) => [r.invoice_id, { ...r }]));
  const out = [...byId.values()];
  for (const r of rows) {
    if (!r.order_bump) continue;
    const parent = r.parent_transaction ? byId.get(r.parent_transaction) : undefined;
    if (parent) { parent.gross_value += r.gross_value || 0; parent.net_value += r.net_value || 0; }
    else out.push(r);
  }
  return out;
}

const HISTORY_SALES = (HISTORY as { sales: SaleRow[] }).sales;

// Planilha + webhook no período; mesma transação nos dois → vale o webhook. Venda
// estornada no webhook some mesmo que a planilha diga "completo".
async function salesInRange(from: string, to: string): Promise<SaleRow[] | null> {
  const [hook, reversed] = await Promise.all([fetchAllSales(from, to), fetchReversedIds()]);
  const byId = new Map<string, SaleRow>();
  for (const r of HISTORY_SALES) {
    if (r.sale_date >= from && r.sale_date <= to && !r.refunded && r.gross_value > 0) byId.set(r.invoice_id, r);
  }
  for (const r of hook ?? []) byId.set(r.invoice_id, r);
  for (const id of reversed) byId.delete(id);
  if (!hook && !HISTORY_SALES.length) return null;
  return [...byId.values()];
}

// Transações estornadas/canceladas recebidas pelo webhook (para tirar da planilha).
async function fetchReversedIdsRaw(): Promise<string[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url}/rest/v1/hotmart_sales?select=invoice_id&refunded=eq.true`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? ((await res.json()) as { invoice_id: string }[]).map((r) => r.invoice_id) : [];
  } catch {
    return [];
  }
}
const fetchReversedIds = unstable_cache(fetchReversedIdsRaw, ["hotmart-reversed"], { revalidate: 60 });

export async function getSalesData(from: string, to: string, campaign?: string, product?: string): Promise<SalesData> {
  const fetched = await salesInRange(from, to);
  const allRaw = fetched && mergeOrderBumps(fetched);
  if (!allRaw) return { available: false, total: 0, gross: 0, net: 0, avgTicket: 0, tickets: [], byDay: [], byCampaign: new Map(), byCreative: new Map() };
  // Product filter (toggle): venda pertence ao produto se a UTM da campanha casa
  // com o padrão OU se o nome do produto (Hotmart) bate — mais robusto p/ vendas
  // sem a UTM certinha.
  const productRe = productFilter(product);
  const prodName = product ? PRODUCTS.find((p) => p.key === product)?.productName : undefined;
  const prodNameKey = prodName ? normKey(prodName) : "";
  const cf = CODED_FILTER;
  const all = isBaseProduct(product)
    // "base" (Ebook) = tudo que NÃO casa com nenhum produto codificado (MOP/BCL/GOC...).
    ? (cf ? allRaw.filter((r) => !cf.test(r.utm_campaign ?? "")) : allRaw)
    : productRe
    ? allRaw.filter((r) =>
        productRe.test(r.utm_campaign ?? "") ||
        (!!prodNameKey && normKey(r.product_name).includes(prodNameKey)))
    : allRaw;
  // Optional campaign filter: match Hotmart utm_campaign to the selected campaign.
  const rows = campaign && campaign !== "all"
    ? all.filter((r) => normKey(r.utm_campaign) === normKey(campaign))
    : all;

  let gross = 0, net = 0;
  const ticketMap = new Map<string, TicketBucket>();
  const dayMap = new Map<string, DayBucket>();
  const byCampaign = new Map<string, { count: number; gross: number; net: number }>();
  const byCreative = new Map<string, { count: number; gross: number; net: number }>();

  for (const r of rows) {
    const g = r.gross_value || 0, n = r.net_value || 0;
    gross += g; net += n;
    const tk = ticketKey(g);

    const tb = ticketMap.get(tk) ?? { ticket: Math.round(g), count: 0, gross: 0, net: 0 };
    tb.count++; tb.gross += g; tb.net += n; ticketMap.set(tk, tb);

    const day = dayMap.get(r.sale_date) ?? { date: r.sale_date, count: 0, gross: 0, net: 0, perTicket: {} };
    day.count++; day.gross += g; day.net += n; day.perTicket[tk] = (day.perTicket[tk] ?? 0) + 1;
    dayMap.set(r.sale_date, day);

    if (r.utm_campaign) { const k = normKey(r.utm_campaign); const c = byCampaign.get(k) ?? { count: 0, gross: 0, net: 0 }; c.count++; c.gross += g; c.net += n; byCampaign.set(k, c); }
    if (r.utm_content) { const k = normKey(r.utm_content); const c = byCreative.get(k) ?? { count: 0, gross: 0, net: 0 }; c.count++; c.gross += g; c.net += n; byCreative.set(k, c); }
  }

  const tickets = [...ticketMap.values()].sort((a, b) => b.count - a.count);
  const byDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    available: true,
    total: rows.length,
    gross,
    net,
    avgTicket: rows.length ? gross / rows.length : 0,
    tickets,
    byDay,
    byCampaign,
    byCreative,
  };
}
