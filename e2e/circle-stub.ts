// A stand-in for Supabase, for walking the circle signed in without a server (SPEC §21).
// Used by circle.spec.ts; kept apart so a one-off screenshot harness can drive the same model.
import { expect, type Page, type Route } from '@playwright/test';

const USER = '00000000-0000-4000-8000-0000000000a1';

/** The Supabase host this build was made with, read from its own public bundle. */
export async function supabaseHost(page: Page): Promise<string | undefined> {
  const html = await (await page.request.get('/')).text();
  const seen = new Set<string>();
  const queue = [...html.matchAll(/\/assets\/[\w.-]+\.js/g)].map((m) => m[0]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const js = await (await page.request.get(path)).text();
    const host = /https:\/\/([a-z0-9-]+)\.supabase\.co/.exec(js);
    if (host) return host[1];
    // Follow the imports the entry makes, which is where the config module lands.
    for (const m of js.matchAll(/["'(/]((?:\.\/|\/assets\/)?[\w-]+-[\w-]{8}\.js)/g)) {
      const name = m[1]!.replace(/^\.\//, '').replace(/^\/assets\//, '');
      queue.push(`/assets/${name}`);
    }
    if (seen.size > 60) break;
  }
  return undefined;
}

function unsignedJwt(sub: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp })}.sig`;
}

interface Week {
  week: string;
  planned: number;
  done: number;
  consistency: number;
  progress: number | null;
  score: number;
  flagged: number;
  hard: boolean;
  rating: number | null;
}

/** An in-memory stand-in for 0009_circle.sql's functions, enough to walk the screen. */
export function stubServer() {
  const published: Week[][] = [];
  const state = {
    circles: [] as {
      id: string;
      name: string;
      members: { id: string; name: string; me: boolean; owner: boolean }[];
    }[],
    code: '',
  };
  const monday = (weeksAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * weeksAgo);
    return d.toLocaleDateString('en-CA');
  };
  const friendWeeks: Week[] = [4, 3, 2, 1, 0].map((n) => ({
    week: monday(n),
    planned: 3,
    done: n === 0 ? 1 : 3,
    consistency: n === 0 ? 33 : 100,
    progress: 50,
    score: n === 0 ? 40 : 80,
    flagged: 0,
    hard: false,
    rating: null,
  }));

  const rpc = (fn: string, args: Record<string, unknown>): { status: number; body: unknown } => {
    const mine = () =>
      state.circles
        .filter((c) => c.members.some((m) => m.me))
        .map((c) => {
          const me = c.members.find((m) => m.me)!;
          return {
            id: c.id,
            name: c.name,
            role: me.owner ? 'owner' : 'member',
            display_name: me.name,
            members: c.members.length,
          };
        });
    switch (fn) {
      case 'circle_mine':
        return { status: 200, body: mine() };
      case 'circle_create': {
        const id = `c${state.circles.length + 1}-0000-4000-8000-000000000000`;
        state.circles.push({
          id,
          name: String(args.p_name),
          members: [{ id: `m-me-${id}`, name: String(args.p_display_name), me: true, owner: true }],
        });
        return { status: 200, body: id };
      }
      case 'circle_invite': {
        state.code = 'ABCDE-23456';
        const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
        return { status: 200, body: [{ code: state.code, expires_at: until }] };
      }
      case 'circle_revoke_invites':
        state.code = '';
        return { status: 200, body: null };
      case 'circle_join':
        // Wrong codes come back as null, as the real function does.
        return { status: 200, body: null };
      case 'circle_publish': {
        const weeks = args.p_weeks as Week[];
        published.push(weeks);
        // A friend has been in the circle a while, so there is someone to rank against.
        const c = state.circles[0];
        if (c && !c.members.some((m) => m.name === 'Sam')) {
          c.members.push({ id: 'm-sam', name: 'Sam', me: false, owner: false });
        }
        return { status: 200, body: weeks.length };
      }
      case 'circle_board': {
        const c = state.circles.find((x) => x.id === args.p_circle);
        if (!c) return { status: 400, body: { message: 'circle: not a member' } };
        const latest = published.at(-1) ?? [];
        return {
          status: 200,
          body: c.members.flatMap<Record<string, unknown>>((m) => {
            const weeks = m.me ? latest : m.name === 'Sam' ? friendWeeks : [];
            const base = { member_id: m.id, display_name: m.name, is_me: m.me, is_owner: m.owner };
            return weeks.length === 0
              ? [{ ...base, week: null }]
              : weeks.map((w) => ({ ...base, ...w }));
          }),
        };
      }
      case 'circle_leave':
        state.circles = state.circles.filter((c) => c.id !== args.p_circle);
        return { status: 200, body: null };
      default:
        return { status: 404, body: { message: `no stand-in for ${fn}` } };
    }
  };
  return { rpc, published, state };
}

export async function serve(page: Page, host: string, server: ReturnType<typeof stubServer>) {
  await page.route(`https://${host}.supabase.co/**`, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const rpcName = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname)?.[1];
    if (rpcName) {
      const r = server.rpc(rpcName, (req.postDataJSON() as Record<string, unknown>) ?? {});
      return json(r.status, r.body);
    }
    // The sync engine's reads and writes: an empty account that accepts what it is sent.
    if (url.pathname.startsWith('/rest/v1/')) return json(req.method() === 'GET' ? 200 : 201, []);
    if (url.pathname === '/auth/v1/user')
      return json(200, { id: USER, email: 'me@example.com', aud: 'authenticated' });
    return json(404, { message: 'not stood in' });
  });
}

export async function signIn(page: Page, host: string) {
  await page.evaluate(
    ({ key, token, user }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: token,
          refresh_token: 'stand-in-refresh',
          token_type: 'bearer',
          expires_in: 86_400,
          expires_at: now + 86_400,
          user: { id: user, aud: 'authenticated', role: 'authenticated', email: 'me@example.com' },
        }),
      );
    },
    { key: `sb-${host}-auth-token`, token: unsignedJwt(USER), user: USER },
  );
}

export async function onboard(page: Page) {
  await page.goto('/');
  await page.getByLabel('Your name').fill('Circle');
  await page.getByLabel('Birth date').fill('1992-03-14');
  await page.getByLabel('Height').fill('180');
  await page.getByLabel('Weight today').fill('80');
  await page.getByLabel('Target weight').fill('78');
  await page.getByRole('button', { name: 'Start tracking' }).click();
  await expect(page.getByText('Left today')).toBeVisible();
}
