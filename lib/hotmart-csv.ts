import type { HotmartSale } from "./hotmart";

// Export de vendas da Hotmart (Vendas → Histórico → Exportar) → linhas de venda.
// Os cabeçalhos mudam entre versões e idiomas, então cada campo é achado por regex;
// o /admin mostra quais colunas foram detectadas. Colunas de comprador são ignoradas.
const HEADER_RE: Record<string, RegExp> = {
  invoice_id: /^c[oó]digo d[ea] (la )?transa[cç]/i,
  parent_transaction: /transa[cç][aã]o (do produto )?principal|transacci[oó]n principal/i,
  status: /^(estatus|status)( d[ea] (la )?transa[cç])?/i,
  created_at: /^(fecha|data) d[ea] (la )?(transa[cç]|compra|pedido)/i,
  paid_at: /^(data|fecha) d[ea] (confirma|aprova|aprobaci)|^confirma[cç]/i,
  product_name: /^(nome do )?produc?to$|^nombre del producto/i,
  offer_code: /^c[oó]digo d[ea] (la )?ofert/i,
  // valor que o comprador pagou (sem juros), senão o preço do produto
  gross_value: /^valor de compra (com|con) impostos|^pre[cç]o (total|do produto|del producto)|^valor (da|de) compra$/i,
  net_value: /faturamento l[ií]quido|comiss[aã]o do produtor|^(minha |mi )?comiss|ingreso neto/i,
  currency: /^moeda|^moneda/i,
  order_bump: /order ?bump/i,
  payment_method: /^(m[eé]todo|forma|tipo) de pag/i,
  installments: /parcela|cuotas/i,
  utm_source: /utm.?source/i,
  utm_campaign: /utm.?campaign/i,
  utm_medium: /utm.?medium/i,
  utm_content: /utm.?content/i,
  utm_term: /utm.?term/i,
  src: /^(c[oó]digo )?src$/i,
  sck: /^(c[oó]digo )?sck$/i,
  xcod: /^(c[oó]digo )?xcod$/i,
};

function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const nl = text.indexOf("\n");
  const firstLine = nl < 0 ? text : text.slice(0, nl);
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

// "1.234,56" / "1234.56" / "R$ 27,00" → número
const money = (v: unknown) => {
  let s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return Number(s) || 0;
};
// "01/10/2026 19:49:48" (horário de Brasília) → ISO
const dateBR = (v: unknown): string | null => {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}-03:00`;
  const d = new Date(String(v));
  return isNaN(+d) ? null : d.toISOString();
};
const norm = (v: unknown): string | null => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};

export type CsvParseResult = {
  ok: boolean;
  error?: string;
  headers: string[];
  detected: Record<string, string | null>;
  sales: HotmartSale[];
  utmCount: number;
};

export function parseHotmartCsv(text: string): CsvParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, error: "CSV vazio ou sem linhas de dados.", headers: rows[0] ?? [], detected: {}, sales: [], utmCount: 0 };
  const headers = rows[0];
  const idx: Record<string, number> = {};
  const detected: Record<string, string | null> = {};
  for (const k in HEADER_RE) {
    idx[k] = headers.findIndex((h) => HEADER_RE[k].test(h.trim()));
    detected[k] = idx[k] >= 0 ? headers[idx[k]] : null;
  }
  if (idx.invoice_id < 0) return { ok: false, error: "Coluna \"Código da transação\" não encontrada.", headers, detected, sales: [], utmCount: 0 };

  const sales = rows.slice(1).flatMap((r): HotmartSale[] => {
    const g = (k: string) => (idx[k] >= 0 ? r[idx[k]] : null);
    const id = norm(g("invoice_id"));
    if (!id) return [];
    const status = (norm(g("status")) ?? "aprovado").toLowerCase();
    const refunded = /reembol|estorn|cancel|chargeback|devolv|expirad/.test(status);
    // Só aprovada/completa entra no faturamento. Boleto impresso, aguardando pagamento,
    // atrasado etc. não são vendas → fora do arquivo.
    const isPaid = /aprova|aprob|complet|conclu/.test(status);
    if (!isPaid && !refunded) return [];
    const gross = money(g("gross_value"));
    const parent = norm(g("parent_transaction"));
    const bumpCol = (norm(g("order_bump")) ?? "").toLowerCase();
    return [{
      invoice_id: id,
      parent_transaction: parent && parent !== id ? parent : null,
      status,
      refunded,
      order_bump: (!!parent && parent !== id) || /^(sim|s[ií]|yes|true|1)$/.test(bumpCol),
      gross_value: gross,
      net_value: idx.net_value >= 0 ? money(g("net_value")) : gross,
      currency: (norm(g("currency")) ?? "BRL").toUpperCase(),
      created_at: dateBR(g("created_at")),
      paid_at: dateBR(g("paid_at")) ?? dateBR(g("created_at")),
      product_id: null,
      product_name: norm(g("product_name")),
      offer_code: norm(g("offer_code")),
      utm_source: norm(g("utm_source")),
      utm_campaign: norm(g("utm_campaign")),
      utm_medium: norm(g("utm_medium")),
      utm_content: norm(g("utm_content")),
      utm_term: norm(g("utm_term")),
      src: norm(g("src")),
      sck: norm(g("sck")),
      xcod: norm(g("xcod")),
      payment_method: norm(g("payment_method")),
      installments: idx.installments >= 0 ? Number(g("installments")) || null : null,
      last_event: "csv_import",
      raw: null,
    }];
  });

  // A mesma transação pode vir em mais de uma linha (ex.: coprodução): 1 venda.
  const merged = new Map<string, HotmartSale>();
  for (const s of sales) {
    const e = merged.get(s.invoice_id);
    if (!e) { merged.set(s.invoice_id, s); continue; }
    e.gross_value = Math.max(e.gross_value, s.gross_value);
    e.refunded = e.refunded || s.refunded;
    e.utm_campaign ??= s.utm_campaign; e.utm_content ??= s.utm_content; e.utm_term ??= s.utm_term;
  }
  const unified = [...merged.values()];
  const utmCount = unified.filter((s) => s.utm_campaign || s.utm_content).length;
  return { ok: true, headers, detected, sales: unified, utmCount };
}
