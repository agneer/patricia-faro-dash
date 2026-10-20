// Hotmart: webhook (Postback 2.0) → linha de venda → Supabase (tabela hotmart_sales).
// Nada de dados do comprador (nome/e-mail/documento) é gravado.

export type HotmartSale = {
  invoice_id: string;
  parent_transaction: string | null;
  status: string;
  refunded: boolean;
  order_bump: boolean;
  gross_value: number;
  net_value: number;
  currency: string;
  created_at: string | null;
  paid_at: string | null;
  product_id: string | null;
  product_name: string | null;
  offer_code: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  utm_content: string | null;
  utm_term: string | null;
  src: string | null;
  sck: string | null;
  xcod: string | null;
  payment_method: string | null;
  installments: number | null;
  last_event: string;
  raw: unknown;
};

// Eventos que mudam vendas. Boleto/pix gerado, carrinho abandonado etc. são ignorados.
const PAID_EVENTS = new Set(["PURCHASE_APPROVED", "PURCHASE_COMPLETE", "PURCHASE_PROTEST"]); // protest = reembolso em análise: ainda é venda
const REVERSAL_EVENTS = new Set(["PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK", "PURCHASE_CANCELED"]);

type Json = Record<string, unknown>;
const at = (o: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Json)[k] : undefined), o);
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;
const iso = (ms: unknown) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : null);

// As UTMs do link do checkout (utm_campaign=…) chegam em lugares diferentes conforme a
// versão do postback (purchase.origin, purchase.tracking…): procura a chave em qualquer
// nível de `data`, fora do bloco do comprador.
function findKey(o: unknown, names: string[], depth = 0): string | null {
  if (!o || typeof o !== "object" || depth > 5) return null;
  for (const [k, v] of Object.entries(o as Json)) {
    if (k === "buyer" || k === "producer" || k === "affiliates") continue;
    if (names.includes(k.toLowerCase()) && v != null && typeof v !== "object" && String(v) !== "") return String(v);
  }
  for (const [k, v] of Object.entries(o as Json)) {
    if (k === "buyer" || k === "producer" || k === "affiliates") continue;
    const hit = findKey(v, names, depth + 1);
    if (hit) return hit;
  }
  return null;
}
const utm = (data: unknown, name: string) => findKey(data, [`utm_${name}`, `utm${name}`]);

/** Postback 2.0 → venda; null = evento que não muda vendas. */
export function saleFromWebhook(body: unknown): HotmartSale | null {
  const event = String(at(body, "event") ?? "");
  const data = at(body, "data");
  const p = at(data, "purchase") as Json | undefined;
  const id = str(p?.transaction);
  if (!id || !(PAID_EVENTS.has(event) || REVERSAL_EVENTS.has(event))) return null;

  const refunded = REVERSAL_EVENTS.has(event);
  const price = (["price", "full_price", "original_offer_price"] as const)
    .map((k) => p?.[k] as Json | undefined)
    .find((x) => x?.value != null);
  const commissions = (at(data, "commissions") as Json[] | undefined) ?? [];
  const producer = commissions.find((c) => String(c.source).toUpperCase() === "PRODUCER");
  const gross = num(price?.value);
  const isBump = !!at(p, "order_bump", "is_order_bump");

  return {
    invoice_id: id,
    parent_transaction: isBump ? str(at(p, "order_bump", "parent_purchase_transaction")) : null,
    status: (str(p?.status) ?? event).toLowerCase(),
    refunded,
    order_bump: isBump,
    gross_value: gross,
    net_value: producer ? num(producer.value) : gross,
    currency: str(price?.currency_value)?.toUpperCase() ?? "BRL",
    created_at: iso(p?.order_date),
    paid_at: iso(p?.approved_date) ?? iso(p?.order_date) ?? iso(at(body, "creation_date")),
    product_id: str(at(data, "product", "id")),
    product_name: str(at(data, "product", "name")),
    offer_code: str(at(p, "offer", "code")),
    utm_source: utm(data, "source"),
    utm_campaign: utm(data, "campaign"),
    utm_medium: utm(data, "medium"),
    utm_content: utm(data, "content"),
    utm_term: utm(data, "term"),
    src: findKey(p, ["src"]),
    sck: findKey(p, ["sck"]),
    xcod: findKey(p, ["xcod"]),
    payment_method: str(at(p, "payment", "type")),
    installments: at(p, "payment", "installments_number") != null ? num(at(p, "payment", "installments_number")) : null,
    last_event: event,
    raw: { event, product: at(data, "product"), purchase: p, commissions },
  };
}

const SB = () => ({ url: process.env.SUPABASE_URL?.trim().replace(/\/+$/, ""), key: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() });

async function isAlreadyReversed(id: string): Promise<boolean> {
  const { url, key } = SB();
  const res = await fetch(`${url}/rest/v1/hotmart_sales?select=refunded&invoice_id=eq.${encodeURIComponent(id)}`, {
    headers: { apikey: key!, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as { refunded: boolean }[];
  return !!rows[0]?.refunded;
}

/** Grava um evento do webhook. Um "aprovado" que chega depois do estorno não desfaz o estorno. */
export async function ingestWebhook(body: unknown): Promise<{ status: number; payload: object }> {
  const sale = saleFromWebhook(body);
  if (!sale) return { status: 200, payload: { ok: true, ignored: true } };
  if (!sale.refunded && (await isAlreadyReversed(sale.invoice_id))) {
    return { status: 200, payload: { ok: true, kept: "refunded" } };
  }
  const r = await upsertSales([sale]);
  if (!r.ok) return { status: 502, payload: { ok: false, error: r.error } };
  // sem dados do comprador no log
  console.log(`[hotmart] ${sale.invoice_id} ${sale.last_event} "${sale.product_name}" ${sale.gross_value} ${sale.currency}` +
    ` bump=${sale.order_bump} utm_campaign=${sale.utm_campaign ?? "—"} utm_content=${sale.utm_content ?? "—"}`);
  return { status: 200, payload: { ok: true, id: sale.invoice_id } };
}

/** Upsert no Supabase via PostgREST (service-role key). Idempotente por invoice_id. */
export async function upsertSales(sales: HotmartSale[]): Promise<{ ok: boolean; status: number; error?: string }> {
  const { url, key } = SB();
  if (!url || !key) return { ok: false, status: 500, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" };
  if (!sales.length) return { ok: true, status: 200 };
  const res = await fetch(`${url}/rest/v1/hotmart_sales?on_conflict=invoice_id`, {
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
