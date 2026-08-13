# Prompt para recriar o Dashboard "Low Ticket" (Meta Ads + Eduzz) em outra operação

> Cole TUDO abaixo (da linha `===` em diante) numa nova conversa do Claude Code, dentro de uma pasta vazia. No fim há uma lista de dados que o assistente vai te pedir (conta Meta, produto Eduzz, marca, metas). O objetivo é reconstruir o mesmo dashboard para **outra operação/ativos**, 100% isolado.

---
===

Você vai construir um **dashboard de performance de tráfego para produtos "low ticket"** que cruza **gasto do Meta Ads** com **vendas reais da Eduzz** (não o pixel), calculando CPA/ROAS reais. É um app Next.js hospedado na Vercel. Já existe uma versão de referência; recrie a mesma arquitetura e features para uma operação nova, com ativos próprios (outra conta Meta, outro produto Eduzz, outra marca).

Trabalhe de forma incremental: leia os guias do Next em `node_modules/next/dist/docs/` antes de escrever código (é Next 16, tem breaking changes), rode `npm run build` a cada etapa, e verifique no navegador.

## 1. Stack

- **Next.js 16.2.9** (App Router, Turbopack), **React 19**, **TypeScript 5**, **Tailwind CSS v4** (`@tailwindcss/postcss`), **Recharts 3** (gráficos).
- Deploy na **Vercel** (auto-deploy via push no GitHub). Cron da Vercel (Hobby = 1x/dia).
- **Supabase** (Postgres + PostgREST) para armazenar as vendas Eduzz — projeto SEPARADO por operação.
- Página principal é **Server Component** com `export const dynamic = "force-dynamic"` (renderiza no servidor a cada request). Componentes com interação (filtros, tabelas ordenáveis) são `"use client"`.
- Tema escuro. UI em **pt-BR**. Layout `max-w-[1600px]`, cartões "panel" com bordas suaves e acentos (variáveis CSS `--accent`, `--emerald`, `--rose`, `--amber`, `--cyan`, `--muted`, etc. em `globals.css`).

## 2. Arquitetura de dados (o coração — leia com atenção)

Três fontes, cada uma cobrindo uma parte:

### a) Gasto/métricas de entrega do Meta (impressões, cliques, LPV, checkout, CPM, CTR)
- **Histórico (dias fechados):** snapshot em `lib/dataset.json`, atualizado por um **cron diário** que puxa os últimos 7 dias do **Windsor.ai** (conector "facebook") e commita o dataset novo no GitHub (→ dispara deploy). Windsor tem **atraso** (cache 6h + sync do plano) e ignora filtro de account_id (filtre no código por `account_id` + regex de campanha).
- **Dias recentes (ao vivo):** overlay via **Pipeboard** (MCP-over-HTTP do Meta, tempo real) cobrindo os **últimos 4 dias**, por cima do snapshot. Resolve o atraso do Windsor no dia corrente e recém-fechados.
- Endpoint Windsor REST: `https://connectors.windsor.ai/facebook?api_key=...&date_from=&date_to=&fields=...` (lento, ~min; use timeout alto no cron).
- Endpoint Pipeboard: `POST https://meta-ads.mcp.pipeboard.co/` com `Authorization: Bearer <PIPEBOARD_API_TOKEN>`, corpo JSON-RPC `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_insights","arguments":{...}}}`. A resposta vem em `result.content[0].text` (string JSON com `.data`).

### b) Vendas reais (Compras, Faturamento, CPA, ROAS, Ticket) — da EDUZZ, não do pixel
- Guardadas no **Supabase** (tabela `eduzz_sales`). O dashboard usa ESSAS vendas para os KPIs de dinheiro quando disponíveis; o pixel só alimenta o funil de entrega.
- **Tempo real:** webhook da Eduzz → grava no Supabase.
- **Histórico:** upload de planilha CSV ("Detalhado · minhas-vendas") em `/admin`.
- **Atribuição por criativo/campanha:** via UTMs que os anúncios já carregam (`utm_campaign`, `utm_content`).

### c) Link do post de cada criativo (botão "post↗")
- Resolvido automaticamente do Pipeboard (`get_ads`): o `tracking_specs` de cada anúncio traz `page` + `post` → monta `https://www.facebook.com/<page>/posts/<post>`. Todo criativo novo já vem com link. Um `creative-links.json` serve de override manual (ex.: apontar pro Instagram).

## 3. Pegadinhas que VÃO te morder (resolva desde o início)

