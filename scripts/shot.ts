// Dev harness: drive headless Chrome over CDP (no dependencies — Node 22 has WebSocket).
//   npm run shot -- <url> <out.png> [--eval "js" | --eval-file f.js]... [--wait ms] [--width 390] [--height 844]
// Prints console messages and page errors; evaluates each --eval in order (awaiting promises),
// then screenshots. Keeps a persistent profile in .cache/chrome-profile so IndexedDB survives.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let profileName = 'chrome-profile';

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error('usage: shot <url> <out.png> [--eval js]... [--wait ms] [--width w] [--height h]');
  process.exit(2);
}
const evals: string[] = [];
let wait = 800;
let width = 390;
let height = 844;
let scheme = 'dark';
for (let i = 2; i < args.length; i++) {
  const a = args[i]!;
  const v = args[i + 1];
  if (v == null) break;
  switch (a) {
    case '--eval':
      evals.push(v);
      break;
    case '--eval-file':
      evals.push(readFileSync(v, 'utf8'));
      break;
    case '--wait':
      wait = Number(v);
      break;
    case '--width':
      width = Number(v);
      break;
    case '--height':
      height = Number(v);
      break;
    case '--scheme':
      scheme = v;
      break;
    case '--profile':
      profileName = `chrome-profile-${v}`;
      break;
    default:
      continue;
  }
  i++;
}

const PROFILE = join(import.meta.dirname, '..', '.cache', profileName);
const port = 9222 + Math.floor(Math.random() * 500);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-sandbox',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 50; i++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as typeof targets;
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = (e) => rej(e);
  });
  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: unknown;
      error?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    };
    if (msg.id != null) {
      pending.get(msg.id)?.(msg.error ? { error: msg.error } : msg.result);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const p = msg.params as { type: string; args: { value?: unknown; description?: string }[] };
      const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (!/\[vite\]|React DevTools/.test(text)) console.log(`console.${p.type}: ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const p = msg.params as {
        exceptionDetails: { text: string; exception?: { description?: string } };
      };
      console.log(
        `EXCEPTION: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`,
      );
    }
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  });
  await send('Page.navigate', { url });
  await sleep(wait);
  for (const js of evals) {
    const r = (await send('Runtime.evaluate', {
      expression: js,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: { text: string }; error?: unknown };
    if (r.exceptionDetails) console.log('eval error:', r.exceptionDetails.text);
    else if (r.result?.value !== undefined) console.log('eval →', JSON.stringify(r.result.value));
    await sleep(300);
  }
  await sleep(200);
  const shot = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  mkdirSync(dirname(out!), { recursive: true });
  writeFileSync(out!, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out}`);
  ws.close();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => chrome.kill());
