with ranked_products as (
  select
    id,
    row_number() over (
      partition by user_id, coalesce(nullif(detail_category, ''), nullif(category, ''), '未分類')
      order by candidate_rank asc, updated_at desc, created_at asc, id asc
    ) as next_rank
  from public.products
)
update public.products as products
set candidate_rank = ranked_products.next_rank
from ranked_products
where products.id = ranked_products.id
  and products.candidate_rank is distinct from ranked_products.next_rank;

create index if not exists products_user_scope_candidate_rank_idx
  on public.products (
    user_id,
    (coalesce(nullif(detail_category, ''), nullif(category, ''), '未分類')),
    candidate_rank
  );
