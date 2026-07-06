alter table public.products
  add column if not exists detail_category text,
  add column if not exists wishlist_status text not null default 'candidate',
  add column if not exists priority text not null default 'medium',
  add column if not exists must_have_level text not null default 'nice',
  add column if not exists candidate_rank integer not null default 1,
  add column if not exists product_url text,
  add column if not exists image_url text,
  add column if not exists purchase_url text,
  add column if not exists purchase_note text,
  add column if not exists planned_purchase_month text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_wishlist_status_check') then
    alter table public.products
      add constraint products_wishlist_status_check
      check (wishlist_status in ('candidate', 'planned', 'purchased', 'on_hold', 'rejected'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_priority_check') then
    alter table public.products
      add constraint products_priority_check
      check (priority in ('high', 'medium', 'low'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_must_have_level_check') then
    alter table public.products
      add constraint products_must_have_level_check
      check (must_have_level in ('must', 'nice', 'optional'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_candidate_rank_check') then
    alter table public.products
      add constraint products_candidate_rank_check
      check (candidate_rank >= 1);
  end if;
end $$;

alter table public.user_price_settings
  add column if not exists wishlist_budget numeric(12, 2) not null default 150000,
  add column if not exists budget_period text not null default 'one_time',
  add column if not exists default_budget_view_mode text not null default 'planned';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_price_settings_wishlist_budget_check') then
    alter table public.user_price_settings
      add constraint user_price_settings_wishlist_budget_check
      check (wishlist_budget >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_price_settings_budget_period_check') then
    alter table public.user_price_settings
      add constraint user_price_settings_budget_period_check
      check (budget_period in ('one_time', 'monthly', 'yearly'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_price_settings_default_budget_view_mode_check') then
    alter table public.user_price_settings
      add constraint user_price_settings_default_budget_view_mode_check
      check (default_budget_view_mode in ('planned', 'primary'));
  end if;
end $$;

create table if not exists public.ledger_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  title text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  entry_type text not null default 'expense' check (entry_type in ('expense', 'income')),
  category text not null default '未分類',
  occurred_on date not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists products_user_id_wishlist_status_idx on public.products (user_id, wishlist_status, candidate_rank);
create index if not exists products_user_id_detail_category_idx on public.products (user_id, detail_category);
create index if not exists ledger_entries_user_id_occurred_on_idx on public.ledger_entries (user_id, occurred_on desc);
create index if not exists ledger_entries_user_id_category_idx on public.ledger_entries (user_id, category);

alter table public.ledger_entries enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ledger_entries' and policyname = 'Users can read their own ledger entries') then
    create policy "Users can read their own ledger entries"
      on public.ledger_entries for select
      using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ledger_entries' and policyname = 'Users can insert their own ledger entries') then
    create policy "Users can insert their own ledger entries"
      on public.ledger_entries for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ledger_entries' and policyname = 'Users can update their own ledger entries') then
    create policy "Users can update their own ledger entries"
      on public.ledger_entries for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ledger_entries' and policyname = 'Users can delete their own ledger entries') then
    create policy "Users can delete their own ledger entries"
      on public.ledger_entries for delete
      using (auth.uid() = user_id);
  end if;
end $$;
