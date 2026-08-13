import { NextRequest, NextResponse } from "next/server";

// Gate for admin-only endpoints. The password lives in ADMIN_PASSWORD (Vercel env);
// the admin page sends it in the x-admin-password header.
export function checkAdmin(req: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return NextResponse.json({ ok: false, error: "ADMIN_PASSWORD não configurada no servidor." }, { status: 503 });
  const provided = req.headers.get("x-admin-password") ?? "";
  if (provided !== expected) return NextResponse.json({ ok: false, error: "Senha incorreta." }, { status: 401 });
  return null;
}

const SB = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });

export async function sbCount(filter = ""): Promise<number> {
  const { url, key } = SB();
  if (!url || !key) return 0;
  const res = await fetch(`${url}/rest/v1/eduzz_sales?select=invoice_id${filter}`, {
    method: "HEAD",
    headers: { apikey: key!, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
    cache: "no-store",
  });
  const range = res.headers.get("content-range") ?? "";
  return Number(range.split("/")[1]) || 0;
}

export async function sbLastSale(): Promise<{ paid_at: string | null; sale_date: string | null } | null> {
  const { url, key } = SB();
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/eduzz_sales?select=paid_at,sale_date&order=paid_at.desc.nullslast&limit=1`, {
    headers: { apikey: key!, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}
