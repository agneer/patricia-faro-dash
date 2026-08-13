-- ─────────────────────────────────────────────────────────────────────────────
-- Eduzz sales store for ICF Low Ticket dashboard.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- The dashboard reads revenue/purchases from here (source of truth) and joins
-- it with Meta spend (Windsor) by date + UTM to compute real CPA / ROAS.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.eduzz_sales (
  invoice_id      text primary key,           -- data.id (Eduzz invoice/fatura id)
  status          text,                        -- paid | refunded | chargeback | ...
  refunded        boolean not null default false,
  gross_value     numeric(12,2) not null default 0,   -- data.price.value (bruto)
  net_value       numeric(12,2) not null default 0,   -- data.paid.value  (líquido)
  currency        text default 'BRL',

  created_at      timestamptz,                 -- data.createdAt
  paid_at         timestamptz,                 -- data.paidAt
  -- date used for grouping/joining with Meta spend (paid day, fallback created)
  sale_date       date generated always as (coalesce((paid_at at time zone 'America/Sao_Paulo')::date, (created_at at time zone 'America/Sao_Paulo')::date)) stored,

  product_id      text,
  product_name    text,

  buyer_email     text,
  buyer_name      text,

  -- attribution (carried by the checkout link's UTMs)
  utm_source      text,
  utm_campaign    text,
  utm_medium      text,
  utm_content     text,
  utm_term        text,
  tracker1        text,
  tracker2        text,
  tracker3        text,

  affiliate_id    text,
  affiliate_name  text,

  payment_method  text,
  installments    int,
  order_bump      boolean default false,

  last_event      text,                        -- last webhook event applied
  raw             jsonb,                       -- full payload, for audit/replay
  updated_at      timestamptz not null default now()
);

create index if not exists eduzz_sales_sale_date_idx     on public.eduzz_sales (sale_date);
create index if not exists eduzz_sales_paid_at_idx        on public.eduzz_sales (paid_at);
create index if not exists eduzz_sales_utm_campaign_idx   on public.eduzz_sales (utm_campaign);
create index if not exists eduzz_sales_utm_content_idx    on public.eduzz_sales (utm_content);
create index if not exists eduzz_sales_status_idx         on public.eduzz_sales (status);

-- Only the service-role key (server-side) touches this table; lock down anon.
alter table public.eduzz_sales enable row level security;
-- (no policies = no anon/public access; service role bypasses RLS)
