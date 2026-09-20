// Landing for the password-reset email. Shown over everything else while the recovery
// session is active, so it works in Safari with no profile on that browser.
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { clearRecovery } from '@/services/sync/manager';

export default function PasswordReset({ email }: { email: string | undefined }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (password.length < 8 || password !== again || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const m = await import('@/services/sync/supabase');
      await m.updatePassword(password);
      setDone(true);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-4 pt-6 safe-top">
      <header>
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
          <KeyRound size={22} strokeWidth={2.2} aria-hidden />
        </span>
        <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em]">
          {done ? 'Password saved' : 'Set a new password'}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          {done
            ? 'Now open Kalib from your Home Screen, go to Settings → Account and sign in with it.'
            : email
              ? `For ${email}. Eight characters or more.`
              : 'Eight characters or more.'}
        </p>
      </header>

      {!done && (
        <Card className="mt-6 space-y-3 p-5">
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Repeat it"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
          />
          {again && password !== again && (
            <p className="text-[13px] text-danger">The two passwords differ.</p>
          )}
          {note && <p className="text-[13px] text-danger">{note}</p>}
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={save}
            disabled={password.length < 8 || password !== again || busy}
          >
            {busy ? 'Saving…' : 'Save password'}
          </Button>
        </Card>
      )}

      {done && (
        <Button
          variant="primary"
          size="lg"
          className="mt-6 w-full"
          onClick={async () => {
            // This browser's session was only for the reset; sign it out so the app is the
            // one place that stays signed in.
            const m = await import('@/services/sync/supabase');
            await m.signOut();
            clearRecovery();
          }}
        >
          Done
        </Button>
      )}
    </div>
  );
}
