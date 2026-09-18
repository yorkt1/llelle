-- Schema do controle de estoque (Vitae).
-- Rode no SQL Editor do Supabase. O app acessa via service role key (server-side),
-- entao o RLS fica ligado e sem policies: nada de anon key tocando estes dados.

create extension if not exists "pgcrypto";

-- Uma linha da planilha de estoque. row_order e o que preserva a ordem de colagem.
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  sheet_name  text        not null,
  row_order   integer     not null,
  sku         text,
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists products_sheet_name_uniq on public.products (lower(sheet_name));
create index if not exists products_row_order_idx on public.products (row_order);

-- Mapeamento persistente nome do relatorio -> linha da planilha.
-- product_id nulo = nome ja reconhecido como fora da planilha (produto novo).
create table if not exists public.product_aliases (
  id          uuid primary key default gen_random_uuid(),
  report_name text        not null,
  normalized  text        not null unique,
  product_id  uuid        references public.products(id) on delete cascade,
  source      text        not null check (source in ('auto', 'manual')),
  created_at  timestamptz not null default now()
);

-- Cada coluna gerada na planilha. period_start < period_end quando a coluna
-- agrupa dias (ex: "04/09 a 07/09"). mode = 'seed' e a carga do saldo inicial.
create table if not exists public.snapshots (
  id           uuid primary key default gen_random_uuid(),
  period_start date        not null,
  period_end   date        not null,
  label        text        not null,
  mode         text        not null check (mode in ('order', 'invoice', 'seed')),
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists snapshots_period_end_idx on public.snapshots (period_end desc, created_at desc);

-- Historico de saldo por produto por coluna: evita reler a planilha inteira.
create table if not exists public.snapshot_items (
  snapshot_id      uuid    not null references public.snapshots(id) on delete cascade,
  product_id       uuid    not null references public.products(id) on delete cascade,
  sold_qty         numeric not null default 0,
  sold_by_order    numeric not null default 0,
  sold_by_invoice  numeric not null default 0,
  previous_balance numeric not null default 0,
  new_balance      numeric not null default 0,
  primary key (snapshot_id, product_id)
);

-- Relatorio ja parseado, para recalcular ao trocar o modo sem reenviar o arquivo.
create table if not exists public.report_uploads (
  id         uuid primary key default gen_random_uuid(),
  filename   text        not null,
  report     jsonb       not null,
  created_at timestamptz not null default now()
);
create index if not exists report_uploads_created_at_idx on public.report_uploads (created_at desc);

alter table public.products        enable row level security;
alter table public.product_aliases enable row level security;
alter table public.snapshots       enable row level security;
alter table public.snapshot_items  enable row level security;
alter table public.report_uploads  enable row level security;
