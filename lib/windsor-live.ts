// Gasto ao vivo via Windsor.ai (conector `facebook`): todo o histórico do escopo, por
// dia e por anúncio, SÓ das contas deste dashboard (`select_accounts`) — sem isso o
// Windsor devolve as ~36 contas da agência e estoura o tempo. O resultado substitui o
// snapshot (dataset.json), que vira só reserva se a chave faltar ou o Windsor falhar.
// Também traz o link do post de cada anúncio (botão "post↗").
import { unstable_cache } from "next/cache";
import { CAMPAIGN_FILTER, META_ACCOUNT_IDS } from "./config";
import { ALL_DATES, adStatusKey, type CreativeRow } from "./snapshot";

const FIELDS = [
  "date", "account_id", "ad_name", "campaign", "adset_name", "spend", "impressions", "clicks", "link_clicks",
  "actions_offsite_conversion_fb_pixel_purchase", "action_values_offsite_conversion_fb_pixel_purchase",
  "actions_offsite_conversion_fb_pixel_initiate_checkout", "actions_landing_page_view",
  "effective_object_story_id", "instagram_permalink_url", "effective_status",
];

// statuses: status atual (effective_status) por adStatusKey(anúncio, conjunto, campanha).
export type LiveData = { rows: CreativeRow[]; links: Record<string, string>; statuses: Record<string, string> };

const brtToday = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// object_story_id = "<pageid>_<postid>" → URL pública do post no Facebook.
function fbPostUrl(objectStoryId: string): string {
  const [page, post] = objectStoryId.split("_");
  return page && post ? `https://www.facebook.com/${page}/posts/${post}` : "";
}

// Lança em falha (pra unstable_cache não guardar resultado vazio); quem chama trata.
async function fetchLive(): Promise<LiveData> {
  const key = process.env.WINDSOR_API_KEY?.trim();
  if (!key) return { rows: [], links: {}, statuses: {} };
  const url = new URL("https://connectors.windsor.ai/facebook");
  url.searchParams.set("api_key", key);
  url.searchParams.set("date_from", ALL_DATES[0] ?? addDays(brtToday(), -89));
  url.searchParams.set("date_to", brtToday());
  url.searchParams.set("fields", FIELDS.join(","));
  url.searchParams.set("select_accounts", META_ACCOUNT_IDS.join(","));
  const res = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`Windsor HTTP ${res.status}`);
  const json = await res.json();
  const data: Record<string, unknown>[] = json.data ?? json.result ?? [];
  const accounts = new Set(META_ACCOUNT_IDS);
  const kept = data.filter((r) =>
    accounts.has(String(r.account_id)) && CAMPAIGN_FILTER.test(String(r.campaign ?? "")) && Number(r.spend ?? 0) > 0);

  // Instagram vence Facebook (os criativos são do IG); por nome de anúncio, que é
  // como o dashboard agrupa os criativos.
  const links: Record<string, string> = {};
  for (const r of kept) {
    const ad = String(r.ad_name ?? "");
    const ig = r.instagram_permalink_url ? String(r.instagram_permalink_url) : "";
    const fb = r.effective_object_story_id ? fbPostUrl(String(r.effective_object_story_id)) : "";
    const link = ig || fb;
    if (!ad || !link) continue;
    if (!links[ad] || (ig && !links[ad].includes("instagram.com"))) links[ad] = link;
  }

  // Mesmo nome/conjunto/campanha pode ter mais de um anúncio: ativo se algum estiver ativo.
  const statuses: Record<string, string> = {};
  for (const r of kept) {
    const st = r.effective_status ? String(r.effective_status) : "";
    if (!st) continue;
    const k = adStatusKey(String(r.ad_name ?? "—"), String(r.adset_name ?? "—"), String(r.campaign ?? "—"));
    if (!statuses[k] || st === "ACTIVE") statuses[k] = st;
  }

  const rows = kept.map((r) => ({
    date: String(r.date), ad: String(r.ad_name ?? "—"), campaign: String(r.campaign ?? "—"), adset: String(r.adset_name ?? "—"),
    spend: +(r.spend ?? 0), impressions: +(r.impressions ?? 0), clicks: +(r.clicks ?? 0), link_clicks: +(r.link_clicks ?? 0),
    purchases: +(r.actions_offsite_conversion_fb_pixel_purchase ?? 0), value: +(r.action_values_offsite_conversion_fb_pixel_purchase ?? 0),
    checkout: +(r.actions_offsite_conversion_fb_pixel_initiate_checkout ?? 0), lpv: +(r.actions_landing_page_view ?? 0),
  }));
  return { rows, links, statuses };
}

// Cacheado no servidor por 10 min (stale-while-revalidate): todas as renders/filtros
// reusam a mesma consulta ao Windsor, e só a primeira depois de expirar espera.
const cachedLive = unstable_cache(fetchLive, ["windsor-live", META_ACCOUNT_IDS.join(",")], { revalidate: 600 });

export async function getLiveData(): Promise<LiveData> {
  try {
    return await cachedLive();
  } catch (e) {
    console.error("[windsor-live] falhou, usando snapshot:", e);
    return { rows: [], links: {}, statuses: {} };
  }
}
