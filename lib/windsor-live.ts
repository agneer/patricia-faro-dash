// Gasto ao vivo via Windsor.ai (conector `facebook`), SÓ das contas deste dashboard
// (`select_accounts`). O histórico vem do snapshot (dataset.json); ao vivo só se
// busca a janela recente — do fim do snapshot (com folga) até hoje —, que responde
// em segundos. Puxar tudo desde o início a cada visita levava >45 s e travava os
// filtros. Duas consultas, cada uma com cache próprio:
//   - números por dia e anúncio (janela recente)              → cache 10 min
//   - status atual + link do post de cada anúncio (todo o período, sem quebra por dia) → cache 30 min
// A página nunca espera o Windsor mais que alguns segundos: se não vier a tempo, abre
// com o snapshot e a consulta termina em segundo plano (after), já guardando no cache.
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { CAMPAIGN_FILTER, META_ACCOUNT_IDS } from "./config";
import { ALL_DATES, DATA_TO, adStatusKey, type CreativeRow } from "./snapshot";

const ROW_FIELDS = [
  "date", "account_id", "ad_name", "campaign", "adset_name", "spend", "impressions", "clicks", "link_clicks",
  "actions_offsite_conversion_fb_pixel_purchase", "action_values_offsite_conversion_fb_pixel_purchase",
  "actions_offsite_conversion_fb_pixel_initiate_checkout", "actions_landing_page_view",
];
const META_FIELDS = [
  "account_id", "ad_name", "campaign", "adset_name", "spend",
  "effective_status", "effective_object_story_id", "instagram_permalink_url",
];

// Dias antes do fim do snapshot que ainda são re-buscados (a Meta corrige dias recentes).
const OVERLAP_DAYS = 3;
// Quanto a página espera o Windsor antes de seguir com o snapshot.
const PAGE_WAIT_MS = 4_000;

export type LiveRows = { rows: CreativeRow[] };
// statuses: status atual (effective_status) por adStatusKey(anúncio, conjunto, campanha).
export type LiveMeta = { links: Record<string, string>; statuses: Record<string, string> };
export type LiveData = LiveRows & LiveMeta;

const brtToday = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// object_story_id = "<pageid>_<postid>" → URL pública do post no Facebook.
function fbPostUrl(objectStoryId: string): string {
  const [page, post] = objectStoryId.split("_");
  return page && post ? `https://www.facebook.com/${page}/posts/${post}` : "";
}

