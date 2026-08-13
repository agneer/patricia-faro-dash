import { NextRequest, NextResponse } from "next/server";
import { checkAdmin, sbCount, sbLastSale } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = checkAdmin(req);
  if (denied) return denied;

  const [total, withUtm, fromCsv, fromWebhook, last] = await Promise.all([
    sbCount(),
    sbCount("&utm_campaign=not.is.null"),
    sbCount("&last_event=eq.csv_import"),
    sbCount("&last_event=eq.myeduzz.invoice_paid"),
    sbLastSale(),
  ]);

  return NextResponse.json({
    ok: true,
    total,
    withUtm,
    fromCsv,
    fromWebhook,
    lastSale: last?.paid_at ?? last?.sale_date ?? null,
    webhookUrl: `${req.nextUrl.origin}/api/eduzz/webhook`,
  });
}
