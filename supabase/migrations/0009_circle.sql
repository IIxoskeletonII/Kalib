-- Kalib — the circle (SPEC §21). Run once in the SQL editor; safe to re-run.
--
-- Until this file, every table had one policy, "own rows", and no user could read anything of
-- anyone else's. A circle needs exactly one exception to that, and this file is built so the
-- exception is as small as it can be:
--
--   * No table here is readable or writable by a client directly. Privileges are revoked from
--     `anon` and `authenticated`, and row-level security is on with no policies, so the only
--     door is the functions below.
--   * The only thing that crosses between users is a week's scores: small integers computed on
--     the phone (src/core/circle.ts). No workout row, food, weight or session date is ever here,
--     and the functions have nothing else to return.
--   * You see someone's scores only while you share a circle with them, and they see yours only
--     while you have chosen to publish. Leaving your last circle deletes everything you
--     published; deleting your account deletes everything through the cascades.
--   * Invite codes are stored hashed, expire after seven days, can be revoked, and joining is
--     throttled per account.
--
-- These tables are deliberately not in the sync engine's SYNC_TABLES: they are server state,
-- not a copy of anything on the phone.

create extension if not exists pgcrypto with schema extensions;

-- ---- tables ---------------------------------------------------------------------------------

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  -- The current owner. Ownership moves to the longest-standing member when the owner leaves
  -- (see circle_members_after_delete), so it is nullable only for the instant in between.
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.circle_members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- Chosen per circle. The email is never shown to anyone.
  display_name text not null check (char_length(btrim(display_name)) between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Present for the house shape. Leaving deletes the row outright, because leaving is meant to
  -- take you with it.
  deleted_at timestamptz,
  unique (circle_id, user_id)
);

create table if not exists public.circle_invites (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- Who made it.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- sha256 of the normalised code. The code itself is shown once, to its maker, and not kept.
  code_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  uses integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One row per person per week, shared by every circle they are in. Integers, all of them.
create table if not exists public.circle_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week date not null check (extract(isodow from week) = 1),
  planned smallint not null check (planned between 1 and 7),
  done smallint not null check (done between 0 and 7),
  consistency smallint not null check (consistency between 0 and 100),
  progress smallint check (progress between 0 and 100),
  score smallint not null check (score between 0 and 100),
  flagged smallint not null default 0 check (flagged between 0 and 99),
  hard boolean not null default false,
  rating smallint check (rating between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, week)
);

-- Failed join attempts, for the throttle. Pruned as it is written.
create table if not exists public.circle_join_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists circle_members_user on public.circle_members (user_id);
create index if not exists circle_invites_circle on public.circle_invites (circle_id);
create index if not exists circle_join_attempts_user on public.circle_join_attempts (user_id, created_at);

