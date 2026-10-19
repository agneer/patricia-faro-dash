// Link do post de cada anúncio (botão "post↗"), direto da Meta Marketing API: o
// criativo de cada anúncio traz `instagram_permalink_url` e `effective_object_story_id`
// (→ facebook.com/<page>/posts/<post>). Todo criativo novo já entra com link.
// Base = mapa do dataset (reserva sem token); `creative-links.json` = override manual (vence).
import { unstable_cache } from "next/cache";
import { META_ACCOUNT_IDS } from "./config";
import { POST_LINKS } from "./snapshot";
import MANUAL from "./creative-links.json";

const API_VERSION = process.env.META_API_VERSION ?? "v23.0";

type Ad = { name?: string; creative?: { effective_object_story_id?: string; instagram_permalink_url?: string } };

// Instagram vence Facebook (os criativos são do IG).
function postUrlOf(ad: Ad): string | null {
  const ig = ad.creative?.instagram_permalink_url;
  if (ig) return ig;
  const [page, post] = (ad.creative?.effective_object_story_id ?? "").split("_");
  return page && post ? `https://www.facebook.com/${page}/posts/${post}` : null;
}

async function fetchAds(accountId: string): Promise<Ad[]> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return [];
  try {
    const url = new URL(`https://graph.facebook.com/${API_VERSION}/act_${accountId}/ads`);
    url.searchParams.set("fields", "name,creative{effective_object_story_id,instagram_permalink_url}");
    url.searchParams.set("limit", "500");
    url.searchParams.set("access_token", token);
    const out: Ad[] = [];
    let next: string | undefined = url.toString();
    while (next) {
      const res: Response = await fetch(next, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return out;
      const json = await res.json();
      out.push(...((json.data ?? []) as Ad[]));
      next = json.paging?.next;
    }
    return out;
  } catch {
    return [];
  }
}

// Mapa nome-do-anúncio → URL do post: dataset (base) + Meta + overrides manuais.
async function buildPostLinks(): Promise<Record<string, string>> {
  const ads = (await Promise.all(META_ACCOUNT_IDS.map(fetchAds))).flat();
  const auto: Record<string, string> = {};
  for (const ad of ads) {
    if (!ad.name) continue;
    const url = postUrlOf(ad);
    if (url && (!auto[ad.name] || url.includes("instagram.com"))) auto[ad.name] = url;
  }
  return { ...POST_LINKS, ...auto, ...(MANUAL as Record<string, string>) };
}

// Cacheado (criativos mudam pouco): 30 min.
export const resolvePostLinks = unstable_cache(
  buildPostLinks,
  ["post-links", META_ACCOUNT_IDS.join(",")],
  { revalidate: 1800 },
);
