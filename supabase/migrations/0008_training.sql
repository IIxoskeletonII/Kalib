-- Kalib — training (SPEC §20). Run once in the SQL editor; safe to re-run.
--
-- Three tables. Note what is NOT here: a `sets` table. A session's sets live in its own row as
-- jsonb, the way recipe items do, because the sync engine rescans a whole table on every run
-- and a row per set would reach tens of thousands within a year. A twenty-set session is about
-- two kilobytes.
--
-- `exercises` holds only the user's own. The 1,394-exercise library is regenerated on each
-- device from a CC0 source, so the client never pushes it (see services/sync/local.ts); storing
-- the same catalogue once per account would be waste with no benefit.

create table if not exists public.exercises (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  external_id text,
  name text not null,
  aliases jsonb,
  shorthand jsonb,
  category text not null,
  difficulty text,
  -- `primary` is reserved in SQL, hence the longer names here and in core/types.ts.
  primary_muscle text not null,
  secondary_muscles jsonb not null default '[]'::jsonb,
  equipment text not null,
  load_type text not null,
  instructions jsonb,
  media text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.routines (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  note text,
  items jsonb not null default '[]'::jsonb,
  sort_order numeric not null default 0,
  source text not null default 'own',
  last_performed date,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.workout_sessions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  -- Null while the session is still running; there is meant to be at most one of those.
  ended_at timestamptz,
  routine_id text,
  name text not null,
  note text,
  entries jsonb not null default '[]'::jsonb,
  volume_kg numeric,
  duration_sec numeric,
  -- MET-based and openly approximate (§20.6). Never spent against a day's food budget: the
  -- TDEE this app runs on is measured from intake against weight trend, so the gym is already
  -- inside it and adding this on top would double-count.
  energy_kcal numeric,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

-- The sync engine pages by updated_at; history and every derived figure walk started_at.
create index if not exists workout_sessions_user_started
  on public.workout_sessions (user_id, started_at desc);
create index if not exists routines_user_order on public.routines (user_id, sort_order);

do $$ declare t text; begin
  foreach t in array array['exercises','routines','workout_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
