# Replicar o dashboard para outro expert

Cada expert é um **deploy separado e isolado** (repo, URL, Supabase, chaves próprios). O código é o mesmo; o que muda vai por **env vars** (ver `.env.example`) + os dados (`dataset.json`, `creative-links.json`).

## Passo a passo (≈30–45 min)

### 1. Repositório novo
- Crie um repo novo no GitHub (ex.: `expert2-dash`).
- Copie este código pra ele (fork, ou `git clone` + novo remote + push).

### 2. Supabase novo (isolado)
- Crie um projeto Supabase novo.
- Rode `supabase/schema.sql` no SQL Editor (cria a tabela `eduzz_sales`).
- Anote `Project URL` e a `service_role key`.

### 3. Vercel novo → URL nova
- Crie um projeto Vercel novo conectado ao repo do expert.
- Isso gera a URL nova (ex.: `expert2-dash.vercel.app`) ou aponte um domínio próprio.

### 4. Env vars na Vercel (Settings → Environment Variables)
Preencha tudo do `.env.example`:
- **Marca:** `APP_NAME`, `APP_DESCRIPTION`, `SCOPE_LABEL`
- **Conta/filtro:** `META_ACCOUNT_ID`, `CAMPAIGN_FILTER`
- **Metas:** `CPA_TARGET`, `TAX_RATE`
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Eduzz/Admin:** `EDUZZ_WEBHOOK_SECRET`, `ADMIN_PASSWORD`
- **Windsor/Cron:** `WINDSOR_API_KEY`, `CRON_SECRET`, `GITHUB_TOKEN`, `GITHUB_REPO` (= repo do expert)

### 5. Dados iniciais (gasto)
- Gere o `lib/dataset.json` do expert puxando do Windsor a conta dele, filtrando pelas campanhas (`CAMPAIGN_FILTER`). (Mesmo processo do ICF — peça ao assistente.)
- Gere o `lib/creative-links.json` (links dos posts dos criativos) — opcional.
- Commit + push → deploy.

### 6. Vendas (Eduzz)
- **Histórico:** exporte a planilha "Detalhado · minhas-vendas" da Eduzz do expert e suba em `/admin` (senha = `ADMIN_PASSWORD`).
- **Tempo real:** cadastre o webhook na Eduzz do expert:
  `https://<url-do-expert>/api/eduzz/webhook/<EDUZZ_WEBHOOK_SECRET>`

### 7. Automação
- O cron diário (`vercel.json`) já vem no código; com `WINDSOR_API_KEY` + `GITHUB_TOKEN` + `CRON_SECRET` setados, ele atualiza o gasto sozinho.

## Pronto
Cada expert fica 100% independente — mexer num não afeta o outro.