-- No policies on purpose: with RLS on and none defined, direct access returns nothing and
-- writes nothing, even if a privilege were granted back by mistake.
do $$ declare t text; begin
  foreach t in array array['circles','circle_members','circle_invites','circle_scores','circle_join_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
  end loop;
end $$;

-- ---- limits ---------------------------------------------------------------------------------
-- In one place so the functions and SPEC §21 agree. A circle is friends and family, not a
-- league.

create or replace function public.circle_limit(p_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_name
    when 'members' then 12        -- people in one circle
    when 'circles' then 5         -- circles one person may be in
    when 'invite_days' then 7     -- days a code stays good
    when 'invite_uses' then 20    -- joins one code allows
    when 'attempts' then 10       -- failed joins an account may make in an hour
    when 'weeks' then 12          -- weeks of scores kept
  end;
$$;

-- ---- helpers (not callable by clients) ------------------------------------------------------

create or replace function public.circle_require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'circle: not signed in' using errcode = '28000';
  end if;
  return uid;
end;
$$;

create or replace function public.circle_clean_name(p_name text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:][:cntrl:]]+', ' ', 'g'));
begin
  if char_length(n) < 1 or char_length(n) > p_max then
    raise exception 'circle: name must be 1 to % characters', p_max using errcode = '22023';
  end if;
  return n;
end;
$$;

-- Codes are ten characters from 31 that cannot be misread for each other (no 0/O, 1/I/L), about
-- fifty bits: at ten guesses an hour per account there is nothing to find by guessing.
create or replace function public.circle_new_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  b integer;
begin
  while char_length(code) < 10 loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    -- Rejection sampling: 248 is the largest multiple of 31 under 256, so every character is
    -- equally likely.
    if b < 248 then
      code := code || substr(alphabet, (b % 31) + 1, 1);
    end if;
  end loop;
  return code;
end;
$$;

create or replace function public.circle_hash_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
$$;

-- When a member row goes — by leaving, removal, or the account being deleted — an owner is
-- replaced by the longest-standing member, an empty circle is deleted, and someone left in no
-- circle at all has their published scores deleted.
create or replace function public.circle_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare heir uuid;
begin
  if old.role = 'owner' then
    select m.id into heir from public.circle_members m
      where m.circle_id = old.circle_id
      order by m.created_at, m.id
      limit 1;
    if heir is null then
      delete from public.circles where id = old.circle_id;
    else
      update public.circle_members set role = 'owner', updated_at = now() where id = heir;
      update public.circles c set user_id = m.user_id, updated_at = now()
        from public.circle_members m where m.id = heir and c.id = old.circle_id;
    end if;
  end if;
  if not exists (select 1 from public.circle_members where user_id = old.user_id) then
    delete from public.circle_scores where user_id = old.user_id;
  end if;
  return null;
end;
$$;

drop trigger if exists circle_members_after_delete on public.circle_members;
create trigger circle_members_after_delete
  after delete on public.circle_members
  for each row execute function public.circle_members_after_delete();

-- ---- what a client may call -----------------------------------------------------------------

-- The circles you are in.
create or replace function public.circle_mine()
returns table (id uuid, name text, role text, display_name text, members integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, me.role, me.display_name,
         (select count(*)::integer from public.circle_members x where x.circle_id = c.id)
  from public.circle_members me
  join public.circles c on c.id = me.circle_id
  where me.user_id = public.circle_require_user()
  order by me.created_at;
$$;

create or replace function public.circle_create(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.circle_require_user();
  cid uuid;
begin
  if (select count(*) from public.circle_members where user_id = uid) >= public.circle_limit('circles') then
    raise exception 'circle: in too many circles' using errcode = '54000';
  end if;
  insert into public.circles (user_id, name)
    values (uid, public.circle_clean_name(p_name, 40))
    returning id into cid;
  insert into public.circle_members (circle_id, user_id, role, display_name)
    values (cid, uid, 'owner', public.circle_clean_name(p_display_name, 24));
  return cid;
end;
$$;

-- A fresh code for a circle you own. Making one revokes any code still live, so there is only
-- ever one in circulation.
create or replace function public.circle_invite(p_circle uuid)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.circle_require_user();
  c text;
  until timestamptz := now() + make_interval(days => public.circle_limit('invite_days'));
begin
  if not exists (select 1 from public.circle_members m
                 where m.circle_id = p_circle and m.user_id = uid and m.role = 'owner') then
    raise exception 'circle: only the owner can invite' using errcode = '42501';
  end if;
  update public.circle_invites set revoked_at = now(), updated_at = now()
    where circle_id = p_circle and revoked_at is null;
  c := public.circle_new_code();
  insert into public.circle_invites (circle_id, user_id, code_hash, expires_at)
    values (p_circle, uid, public.circle_hash_code(c), until);
  return query select substr(c, 1, 5) || '-' || substr(c, 6, 5), until;
end;
$$;

create or replace function public.circle_revoke_invites(p_circle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := public.circle_require_user();
begin
  if not exists (select 1 from public.circle_members m
                 where m.circle_id = p_circle and m.user_id = uid and m.role = 'owner') then
    raise exception 'circle: only the owner can revoke' using errcode = '42501';
  end if;
  update public.circle_invites set revoked_at = now(), updated_at = now()
    where circle_id = p_circle and revoked_at is null;
end;
$$;

-- The circle joined, or null when the code is wrong, expired, revoked or used up. Which of
-- those it was is not said: it would tell a guesser which codes once existed.
create or replace function public.circle_join(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.circle_require_user();
  inv public.circle_invites%rowtype;
  name text := public.circle_clean_name(p_display_name, 24);
begin
  delete from public.circle_join_attempts where created_at < now() - interval '1 day';
  if (select count(*) from public.circle_join_attempts
      where user_id = uid and created_at > now() - interval '1 hour') >= public.circle_limit('attempts') then
    raise exception 'circle: too many attempts' using errcode = '54000';
  end if;

  select * into inv from public.circle_invites
    where code_hash = public.circle_hash_code(p_code)
      and revoked_at is null
      and expires_at > now()
      and uses < public.circle_limit('invite_uses')
    for update;
  if not found then
    -- Returned, not raised: an exception would roll back this very insert, and a throttle
    -- that forgets every failure throttles nothing.
    insert into public.circle_join_attempts (user_id) values (uid);
    return null;
  end if;

  if exists (select 1 from public.circle_members where circle_id = inv.circle_id and user_id = uid) then
    return inv.circle_id;
  end if;
  if (select count(*) from public.circle_members where user_id = uid) >= public.circle_limit('circles') then
    raise exception 'circle: in too many circles' using errcode = '54000';
  end if;
  -- Locks the circle row so two people joining at once cannot both take the last place.
  perform 1 from public.circles where id = inv.circle_id for update;
  if (select count(*) from public.circle_members where circle_id = inv.circle_id) >= public.circle_limit('members') then
    raise exception 'circle: circle is full' using errcode = '54000';
  end if;

  insert into public.circle_members (circle_id, user_id, role, display_name)
    values (inv.circle_id, uid, 'member', name);
  update public.circle_invites set uses = uses + 1, updated_at = now() where id = inv.id;
  return inv.circle_id;
end;
$$;

create or replace function public.circle_leave(p_circle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := public.circle_require_user();
begin
  delete from public.circle_members where circle_id = p_circle and user_id = uid;
end;
$$;

-- Owner only, and by member id: no client ever learns another person's account id.
create or replace function public.circle_remove(p_circle uuid, p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := public.circle_require_user();
begin
  if not exists (select 1 from public.circle_members m
                 where m.circle_id = p_circle and m.user_id = uid and m.role = 'owner') then
    raise exception 'circle: only the owner can remove' using errcode = '42501';
  end if;
  delete from public.circle_members
    where id = p_member and circle_id = p_circle and user_id <> uid;
end;
$$;

create or replace function public.circle_rename_me(p_circle uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := public.circle_require_user();
begin
  update public.circle_members
    set display_name = public.circle_clean_name(p_display_name, 24), updated_at = now()
    where circle_id = p_circle and user_id = uid;
end;
$$;

-- Publishes your weeks. Refused unless you are in a circle: nothing leaves the phone before you
-- have joined one. Each week is validated here as well as on the phone, and anything older than
-- the board keeps is deleted.
create or replace function public.circle_publish(p_weeks jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.circle_require_user();
  w jsonb;
  wk date;
  n integer := 0;
  oldest date := (date_trunc('week', now())::date) - 7 * (public.circle_limit('weeks') - 1);
  newest date := (date_trunc('week', now() + interval '1 day'))::date;
begin
  if not exists (select 1 from public.circle_members where user_id = uid) then
    raise exception 'circle: not in a circle' using errcode = '42501';
  end if;
  if jsonb_typeof(p_weeks) <> 'array' or jsonb_array_length(p_weeks) > 8 then
    raise exception 'circle: expected up to 8 weeks' using errcode = '22023';
  end if;

  for w in select * from jsonb_array_elements(p_weeks) loop
    -- Only these keys, so nothing else can be smuggled through as a "score".
    if exists (select 1 from jsonb_object_keys(w) k
               where k not in ('week','planned','done','consistency','progress','score','flagged','hard','rating')) then
      raise exception 'circle: unexpected field' using errcode = '22023';
    end if;
    wk := (w ->> 'week')::date;
    -- A day's grace either side for time zones; anything else is not this week or a kept one.
    if wk < oldest or wk > newest then
      raise exception 'circle: week out of range' using errcode = '22023';
    end if;
    insert into public.circle_scores
      (user_id, week, planned, done, consistency, progress, score, flagged, hard, rating, updated_at)
    values (
      uid, wk,
      (w ->> 'planned')::smallint,
      (w ->> 'done')::smallint,
      (w ->> 'consistency')::smallint,
      (w ->> 'progress')::smallint,
      (w ->> 'score')::smallint,
      coalesce((w ->> 'flagged')::smallint, 0),
      coalesce((w ->> 'hard')::boolean, false),
      (w ->> 'rating')::smallint,
      now()
    )
    on conflict (user_id, week) do update set
      planned = excluded.planned, done = excluded.done, consistency = excluded.consistency,
      progress = excluded.progress, score = excluded.score, flagged = excluded.flagged,
      hard = excluded.hard, rating = excluded.rating, updated_at = now();
    n := n + 1;
  end loop;

  delete from public.circle_scores where user_id = uid and week < oldest;
  return n;
end;
$$;

-- The board for one circle you are in: each member's published weeks, newest five, and nothing
-- else. Member ids are the circle's own, not account ids.
create or replace function public.circle_board(p_circle uuid)
returns table (
  member_id uuid, display_name text, is_me boolean, is_owner boolean,
  week date, planned smallint, done smallint, consistency smallint, progress smallint,
  score smallint, flagged smallint, hard boolean, rating smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := public.circle_require_user();
begin
  if not exists (select 1 from public.circle_members where circle_id = p_circle and user_id = uid) then
    raise exception 'circle: not a member' using errcode = '42501';
  end if;
  return query
    select m.id, m.display_name, m.user_id = uid, m.role = 'owner',
           s.week, s.planned, s.done, s.consistency, s.progress, s.score, s.flagged, s.hard, s.rating
    from public.circle_members m
    left join public.circle_scores s
      on s.user_id = m.user_id
     and s.week >= (date_trunc('week', now())::date) - 28
    where m.circle_id = p_circle
    order by m.created_at, s.week;
end;
$$;

-- ---- who may call what ----------------------------------------------------------------------

do $$ declare f text; begin
  -- Internal: nobody calls these from outside.
  foreach f in array array[
    'circle_limit(text)', 'circle_require_user()', 'circle_clean_name(text, integer)',
    'circle_new_code()', 'circle_hash_code(text)', 'circle_members_after_delete()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- The client surface: signed-in users only.
  foreach f in array array[
    'circle_mine()', 'circle_create(text, text)', 'circle_invite(uuid)',
    'circle_revoke_invites(uuid)', 'circle_join(text, text)', 'circle_leave(uuid)',
    'circle_remove(uuid, uuid)', 'circle_rename_me(uuid, text)', 'circle_publish(jsonb)',
    'circle_board(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
