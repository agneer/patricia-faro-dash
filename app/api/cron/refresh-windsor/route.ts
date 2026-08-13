import { NextRequest, NextResponse } from "next/server";
import bundled from "@/lib/dataset.json";
import { expand, build, mergeRecent, type RawRow, type CompactDataset } from "@/lib/dataset-build";
import { META_ACCOUNT_IDS, CAMPAIGN_FILTER } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const ACCOUNT_IDS = new Set(META_ACCOUNT_IDS);
const IS_LOW_TICKET = CAMPAIGN_FILTER;
const REFRESH_DAYS = 7; // re-pull the last N days (catches corrections + new days)

const FIELDS = [
  "date", "account_id", "ad_name", "campaign", "adset_name", "spend", "impressions", "clicks", "link_clicks",
  "actions_offsite_conversion_fb_pixel_purchase", "action_values_offsite_conversion_fb_pixel_purchase",
  "actions_offsite_conversion_fb_pixel_initiate_checkout", "actions_landing_page_view",
];

const today = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // ~BRT date
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

async function fetchWindsor(from: string, to: string): Promise<RawRow[]> {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error("WINDSOR_API_KEY ausente");
  const url = new URL("https://connectors.windsor.ai/facebook");
  url.searchParams.set("api_key", key);
  url.searchParams.set("date_from", from);
  url.searchParams.set("date_to", to);
  url.searchParams.set("fields", FIELDS.join(","));
  const res = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(280_000) });
  if (!res.ok) throw new Error(`Windsor ${res.status}`);
  const json = await res.json();
  const data: Record<string, unknown>[] = json.data ?? json.result ?? [];
  return data
    .filter((r) => ACCOUNT_IDS.has(String(r.account_id)) && IS_LOW_TICKET.test(String(r.campaign ?? "")))
    .map((r) => ({
      date: String(r.date), ad: String(r.ad_name ?? "—"), campaign: String(r.campaign ?? "—"), adset: String(r.adset_name ?? "—"),
      spend: +(r.spend ?? 0), impressions: +(r.impressions ?? 0), clicks: +(r.clicks ?? 0), link_clicks: +(r.link_clicks ?? 0),
      purchases: +(r.actions_offsite_conversion_fb_pixel_purchase ?? 0), value: +(r.action_values_offsite_conversion_fb_pixel_purchase ?? 0),
      checkout: +(r.actions_offsite_conversion_fb_pixel_initiate_checkout ?? 0), lpv: +(r.actions_landing_page_view ?? 0),
    }));
}

// Commit the new dataset.json to GitHub → triggers Vercel auto-deploy.
async function commitToGitHub(content: string): Promise<void> {
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  // Usa GITHUB_REPO se for "owner/repo" válido; senão cai no repo deste deploy.
  const envRepo = process.env.GITHUB_REPO ?? "";
  const repo = envRepo.includes("/") ? envRepo : "agneer/patricia-faro-dash";
  const path = "lib/dataset.json";
  if (!token) throw new Error("GITHUB_TOKEN ausente");
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "icf-dash-cron" };

  const cur = await fetch(`${api}?ref=main`, { headers, cache: "no-store" });
  const sha = cur.ok ? (await cur.json()).sha : undefined;

  const put = await fetch(api, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `data: refresh automático do gasto Windsor (${today()})`,
      content: Buffer.from(content).toString("base64"),
      sha,
      branch: "main",
      committer: { name: "ICF Dash Cron", email: "agneer@users.noreply.github.com" },
      author: { name: "ICF Dash Cron", email: "agneer@users.noreply.github.com" },
    }),
  });
  if (!put.ok) throw new Error(`GitHub commit ${put.status}: ${await put.text().catch(() => "")}`);
}

export async function GET(req: NextRequest) {
  // Autorização robusta: aceita o secret da Vercel (Authorization: Bearer), o
  // user-agent de cron da Vercel, OU a senha admin (pra disparo manual). Sem
  // CRON_SECRET configurado, libera. Refresh de dados públicos → baixo risco.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const ua = req.headers.get("user-agent") ?? "";
  const adminPw = req.headers.get("x-admin-password") ?? req.nextUrl.searchParams.get("key") ?? "";
  const authorized =
    !secret ||
    auth === `Bearer ${secret}` ||
    /vercel-cron/i.test(ua) ||
    (!!process.env.ADMIN_PASSWORD && adminPw === process.env.ADMIN_PASSWORD);
  if (!authorized) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const to = today();
    // ?days=N permite um pull mais fundo (ex.: semear o histórico de uma conta nova).
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || REFRESH_DAYS, 1), 400);
    const from = addDays(to, -(days - 1));
    const fresh = await fetchWindsor(from, to);
    if (!fresh.length) return NextResponse.json({ ok: false, error: "Windsor não retornou linhas LOW TICKET" }, { status: 502 });

    const existing = expand(bundled as CompactDataset);
    // Keep the full history (campaign started 2026-01-06); 400-day window is a safe cap.
    const merged = mergeRecent(existing, fresh, 400, to);
    const next = build(merged, (bundled as CompactDataset).account);

    await commitToGitHub(JSON.stringify(next) + "\n");

    return NextResponse.json({
      ok: true,
      refreshed: { from, to, freshRows: fresh.length },
      dataset: { from: next.generatedFrom, to: next.generatedTo, rows: next.rows.length, days: next.daily.length },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
