create table if not exists public.products (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default '未分類',
  reference_price numeric(12, 2),
  target_price numeric(12, 2),
  custom_floor_price numeric(12, 2),
  calculation_offer_id text,
  preferred_chart_price_type text not null default 'effective' check (preferred_chart_price_type in ('effective', 'listed', 'both')),
  preferred_chart_period text not null default '90d' check (preferred_chart_period in ('7d', '30d', '90d', '6m', '1y', 'all')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_non_negative_prices check (
    (reference_price is null or reference_price >= 0)
    and (target_price is null or target_price >= 0)
    and (custom_floor_price is null or custom_floor_price >= 0)
  )
);

create table if not exists public.offers (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  store_name text not null,
  listed_price numeric(12, 2),
  shipping_fee numeric(12, 2) not null default 0 check (shipping_fee >= 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  coupon_discount numeric(12, 2) not null default 0 check (coupon_discount >= 0),
  point_value numeric(12, 2) not null default 0 check (point_value >= 0),
  effective_price numeric(12, 2),
  stock_status text not null default 'unknown' check (stock_status in ('in_stock', 'out_of_stock', 'unknown', 'preorder')),
  is_calculation_target boolean not null default false,
  source_type text not null default 'manual' check (source_type in ('manual', 'api', 'scraper', 'extension', 'bookmarklet')),
  external_product_id text,
  last_fetched_at timestamptz,
  next_check_at timestamptz,
  fetch_status text not null default 'idle' check (fetch_status in ('idle', 'success', 'failed')),
  last_fetch_error text,
  auto_fetch_enabled boolean not null default false,
  price_adapter_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_non_negative_prices check (
    (listed_price is null or listed_price >= 0)
    and (effective_price is null or effective_price >= 0)
  )
);

alter table public.products
  add constraint products_calculation_offer_fk
  foreign key (calculation_offer_id)
  references public.offers(id)
  deferrable initially deferred;

create table if not exists public.price_histories (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  offer_id text not null references public.offers(id) on delete cascade,
  store_name text not null,
  listed_price numeric(12, 2),
  shipping_fee numeric(12, 2) not null default 0 check (shipping_fee >= 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  coupon_discount numeric(12, 2) not null default 0 check (coupon_discount >= 0),
  point_value numeric(12, 2) not null default 0 check (point_value >= 0),
  effective_price numeric(12, 2),
  stock_status text not null default 'unknown' check (stock_status in ('in_stock', 'out_of_stock', 'unknown', 'preorder')),
  recorded_at timestamptz not null default now(),
  record_source text not null default 'manual' check (record_source in ('auto', 'manual', 'url_fetch', 'scheduled', 'external_api', 'extension', 'bookmarklet')),
  is_excluded_from_lowest_price boolean not null default false,
  exclusion_reason text,
  note text,
  created_at timestamptz not null default now(),
  constraint price_histories_non_negative_prices check (
    (listed_price is null or listed_price >= 0)
    and (effective_price is null or effective_price >= 0)
  )
);

create table if not exists public.user_price_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  near_lowest_absolute_threshold numeric(12, 2) not null default 500 check (near_lowest_absolute_threshold >= 0),
  near_lowest_percentage_threshold numeric(5, 2) not null default 5 check (near_lowest_percentage_threshold >= 0),
  large_drop_absolute_threshold numeric(12, 2) not null default 1000 check (large_drop_absolute_threshold >= 0),
  large_drop_percentage_threshold numeric(5, 2) not null default 5 check (large_drop_percentage_threshold >= 0),
  preferred_chart_price_type text not null default 'effective' check (preferred_chart_price_type in ('effective', 'listed', 'both')),
  preferred_chart_period text not null default '90d' check (preferred_chart_period in ('7d', '30d', '90d', '6m', '1y', 'all')),
  stale_price_check_days integer not null default 14 check (stale_price_check_days >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_user_id_updated_at_idx on public.products (user_id, updated_at desc);
create index if not exists offers_user_id_product_id_idx on public.offers (user_id, product_id);
create index if not exists offers_product_id_updated_at_idx on public.offers (product_id, updated_at desc);
create index if not exists price_histories_user_id_idx on public.price_histories (user_id);
create index if not exists price_histories_product_id_recorded_at_idx on public.price_histories (product_id, recorded_at desc);
create index if not exists price_histories_offer_id_recorded_at_idx on public.price_histories (offer_id, recorded_at desc);
create index if not exists price_histories_lowest_lookup_idx on public.price_histories (product_id, is_excluded_from_lowest_price, effective_price, recorded_at);

alter table public.products enable row level security;
alter table public.offers enable row level security;
alter table public.price_histories enable row level security;
alter table public.user_price_settings enable row level security;

create policy "Users can read their own products"
  on public.products for select
  using (auth.uid() = user_id);

create policy "Users can insert their own products"
  on public.products for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own products"
  on public.products for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own products"
  on public.products for delete
  using (auth.uid() = user_id);

create policy "Users can read their own offers"
  on public.offers for select
  using (auth.uid() = user_id);

create policy "Users can insert their own offers"
  on public.offers for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.products
      where products.id = offers.product_id
      and products.user_id = auth.uid()
    )
  );

create policy "Users can update their own offers"
  on public.offers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own offers"
  on public.offers for delete
  using (auth.uid() = user_id);

create policy "Users can read their own price histories"
  on public.price_histories for select
  using (auth.uid() = user_id);

create policy "Users can insert their own price histories"
  on public.price_histories for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.products
      where products.id = price_histories.product_id
      and products.user_id = auth.uid()
    )
    and exists (
      select 1 from public.offers
      where offers.id = price_histories.offer_id
      and offers.user_id = auth.uid()
    )
  );

create policy "Users can update their own price histories"
  on public.price_histories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own price histories"
  on public.price_histories for delete
  using (auth.uid() = user_id);

create policy "Users can read their own price settings"
  on public.user_price_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert their own price settings"
  on public.user_price_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own price settings"
  on public.user_price_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own price settings"
  on public.user_price_settings for delete
  using (auth.uid() = user_id);
