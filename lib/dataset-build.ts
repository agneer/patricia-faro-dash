// Helpers to expand the compact dataset.json into raw rows and rebuild it.
// Used by the daily cron to merge fresh Windsor days into the snapshot.

export type RawRow = {
  date: string; ad: string; campaign: string; adset: string;
  spend: number; impressions: number; clicks: number; link_clicks: number;
  purchases: number; value: number; checkout: number; lpv: number;
};

export type CompactDataset = {
  account: { id: string; name: string; connector: string; connectorLabel: string; currency: string };
  generatedFrom: string;
  generatedTo: string;
  dates: string[];
  ads: string[];
  campaigns: string[];
  adsets: string[];
  rows: number[][];
  daily: { date: string; spend: number; impressions: number; clicks: number; link_clicks: number; purchases: number; value: number; checkout: number; lpv: number }[];
};

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

export function expand(ds: CompactDataset): RawRow[] {
  const { dates, ads, campaigns, adsets, rows } = ds;
  return rows.map((r) => ({
    date: dates[r[0]], ad: ads[r[1]], campaign: campaigns[r[2]], adset: adsets[r[3]],
    spend: r[4], impressions: r[5], clicks: r[6], link_clicks: r[7],
    purchases: r[8], value: r[9], checkout: r[10], lpv: r[11],
  }));
}

export function build(rawRows: RawRow[], account: CompactDataset["account"]): CompactDataset {
  const ads: string[] = [], campaigns: string[] = [], adsets: string[] = [], dates: string[] = [];
  const idx = (arr: string[], v: string) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const rows: number[][] = [];
  const dailyMap = new Map<string, CompactDataset["daily"][number]>();

  for (const x of rawRows) {
    const di = idx(dates, x.date), ai = idx(ads, x.ad ?? "—"), ci = idx(campaigns, x.campaign ?? "—"), si = idx(adsets, x.adset ?? "—");
    const spend = r2(x.spend), imp = +x.impressions || 0, clk = +x.clicks || 0, lc = +x.link_clicks || 0;
    const pur = +x.purchases || 0, val = r2(x.value), chk = +x.checkout || 0, lpv = +x.lpv || 0;
    rows.push([di, ai, ci, si, spend, imp, clk, lc, pur, val, chk, lpv]);
    let d = dailyMap.get(x.date);
    if (!d) { d = { date: x.date, spend: 0, impressions: 0, clicks: 0, link_clicks: 0, purchases: 0, value: 0, checkout: 0, lpv: 0 }; dailyMap.set(x.date, d); }
    d.spend += spend; d.impressions += imp; d.clicks += clk; d.link_clicks += lc; d.purchases += pur; d.value += val; d.checkout += chk; d.lpv += lpv;
  }
  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, spend: r2(d.spend), value: r2(d.value) }));
  const sorted = [...dates].sort();
  return { account, generatedFrom: sorted[0], generatedTo: sorted[sorted.length - 1], dates, ads, campaigns, adsets, rows, daily };
}

// Merge fresh rows (recent days) into existing raw rows, then trim to a window.
export function mergeRecent(existing: RawRow[], fresh: RawRow[], windowDays: number, today: string): RawRow[] {
  const freshDates = new Set(fresh.map((r) => r.date));
  const cutoff = new Date(Date.parse(today) - (windowDays - 1) * 86400000).toISOString().slice(0, 10);
  // keep old rows whose date is NOT being refreshed; add all fresh; trim to window
  const kept = existing.filter((r) => !freshDates.has(r.date));
  return [...kept, ...fresh].filter((r) => r.date >= cutoff);
}
