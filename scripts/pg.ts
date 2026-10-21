// A throwaway PostgreSQL for testing migrations against, when one is installed on this machine.
//
// Supabase is not available to the tests and must never be touched by them, so this starts a
// private cluster in a temporary directory on a random port, with just enough of Supabase's
// shape (the `auth` schema, `auth.uid()`, the `anon` and `authenticated` roles, an `extensions`
// schema) for the migrations to run unchanged. It is torn down afterwards.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The directory holding initdb, pg_ctl and psql, or undefined when there is none. */
export function findPgBin(): string | undefined {
  const fromEnv = process.env.KALIB_PG_BIN;
  if (fromEnv && existsSync(join(fromEnv, exe('psql')))) return fromEnv;
  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\PostgreSQL';
    if (existsSync(root)) {
      const versions = readdirSync(root)
        .filter((v) => /^\d+$/.test(v))
        .sort((a, b) => Number(b) - Number(a));
      for (const v of versions) {
        const bin = join(root, v, 'bin');
        if (existsSync(join(bin, exe('initdb')))) return bin;
      }
    }
    return undefined;
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir && existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl'))) return dir;
  }
  for (const v of ['18', '17', '16', '15']) {
    const bin = `/usr/lib/postgresql/${v}/bin`;
    if (existsSync(join(bin, 'initdb'))) return bin;
  }
  return undefined;
}

function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

/** What Supabase provides that the migrations assume. */
const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema extensions;
grant usage on schema auth, extensions, public to anon, authenticated;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase's default: new tables in public are granted to the API roles, so that row-level
-- security, and only row-level security, decides. The migrations must cope with that.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export interface PgResult {
  ok: boolean;
  out: string;
  err: string;
}

export interface Pg {
  /** Runs SQL as the superuser. */
  admin(sql: string): PgResult;
  /** Runs SQL as a signed-in user (role `authenticated`, `auth.uid()` = `uid`), or as anon. */
  as(uid: string | 'anon', sql: string): PgResult;
  stop(): void;
}

export function startPg(bin: string): Pg {
  const dir = mkdtempSync(join(tmpdir(), 'kalib-pg-'));
  const data = join(dir, 'data');
  const port = 55_000 + Math.floor(Math.random() * 4_000);
  const run = (cmd: string, args: string[], input?: string) =>
    spawnSync(join(bin, exe(cmd)), args, {
      encoding: 'utf8',
      ...(input != null ? { input } : {}),
      env: {
        ...process.env,
        PGCLIENTENCODING: 'UTF8',
        PGTZ: 'UTC',
        // "does not exist, skipping" from a re-run is the migration working, not a finding.
        PGOPTIONS: '-c client_min_messages=warning',
      },
      timeout: 120_000,
    });

  const init = run('initdb', [
    '-D',
    data,
    '-U',
    'postgres',
    '--auth=trust',
    '-E',
    'UTF8',
    '--no-locale',
    '--no-sync',
  ]);
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  // No pipes: the server pg_ctl starts inherits them and never closes them, so a captured
  // pg_ctl would look as if it never finished. Success is checked by asking the server.
  spawnSync(
    join(bin, exe('pg_ctl')),
    [
      '-D',
      data,
      '-l',
      join(dir, 'log.txt'),
      '-o',
      `-p ${port} -c listen_addresses=localhost -c timezone=UTC -c fsync=off`,
      '-w',
      'start',
    ],
    { stdio: 'ignore', timeout: 60_000 },
  );

  const psql = (sql: string): PgResult => {
    const r = run(
      'psql',
      [
        '-h',
        'localhost',
        '-p',
        String(port),
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-X',
        '-q',
        '-At',
        '-F',
        '|',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      sql,
    );
    const clean = (t: string | null) => (t ?? '').replace(/\r\n/g, '\n').trim();
    return { ok: r.status === 0, out: clean(r.stdout), err: clean(r.stderr) };
  };

  const shim = psql(SUPABASE_SHIM);
  if (!shim.ok) {
    run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not start or prepare PostgreSQL: ${shim.err}`);
  }

  return {
    admin: psql,
    as(uid, sql) {
      const who =
        uid === 'anon'
          ? `set local role anon;`
          : `set local role authenticated; set local request.jwt.claim.sub = '${uid}';`;
      return psql(`begin; ${who}\n${sql}\ncommit;`);
    },
    stop() {
      spawnSync(join(bin, exe('pg_ctl')), ['-D', data, '-m', 'immediate', '-w', 'stop'], {
        stdio: 'ignore',
        timeout: 60_000,
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
