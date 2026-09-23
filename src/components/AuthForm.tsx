// Email + password against Supabase, used by Settings → Sync and by the welcome screen so a
// returning phone can sign in instead of filling the profile in again.
import { useState } from 'react';
import { Button } from './ui';

export function AuthForm({
  initialMode = 'signin',
  onSignedIn,
}: {
  initialMode?: 'signin' | 'signup';
  onSignedIn?: () => void;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const submit = async () => {
    const e = email.trim();
    if (!e || password.length < 8 || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const m = await import('@/services/sync/supabase');
      if (mode === 'signup') await m.signUpWithPassword(e, password);
      else await m.signInWithPassword(e, password);
      setPassword('');
      onSignedIn?.();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    const e = email.trim();
    if (!e) {
      setNote('Enter your email first, then tap Forgot password.');
      return;
    }
    try {
      const m = await import('@/services/sync/supabase');
      await m.sendPasswordReset(e);
      setNote(
        `Reset link sent to ${e}. It opens in Safari; set a new password there, then sign in here.`,
      );
    } catch (err) {
      setNote((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[14px] text-muted">
        {mode === 'signup'
          ? 'Create an account to keep a copy of your log in the cloud and use it on another phone.'
          : 'Sign in and everything — profile, weigh-ins, recipes, plans — comes back from your account.'}
      </p>
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
      />
      <input
        type="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        placeholder={mode === 'signup' ? 'Choose a password (8+ characters)' : 'Password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
      />
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={() => void submit()}
        disabled={!email.trim() || password.length < 8 || busy}
      >
        {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </Button>
      <div className="flex justify-between text-[13px]">
        <button
          type="button"
          className="font-semibold text-accent"
          onClick={() => {
            setMode(mode === 'signup' ? 'signin' : 'signup');
            setNote(null);
          }}
        >
          {mode === 'signup' ? 'I already have an account' : 'Create an account'}
        </button>
        {mode === 'signin' && (
          <button type="button" className="text-muted" onClick={() => void forgot()}>
            Forgot password?
          </button>
        )}
      </div>
      {note && <p className="text-[13px] text-muted">{note}</p>}
    </div>
  );
}
