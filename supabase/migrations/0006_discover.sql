-- Kalib — §18.6 suggestions and budgets. Run once in the SQL editor (safe to re-run).

alter table public.recipes add column if not exists blurb text;
alter table public.recipes add column if not exists tags jsonb;
alter table public.recipes add column if not exists time_min numeric;
alter table public.recipes add column if not exists oven_c numeric;
alter table public.recipes add column if not exists source text;

alter table public.week_plans add column if not exists budget numeric;

alter table public.prices add column if not exists estimated boolean not null default false;
