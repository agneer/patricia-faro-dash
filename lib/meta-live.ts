// Real-time current-day spend via Pipeboard (direct line to the Meta Marketing
// API). Overlays today's live numbers on top of the cron snapshot — fixes the
// Windsor lag for the running day. No token set → returns [] (snapshot only).
import { unstable_cache } from "next/cache";
import { CONFIG, CAMPAIGN_FILTER } from "./config";
import type { CreativeRow } from "./snapshot";

const ENDPOINT = "https://meta-ads.mcp.pipeboard.co/";

type MetaAction = { action_type: string; value: string };
type MetaInsight = {
  date_start?: string; ad_name?: string; campaign_name?: string; adset_name?: string;
  spend?: string; impressions?: string; clicks?: string;
  actions?: MetaAction[]; action_values?: MetaAction[];
};

const pick = (arr: MetaAction[] | undefined, type: string) => Number(arr?.find((a) => a.action_type === type)?.value ?? 0);

async function callPipeboard(args: Record<string, unknown>): Promise<MetaInsight[] | null> {
  const token = process.env.PIPEBOARD_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_insights", arguments: args } }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.result?.content?.[0]?.text;
    if (!text) return null;
    return (JSON.parse(text).data ?? []) as MetaInsight[];
  } catch {
    return null;
  }
}

// Live creatives (ad-level) for the last few days, straight from Meta via Pipeboard.
// Windsor (snapshot) lags on recent days AND só entra no dataset no refresh diário,
// então cobrimos os últimos LIVE_DAYS ao vivo: hoje/ontem por preset e os dias
// anteriores por range de 1 dia (since=until — o time_increment do Pipeboard não
// quebra por dia, mas consulta de 1 dia funciona). Cada dia é uma chamada isolada:
// falha em um dia não derruba os outros; falha total cai no snapshot.
const LIVE_DAYS = 4;
const brtDay = (n: number) => new Date(Date.now() - 3 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);

async function fetchLiveRecent(): Promise<CreativeRow[]> {
  const acct = `act_${CONFIG.metaAccountId}`;
  const calls: Promise<MetaInsight[] | null>[] = [
    callPipeboard({ object_id: acct, time_range: "today", level: "ad", limit: 500 }),
    callPipeboard({ object_id: acct, time_range: "yesterday", level: "ad", limit: 500 }),
  ];
  for (let n = 2; n < LIVE_DAYS; n++) {
    const day = brtDay(n);
    calls.push(callPipeboard({ object_id: acct, time_range: { since: day, until: day }, level: "ad", limit: 500 }));
  }
  const results = await Promise.all(calls);
  const rows = results.flatMap((r) => r ?? []);
  if (!rows.length) return [];
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

// Cacheado no servidor (unstable_cache funciona em POST, ao contrário do fetch
// revalidate): todas as renders/filtros dentro de 90s reusam o mesmo resultado
// ao vivo, em vez de refazer as chamadas ao Pipeboard a cada troca de filtro.
export const getLiveRecentCreatives = unstable_cache(
  fetchLiveRecent,
  ["live-recent-creatives", CONFIG.metaAccountId],
  { revalidate: 90 },
);
