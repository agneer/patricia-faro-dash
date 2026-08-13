import type { EduzzSale } from "./eduzz";

// Mapeamento coluna-do-CSV → campo da tabela. Vários nomes possíveis por campo;
// o primeiro que existir no cabeçalho é usado.
const HEADER_MAP: Record<string, string[]> = {
  invoice_id: ["Fatura", "ID da Fatura", "Cód. Fatura", "Codigo", "Código", "Transação", "Pedido"],
  status: ["Status", "Situação", "Situacao"],
  // Valor Inicial = preço-base SEM juros de parcelamento (o que queremos). Total = com juros.
  gross_value: ["Valor Inicial da Venda", "Valor Total da Venda", "Valor da Venda", "Valor Total", "Valor Bruto", "Valor", "Total"],
  net_value: ["Ganho Líquido", "Ganho Liquido", "Ganho", "Valor Líquido", "Líquido", "Liquido", "Comissão", "Comissao"],
  refund_date: ["Data de Reembolso", "Data Reembolso"],
  created_at: ["Data", "Data da Venda", "Data Criação", "Data de Criação", "Data Criacao"],
  paid_at: ["Data Pagamento", "Data de Pagamento", "Pago em", "Data do Pagamento"],
  product_name: ["Produto", "Nome do Produto"],
  buyer_email: ["Email", "E-mail", "Email do Cliente", "E-mail do Cliente", "Cliente / E-mail"],
  buyer_name: ["Cliente / Nome", "Cliente", "Nome", "Nome do Cliente", "Comprador"],
  utm_source: ["utm_source", "UTM Source", "Origem"],
  utm_campaign: ["utm_campaign", "UTM Campaign", "Campanha"],
  utm_medium: ["utm_medium", "UTM Medium", "Mídia", "Midia"],
  utm_content: ["utm_content", "UTM Content", "Conteúdo", "Conteudo"],
  utm_term: ["utm_term", "UTM Term", "Termo"],
  payment_method: ["Forma de Pagamento", "Método", "Metodo", "Pagamento"],
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

const pick = (headers: string[], names: string[]) => {
  for (const n of names) {
    const i = headers.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
};
const moneyBR = (v: unknown) => {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/[R$\s.]/g, "").replace(",", ".");
  return Number(s) || 0;
};
const dateBR = (v: unknown): string | null => {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? "00"}:${m[5] ?? "00"}:00-03:00`;
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
  sales: EduzzSale[];
  utmCount: number;
};

export function parseEduzzCsv(text: string): CsvParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, error: "CSV vazio ou sem linhas de dados.", headers: rows[0] ?? [], detected: {}, sales: [], utmCount: 0 };
  const headers = rows[0];
  const idx: Record<string, number> = {};
  const detected: Record<string, string | null> = {};
  for (const k in HEADER_MAP) { idx[k] = pick(headers, HEADER_MAP[k]); detected[k] = idx[k] >= 0 ? headers[idx[k]] : null; }

  if (idx.invoice_id < 0) return { ok: false, error: `Coluna de Fatura/ID não encontrada. Cabeçalhos: ${headers.join(", ")}`, headers, detected, sales: [], utmCount: 0 };

  const sales: EduzzSale[] = rows.slice(1).map((r): EduzzSale => {
    const g = (k: string) => (idx[k] >= 0 ? r[idx[k]] : null);
    const status = (norm(g("status")) ?? "paid").toLowerCase();
    const refunded = /reembols|estorn|cancel|chargeback|devolv/.test(status) || !!norm(g("refund_date"));
    // Só "Paga/Aprovada/Faturada" entra no faturamento. "Em Recuperação", "Aberta",
    // "Aguardando", "Boleto/Pix gerado" etc. NÃO são pagas → bruto 0 (saem do dash).
    const isPaid = /pag[ao]|aprovad|complet|conclu|faturad/.test(status);
    const gross = isPaid || refunded ? moneyBR(g("gross_value")) : 0;
    return {
      invoice_id: String(norm(g("invoice_id"))),
      status,
      refunded,
      gross_value: gross,
      net_value: idx.net_value >= 0 ? moneyBR(g("net_value")) : gross,
      currency: "BRL",
      created_at: dateBR(g("created_at")),
      paid_at: dateBR(g("paid_at")) ?? dateBR(g("created_at")),
      product_id: null,
      product_name: norm(g("product_name")),
      buyer_email: norm(g("buyer_email")),
      buyer_name: norm(g("buyer_name")),
      utm_source: norm(g("utm_source")),
      utm_campaign: norm(g("utm_campaign")),
      utm_medium: norm(g("utm_medium")),
      utm_content: norm(g("utm_content")),
      utm_term: norm(g("utm_term")),
      tracker1: null, tracker2: null, tracker3: null,
      affiliate_id: null, affiliate_name: null,
      payment_method: norm(g("payment_method")),
      installments: null,
      order_bump: false,
      last_event: "csv_import",
      raw: null,
    };
  }).filter((s) => s.invoice_id && s.invoice_id !== "null");

  // Unify multiple rows of the same invoice (Produtor + Co-produtor) into ONE sale:
  // bruto = valor total da venda (max, pois só o produtor carrega o valor),
  // líquido = soma dos ganhos (produtor + co-produtor). Conta como 1 venda.
  const merged = new Map<string, EduzzSale>();
  for (const s of sales) {
    const e = merged.get(s.invoice_id);
    if (!e) { merged.set(s.invoice_id, s); continue; }
    e.gross_value = Math.max(e.gross_value, s.gross_value);
    e.net_value = Math.round((e.net_value + s.net_value) * 100) / 100;
    e.refunded = e.refunded || s.refunded;
    e.utm_source ??= s.utm_source; e.utm_campaign ??= s.utm_campaign; e.utm_medium ??= s.utm_medium;
    e.utm_content ??= s.utm_content; e.utm_term ??= s.utm_term;
    e.product_name ??= s.product_name; e.buyer_email ??= s.buyer_email; e.buyer_name ??= s.buyer_name;
    e.payment_method ??= s.payment_method; e.paid_at ??= s.paid_at; e.created_at ??= s.created_at;
  }
  const unified = [...merged.values()];

  const utmCount = unified.filter((s) => s.utm_campaign || s.utm_content).length;
  return { ok: true, headers, detected, sales: unified, utmCount };
}
