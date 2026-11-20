-- Which meal a logged food belongs to. Picked when logging; older entries are placed once by the time they were eaten.

alter table public.meals add column if not exists meal text
  check (meal in ('breakfast', 'lunch', 'dinner', 'snack'));

update public.meals
   set meal = case
     when extract(hour from eaten_at at time zone 'America/New_York') < 11 then 'breakfast'
     when extract(hour from eaten_at at time zone 'America/New_York') < 16 then 'lunch'
     when extract(hour from eaten_at at time zone 'America/New_York') < 21 then 'dinner'
     else 'snack' end
 where meal is null;
