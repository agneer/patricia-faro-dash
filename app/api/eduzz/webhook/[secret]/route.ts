import { NextRequest, NextResponse } from "next/server";
import { ingestEvents } from "@/lib/eduzz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Path-based secret variant — for platforms (like Eduzz/Órbita) that don't
// forward the ?secret=... query string on POST. Register this URL in Eduzz:
//   https://icf-low-ticket-dash.vercel.app/api/eduzz/webhook/YOUR_SECRET
export async function POST(req: NextRequest, ctx: { params: Promise<{ secret: string }> }) {
  const expected = process.env.EDUZZ_WEBHOOK_SECRET;
  const { secret } = await ctx.params;
  if (expected && secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ secret: string }> }) {
  const expected = process.env.EDUZZ_WEBHOOK_SECRET;
  const { secret } = await ctx.params;
  const authed = !expected || secret === expected;
  return NextResponse.json({ ok: authed, endpoint: "eduzz-webhook-path", method: "POST" }, { status: authed ? 200 : 401 });
}
