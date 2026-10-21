// The circle's migration (0009), run for real.
//
// It is the one place the app lets anything cross between users, so it is tested the way an
// attacker would use it rather than the way the app does: as other people, as nobody, straight
// at the tables, with codes that are wrong, late, revoked or guessed, and with payloads that try
// to carry more than scores. Against a private PostgreSQL started for the run (scripts/pg.ts),
// never against Supabase.
//
// The static checks at the top run everywhere. The live ones need PostgreSQL installed; where it
// is not, they are skipped and say so, and the static ones still guard the shape.
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPgBin, startPg, type Pg, type PgResult } from './pg';

const DIR = 'supabase/migrations';
const SQL = readFileSync(`${DIR}/0009_circle.sql`, 'utf8');

const CLIENT_FUNCTIONS = [
  'circle_mine',
  'circle_create',
  'circle_invite',
  'circle_revoke_invites',
  'circle_join',
  'circle_leave',
  'circle_remove',
  'circle_rename_me',
  'circle_publish',
  'circle_board',
];
const TABLES = [
  'circles',
  'circle_members',
  'circle_invites',
  'circle_scores',
  'circle_join_attempts',
];

describe('0009_circle.sql, read', () => {
  it('creates every table only if absent, so it can be re-run', () => {
    for (const t of TABLES) {
      expect(SQL).toMatch(new RegExp(`create table if not exists public\\.${t} \\(`));
    }
    expect(SQL).not.toMatch(/create table (?!if not exists)/);
    expect(SQL).not.toMatch(/create index (?!if not exists)/);
    expect(SQL).not.toMatch(/create function/);
    expect(SQL).toMatch(/drop trigger if exists circle_members_after_delete/);
  });

  it('turns row-level security on for every table it creates and grants nothing back', () => {
    for (const t of TABLES) expect(SQL).toContain(`'${t}'`);
    expect(SQL).toMatch(/enable row level security/);
    expect(SQL).not.toMatch(/create policy/);
    expect(SQL).not.toMatch(/grant (select|insert|update|delete|all) on (table )?public\./i);
  });

  it('pins search_path on every function', () => {
    const fns = [...SQL.matchAll(/create or replace function public\.(\w+)[\s\S]*?\nas \$\$/g)];
    expect(fns.length).toBeGreaterThanOrEqual(CLIENT_FUNCTIONS.length);
    for (const f of fns) expect(f[0], f[1]).toMatch(/set search_path = ''/);
  });

  it('never grants anything to anon, and never mentions a service role', () => {
    expect(SQL).not.toMatch(/grant [^;]* to [^;]*\banon\b/i);
    expect(SQL).not.toMatch(/service_role/);
  });

  it('is numbered after every migration before it', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files.at(-1)).toBe('0009_circle.sql');
  });
});

// ---------------------------------------------------------------------------------------------

const bin = findPgBin();
const live = bin ? describe : describe.skip;
if (!bin) {
  console.warn('circle-sql: PostgreSQL not found; the live migration tests are skipped.');
}

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const E = '00000000-0000-4000-8000-00000000000e';
const extra = (n: number) => `00000000-0000-4000-8000-1${String(n).padStart(11, '0')}`;

function ok(r: PgResult): string {
  expect(r.err, r.err).toBe('');
  expect(r.ok).toBe(true);
  return r.out;
}

function fails(r: PgResult, message: RegExp): void {
  expect(r.ok, `expected failure, got: ${r.out}`).toBe(false);
  expect(r.err).toMatch(message);
}

/** Mondays relative to this week, as the server sees it (UTC). */
const monday = (weeksAgo: number) => `(date_trunc('week', now())::date - ${7 * weeksAgo})`;

function week(weeksAgo: number, o: Record<string, unknown> = {}): string {
  return `jsonb_build_object('week', ${monday(weeksAgo)}, 'planned', 3, 'done', 2, 'consistency', 67, 'progress', 55, 'score', 62, 'flagged', 0, 'hard', false${Object.entries(
    o,
  )
    .map(
      ([k, v]) =>
        `, '${k}', ${v === null ? 'null::int' : typeof v === 'string' ? `'${v}'` : String(v)}`,
    )
    .join('')})`;
}