1. **Next NÃO cacheia `fetch` POST** (`revalidate` é ignorado em POST). Como as chamadas ao Pipeboard e Supabase são POST/dinâmicas, envolva-as em **`unstable_cache`** (de `next/cache`) — senão cada troca de filtro refaz 5–10 chamadas e o dash trava (20s+). Use revalidate ~90s (ao vivo), ~1800s (posts), ~60s (vendas). **Isso é crítico para performance.**
2. **A página busca o período atual E o anterior** (comparativos de KPI). Faça o período anterior em modo "lite": pula overlay ao vivo e links de post (só precisa dos KPIs do snapshot). Busque ao vivo + posts **em paralelo** (`Promise.all`). Timeout das chamadas ao vivo em ~8s.
3. **Pipeboard: `time_increment` NÃO funciona** (retorna o total do intervalo rotulado com a data inicial). Para dados por dia, faça consultas de **1 dia** (`time_range:{since:X,until:X}`) ou os presets `"today"`/`"yesterday"`.
4. **Webhook da Eduzz usa formato LEGADO** (não o `{event, data:{...}}` novo). Campos reais: `trans_cod` (id), `event_name`, `trans_status`, `pro_value`+`cop_value` (líquido produtor+co-produtor), `trans_value` (valor-base SEM juros), `trans_paid` (total com juros), `utm_campaign`/`utm_content`, `product_name`, `trans_paiddate`/`trans_paidtime`. Mapeie os DOIS formatos (novo e legado). **Bruto = `trans_value`** (preço do produto, sem juros de parcelamento).
5. **CSV da Eduzz** ("Detalhado · minhas-vendas", delimitador `;`): (a) o comprador aparece 2x (Produtor + Co-produtor) → **unifique por fatura**: bruto = `Valor Inicial da Venda` (máx entre linhas), líquido = soma dos `Ganho Liquido`; (b) use **`Valor Inicial da Venda`** (sem juros), não `Valor Total da Venda`; (c) conte **só status "Paga"** (exclua "Em Recuperação", "Aberta" etc. → bruto 0); (d) reembolso via coluna **`Data de Reembolso`** (não só pelo texto do status). Importador é **idempotente por `invoice_id`** (upsert).
6. **`sale_date` é coluna GERADA** no Postgres em fuso de São Paulo: `coalesce((paid_at at time zone 'America/Sao_Paulo')::date, (created_at ...)::date)`. Filtre/agrupe por ela.
7. **"Hoje" deve ancorar na data REAL (BRT)**, não no último dia com dado — senão "Hoje" cai em ontem quando ainda não houve gasto. `new Date(Date.now() - 3*3600*1000).toISOString().slice(0,10)`.
8. **Cron da Vercel + auth:** aceite `Authorization: Bearer <CRON_SECRET>` **OU** user-agent contendo `vercel-cron` **OU** a senha admin (para disparo manual `?key=<ADMIN_PASSWORD>`). Um `CRON_SECRET` desalinhado dá 401 e congela o snapshot silenciosamente.
9. **Dias sem pixel:** permita um `manual-purchases.json` (por `data`+`ad`) aplicado NA RENDERIZAÇÃO (sobrevive ao cron que reescreve o snapshot).

## 4. Estrutura de arquivos

