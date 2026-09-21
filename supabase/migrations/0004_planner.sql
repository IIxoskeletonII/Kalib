-- Kalib — SPEC §18: meal plans and ingredient prices. Run once after 0003.

alter table public.recipes add column if not exists steps jsonb;

create table if not exists public.week_plans (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  days integer not null default 7,
  allowance_kcal numeric not null default 0,
  allowance_protein_g numeric not null default 0,
  items jsonb not null default '[]'::jsonb,
  checked jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.prices (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  food_id text not null,
  price_per_kg numeric not null,
  currency text not null default 'EUR',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  unique (user_id, food_id)
);

do $$
declare t text;
begin
  foreach t in array array['week_plans','prices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;
