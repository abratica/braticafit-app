-- Food search: remember which USDA food a saved food came from, and cache USDA searches
-- (the USDA allows ~1,000 lookups an hour for the whole app, so repeat searches come from here).

alter table public.foods add column if not exists fdc_id int;

create table public.food_search_cache (
  q          text primary key,
  results    jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.food_search_cache enable row level security;  -- no policies: only the edge function reads it
