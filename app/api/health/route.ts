import { NextResponse } from "next/server";
import bundled from "@/lib/dataset.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Diagnóstico TEMPORÁRIO das integrações, sem expor segredos: só diz se cada env
// existe e qual código HTTP cada serviço devolve. Remover depois de estabilizar.
async function probe(url: string, init?: RequestInit): Promise<{ status: string; ms: number; body?: unknown }> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const text = await r.text().catch(() => "");
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = undefined; }
    return { status: String(r.status), ms: Date.now() - t0, body };
  } catch (e) {
    return { status: `erro: ${e instanceof Error ? e.name : "falha"}`, ms: Date.now() - t0 };
  }
}

export async function GET() {
  const has = (k: string) => !!process.env[k]?.trim();
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  const envRepo = process.env.GITHUB_REPO ?? "";
  const repo = envRepo.includes("/") ? envRepo : "agneer/patricia-faro-dash";
  const sbUrl = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const wKey = process.env.WINDSOR_API_KEY?.trim();
  const day = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

  const [gh, sb, w] = await Promise.all([
    ghToken
      ? probe(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${ghToken}`, "User-Agent": "dash-health" } })
      : null,
    sbUrl && sbKey
      ? probe(`${sbUrl}/rest/v1/eduzz_sales?select=invoice_id&limit=1`, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } })
      : null,
    wKey
      ? probe(`https://connectors.windsor.ai/facebook?api_key=${encodeURIComponent(wKey)}&date_from=${day}&date_to=${day}&fields=account_id,spend`)
      : null,
  ]);

  const ghBody = gh?.body as { permissions?: { push?: boolean }; message?: string } | undefined;
  const sbBody = sb?.body as { message?: string; code?: string } | undefined;
  const wBody = w?.body as { data?: unknown[]; error?: string } | undefined;

  return NextResponse.json({
    snapshotAte: (bundled as { generatedTo: string }).generatedTo,
    env: Object.fromEntries(
      ["WINDSOR_API_KEY", "GITHUB_TOKEN", "GITHUB_REPO", "CRON_SECRET", "ADMIN_PASSWORD", "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY", "EDUZZ_WEBHOOK_SECRET", "META_ACCESS_TOKEN"].map((k) => [k, has(k)]),
    ),
    github: gh
      ? { repoAlvo: repo, http: gh.status, podeCommitar: ghBody?.permissions?.push ?? false, msg: ghBody?.message }
      : { repoAlvo: repo, http: "sem GITHUB_TOKEN" },
    supabase: sb
      ? { urlFormatoOk: /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(sbUrl), http: sb.status, msg: sbBody?.message ?? sbBody?.code, ms: sb.ms }
      : { urlFormatoOk: /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(sbUrl), http: "sem SUPABASE_URL/KEY" },
    windsor: w
      ? { http: w.status, linhasHoje: Array.isArray(wBody?.data) ? wBody.data.length : null, erro: wBody?.error, ms: w.ms }
      : { http: "sem WINDSOR_API_KEY" },
  });
}
