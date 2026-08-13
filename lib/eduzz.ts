// Eduzz integration helpers — webhook ingestion + Supabase persistence.
// Webhook payload reference: developers.eduzz.com (myeduzz.invoice_paid).

export type EduzzSale = {
  invoice_id: string;
  status: string;
  refunded: boolean;
  gross_value: number;
  net_value: number;
  currency: string;
  created_at: string | null;
  paid_at: string | null;
  product_id: string | null;
  product_name: string | null;
  buyer_email: string | null;
  buyer_name: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  utm_content: string | null;
  utm_term: string | null;
  tracker1: string | null;
  tracker2: string | null;
  tracker3: string | null;
  affiliate_id: string | null;
  affiliate_name: string | null;
  payment_method: string | null;
  installments: number | null;
  order_bump: boolean;
  last_event: string;
  raw: unknown;
};

// Events that mean "money in" vs "money reversed".
const PAID_EVENTS = new Set(["myeduzz.invoice_paid"]);
const REVERSAL_EVENTS = new Set([
  "myeduzz.invoice_refunded",
  "myeduzz.invoice_chargeback",
  "myeduzz.invoice_canceled",
]);

const numOr0 = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));

// Eduzz date format: "20260616" + "13:25:43" → ISO (BRT).
function eduzzDateTime(date?: unknown, time?: unknown): string | null {
  const m = String(date ?? "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const t = /^\d{2}:\d{2}/.test(String(time ?? "")) ? String(time) : "00:00:00";
  return `${m[1]}-${m[2]}-${m[3]}T${t}-03:00`;
}

/** Detect the payload format and map to our flat sale row. */
export function mapWebhookToSale(body: any): EduzzSale | null {
  if (!body || typeof body !== "object") return null;
  if (body.trans_cod != null) return mapLegacy(body);   // Eduzz "Notificação" (real format)
  if (body?.data?.id != null) return mapMyEduzz(body);   // newer MyEduzz format
  return null;
}

// Legacy Eduzz webhook ("Notificação"): pro_value + cop_value já vêm juntos no payload.
function mapLegacy(t: any): EduzzSale {
  const ev = String(t.event_name ?? "");
  const isRefund = /refund|charge_?back|cancel|estorn|dispute|devol|protest/i.test(ev) || t.trans_status === 7;
  const isPaid = /paid|pago|approv|aprovad/i.test(ev) || t.trans_status === 3 || isRefund;
  return {
    invoice_id: String(t.trans_cod),
    status: ev || String(t.trans_status ?? ""),
    refunded: isRefund,
    // valor-base dos produtos (sem juros de parcelamento) — não o total pago.
    gross_value: isPaid ? (numOr0(t.trans_value) || numOr0(t.trans_paid)) : 0,
    net_value: Math.round((numOr0(t.pro_value) + numOr0(t.cop_value)) * 100) / 100,
    currency: strOrNull(t.trans_currency) ?? "BRL",
    created_at: eduzzDateTime(t.trans_createdate, t.trans_createtime),
    paid_at: eduzzDateTime(t.trans_paiddate, t.trans_paidtime),
    product_id: strOrNull(t.product_cod ?? t.pro_cod),
    product_name: strOrNull(t.product_name),
    buyer_email: strOrNull(t.cus_email),
    buyer_name: strOrNull(t.cus_name),
    utm_source: strOrNull(t.utm_source ?? t.tracker_utm_source),
    utm_campaign: strOrNull(t.utm_campaign ?? t.tracker_utm_campaign),
    utm_medium: strOrNull(t.utm_medium ?? t.tracker_utm_medium),
    utm_content: strOrNull(t.utm_content ?? t.tracker_utm_content),
    utm_term: strOrNull(t.utm_term ?? t.tracker_utm_term),
    tracker1: strOrNull(t.tracker_trk), tracker2: strOrNull(t.tracker_trk2), tracker3: strOrNull(t.tracker_trk3),
    affiliate_id: strOrNull(t.aff_cod), affiliate_name: strOrNull(t.aff_name),
    payment_method: strOrNull(t.trans_paymentmethod),
    installments: null,
    order_bump: false,
    last_event: ev || "webhook",
    raw: t,
  };
}

function mapMyEduzz(body: any): EduzzSale | null {
  const event: string = body?.event ?? "";
  const d = body?.data;
  if (!d?.id) return null;

  const isReversal = REVERSAL_EVENTS.has(event);
  const status = isReversal ? event.split(".").pop() ?? "reversed" : strOrNull(d.status) ?? (PAID_EVENTS.has(event) ? "paid" : "open");

  return {
    invoice_id: String(d.id),
    status,
    refunded: isReversal,
    gross_value: numOr0(d.price?.value),
    net_value: numOr0(d.paid?.value),
    currency: strOrNull(d.price?.currency) ?? "BRL",
    created_at: strOrNull(d.createdAt),
    paid_at: strOrNull(d.paidAt),
    product_id: strOrNull(d.items?.[0]?.productId),
    product_name: strOrNull(d.items?.[0]?.name),
    buyer_email: strOrNull(d.buyer?.email),
    buyer_name: strOrNull(d.buyer?.name),
    utm_source: strOrNull(d.utm?.source),
    utm_campaign: strOrNull(d.utm?.campaign),
    utm_medium: strOrNull(d.utm?.medium),
    utm_content: strOrNull(d.utm?.content),
    utm_term: strOrNull(d.utm?.term),
    tracker1: strOrNull(d.tracker?.code1),
    tracker2: strOrNull(d.tracker?.code2),
    tracker3: strOrNull(d.tracker?.code3),
    affiliate_id: strOrNull(d.affiliate?.id),
    affiliate_name: strOrNull(d.affiliate?.name),
    payment_method: strOrNull(d.paymentMethod),
    installments: d.installments != null ? Number(d.installments) : null,
    order_bump: !!d.orderBump,
    last_event: event,
    raw: body,
  };
}

/** Shared ingestion: map one-or-many events and persist. Used by both the
 *  query-secret and path-secret webhook routes. */
export async function ingestEvents(body: unknown): Promise<{ status: number; payload: object }> {
  const events = Array.isArray(body) ? body : [body];
  const sales = events.map(mapWebhookToSale).filter((s): s is EduzzSale => s != null);
  if (!sales.length) return { status: 200, payload: { ok: true, ignored: true } };
  const r = await upsertSales(sales);
  if (!r.ok) return { status: 502, payload: { ok: false, error: r.error } };
  return { status: 200, payload: { ok: true, received: sales.length } };
}

/** Upsert sales into Supabase via the PostgREST endpoint (service-role key). */
export async function upsertSales(sales: EduzzSale[]): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, status: 500, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" };
  if (!sales.length) return { ok: true, status: 200 };

  const res = await fetch(`${url}/rest/v1/eduzz_sales?on_conflict=invoice_id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(sales.map((s) => ({ ...s, updated_at: new Date().toISOString() }))),
  });
  if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => "") };
  return { ok: true, status: res.status };
}
