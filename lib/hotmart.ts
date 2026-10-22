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
  // Líquido = valor − comissão da plataforma (MARKETPLACE). Coprodutor/afiliado não saem:
  // é faturamento do negócio, só dividido depois.
  const marketplace = commissions.filter((c) => String(c.source).toUpperCase() === "MARKETPLACE");
  const gross = num(price?.value);
  const isBump = !!at(p, "order_bump", "is_order_bump");

  return {
    invoice_id: id,
    parent_transaction: isBump ? str(at(p, "order_bump", "parent_purchase_transaction")) : null,
    status: (str(p?.status) ?? event).toLowerCase(),
    refunded,
    order_bump: isBump,
    gross_value: gross,
    net_value: Math.round((gross - marketplace.reduce((t, c) => t + num(c.value), 0)) * 100) / 100,
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
  if (!sale) {
    console.log(`[hotmart] evento ignorado: ${String(at(body, "event") ?? "?")}`);
    return { status: 200, payload: { ok: true, ignored: true } };
  }
  // "Enviar teste" da Hotmart: produto fictício (R$ 1.500, transação fixa). Só registra
  // no log que o webhook está funcionando — não vira venda no dash.
  if (/test postback/i.test(sale.product_name ?? "") || sale.invoice_id === "HP16015479281022") {
    console.log(`[hotmart] teste da Hotmart recebido ✓ (${sale.last_event}) — não gravado`);
    return { status: 200, payload: { ok: true, test: true } };
  }
  // Loga o que chegou ANTES de gravar (sem dados do comprador), pra conferir UTMs
  // mesmo se o banco falhar. Chaves de origem/rastreio mostram onde a Hotmart põe as UTMs.
  const origin = at(body, "data", "purchase", "origin");
  console.log(`[hotmart] ${sale.invoice_id} ${sale.last_event} "${sale.product_name}" ${sale.gross_value} ${sale.currency}` +
    ` bump=${sale.order_bump} utm_campaign=${sale.utm_campaign ?? "—"} utm_content=${sale.utm_content ?? "—"}` +
    ` origin=${JSON.stringify(origin ?? null)}`);
  try {
    if (!sale.refunded && (await isAlreadyReversed(sale.invoice_id))) {
      return { status: 200, payload: { ok: true, kept: "refunded" } };
    }
    const r = await upsertSales([sale]);
    if (!r.ok) {
      console.error(`[hotmart] ${sale.invoice_id} não gravou no Supabase: HTTP ${r.status} ${String(r.error).slice(0, 200)}`);
      return { status: 502, payload: { ok: false, error: r.error } };
    }
  } catch (e) {
    // Banco fora do ar: responde erro para a Hotmart reenviar depois.
    console.error(`[hotmart] ${sale.invoice_id} Supabase inacessível:`, e instanceof Error ? e.message : e);
    return { status: 503, payload: { ok: false, error: "banco de vendas indisponível" } };
  }
  console.log(`[hotmart] ${sale.invoice_id} → salvo`);
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
