import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AuthForm } from '@/components/AuthForm';
import { ProfileForm } from '@/components/ProfileForm';
import { Button, Sheet, Spinner } from '@/components/ui';
import { todayKey } from '@/core/dates';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { setSetting } from '@/db/repo/settings';
import { upsertWeighIn } from '@/db/repo/weighIns';
import { useSync } from '@/hooks/useSync';
import { syncConfigured } from '@/services/sync/config';
import { syncNow } from '@/services/sync/manager';
import { refreshTargetForDate } from '@/services/targets';

export default function Onboarding() {
  const navigate = useNavigate();
  const { session } = useSync();
  const [authOpen, setAuthOpen] = useState(false);
  /** Signed in but still on this screen: the account's data is on its way, or there is none. */
  const [phase, setPhase] = useState<'idle' | 'restoring' | 'empty'>('idle');

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      if (!cancelled) setPhase('restoring');
      await syncNow().catch(() => undefined);
      // A profile would have sent us to Today already, so this account has nothing stored.
      if (!cancelled) setPhase('empty');
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <div className="space-y-6 pb-10">
      <header className="pt-2">
        <img src="/icons/icon.svg" alt="" width={44} height={44} className="mb-5 rounded-xl" />
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em]">
          Welcome to Kalib
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          These numbers seed a <span className="text-ink">provisional</span> target. After two weeks
          of weigh-ins and logging, your real maintenance calories are measured from your own data
          and replace it.
        </p>
      </header>

      {syncConfigured && !session && (
        <div className="card flex items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Been here before?</span>
            <span className="block text-[13px] text-muted">
              Sign in and your profile, log and recipes come back — no forms.
            </span>
          </span>
          <Button size="sm" variant="primary" onClick={() => setAuthOpen(true)}>
            Sign in
          </Button>
        </div>
      )}

      {session && phase === 'restoring' && (
        <div className="card flex items-center gap-3 px-4 py-3" role="status" aria-live="polite">
          <Spinner size={18} />
          <span className="text-[14px]">
            Signed in as {session.user.email} — bringing your data back…
          </span>
        </div>
      )}

      {session && phase === 'empty' && (
        <div className="card px-4 py-3">
          <p className="text-[14px]">
            Signed in as {session.user.email}. This account has nothing stored yet, so fill in your
            details once and it will sync from here.
          </p>
        </div>
      )}

      <ProfileForm
        askWeight
        submitLabel="Start tracking"
        onSubmit={async ({ weight_kg, name, ...profile }) => {
          await saveProfileSnapshot(profile);
          await setSetting('name', name);
          const today = todayKey();
          if (weight_kg != null) await upsertWeighIn(today, weight_kg);
          await refreshTargetForDate(today);
          navigate('/', { replace: true });
        }}
      />

      <p className="text-[12px] leading-relaxed text-muted">
        Not medical advice. Targets are general-population formulas; review them with a clinician if
        any medical condition or medication applies.
      </p>

      <Sheet open={authOpen && !session} onClose={() => setAuthOpen(false)} title="Sign in">
        {authOpen && <AuthForm />}
      </Sheet>
    </div>
  );
}