// Lança em falha (pra unstable_cache não guardar resultado vazio); quem chama trata.
async function windsor(fields: string[], from: string, to: string): Promise<Record<string, unknown>[]> {
  const key = process.env.WINDSOR_API_KEY?.trim();
  if (!key) return [];
  const url = new URL("https://connectors.windsor.ai/facebook");
  url.searchParams.set("api_key", key);
  url.searchParams.set("date_from", from);
  url.searchParams.set("date_to", to);
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("select_accounts", META_ACCOUNT_IDS.join(","));
  const t0 = Date.now();
  const res = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Windsor HTTP ${res.status}`);
  const json = await res.json();
  const data: Record<string, unknown>[] = json.data ?? json.result ?? [];
  console.log(`[windsor-live] ${fields.includes("date") ? "linhas" : "status/links"} ${from}→${to}: ${data.length} em ${Date.now() - t0} ms`);
  const accounts = new Set(META_ACCOUNT_IDS);
  return data.filter((r) =>
    accounts.has(String(r.account_id)) && CAMPAIGN_FILTER.test(String(r.campaign ?? "")) && Number(r.spend ?? 0) > 0);
}

async function fetchRows(): Promise<LiveRows> {
  const today = brtToday();
  const start = DATA_TO ? addDays(DATA_TO, -OVERLAP_DAYS) : addDays(today, -6);
  const kept = await windsor(ROW_FIELDS, start, today);
  return {
    rows: kept.map((r) => ({
      date: String(r.date), ad: String(r.ad_name ?? "—"), campaign: String(r.campaign ?? "—"), adset: String(r.adset_name ?? "—"),
      spend: +(r.spend ?? 0), impressions: +(r.impressions ?? 0), clicks: +(r.clicks ?? 0), link_clicks: +(r.link_clicks ?? 0),
      purchases: +(r.actions_offsite_conversion_fb_pixel_purchase ?? 0), value: +(r.action_values_offsite_conversion_fb_pixel_purchase ?? 0),
      checkout: +(r.actions_offsite_conversion_fb_pixel_initiate_checkout ?? 0), lpv: +(r.actions_landing_page_view ?? 0),
    })),
  };
}

async function fetchMeta(): Promise<LiveMeta> {
  const kept = await windsor(META_FIELDS, ALL_DATES[0] ?? addDays(brtToday(), -89), brtToday());
  // Instagram vence Facebook (os criativos são do IG); por nome de anúncio, que é
  // como o dashboard agrupa os criativos.
  const links: Record<string, string> = {};
  // Mesmo nome/conjunto/campanha pode ter mais de um anúncio: ativo se algum estiver ativo.
  const statuses: Record<string, string> = {};
  for (const r of kept) {
    const ad = String(r.ad_name ?? "");
    const ig = r.instagram_permalink_url ? String(r.instagram_permalink_url) : "";
    const fb = r.effective_object_story_id ? fbPostUrl(String(r.effective_object_story_id)) : "";
    const link = ig || fb;
    if (ad && link && (!links[ad] || (ig && !links[ad].includes("instagram.com")))) links[ad] = link;

    const st = r.effective_status ? String(r.effective_status) : "";
    if (!st) continue;
    const k = adStatusKey(String(r.ad_name ?? "—"), String(r.adset_name ?? "—"), String(r.campaign ?? "—"));
    if (!statuses[k] || st === "ACTIVE") statuses[k] = st;
  }
  return { links, statuses };
}

// Cache no servidor (stale-while-revalidate): depois de expirar, serve o anterior e
// atualiza em segundo plano — só um cache vazio faz alguém esperar.
const KEY = META_ACCOUNT_IDS.join(",");
const cachedRows = unstable_cache(fetchRows, ["windsor-rows", KEY, DATA_TO], { revalidate: 600 });
const cachedMeta = unstable_cache(fetchMeta, ["windsor-meta", KEY], { revalidate: 1800 });

// Uma consulta em andamento por instância: o período atual e o anterior (setas de
// comparação) e cliques seguidos reaproveitam a mesma, em vez de abrir outra.
const inflight = new Map<string, Promise<unknown>>();
function shared<T>(name: string, fn: () => Promise<T>): Promise<T> {
  let p = inflight.get(name) as Promise<T> | undefined;
  if (!p) {
    p = fn().finally(() => inflight.delete(name));
    inflight.set(name, p);
  }
  return p;
}

// Espera até `ms`; se não vier, devolve `fallback` e deixa a consulta terminar depois
// da resposta (after), para o próximo acesso já encontrar o cache cheio.
async function upTo<T>(name: string, p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => { timer = setTimeout(() => resolve("late"), ms); });
  try {
    const r = await Promise.race([p, late]);
    if (r !== "late") return r as T;
    console.warn(`[windsor-live] ${name} passou de ${ms} ms — abrindo com o snapshot, termina em segundo plano`);
    after(() => p.then(() => undefined, () => undefined));
    return fallback;
  } catch (e) {
    console.error(`[windsor-live] ${name} falhou, usando snapshot:`, e instanceof Error ? e.message : e);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export async function getLiveData(): Promise<LiveData> {
  const [rows, meta] = await Promise.all([
    upTo("linhas", shared("rows", cachedRows), PAGE_WAIT_MS, { rows: [] }),
    upTo("status/links", shared("meta", cachedMeta), PAGE_WAIT_MS, { links: {}, statuses: {} }),
  ]);
  return { ...rows, ...meta };
}
