// Gasto direto da Meta Marketing API (Graph API), SEM Windsor: todo o histórico do
// escopo, por dia e por anúncio, de TODAS as contas (META_ACCOUNT_IDS). O que a Meta
// devolve substitui o snapshot (dataset.json) — o snapshot vira só reserva se o token
// faltar ou a Meta falhar. Sem META_ACCESS_TOKEN → [] (fica só o snapshot).
import { unstable_cache } from "next/cache";
import { CAMPAIGN_FILTER, META_ACCOUNT_IDS } from "./config";
import { ALL_DATES, type CreativeRow } from "./snapshot";

// Versão da Graph API (sobrescreve com META_API_VERSION se a Meta descontinuar).
const API_VERSION = process.env.META_API_VERSION ?? "v23.0";
// Campos de insight (date_start/date_stop já voltam sempre — não vão em fields).
const FIELDS = "ad_name,campaign_name,adset_name,spend,impressions,clicks,actions,action_values";
// Janelas de 30 dias: evita o erro "reduce the amount of data" da Meta em períodos longos.
const CHUNK_DAYS = 30;

type MetaAction = { action_type: string; value: string };
type MetaInsight = {
  date_start?: string; ad_name?: string; campaign_name?: string; adset_name?: string;
  spend?: string; impressions?: string; clicks?: string;
  actions?: MetaAction[]; action_values?: MetaAction[];
};

const pick = (arr: MetaAction[] | undefined, type: string) => Number(arr?.find((a) => a.action_type === type)?.value ?? 0);
const brtToday = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// Uma janela [since, until] de uma conta, seguindo a paginação. null = falhou e os
// dias dessa janela caem no snapshot (sem derrubar as outras janelas/contas).
async function fetchWindow(accountId: string, since: string, until: string): Promise<MetaInsight[] | null> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const url = new URL(`https://graph.facebook.com/${API_VERSION}/act_${accountId}/insights`);
    url.searchParams.set("level", "ad");
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("fields", FIELDS);
    url.searchParams.set("time_range", JSON.stringify({ since, until }));
    url.searchParams.set("limit", "500");
    url.searchParams.set("access_token", token);
    const out: MetaInsight[] = [];
    let next: string | undefined = url.toString();
    while (next) {
      const res: Response = await fetch(next, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        console.error(`[meta] ${accountId} ${since}→${until} HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
        return null;
      }
      const json = await res.json();
      out.push(...((json.data ?? []) as MetaInsight[]));
      next = json.paging?.next;
    }
    return out;
  } catch (e) {
    console.error(`[meta] ${accountId} ${since}→${until} falhou:`, e);
    return null;
  }
}

async function fetchAllCreatives(): Promise<CreativeRow[]> {
  if (!process.env.META_ACCESS_TOKEN) return [];
  const end = brtToday();
  const start = ALL_DATES[0] ?? addDays(end, -89);
  const windows: [string, string][] = [];
  for (let s = start; s <= end; s = addDays(s, CHUNK_DAYS)) {
    const e = addDays(s, CHUNK_DAYS - 1);
    windows.push([s, e < end ? e : end]);
  }
  const calls = META_ACCOUNT_IDS.flatMap((acct) => windows.map(([s, e]) => fetchWindow(acct, s, e)));
  const rows = (await Promise.all(calls)).flatMap((r) => r ?? []);
  return rows
    .filter((r) => CAMPAIGN_FILTER.test(r.campaign_name ?? "") && Number(r.spend ?? 0) > 0)
    .map((r) => ({
      date: String(r.date_start),
      ad: String(r.ad_name ?? "—"),
      campaign: String(r.campaign_name ?? "—"),
      adset: String(r.adset_name ?? "—"),
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      link_clicks: pick(r.actions, "link_click"),
      purchases: pick(r.actions, "offsite_conversion.fb_pixel_purchase"),
      value: pick(r.action_values, "offsite_conversion.fb_pixel_purchase"),
      checkout: pick(r.actions, "offsite_conversion.fb_pixel_initiate_checkout"),
      lpv: pick(r.actions, "landing_page_view"),
    }));
}

// Cacheado no servidor por 2 min: todas as renders/filtros (inclusive o período
// anterior, usado nos comparativos) reusam a mesma consulta à Meta.
export const getMetaCreatives = unstable_cache(
  fetchAllCreatives,
  ["meta-creatives", META_ACCOUNT_IDS.join(",")],
  { revalidate: 120 },
);
