import { NextRequest, NextResponse } from "next/server";
import { ingestEvents } from "@/lib/eduzz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Eduzz → POST here on every sale event (myeduzz.invoice_paid, refunded, ...).
// Configure the URL in Eduzz (Órbita → Webhooks) as:
//   https://icf-low-ticket-dash.vercel.app/api/eduzz/webhook?secret=YOUR_SECRET
// and set EDUZZ_WEBHOOK_SECRET to the same value in the Vercel project.
export async function POST(req: NextRequest) {
  const secret = process.env.EDUZZ_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const r = await ingestEvents(body);
  return NextResponse.json(r.payload, { status: r.status });
}

// Lets you open the URL in a browser to confirm it's deployed.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "eduzz-webhook", method: "POST" });
}