const publish = (pg: Pg, uid: string, weeks: string[]) =>
  pg.as(uid, `select public.circle_publish(jsonb_build_array(${weeks.join(', ')}));`);

live('0009_circle.sql, run', () => {
  let pg: Pg;

  beforeAll(() => {
    pg = startPg(bin!);
    // Every migration in order, then this one again: it must be safe to re-run.
    for (const f of readdirSync(DIR)
      .filter((x) => x.endsWith('.sql'))
      .sort()) {
      ok(pg.admin(readFileSync(`${DIR}/${f}`, 'utf8')));
    }
    ok(pg.admin(SQL));
    ok(pg.admin(SQL));
    const users = [A, B, C, D, E, ...Array.from({ length: 14 }, (_, i) => extra(i))];
    ok(
      pg.admin(
        `insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'person${i}@example.com')`).join(', ')};`,
      ),
    );
  }, 180_000);

  afterAll(() => pg?.stop());

  // ---- the shape, as the database reports it ----

  it('has row-level security on every circle table and no policy that opens one', () => {
    const rows = ok(
      pg.admin(
        `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in (${TABLES.map((t) => `'${t}'`).join(',')}) order by relname;`,
      ),
    );
    expect(rows.split('\n')).toEqual([...TABLES].sort().map((t) => `${t}|t`));
    expect(ok(pg.admin(`select count(*) from pg_policies where tablename like 'circle%';`))).toBe(
      '0',
    );
  });

  it('gives the API roles no privilege on any circle table, despite the default grants', () => {
    const rows = ok(
      pg.admin(
        `select t, r, p from unnest(array[${TABLES.map((t) => `'public.${t}'`).join(',')}]) t,
                unnest(array['anon','authenticated']) r,
                unnest(array['select','insert','update','delete']) p
         where has_table_privilege(r, t, p);`,
      ),
    );
    expect(rows).toBe('');
  });

  it('lets signed-in users call the client functions, anon none, and nobody the helpers', () => {
    const rows = ok(
      pg.admin(
        `select p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'), p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'circle%' order by 1;`,
      ),
    ).split('\n');
    expect(rows.length).toBe(16);
    for (const row of rows) {
      const [name, anon, auth, definer, config] = row.split('|');
      expect(anon, `${name} callable by anon`).toBe('f');
      expect(auth, `${name} for authenticated`).toBe(CLIENT_FUNCTIONS.includes(name!) ? 't' : 'f');
      expect(config, `${name} search_path`).toBe('search_path=""');
      if (CLIENT_FUNCTIONS.includes(name!)) expect(definer, `${name} definer`).toBe('t');
    }
  });

  it('refuses the tables to a signed-in user going round the functions', () => {
    for (const t of TABLES) {
      fails(pg.as(A, `select * from public.${t};`), /permission denied/);
    }
    fails(
      pg.as(
        A,
        `insert into public.circle_scores (user_id, week, planned, done, consistency, score) values ('${A}', ${monday(0)}, 3, 3, 100, 100);`,
      ),
      /permission denied/,
    );
  });

  it('refuses everything to anon and to a session with no user', () => {
    fails(pg.as('anon', `select * from public.circle_mine();`), /permission denied/);
    fails(pg.as('anon', `select public.circle_create('x', 'y');`), /permission denied/);
    fails(
      pg.admin(`begin; set local role authenticated; select * from public.circle_mine(); commit;`),
      /not signed in/,
    );
  });

  // ---- the life of a circle ----

  let home = '';
  let code = '';

  it('creates a circle with its maker as owner', () => {
    home = ok(pg.as(A, `select public.circle_create('  Home  ', ' Eli ');`));
    expect(home).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      ok(pg.as(A, `select name, role, display_name, members from public.circle_mine();`)),
    ).toBe('Home|owner|Eli|1');
    expect(ok(pg.as(B, `select count(*) from public.circle_mine();`))).toBe('0');
    expect(ok(pg.admin(`select user_id from public.circles where id = '${home}';`))).toBe(A);
  });

  it('refuses names that are empty, too long, or only whitespace', () => {
    fails(pg.as(A, `select public.circle_create('', 'Eli');`), /1 to 40 characters/);
    fails(
      pg.as(A, `select public.circle_create('${'x'.repeat(41)}', 'Eli');`),
      /1 to 40 characters/,
    );
    fails(pg.as(A, `select public.circle_create('Gym', E'\\t \\n');`), /1 to 24 characters/);
    fails(
      pg.as(A, `select public.circle_create('Gym', '${'y'.repeat(25)}');`),
      /1 to 24 characters/,
    );
  });

  it('keeps outsiders out of the board and the invites', () => {
    fails(pg.as(B, `select * from public.circle_board('${home}');`), /not a member/);
    fails(pg.as(B, `select * from public.circle_invite('${home}');`), /only the owner/);
    fails(pg.as(B, `select public.circle_revoke_invites('${home}');`), /only the owner/);
    fails(pg.as(B, `select public.circle_remove('${home}', gen_random_uuid());`), /only the owner/);
  });

  it('makes codes of ten unambiguous characters, shown once and stored only as a hash', () => {
    const out = ok(
      pg.as(
        A,
        `select code, expires_at > now() + interval '6 days 23 hours' from public.circle_invite('${home}');`,
      ),
    );
    const [shown, expiry] = out.split('|');
    expect(shown).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    expect(expiry).toBe('t');
    code = shown!;
    const stored = ok(pg.admin(`select row_to_json(i)::text from public.circle_invites i;`));
    expect(stored).not.toContain(code.replace('-', ''));
    expect(stored).not.toContain(code);
  });

  it('draws codes evenly from the alphabet, without repeats', () => {
    const codes = ok(
      pg.admin(`select public.circle_new_code() from generate_series(1, 400);`),
    ).split('\n');
    expect(new Set(codes).size).toBe(400);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
    const chars = codes.join('');
    const seen = new Set(chars);
    expect(seen.size).toBe(31);
    for (const ch of '0O1IL') expect(seen.has(ch)).toBe(false);
  });

  it('joins by code however it is typed, and joining twice is harmless', () => {
    const typed = ` ${code.toLowerCase().replace('-', ' ')} `;
    expect(ok(pg.as(B, `select public.circle_join('${typed}', 'Sam');`))).toBe(home);
    expect(ok(pg.as(B, `select public.circle_join('${code}', 'Sam again');`))).toBe(home);
    expect(ok(pg.as(B, `select role, display_name, members from public.circle_mine();`))).toBe(
      'member|Sam|2',
    );
  });

  it('refuses a wrong code, and stops an account that keeps guessing', () => {
    expect(ok(pg.as(D, `select public.circle_join('AAAAA-AAAAA', 'D') is null;`))).toBe('t');
    for (let i = 0; i < 9; i++) ok(pg.as(D, `select public.circle_join('BBBBB-BBBB${i}', 'D');`));
    expect(
      ok(pg.admin(`select count(*) from public.circle_join_attempts where user_id = '${D}';`)),
    ).toBe('10');
    // Ten failures in the hour: even the right code is refused now.
    fails(pg.as(D, `select public.circle_join('${code}', 'D');`), /too many attempts/);
    // Another account is not affected by D's guessing.
    expect(ok(pg.as(E, `select count(*) from public.circle_mine();`))).toBe('0');
    // An hour on, D may try again.
    ok(
      pg.admin(
        `update public.circle_join_attempts set created_at = now() - interval '2 hours' where user_id = '${D}';`,
      ),
    );
    expect(ok(pg.as(D, `select public.circle_join('${code}', 'Dee');`))).toBe(home);
  });

  it('refuses an expired, a revoked, a replaced or a used-up code', () => {
    const fresh = () => ok(pg.as(A, `select code from public.circle_invite('${home}');`));
    // Replaced: a new code retires the old one.
    const first = fresh();
    const second = fresh();
    expect(ok(pg.as(C, `select public.circle_join('${first}', 'C') is null;`))).toBe('t');
    // Expired.
    ok(
      pg.admin(
        `update public.circle_invites set expires_at = now() - interval '1 minute' where revoked_at is null;`,
      ),
    );
    expect(ok(pg.as(C, `select public.circle_join('${second}', 'C') is null;`))).toBe('t');
    // Revoked.
    const third = fresh();
    ok(pg.as(A, `select public.circle_revoke_invites('${home}');`));
    expect(ok(pg.as(C, `select public.circle_join('${third}', 'C') is null;`))).toBe('t');
    // Used up.
    const fourth = fresh();
    ok(pg.admin(`update public.circle_invites set uses = 20 where revoked_at is null;`));
    expect(ok(pg.as(C, `select public.circle_join('${fourth}', 'C') is null;`))).toBe('t');
    code = fresh();
  });

  // ---- scores ----

  it('publishes nothing for someone in no circle', () => {
    fails(publish(pg, C, [week(1)]), /not in a circle/);
    expect(ok(pg.admin(`select count(*) from public.circle_scores where user_id = '${C}';`))).toBe(
      '0',
    );
  });

  it('takes a member’s weeks and shows them to the circle, scores and nothing more', () => {
    expect(
      ok(publish(pg, A, [week(4), week(3), week(2), week(1), week(0, { done: 1, rating: null })])),
    ).toBe('5');
    const board = ok(pg.as(B, `select * from public.circle_board('${home}');`)).split('\n');
    const mine = board.filter((r) => r.includes('|Eli|'));
    expect(mine).toHaveLength(5);
    // member id, name, is_me, is_owner, week, planned, done, consistency, progress, score, flagged, hard, rating
    expect(mine.at(-1)!.split('|').slice(1, 4)).toEqual(['Eli', 'f', 't']);
    expect(mine.at(-1)!.split('|').slice(5)).toEqual(['3', '1', '67', '55', '62', '0', 'f', '']);
    // B and Dee have published nothing yet: one row each, with no week.
    expect(board.filter((r) => r.includes('|Sam|'))).toHaveLength(1);
    // No account id and no email crosses.
    const text = board.join('\n');
    expect(text).not.toContain(A);
    expect(text).not.toContain('@');
  });

  it('marks the caller’s own rows', () => {
    const rows = ok(
      pg.as(
        A,
        `select display_name, bool_or(is_me) from public.circle_board('${home}') group by 1 order by 1;`,
      ),
    );
    expect(rows.split('\n')).toEqual(['Dee|f', 'Eli|t', 'Sam|f']);
  });

  it('updates a week rather than duplicating it', () => {
    ok(publish(pg, A, [week(1, { score: 90 })]));
    expect(
      ok(
        pg.admin(
          `select count(*), max(score) from public.circle_scores where user_id = '${A}' and week = ${monday(1)};`,
        ),
      ),
    ).toBe('1|90');
  });

  it('refuses anything that is not a score, and writes none of a batch with one bad week', () => {
    const before = ok(
      pg.admin(`select count(*) from public.circle_scores where user_id = '${A}';`),
    );
    fails(publish(pg, A, [week(1, { weight_kg: 82 })]), /unexpected field/);
    fails(publish(pg, A, [week(1, { note: 'hello' })]), /unexpected field/);
    fails(
      publish(pg, A, [week(2, { score: 55 }), week(1, { consistency: 101 })]),
      /check constraint/,
    );
    fails(publish(pg, A, [week(1, { planned: 0 })]), /check constraint/);
    fails(publish(pg, A, [week(1, { done: 8 })]), /check constraint/);
    fails(publish(pg, A, [week(1, { score: -1 })]), /check constraint/);
    fails(publish(pg, A, [week(1, { score: 'lots' })]), /invalid input syntax/);
    fails(
      publish(pg, A, [
        `jsonb_build_object('week', ${monday(1)} + 2, 'planned', 3, 'done', 1, 'consistency', 33, 'score', 33)`,
      ]),
      /check constraint/,
    );
    fails(publish(pg, A, [week(12)]), /week out of range/);
    fails(publish(pg, A, [week(-2)]), /week out of range/);
    fails(
      publish(
        pg,
        A,
        Array.from({ length: 9 }, () => week(1)),
      ),
      /up to 8 weeks/,
    );
    fails(
      pg.as(A, `select public.circle_publish('{"week": "2026-10-19"}'::jsonb);`),
      /up to 8 weeks/,
    );
    expect(ok(pg.admin(`select count(*) from public.circle_scores where user_id = '${A}';`))).toBe(
      before,
    );
    expect(
      ok(
        pg.admin(
          `select score from public.circle_scores where user_id = '${A}' and week = ${monday(2)};`,
        ),
      ),
    ).toBe('62');
  });

  it('keeps twelve weeks and deletes older ones on the next publish', () => {
    ok(
      pg.admin(
        `insert into public.circle_scores (user_id, week, planned, done, consistency, score) values ('${A}', ${monday(20)}, 3, 3, 100, 100);`,
      ),
    );
    ok(publish(pg, A, [week(0)]));
    expect(
      ok(
        pg.admin(
          `select count(*) from public.circle_scores where user_id = '${A}' and week < ${monday(11)};`,
        ),
      ),
    ).toBe('0');
  });

  it('shows only the last five weeks on the board', () => {
    ok(
      pg.admin(
        `insert into public.circle_scores (user_id, week, planned, done, consistency, score) values ('${A}', ${monday(8)}, 3, 3, 100, 100), ('${A}', ${monday(5)}, 3, 3, 100, 100);`,
      ),
    );
    const weeks = ok(
      pg.as(B, `select count(*) from public.circle_board('${home}') where display_name = 'Eli';`),
    );
    expect(weeks).toBe('5');
  });

  it('lets a member rename themselves, and only themselves', () => {
    ok(pg.as(B, `select public.circle_rename_me('${home}', '  Sammy   J ');`));
    expect(ok(pg.as(B, `select display_name from public.circle_mine();`))).toBe('Sammy J');
    fails(pg.as(B, `select public.circle_rename_me('${home}', '');`), /1 to 24 characters/);
    expect(
      ok(pg.as(A, `select display_name from public.circle_mine() where id = '${home}';`)),
    ).toBe('Eli');
  });

  // ---- two circles, and what each can see ----

  let gym = '';

  it('shows each circle only its own members', () => {
    gym = ok(pg.as(C, `select public.circle_create('Gym', 'Cleo');`));
    const gymCode = ok(pg.as(C, `select code from public.circle_invite('${gym}');`));
    ok(pg.as(A, `select public.circle_join('${gymCode}', 'E.');`));
    ok(publish(pg, C, [week(1, { score: 77 })]));
    // B shares Home with A but not Gym with C.
    fails(pg.as(B, `select * from public.circle_board('${gym}');`), /not a member/);
    const home_ = ok(
      pg.as(
        B,
        `select string_agg(distinct display_name, ',' order by display_name) from public.circle_board('${home}');`,
      ),
    );
    expect(home_).toBe('Dee,Eli,Sammy J');
    // A sees both, under the name chosen for each.
    expect(
      ok(pg.as(A, `select string_agg(display_name, ',' order by name) from public.circle_mine();`)),
    ).toBe('E.,Eli');
    expect(
      ok(
        pg.as(
          A,
          `select count(*) from public.circle_board('${gym}') where display_name = 'Cleo' and score = 77;`,
        ),
      ),
    ).toBe('1');
  });

  it('leaving one circle keeps scores that another still shows', () => {
    ok(pg.as(A, `select public.circle_leave('${gym}');`));
    expect(
      Number(ok(pg.admin(`select count(*) from public.circle_scores where user_id = '${A}';`))),
    ).toBeGreaterThan(0);
    fails(pg.as(A, `select * from public.circle_board('${gym}');`), /not a member/);
  });

  it('lets only the owner remove, never themselves, and takes the removed person’s scores', () => {
    ok(publish(pg, B, [week(1)]));
    const sam = ok(
      pg.as(
        A,
        `select distinct member_id from public.circle_board('${home}') where display_name = 'Sammy J';`,
      ),
    );
    const dee = ok(
      pg.as(
        A,
        `select distinct member_id from public.circle_board('${home}') where display_name = 'Dee';`,
      ),
    );
    fails(pg.as(D, `select public.circle_remove('${home}', '${sam}');`), /only the owner/);
    const self = ok(
      pg.as(A, `select distinct member_id from public.circle_board('${home}') where is_me;`),
    );
    ok(pg.as(A, `select public.circle_remove('${home}', '${self}');`));
    expect(ok(pg.as(A, `select count(*) from public.circle_mine();`))).toBe('1');
    // A member id from another circle removes nobody, from either.
    const cleo = ok(
      pg.admin(
        `select id from public.circle_members where circle_id = '${gym}' and user_id = '${C}';`,
      ),
    );
    ok(pg.as(A, `select public.circle_remove('${home}', '${cleo}');`));
    expect(ok(pg.admin(`select count(*) from public.circle_members where id = '${cleo}';`))).toBe(
      '1',
    );
    expect(dee).toMatch(/^[0-9a-f-]{36}$/);
    ok(pg.as(A, `select public.circle_remove('${home}', '${sam}');`));
    expect(ok(pg.as(B, `select count(*) from public.circle_mine();`))).toBe('0');
    expect(ok(pg.admin(`select count(*) from public.circle_scores where user_id = '${B}';`))).toBe(
      '0',
    );
  });

  it('hands the circle on when its owner leaves, and deletes it with its last member', () => {
    // Gym: Cleo owns it alone since A left. Add two, oldest first.
    const gymCode = ok(pg.as(C, `select code from public.circle_invite('${gym}');`));
    ok(pg.as(D, `select public.circle_join('${gymCode}', 'Dee');`));
    ok(pg.as(E, `select public.circle_join('${gymCode}', 'Eve');`));
    ok(pg.as(C, `select public.circle_leave('${gym}');`));
    expect(ok(pg.as(D, `select role from public.circle_mine() where id = '${gym}';`))).toBe(
      'owner',
    );
    expect(ok(pg.admin(`select user_id from public.circles where id = '${gym}';`))).toBe(D);
    expect(ok(pg.admin(`select count(*) from public.circle_scores where user_id = '${C}';`))).toBe(
      '0',
    );
    ok(pg.as(D, `select public.circle_leave('${gym}');`));
    ok(pg.as(E, `select public.circle_leave('${gym}');`));
    expect(ok(pg.admin(`select count(*) from public.circles where id = '${gym}';`))).toBe('0');
    expect(
      ok(pg.admin(`select count(*) from public.circle_invites where circle_id = '${gym}';`)),
    ).toBe('0');
  });

  it('survives its owner deleting their account: the circle passes on, their scores go', () => {
    ok(pg.as(A, `select public.delete_my_account();`));
    expect(
      ok(pg.as(D, `select role, members from public.circle_mine() where id = '${home}';`)),
    ).toBe('owner|1');
    expect(ok(pg.admin(`select user_id from public.circles where id = '${home}';`))).toBe(D);
    expect(ok(pg.admin(`select count(*) from public.circle_scores where user_id = '${A}';`))).toBe(
      '0',
    );
  });

  // ---- limits ----

  it('holds a circle to twelve people', () => {
    const club = ok(pg.as(E, `select public.circle_create('Club', 'Eve');`));
    const clubCode = ok(pg.as(E, `select code from public.circle_invite('${club}');`));
    for (let i = 0; i < 11; i++)
      ok(pg.as(extra(i), `select public.circle_join('${clubCode}', 'P${i}');`));
    expect(ok(pg.as(E, `select members from public.circle_mine() where id = '${club}';`))).toBe(
      '12',
    );
    fails(pg.as(extra(11), `select public.circle_join('${clubCode}', 'P11');`), /circle is full/);
  });

  it('holds a person to five circles', () => {
    for (let i = 0; i < 4; i++) ok(pg.as(extra(12), `select public.circle_create('C${i}', 'Me');`));
    // One more as owner is the fifth; the sixth is refused, whether made or joined.
    ok(pg.as(extra(12), `select public.circle_create('C4', 'Me');`));
    fails(pg.as(extra(12), `select public.circle_create('C5', 'Me');`), /too many circles/);
    const someCode = ok(pg.as(D, `select code from public.circle_invite('${home}');`));
    fails(pg.as(extra(12), `select public.circle_join('${someCode}', 'Me');`), /too many circles/);
  });
});
