-- Kalib — SPEC §8.2: recipes and batches. Run once in the Supabase SQL editor after 0002.

alter table public.foods add column if not exists recipe_id text;

create table if not exists public.recipes (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  yield_g numeric,
  portions numeric not null default 1,
  food_id text not null,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.batches (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id text not null,
  cooked_on date not null,
  total_g numeric not null,
  portions_total numeric not null,
  portions_remaining numeric not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['recipes','batches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;
