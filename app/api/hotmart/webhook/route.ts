import { NextRequest, NextResponse } from "next/server";
import { ingestWebhook } from "@/lib/hotmart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Hotmart → POST aqui a cada evento de compra (Postback 2.0). Cadastre em
// Hotmart → Ferramentas → Webhook: URL https://<projeto>.vercel.app/api/hotmart/webhook,
// versão 2.0.0, eventos Compra aprovada/completa/reembolsada/cancelada, Chargeback e
// Pedido de reembolso. O Hottok da tela vai em HOTMART_HOTTOK na Vercel.
export async function POST(req: NextRequest) {
  const expected = process.env.HOTMART_HOTTOK?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "HOTMART_HOTTOK não configurado" }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  // v2 manda o hottok no cabeçalho; versões antigas, no corpo
  const hottok = req.headers.get("x-hotmart-hottok") ?? (body as { hottok?: string } | null)?.hottok;
  if (hottok !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const r = await ingestWebhook(body);
  return NextResponse.json(r.payload, { status: r.status });
}

// Abrir no navegador confirma que está no ar.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "hotmart-webhook", method: "POST" });
}