```
lib/
  config.ts          # CONFIG (env-driven) + PRODUCTS (products.json) + CAMPAIGN_FILTER + productFilter()
  products.json      # [] = produto único; [{key,label,pattern}] = multi-produto (toggle)
  snapshot.ts        # tipos DailyRow/CreativeRow; carrega dataset.json
  dataset.json       # snapshot compacto (dates[]/ads[]/campaigns[]/rows[]/daily[])
  dataset-build.ts   # expand/build/mergeRecent (formato compacto <-> expandido)
  windsor.ts         # NÚCLEO: getDashboardData(), build(), resolveRange(), KPIs, funil, overlay ao vivo, override manual
  meta-live.ts       # getLiveRecentCreatives() — Pipeboard, últimos 4 dias, unstable_cache
  creative-posts.ts  # resolvePostLinks() — Pipeboard get_ads → post URL, unstable_cache
  creative-links.json# override manual de link de post por nome de anúncio
  manual-purchases.json # override manual de compras/receita por (data, ad)
  sales.ts           # getSalesData() — lê eduzz_sales do Supabase, agrega por dia/ticket/criativo, filtra por produto (UTM), unstable_cache
  eduzz.ts           # mapWebhookToSale() (formatos novo+legado), ingestEvents(), upsertSales() (PostgREST)
  eduzz-csv.ts       # parseEduzzCsv() — parser + unificação produtor/co-produtor
  admin.ts           # checkAdmin() + helpers de contagem Supabase
  format.ts          # brl(), num(), pct(), compact()
app/
  page.tsx           # dashboard (server component) — orquestra tudo
  layout.tsx, globals.css, favicon.ico
  admin/page.tsx     # upload de planilha + painel do webhook (gated por ADMIN_PASSWORD)
  api/cron/refresh-windsor/route.ts   # cron: Windsor → merge → commit dataset.json no GitHub
  api/eduzz/webhook/route.ts          # webhook (secret via ?secret= ou header)
  api/eduzz/webhook/[secret]/route.ts # webhook (secret no path — Eduzz não manda querystring no POST)
  api/admin/import/route.ts           # recebe CSV, parseia, upsert
  api/admin/stats/route.ts            # total/csv/webhook/última venda
components/
  ui.tsx (KpiCard, SectionTitle, MiniStat), FilterBar.tsx (presets de data + Máx + Personalizar + refresh),
  CampaignFilter.tsx (dropdown), ProductToggle.tsx (GERAL|Produto A|Produto B — destaque acima do investimento),
  TaxToggle.tsx (com/sem imposto Meta), Funnel.tsx (funil perceptual), DailyChart.tsx (2 eixos),
  DataTable.tsx (criativos/páginas — ordenável, sticky 1ª col, quebra por conjunto, botão post↗),
  DailyTable.tsx (dados diários — investimento + vendas reais por dia, totais, ordenável),
  EduzzSection.tsx (bloco "Vendas reais · Eduzz")
supabase/schema.sql  # tabela eduzz_sales (ver abaixo)
vercel.json          # { "crons": [{ "path": "/api/cron/refresh-windsor", "schedule": "0 8 * * *" }] }
.env.example
```

## 5. Config por operação (`lib/config.ts`, env-driven)

```ts
export const CONFIG = {
  appName: process.env.APP_NAME ?? "...",
  appDescription: process.env.APP_DESCRIPTION ?? "Painel de performance Meta Ads + vendas Eduzz",
  scopeLabel: process.env.SCOPE_LABEL ?? "LOW TICKET | EBOOK",
  metaAccountId: process.env.META_ACCOUNT_ID ?? "...",           // conta Meta (sem 'act_')
  campaignFilterSource: process.env.CAMPAIGN_FILTER ?? "low\\s*ticket\\s*\\|\\s*ebook",
  cpaTarget: Number(process.env.CPA_TARGET ?? 90),
  taxRate: Number(process.env.TAX_RATE ?? 0.1215),              // imposto Meta BR ~12,15%
};
// PRODUCTS vem de products.json: [] = single; multi = CAMPAIGN_FILTER = OR dos patterns.
// productFilter(key) = regex de um produto (separa gasto E vendas pela UTM/nome de campanha).
```

**Multi-produto:** cada produto = `{ key, label, pattern }` onde `pattern` aparece tanto no nome da campanha (gasto) quanto na `utm_campaign` das vendas (Eduzz). Um `ProductToggle` (GERAL | Produto A | Produto B) troca o escopo inteiro de uma vez. `GERAL` soma todos.

## 6. Schema Supabase (`eduzz_sales`)

Tabela com PK `invoice_id`; colunas: `status, refunded (bool), gross_value, net_value, currency, created_at, paid_at, sale_date (GERADA, ver pegadinha #6), product_id, product_name, buyer_email, buyer_name, utm_source/campaign/medium/content/term, tracker1..3, affiliate_id/name, payment_method, installments, order_bump, last_event, raw (jsonb), updated_at`. Índices em `sale_date, paid_at, utm_campaign, utm_content, status`. RLS ligado sem policies (só a service_role acessa). Query de leitura filtra `refunded=eq.false & invoice_id=not.like.TEST-* & gross_value=gt.0`.

## 7. Features do dashboard (page.tsx)

