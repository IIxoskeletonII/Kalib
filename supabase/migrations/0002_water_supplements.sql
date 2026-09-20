-- Kalib — SPEC §17: water and supplements. Run once in the Supabase SQL editor after 0001.

create table if not exists public.water_logs (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  logged_at timestamptz not null,
  ml numeric not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);
create index if not exists water_logs_user_date on public.water_logs (user_id, date);

create table if not exists public.supplements (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  dose numeric not null,
  unit text not null,
  timing text not null,
  catalogue_id text,
  nutrient text,
  nutrient_amount numeric,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.supplement_logs (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  supplement_id text not null,
  date date not null,
  taken_at timestamptz not null,
  dose numeric not null,
  unit text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);
create index if not exists supplement_logs_user_date on public.supplement_logs (user_id, date);

do $$
declare t text;
begin
  foreach t in array array['water_logs','supplements','supplement_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;
