// ─────────────────────────────────────────────────────────────────────────────
// Real data pulled from the Windsor.ai "facebook" (Meta Ads) connector.
// Account: "Grupo ICF - Lançamentos" (id 1358862781130238).
// 90 days of day-level rows (incl. today), broken down by ad / campaign / ad set,
// stored compactly in dataset.json. The daily series is aggregated from the same
// rows, so totals stay perfectly consistent. When WINDSOR_API_KEY is set the app
// fetches this same shape live instead.
// ─────────────────────────────────────────────────────────────────────────────
import dataset from "./dataset.json";

export type DailyRow = {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  purchases: number;
  value: number;
  checkout: number;
  lpv: number;
};

export type CreativeRow = {
  date: string;
  ad: string;
  campaign: string;
  adset: string;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  purchases: number;
  value: number;
  checkout: number;
  lpv: number;
};

export const ACCOUNT = dataset.account;
export const DATA_FROM = dataset.generatedFrom;
export const DATA_TO = dataset.generatedTo;

const { dates, ads, campaigns, adsets, rows, daily } = dataset;

export const DAILY: DailyRow[] = (daily as DailyRow[]).slice();

export const CREATIVES: CreativeRow[] = (rows as number[][]).map((r) => ({
  date: dates[r[0]],
  ad: ads[r[1]],
  campaign: campaigns[r[2]],
  adset: adsets[r[3]],
  spend: r[4],
  impressions: r[5],
  clicks: r[6],
  link_clicks: r[7],
  purchases: r[8],
  value: r[9],
  checkout: r[10],
  lpv: r[11],
}));

export const ALL_DATES: string[] = [...dates].sort();

// Mapa anúncio → URL do post, colhido do Windsor pelo cron (campos permalink).
// Serve criativos com o botão "post↗" sem depender do Pipeboard (dashboard só-Windsor).
export const POST_LINKS: Record<string, string> =
  ((dataset as { postLinks?: Record<string, string> }).postLinks) ?? {};

// Status atual de cada anúncio (effective_status da Meta, via Windsor), chave
// adStatusKey(anúncio, conjunto, campanha). Reserva do mapa que vem ao vivo.
export const adStatusKey = (ad: string, adset: string, campaign: string) => `${ad} || ${adset} || ${campaign}`;
export const AD_STATUS: Record<string, string> =
  ((dataset as { adStatus?: Record<string, string> }).adStatus) ?? {};
