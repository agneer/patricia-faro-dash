// ─────────────────────────────────────────────────────────────────────────────
// Per-expert configuration. Everything that changes between experts lives here,
// driven by env vars with the ICF values as defaults (so the current deploy is
// unchanged). To spin up a new expert: fork the repo, set these env vars on the
// new Vercel project, regenerate dataset.json + creative-links.json, deploy.
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  // Branding
  appName: process.env.APP_NAME ?? "Patrícia Faro · Low Ticket",
  appDescription: process.env.APP_DESCRIPTION ?? "Painel de performance Meta Ads + vendas Eduzz",
  scopeLabel: process.env.SCOPE_LABEL ?? "LOW TICKET · GAS", // chip showing the campaign scope

  // Meta Ads account + which campaigns belong to this dashboard
  metaAccountId: process.env.META_ACCOUNT_ID ?? "939669440392208",
  campaignFilterSource: process.env.CAMPAIGN_FILTER ?? "LT_GAS",

  // Targets / rates
  cpaTarget: Number(process.env.CPA_TARGET ?? 90),
  taxRate: Number(process.env.TAX_RATE ?? 0.1215),
};

// ─────────────────────────────────────────────────────────────────────────────
// Produtos (low-tickets) deste dashboard. Cada um tem um `pattern` que aparece
// tanto no nome da campanha no Meta (gasto/criativos) quanto na UTM Campaign das
// vendas Eduzz — então um único padrão separa gasto E vendas de forma alinhada.
// Vazio (`[]`) = dashboard de produto único (comportamento antigo, sem toggle).
// ─────────────────────────────────────────────────────────────────────────────
import PRODUCTS_JSON from "./products.json";
import ACCOUNTS_JSON from "./accounts.json";

// Contas Meta deste dashboard. Vazio = só a conta única (CONFIG.metaAccountId).
// Múltiplas = o cron do Windsor puxa TODAS (ex.: mesmo produto em contas diferentes).
export const META_ACCOUNT_IDS: string[] =
  (ACCOUNTS_JSON as string[]).length ? (ACCOUNTS_JSON as string[]) : [CONFIG.metaAccountId];

// `base: true` = produto "resto" (tudo do escopo que NÃO casa com os outros
// produtos codificados). `pattern` fica opcional nesse caso.
export type Product = { key: string; label: string; pattern?: string; productName?: string; base?: boolean };

export const PRODUCTS: Product[] = (PRODUCTS_JSON as Product[]) ?? [];
export const MULTI_PRODUCT = PRODUCTS.length > 1;

// Escopo geral do dashboard (GERAL) = o CAMPAIGN_FILTER de env (escopo amplo, ex.
// "low ticket | ebook") em UNIÃO com os padrões de cada produto. Assim GERAL pega
// tudo do escopo mesmo que um produto tenha nomenclatura própria, e os produtos
// (toggle) são sub-filtros dentro do escopo. Sem produtos → só o env.
const overallSource = MULTI_PRODUCT
  ? [CONFIG.campaignFilterSource, ...PRODUCTS.map((p) => p.pattern)].map((p) => `(?:${p})`).join("|")
  : CONFIG.campaignFilterSource;

// Regex used to keep only this expert's campaigns (case-insensitive).
export const CAMPAIGN_FILTER = new RegExp(overallSource, "i");

// Regex de um produto específico (para o toggle). null = "geral" ou produto base.
export function productFilter(key?: string): RegExp | null {
  const p = key ? PRODUCTS.find((x) => x.key === key) : null;
  return p && p.pattern ? new RegExp(p.pattern, "i") : null;
}

// Regex de TODOS os produtos codificados (com pattern) — usado pelo produto "base"
// (Ebook), que é "tudo que não casa com nenhum código".
const CODED = PRODUCTS.filter((p) => !p.base && p.pattern).map((p) => `(?:${p.pattern})`);
export const CODED_FILTER: RegExp | null = CODED.length ? new RegExp(CODED.join("|"), "i") : null;
export const isBaseProduct = (key?: string): boolean => !!key && !!PRODUCTS.find((p) => p.key === key)?.base;
