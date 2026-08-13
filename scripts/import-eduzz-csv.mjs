#!/usr/bin/env node
// Importa o histórico de vendas da Eduzz (planilha CSV exportada) para o Supabase.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/import-eduzz-csv.mjs ./vendas-eduzz.csv
//
// O HEADER_MAP abaixo será ajustado para os nomes EXATOS das colunas da sua
// exportação (me mande a primeira linha do CSV). Delimitador (',' ou ';') é
// detectado automaticamente; valores em R$ no formato "1.234,56" são tratados.

import fs from "node:fs";

// ── mapeamento coluna-do-CSV → campo da tabela (ajustar aos seus cabeçalhos) ──
const HEADER_MAP = {
  invoice_id: ["Fatura", "ID da Fatura", "Cód. Fatura", "Codigo"],
  status: ["Status", "Situação"],
  gross_value: ["Valor Total da Venda", "Valor da Venda", "Valor Total", "Valor Bruto", "Valor"],
  net_value: ["Ganho Líquido", "Ganho Liquido", "Ganho", "Valor Líquido", "Líquido", "Comissão"],
  created_at: ["Data", "Data da Venda", "Data Criação", "Data de Criação"],
  paid_at: ["Data Pagamento", "Data de Pagamento", "Pago em"],
  product_name: ["Produto", "Nome do Produto"],
  buyer_email: ["Email", "E-mail", "Email do Cliente"],
  buyer_name: ["Cliente", "Nome", "Nome do Cliente"],
  utm_source: ["utm_source", "UTM Source", "Origem"],
  utm_campaign: ["utm_campaign", "UTM Campaign", "Campanha"],
  utm_medium: ["utm_medium", "UTM Medium"],
  utm_content: ["utm_content", "UTM Content", "Conteúdo"],
  utm_term: ["utm_term", "UTM Term", "Termo"],
  payment_method: ["Forma de Pagamento", "Método", "Pagamento"],
};

const file = process.argv[2];
if (!file) { console.error("Informe o caminho do CSV: node scripts/import-eduzz-csv.mjs <arquivo.csv>"); process.exit(1); }
const SUPABASE_URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }

// ── parser CSV simples (RFC4180), com aspas e delimitador detectável ──
function parseCsv(text) {
  text = text.replace(/^﻿/, ""); // remove BOM
  const firstLine = text.slice(0, text.indexOf("\n"));
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows = []; let row = [], field = "", q = false;
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

const pick = (headers, names) => { for (const n of names) { const i = headers.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase()); if (i >= 0) return i; } return -1; };
const moneyBR = (v) => { if (v == null) return 0; const s = String(v).replace(/[R$\s.]/g, "").replace(",", "."); return Number(s) || 0; };
const dateBR = (v) => { if (!v) return null; const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/); if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? "00"}:${m[5] ?? "00"}:00-03:00`; const d = new Date(v); return isNaN(+d) ? null : d.toISOString(); };
const norm = (v) => { const s = (v ?? "").toString().trim(); return s === "" ? null : s; };

const raw = fs.readFileSync(file, "utf8");
const rows = parseCsv(raw);
const headers = rows[0];
const idx = {}; for (const k in HEADER_MAP) idx[k] = pick(headers, HEADER_MAP[k]);
console.log("Colunas detectadas:", Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i >= 0 ? headers[i] : "❌ não encontrada"])));
if (idx.invoice_id < 0) { console.error("\n⚠️ Coluna de Fatura/ID não encontrada. Cabeçalhos do arquivo:", headers); process.exit(1); }

const sales = rows.slice(1).map((r) => {
  const g = (k) => (idx[k] >= 0 ? r[idx[k]] : null);
  const status = (norm(g("status")) ?? "paid").toLowerCase();
  return {
    invoice_id: String(norm(g("invoice_id"))),
    status,
    refunded: /reembols|estorn|cancel|chargeback|devolv/.test(status),
    gross_value: moneyBR(g("gross_value")),
    net_value: moneyBR(g("net_value")) || moneyBR(g("gross_value")),
    currency: "BRL",
    created_at: dateBR(g("created_at")),
    paid_at: dateBR(g("paid_at")) ?? dateBR(g("created_at")),
    product_name: norm(g("product_name")),
    buyer_email: norm(g("buyer_email")),
    buyer_name: norm(g("buyer_name")),
    utm_source: norm(g("utm_source")),
    utm_campaign: norm(g("utm_campaign")),
    utm_medium: norm(g("utm_medium")),
    utm_content: norm(g("utm_content")),
    utm_term: norm(g("utm_term")),
    payment_method: norm(g("payment_method")),
    order_bump: false,
    last_event: "csv_import",
  };
}).filter((s) => s.invoice_id && s.invoice_id !== "null");

console.log(`\n${sales.length} vendas para importar. UTM preenchida em ${sales.filter((s) => s.utm_campaign || s.utm_content).length}.`);

// upsert em lotes de 500
let done = 0;
for (let i = 0; i < sales.length; i += 500) {
  const batch = sales.slice(i, i + 500).map((s) => ({ ...s, updated_at: new Date().toISOString() }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/eduzz_sales?on_conflict=invoice_id`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(batch),
  });
  if (!res.ok) { console.error("Erro no lote:", res.status, await res.text()); process.exit(1); }
  done += batch.length; console.log(`  ${done}/${sales.length}…`);
}
console.log("✅ Importação concluída.");
