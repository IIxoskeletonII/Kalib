-- Kalib — server mirror of the local Dexie store (SPEC §6), one row per local row.
-- Run once in the Supabase SQL editor. Every table is keyed by the client-generated id and
-- carries updated_at / deleted_at so sync is last-write-wins with soft deletes.

create table if not exists public.profiles (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  sex text not null,
  birth_date date not null,
  height_cm numeric not null,
  activity_level text not null,
  mode text not null,
  goal_rate_kg_per_week numeric not null,
  bodyfat_pct numeric,
  target_weight_kg numeric,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.weigh_ins (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  weight_kg numeric not null,
  bodyfat_pct numeric,
  source text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  unique (user_id, date)
);

-- Only the user's own foods (custom / off / photo). The USDA seed stays on the device.
create table if not exists public.foods (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  external_id text,
  name text not null,
  brand text,
  barcode text,
  category text,
  per_100g jsonb not null,
  micros jsonb not null default '{}'::jsonb,
  micro_coverage numeric not null default 0,
  portions jsonb not null default '[]'::jsonb,
  density_g_per_ml numeric,
  verified boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.log_entries (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  logged_at timestamptz not null,
  date date not null,
  meal_slot text not null,
  name text not null,
  food_id text,
  batch_id text,
  recipe_id text,
  grams numeric not null,
  servings numeric not null,
  kcal numeric not null,
  protein_g numeric not null,
  carb_g numeric not null,
  fat_g numeric not null,
  fiber_g numeric not null,
  micros jsonb not null default '{}'::jsonb,
  entry_method text not null,
  confidence text not null,
  photo_url text,
  photo_assumptions jsonb,
  corrected_from_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);
create index if not exists log_entries_user_date on public.log_entries (user_id, date);

create table if not exists public.daily_targets (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  kcal numeric not null,
  protein_g numeric not null,
  carb_g numeric not null,
  fat_g numeric not null,
  fiber_g numeric not null,
  water_ml numeric not null,
  banking_adjustment numeric not null default 0,
  source text not null,
  provisional boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  unique (user_id, date)
);

create table if not exists public.tdee_estimates (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  computed_on date not null,
  tdee_kcal numeric not null,
  ci_low numeric not null,
  ci_high numeric not null,
  window_days integer not null,
  logged_days integer not null,
  weighed_days integer not null,
  data_quality numeric not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null,
  primary key (user_id, key)
);

-- Row-level security: each user sees and writes only their own rows. This is also the
-- GDPR Article 9 isolation boundary noted in SPEC §12.
do $$
declare t text;
begin
  foreach t in array array['profiles','weigh_ins','foods','log_entries','daily_targets','tdee_estimates','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;
