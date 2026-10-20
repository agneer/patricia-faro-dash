import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin";
import { parseHotmartCsv } from "@/lib/hotmart-csv";
import { upsertSales } from "@/lib/hotmart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = checkAdmin(req);
  if (denied) return denied;

  let text: string;
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Arquivo não enviado." }, { status: 400 });
      text = await file.text();
    } else {
      text = await req.text();
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Não consegui ler o arquivo." }, { status: 400 });
  }

  const parsed = parseHotmartCsv(text);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error, headers: parsed.headers, detected: parsed.detected }, { status: 422 });

  // upsert em lotes (idempotente por invoice_id — reimportar não duplica)
  let imported = 0;
  for (let i = 0; i < parsed.sales.length; i += 500) {
    const batch = parsed.sales.slice(i, i + 500);
    const r = await upsertSales(batch);
    if (!r.ok) return NextResponse.json({ ok: false, error: `Erro ao gravar no Supabase: ${r.error}`, importedBefore: imported }, { status: 502 });
    imported += batch.length;
  }

  return NextResponse.json({
    ok: true,
    imported,
    total: parsed.sales.length,
    utmCount: parsed.utmCount,
    detected: parsed.detected,
    headers: parsed.headers,
  });
}
