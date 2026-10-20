-- ─────────────────────────────────────────────────────────────────────────────
-- Vendas Hotmart do dashboard Patrícia Faro · Low Ticket.
-- Rodar uma vez no Supabase (Dashboard → SQL Editor → New query).
-- O dashboard lê faturamento/vendas daqui (fonte da verdade) e cruza com o gasto
-- do Windsor por dia + UTM para calcular CPA / ROAS reais.
-- Sem dados pessoais do comprador (nome, e-mail, documento): o painel não precisa.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hotmart_sales (
  invoice_id         text primary key,           -- código da transação Hotmart (HP…)
  parent_transaction text,                       -- order bump: transação principal
  status             text,                       -- approved | complete | refunded | chargeback | canceled | ...
  refunded           boolean not null default false,
  order_bump         boolean not null default false,
  gross_value        numeric(12,2) not null default 0,  -- valor da compra (data.purchase.price)
  net_value          numeric(12,2) not null default 0,  -- comissão do produtor (data.commissions PRODUCER)
  currency           text default 'BRL',

  created_at         timestamptz,                -- data.purchase.order_date
  paid_at            timestamptz,                -- data.purchase.approved_date
  -- dia usado para agrupar/cruzar com o gasto (aprovação, senão pedido), em BRT
  sale_date          date generated always as (coalesce((paid_at at time zone 'America/Sao_Paulo')::date, (created_at at time zone 'America/Sao_Paulo')::date)) stored,

  product_id         text,
  product_name       text,
  offer_code         text,

  -- atribuição (UTMs do link do checkout; src/sck/xcod = parâmetros próprios da Hotmart)
  utm_source         text,
  utm_campaign       text,
  utm_medium         text,
  utm_content        text,
  utm_term           text,
  src                text,
  sck                text,
  xcod               text,

  payment_method     text,
  installments       int,

  last_event         text,                       -- último evento aplicado (ou csv_import)
  raw                jsonb,                      -- payload sem dados do comprador, p/ auditoria
  updated_at         timestamptz not null default now()
);

create index if not exists hotmart_sales_sale_date_idx    on public.hotmart_sales (sale_date);
create index if not exists hotmart_sales_paid_at_idx      on public.hotmart_sales (paid_at);
create index if not exists hotmart_sales_utm_campaign_idx on public.hotmart_sales (utm_campaign);
create index if not exists hotmart_sales_utm_content_idx  on public.hotmart_sales (utm_content);

-- Só a service-role key (servidor) mexe na tabela; anon bloqueado.
alter table public.hotmart_sales enable row level security;
-- (sem policies = sem acesso anon/public; service role ignora RLS)
