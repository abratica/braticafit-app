-- Which outside database a saved food came from ("fs:123" for fatsecret, "usda:456" for USDA),
-- so logging the same food and serving again reuses it instead of making a copy.
alter table public.foods add column if not exists ext_id text;
update public.foods set ext_id = 'usda:' || fdc_id where fdc_id is not null and ext_id is null;
delete from public.food_search_cache where q not like 'fs:%' and q not like 'usda:%';  -- old format
