// Settings → Reminders: a weigh-in nudge and an evening "nothing logged" check, each at a
// time of the user's choosing. iOS only delivers these to the Home Screen app.
import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { todayKey } from '@/core/dates';
import { useEntries, useSetting, useWeighIns } from '@/hooks/useData';
import { isStandalone, pushSupport, serverConfig } from '@/platform/push';
import {
  DEFAULT_REMINDERS,
  REMINDERS_KEY,
  turnOff,
  turnOn,
  updatePrefs,
  type ReminderSettings,
  checkHealth,
  describeNext,
  testNow,
  type Health,
} from '@/services/reminders';
import { toast } from './Toast';
import { Button, Card } from './ui';

export function RemindersCard() {
  const settings = useSetting<ReminderSettings>(REMINDERS_KEY, DEFAULT_REMINDERS);
  const today = todayKey();
  const entries = useEntries(today);
  const weighIns = useWeighIns();
  const [server, setServer] = useState<'checking' | 'on' | 'off'>('checking');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const status = health && 'status' in health ? health.status : undefined;
  const [testing, setTesting] = useState(false);
  const support = pushSupport();

  useEffect(() => {
    let cancelled = false;
    void serverConfig()
      .then((c) => {
        if (!cancelled) setServer(c.enabled ? 'on' : 'off');
      })
      .catch(() => {
        if (!cancelled) setServer('off');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const done = {
    lastLoggedDate: entries && entries.length > 0 ? today : undefined,
    lastWeighedDate: weighIns?.some((w) => w.date === today) ? today : undefined,
  };
  const doneKey = `${done.lastLoggedDate ?? ''}|${done.lastWeighedDate ?? ''}`;

  // When reminders are on, make sure the server still has this phone; re-register if not.
  useEffect(() => {
    if (!settings.enabled || server !== 'on' || entries === undefined || weighIns === undefined) {
      return;
    }
    let cancelled = false;
    const [logged, weighed] = doneKey.split('|');
    void checkHealth(settings, {
      lastLoggedDate: logged || undefined,
      lastWeighedDate: weighed || undefined,
    })
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealth({ state: 'unknown' }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.enabled, settings.weighAt, settings.logAt, server, doneKey]);

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    setNote(null);
    try {
      const r = await testNow();
      if (r.outcome === 'sent') {
        toast(`The push service accepted it (${r.status}). It should be on your phone now.`);
      } else if (r.outcome === 'gone') {
        setNote(
          'The server had no subscription for this phone — it has been registered again. Tap once more.',
        );
        setHealth(null);
      } else {
        setNote(`The push service refused it: ${r.status} ${r.detail || ''}`.trim());
      }
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      if (settings.enabled) {
        await turnOff({ weighAt: settings.weighAt, logAt: settings.logAt });
      } else {
        const r = await turnOn({ weighAt: settings.weighAt, logAt: settings.logAt }, done);
        if (r === 'denied') setNote('Notifications are blocked for Kalib in iOS Settings.');
        if (r === 'unavailable') setNote('Reminders are not set up on the server yet.');
        if (r === 'signin')
          setNote('Sign in first (Sync, above) — reminders belong to an account.');
      }
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setTime = (key: 'weighAt' | 'logAt', value: string | null) => {
    void updatePrefs({ ...settings, [key]: value }, done);
  };

  if (support === 'needs-install' && !isStandalone()) {
    return (
      <Card className="p-5">
        <p className="flex items-start gap-2 text-[14px] text-muted">
          <BellOff size={16} className="mt-0.5 shrink-0" aria-hidden />
          Reminders reach the Home Screen app only. Share → Add to Home Screen, then open Kalib from
          there.
        </p>
      </Card>
    );
  }
  if (support === 'unsupported') {
    return (
      <Card className="p-5">
        <p className="flex items-start gap-2 text-[14px] text-muted">
          <BellOff size={16} className="mt-0.5 shrink-0" aria-hidden />
          This browser cannot show notifications.
        </p>
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-line">
      <button
        type="button"
        role="switch"
        aria-checked={settings.enabled}
        disabled={busy || server !== 'on'}
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left disabled:opacity-60"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Bell size={18} strokeWidth={2.2} aria-hidden />
          </span>
          <span>
            <span className="block text-[16px] font-medium">Reminders</span>
            <span className="block text-[13px] text-muted">
              {server === 'checking'
                ? 'Checking…'
                : server === 'off'
                  ? 'Not set up on the server yet'
                  : settings.enabled
                    ? 'On — only when something is still undone'
                    : 'A nudge when the day is slipping'}
            </span>
          </span>
        </span>
        <Toggle on={settings.enabled} />
      </button>

      <TimeRow
        label="Weigh-in nudge"
        hint="if you have not weighed in by"
        value={settings.weighAt}
        onChange={(v) => setTime('weighAt', v)}
        disabled={!settings.enabled}
      />
      <TimeRow
        label="Evening check"
        hint="if anything is still undone by"
        value={settings.logAt}
        onChange={(v) => setTime('logAt', v)}
        disabled={!settings.enabled}
      />
      {settings.enabled && server === 'on' && (
        <div className="space-y-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] text-muted">
              {health == null
                ? 'Checking the server…'
                : health.state === 'registered'
                  ? 'Registered on the server.'
                  : health.state === 're-registered'
                    ? 'The server had lost this phone — registered again.'
                    : health.state === 'signin'
                      ? 'Sign in (Sync, above) so the server can keep this phone.'
                      : health.state === 'no-subscription'
                        ? 'This phone has no push subscription — turn reminders off and on.'
                        : 'Could not reach the server.'}
            </p>
            <Button size="sm" onClick={() => void runTest()} disabled={testing}>
              {testing ? 'Sending…' : 'Send a test'}
            </Button>
          </div>
          {status && (
            <dl className="space-y-1 text-[12px] text-muted tabular">
              <div className="flex justify-between gap-3">
                <dt>Next weigh-in nudge</dt>
                <dd className="text-ink-2">
                  {describeNext(status.next?.weigh ?? null) ??
                    (settings.weighAt ? 'due now' : 'off')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Next evening check</dt>
                <dd className="text-ink-2">
                  {describeNext(status.next?.log ?? null) ?? (settings.logAt ? 'due now' : 'off')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Last sent</dt>
                <dd className="text-ink-2">
                  {status.sent?.weigh || status.sent?.log
                    ? [
                        status.sent.weigh && `weigh-in ${status.sent.weigh}`,
                        status.sent.log && `log ${status.sent.log}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'none yet'}
                </dd>
              </div>
            </dl>
          )}
          {status?.last_error && (
            <p className="text-[12px] text-danger">
              Last attempt failed: {status.last_error.status} {status.last_error.detail}
            </p>
          )}
          <p className="text-[12px] text-muted">
            The evening check covers the whole day — food, supplements and water. It only goes out
            if something is still undone at that time.
          </p>
        </div>
      )}
      {note && <p className="px-4 py-3 text-[13px] text-danger">{note}</p>}
    </Card>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-accent' : 'bg-surface-3'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out-soft)] ${on ? 'translate-x-5' : ''}`}
      />
    </span>
  );
}

function TimeRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
}) {
  const on = value != null;
  return (
    <div className={`flex items-center gap-2.5 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-[13px] text-muted">{hint}</span>
      </span>
      <input
        type="time"
        value={value ?? '07:30'}
        disabled={disabled || !on}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={`${label} time`}
        className="h-9 w-[104px] min-w-0 max-w-[104px] shrink-0 rounded-full bg-surface-2 px-1 text-center text-[14px] tabular outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
      />
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label} on or off`}
        disabled={disabled}
        className="shrink-0"
        onClick={() => onChange(on ? null : label === 'Weigh-in nudge' ? '07:30' : '20:00')}
      >
        <Toggle on={on} />
      </button>
    </div>
  );
}
