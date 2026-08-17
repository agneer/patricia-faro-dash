// Resolve o link do post de cada anúncio. Fonte principal: o mapa colhido do Windsor
// pelo cron (POST_LINKS no dataset) — funciona em dashboard só-Windsor, sem Pipeboard.
// Se houver PIPEBOARD_API_TOKEN, o Pipeboard complementa/atualiza; e o `creative-links.json`
// continua como camada de override manual (vence os dois).
import { unstable_cache } from "next/cache";
import { CONFIG, META_ACCOUNT_IDS } from "./config";
import { POST_LINKS } from "./snapshot";
import MANUAL from "./creative-links.json";

const ENDPOINT = "https://meta-ads.mcp.pipeboard.co/";

type TrackingSpec = Record<string, string[]>;
type Ad = { name?: string; tracking_specs?: TrackingSpec[] };

// O post id vem nos tracking_specs do anúncio (post_engagement / link_click):
//   { "action.type": ["post_engagement"], "page": ["<pageid>"], "post": ["<postid>"] }
// → https://www.facebook.com/<pageid>/posts/<postid>
function postUrlOf(specs?: TrackingSpec[]): string | null {
  for (const s of specs ?? []) {
    const post = s["post"]?.[0];
    const page = s["post.wall"]?.[0] ?? s["page"]?.[0];
    if (post && page) return `https://www.facebook.com/${page}/posts/${post}`;
  }
  return null;
}

async function fetchAds(accountId: string): Promise<Ad[] | null> {
  const token = process.env.PIPEBOARD_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "get_ads", arguments: { account_id: `act_${accountId}`, limit: 500 } },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.result?.content?.[0]?.text;
    if (!text) return null;
    return (JSON.parse(text).data ?? []) as Ad[];
  } catch {
    return null;
  }
}

// Mapa nome-do-anúncio → URL do post. Busca em TODAS as contas do dashboard (multi-
// conta) + overrides manuais (manual vence). Conta bloqueada no Pipeboard falha em
// silêncio e é ignorada — os criativos dela entram quando liberar.
async function buildPostLinks(): Promise<Record<string, string>> {
  const manual = MANUAL as Record<string, string>;
  const perAccount = await Promise.all(META_ACCOUNT_IDS.map(fetchAds));
  const ads = perAccount.filter(Boolean).flat() as Ad[];
  const auto: Record<string, string> = {};
  for (const ad of ads) {
    if (!ad.name) continue;
    const url = postUrlOf(ad.tracking_specs);
    if (url) auto[ad.name] = url;
  }
  return { ...POST_LINKS, ...auto, ...manual };
}

// Cacheado (POST não cacheia no fetch): criativos mudam pouco, então 30 min.
export const resolvePostLinks = unstable_cache(
  buildPostLinks,
  ["post-links", CONFIG.metaAccountId],
  { revalidate: 1800 },
);