- **Cabeçalho:** nome, badge "● Gasto ao vivo (Meta)" vs "● Snapshot diário", conta, chip de escopo, período, "Atualizado …".
- **Filtros:** `ProductToggle` (se multi-produto, destaque acima dos KPIs), `CampaignFilter` (dropdown), `FilterBar` (Hoje, Ontem, 3/5/7/14/30/90 dias, Este mês, Mês passado, Máx, Personalizar com datas, botão refresh), `TaxToggle` (com/sem 12,15%). Filtros vão na URL (`?preset=&product=&campaign=&tax=&from=&to=`).
- **5 KPIs:** Investimento · Compras (Eduzz) · CPA (Eduzz) · ROAS (Eduzz, mostra bruto e líquido) · Ticket médio (Eduzz). Com sparklines e trend vs período anterior. Se não houver Eduzz, cai no pixel.
- **Bloco "Vendas reais · Eduzz"** (EduzzSection): vendas, fat. bruto, fat. líquido, ticket, CPA real, ROAS real, gráfico "vendas por dia empilhado por ticket".
- **Funil de conversão** (Impressões → Cliques no link → Visualização de página → Checkout → Compras) com taxas entre etapas.
- **Caixa "Custo por etapa"** ao lado do funil: CPM (impressões), CPC (cliques), Custo/visualização, Custo/checkout, Custo/compra. Com **setas de meta**: verde ▼ abaixo / vermelho ▲ acima, e a meta visível (ex.: "meta R$ 2,68"). Metas configuráveis.
- **Desempenho diário** (DailyChart, 2 eixos comparáveis) + **Dados diários** (DailyTable): 1 linha por dia com Investido, Vendas (real), Faturam., CPA, ROAS, Impr., Cliques, Pág., Custo/Pág, Checkout, Custo/Chk, Connect, Tx Conv, CTR, CPM + linha de Total, ordenável.
- **Desempenho do criativo** (DataTable): por anúncio, com CPA colorido pela meta, ROAS, custos e taxas de funil, quebra por conjunto (+), e botão **post↗**.
- **Páginas & ofertas** (por campanha; quando filtra 1 campanha, quebra por conjunto).
- **Temperatura de público** (cards por conjunto: Frio/Morno/Quente/Aberto).

## 8. Cron (`api/cron/refresh-windsor`)

Puxa últimos 7 dias do Windsor, filtra `account_id == META_ACCOUNT_ID` + `CAMPAIGN_FILTER`, faz `mergeRecent` sobre o dataset existente (janela ~400 dias), reconstrói o compacto e **commita `lib/dataset.json` no GitHub** via Contents API (com `GITHUB_TOKEN` clássico, scope `repo`) → auto-deploy. Auth robusta (ver pegadinha #8). `vercel.json` agenda `0 8 * * *`.

## 9. Env vars (todas na Vercel do projeto novo)

`APP_NAME, APP_DESCRIPTION, SCOPE_LABEL, META_ACCOUNT_ID, CAMPAIGN_FILTER, CPA_TARGET, TAX_RATE, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EDUZZ_WEBHOOK_SECRET, ADMIN_PASSWORD, WINDSOR_API_KEY, PIPEBOARD_API_TOKEN, CRON_SECRET, GITHUB_TOKEN, GITHUB_REPO`.

## 10. Passos de setup para a operação nova

1. Scaffold Next 16 + Tailwind v4 + Recharts. Copie a arquitetura acima.
2. Crie Supabase novo → rode `schema.sql`.
3. **Seed do histórico:** puxe TODO o histórico de gasto da conta Meta nova (Windsor ou Pipeboard por dia) filtrando pelas campanhas do produto, e gere `lib/dataset.json`.
4. Crie repo GitHub + projeto Vercel (gera a URL). Preencha as env vars.
5. **Vendas histórico:** exporte a planilha da Eduzz e suba em `/admin`.
6. **Webhook Eduzz:** cadastre no produto `https://<url>/api/eduzz/webhook/<EDUZZ_WEBHOOK_SECRET>` (o secret é o mesmo mesmo se vários produtos na mesma conta Eduzz — a separação é por UTM/produto).
7. Confirme: badge "ao vivo", KPIs Eduzz, tabelas, cron rodando.

## 11. O que PERGUNTAR ao usuário antes de começar

- **Marca:** nome do dashboard, descrição, label de escopo.
- **Meta:** id da conta de anúncios; qual o padrão do NOME das campanhas desse produto (regex). Se houver mais de um low-ticket na mesma conta, os patterns de cada um (para o toggle de produto).
- **Eduzz:** nome do produto (como aparece na coluna "Produto"/`product_name`); é a mesma conta Eduzz de outro produto? (define reuso do webhook).
- **Metas:** CPA alvo; imposto (default 12,15%); metas de custo/página, custo/checkout, custo/compra (para as setas).
- **Acessos:** chave Windsor, token Pipeboard, projeto Supabase, token GitHub — o usuário provê (não expor em chat; usar env da Vercel/arquivos).

Construa iterativamente, buildando e verificando a cada parte. Priorize: dados corretos (vendas reais > pixel) → performance (unstable_cache) → UI.
