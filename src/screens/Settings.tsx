import {
  Database,
  FileJson,
  FileSpreadsheet,
  FolderOpen,
  Monitor,
  Pill,
  SearchX,
  Moon,
  RefreshCw,
  CalendarClock,
  CalendarRange,
  ChefHat,
  Cloud,
  CloudOff,
  LogOut,
  Sun,
  UserRound,
  Utensils,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ProfileForm } from '@/components/ProfileForm';
import { RemindersCard } from '@/components/RemindersCard';
import { Button, Card, ListRow, Row, SectionHeading, Segmented, Sheet, fmt } from '@/components/ui';
import { fromDateKey, todayKey } from '@/core/dates';
import { nextSwitch, resolveMode, type ModeSwitch } from '@/core/targets';
import type { Mode } from '@/core/types';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { setSetting } from '@/db/repo/settings';
import { useDailyTarget, useProfile, useSetting, useWeighIns } from '@/hooks/useData';
import { useSync } from '@/hooks/useSync';
import { useTheme, type ThemePref } from '@/hooks/useTheme';
import {
  exportBackup,
  parseBackup,
  restoreBackup,
  summarize,
  type Backup,
  type BackupSummary,
} from '@/services/backup';
import { exportCsv } from '@/services/exportData';
import { SwipeRow } from '@/components/SwipeRow';
import { shareText } from '@/platform/share';
import { clearMisses, forgetMiss, MISSES_KEY, type SearchMiss } from '@/services/misses';
import { clearRecovery, resetThisPhone, syncNow } from '@/services/sync/manager';
import { syncConfigured } from '@/services/sync/config';
import { MODE_SCHEDULE_KEY, refreshTargetForDate, setModeSchedule } from '@/services/targets';

const THEMES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Auto', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
];

export default function Settings() {
  const profile = useProfile();
  const weighIns = useWeighIns();
  const today = todayKey();
  const target = useDailyTarget(today);
  const [theme, setTheme] = useTheme();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [pending, setPending] = useState<{ backup: Backup; summary: BackupSummary } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { status: sync, session, recovery } = useSync();
  const [newPassword, setNewPassword] = useState('');
  const schedule = useSetting<ModeSwitch[]>(MODE_SCHEDULE_KEY, []);
  const [addingSwitch, setAddingSwitch] = useState(false);
  const [switchDate, setSwitchDate] = useState('');
  const [switchMode, setSwitchMode] = useState<Mode>('MAINTAIN');
  const activeMode = profile ? resolveMode(profile.mode, schedule, today) : undefined;
  const upcoming = nextSwitch(schedule, today);

  const saveSwitch = async () => {
    if (!switchDate) return;
    await setModeSchedule([
      ...schedule.filter((s) => s.date !== switchDate),
      { date: switchDate, mode: switchMode },
    ]);
    await refreshTargetForDate(today);
    setAddingSwitch(false);
    setSwitchDate('');
  };

  const removeSwitch = async (date: string) => {
    await setModeSchedule(schedule.filter((s) => s.date !== date));
    await refreshTargetForDate(today);
  };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authNote, setAuthNote] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [missesOpen, setMissesOpen] = useState(false);
  const misses = useSetting<SearchMiss[]>(MISSES_KEY, []);
  const [eraseWord, setEraseWord] = useState('');
  const [eraseBusy, setEraseBusy] = useState(false);
  const name = useSetting<string>('name', '');

  const submitAuth = async () => {
    const e = email.trim();
    if (!e || password.length < 8 || authBusy) return;
    setAuthBusy(true);
    setAuthNote(null);
    try {
      const m = await import('@/services/sync/supabase');
      if (authMode === 'signup') await m.signUpWithPassword(e, password);
      else await m.signInWithPassword(e, password);
      setPassword('');
    } catch (err) {
      setAuthNote((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const forgot = async () => {
    const e = email.trim();
    if (!e) {
      setAuthNote('Enter your email first, then tap Forgot password.');
      return;
    }
    try {
      const m = await import('@/services/sync/supabase');
      await m.sendPasswordReset(e);
      setAuthNote(
        `Reset link sent to ${e}. It opens in Safari; set a new password there, then sign in here.`,
      );
    } catch (err) {
      setAuthNote((err as Error).message);
    }
  };
  const latestWeight = weighIns?.at(-1)?.weight_kg;

  const pickBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      setPending({ backup, summary: summarize(backup) });
    } catch (err) {
      setNote(`Could not read that file: ${(err as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmRestore = async () => {
    if (!pending || restoring) return;
    setRestoring(true);
    try {
      await restoreBackup(pending.backup);
      await refreshTargetForDate(today);
      setNote(
        `Restored ${pending.summary.log_entries} entries and ${pending.summary.weigh_ins} weigh-ins.`,
      );
      setPending(null);
    } catch (err) {
      setNote(`Restore failed: ${(err as Error).message}`);
    } finally {
      setRestoring(false);
    }
  };

  const checkForUpdate = async () => {
    setUpdateNote('Checking…');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) {
        setUpdateNote('Updates apply automatically when the app is installed.');
        return;
      }
      await reg.update();
      if (reg.installing || reg.waiting) {
        setUpdateNote('Update found — installing. The app reloads in a moment.');
      } else {
        setUpdateNote(`You have the latest version (${__APP_VERSION__}).`);
      }
    } catch (err) {
      setUpdateNote(`Could not check: ${(err as Error).message}`);
    }
  };

  const run = async (label: string, fn: () => Promise<'shared' | 'downloaded'>) => {
    try {
      const how = await fn();
      setNote(`${label} ${how === 'shared' ? 'shared' : 'downloaded'}.`);
    } catch (err) {
      setNote(`${label} failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-7 pb-32">
      <header className="pt-2">
        <p className="text-[14px] font-medium text-muted">Profile, data and appearance</p>
        <h1 className="mt-0.5 text-[34px] leading-none font-extrabold tracking-[-0.03em]">
          Settings
        </h1>
      </header>

      <section>
        <SectionHeading
          trailing={
            sync.state === 'syncing'
              ? 'syncing…'
              : sync.state === 'idle' && sync.lastAt
                ? `synced ${new Date(sync.lastAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                : undefined
          }
        >
          Account
        </SectionHeading>
        <Card className="p-5">
          {!syncConfigured ? (
            <p className="flex items-start gap-2 text-[14px] text-muted">
              <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden />
              Cloud sync is not configured in this build. Everything stays on this phone.
            </p>
          ) : session ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-[22px] font-bold text-on-accent">
                  {(name.trim() || session.user.email || '?').charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-bold">{name.trim() || 'Signed in'}</p>
                  <p className="truncate text-[14px] text-muted">{session.user.email}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[13px]">
                    {sync.state === 'mismatch' ? (
                      <span className="text-danger">Not syncing — see below</span>
                    ) : sync.state === 'error' ? (
                      <span className="text-danger">Last sync failed</span>
                    ) : (
                      <>
                        <span className="h-2 w-2 rounded-full bg-accent" />
                        <span className="text-ink-2">
                          {sync.state === 'syncing'
                            ? 'Syncing…'
                            : sync.state === 'idle' && sync.lastAt
                              ? `Synced ${relativeTime(sync.lastAt)}`
                              : 'Signed in, first sync pending'}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              {sync.state === 'mismatch' && (
                <p className="rounded-2xl bg-danger/10 p-3 text-[13px] leading-snug text-ink-2">
                  This phone holds {sync.ownerEmail ? `${sync.ownerEmail}’s` : 'another account’s'}{' '}
                  data, so it will not sync to this account. To hand the phone to someone else: sign
                  out, then choose “Remove this phone’s data”.
                </p>
              )}
              {sync.state === 'error' && <p className="text-[13px] text-danger">{sync.message}</p>}
              {recovery && (
                <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
                  <p className="text-[14px] font-semibold">Set a new password</p>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="New password (8+ characters)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-12 w-full rounded-full bg-surface px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
                  />
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={newPassword.length < 8}
                    onClick={async () => {
                      try {
                        const m = await import('@/services/sync/supabase');
                        await m.updatePassword(newPassword);
                        setNewPassword('');
                        clearRecovery();
                        setNote('Password updated.');
                      } catch (err) {
                        setNote((err as Error).message);
                      }
                    }}
                  >
                    Save password
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  icon={Cloud}
                  onClick={() => void syncNow()}
                  disabled={sync.state === 'syncing' || sync.state === 'mismatch'}
                >
                  Sync now
                </Button>
                <Button icon={LogOut} onClick={() => setSignOutOpen(true)}>
                  Sign out
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[14px] text-muted">
                {authMode === 'signup'
                  ? 'Create an account to keep a copy of your log in the cloud and use it on another phone.'
                  : 'Sign in to keep a copy of your log in the cloud and use it on another phone.'}
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
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={
                  authMode === 'signup' ? 'Choose a password (8+ characters)' : 'Password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitAuth();
                }}
                className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
              />
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={submitAuth}
                disabled={!email.trim() || password.length < 8 || authBusy}
              >
                {authBusy ? 'One moment…' : authMode === 'signup' ? 'Create account' : 'Sign in'}
              </Button>
              <div className="flex justify-between text-[13px]">
                <button
                  type="button"
                  className="font-semibold text-accent"
                  onClick={() => {
                    setAuthMode(authMode === 'signup' ? 'signin' : 'signup');
                    setAuthNote(null);
                  }}
                >
                  {authMode === 'signup' ? 'I already have an account' : 'Create an account'}
                </button>
                {authMode === 'signin' && (
                  <button type="button" className="text-muted" onClick={() => void forgot()}>
                    Forgot password?
                  </button>
                )}
              </div>
              {authNote && <p className="text-[13px] text-muted">{authNote}</p>}
            </div>
          )}
        </Card>
      </section>

      {target && (
        <section>
          <SectionHeading trailing={target.provisional ? 'provisional' : 'measured'}>
            Today's targets
          </SectionHeading>
          <Card className="divide-y divide-line">
            <Row label="Calories" value={fmt(target.kcal)} sub="kcal" />
            <Row label="Protein" value={fmt(target.protein_g)} sub="g" />
            <Row label="Fiber" value={fmt(target.fiber_g)} sub="g" />
            <Row label="Carbs" value={fmt(target.carb_g)} sub="g" />
            <Row label="Fat" value={fmt(target.fat_g)} sub="g" />
            <Row label="Water" value={fmt(target.water_ml / 1000, 1)} sub="L" />
            <Row label="Weekly budget" value={fmt(target.kcal * 7)} sub="kcal" />
          </Card>
        </section>
      )}

      <section>
        <SectionHeading>Profile</SectionHeading>
        <Card className={editing ? 'p-5' : ''}>
          {profile && !editing && (
            <ListRow
              icon={UserRound}
              onClick={() => setEditing(true)}
              wrapTitle
              title={`${profile.sex === 'male' ? 'Male' : 'Female'}, ${profile.height_cm} cm, born ${profile.birth_date.slice(0, 4)}`}
              subtitle={`${cap(profile.activity_level)} activity, ${profile.mode.toLowerCase()}${
                profile.mode !== 'MAINTAIN' ? ` at ${profile.goal_rate_kg_per_week} kg a week` : ''
              }${profile.bodyfat_pct != null ? `, ${profile.bodyfat_pct}% body fat` : ''}${
                profile.target_weight_kg != null ? `, target ${profile.target_weight_kg} kg` : ''
              }`}
              chevron
            />
          )}
          {profile && editing && (
            <ProfileForm
              initial={profile}
              initialName={name}
              askWeight={false}
              latestWeight={latestWeight}
              submitLabel="Save profile"
              onCancel={() => setEditing(false)}
              onSubmit={async ({ name: newName, ...values }) => {
                // Snapshot, never mutate: history keeps the parameters that produced each target.
                await saveProfileSnapshot(values);
                await setSetting('name', newName);
                await refreshTargetForDate(today);
                setEditing(false);
              }}
            />
          )}
        </Card>
      </section>

      <section>
        <SectionHeading trailing={activeMode ? `now ${modeLabel(activeMode)}` : undefined}>
          Mode schedule
        </SectionHeading>
        <Card>
          {schedule.length === 0 ? (
            <p className="px-5 pt-4 pb-1 text-[14px] text-muted">
              Switch modes on a date — for example to maintenance while travelling, and back to a
              cut when you return. Targets follow the schedule automatically.
            </p>
          ) : (
            <div className="divide-y divide-line">
              {schedule.map((s) => (
                <ListRow
                  key={s.date}
                  icon={CalendarClock}
                  iconTone={s.date > today ? 'accent' : 'muted'}
                  wrapTitle
                  title={`${modeLabel(s.mode)} from ${fromDateKey(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  subtitle={s.date > today ? 'Upcoming' : 'In effect'}
                  value="Remove"
                  onClick={() => void removeSwitch(s.date)}
                />
              ))}
            </div>
          )}
          <div className="p-4 pt-3">
            {upcoming && (
              <p className="mb-3 text-[13px] text-muted">
                Next: {modeLabel(upcoming.mode)} on{' '}
                {fromDateKey(upcoming.date).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                })}
                .
              </p>
            )}
            <Button icon={CalendarClock} className="w-full" onClick={() => setAddingSwitch(true)}>
              Schedule a switch
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeading>Reminders</SectionHeading>
        <RemindersCard />
      </section>

      <section>
        <SectionHeading>Appearance</SectionHeading>
        <Segmented value={theme} options={THEMES} onChange={setTheme} />
      </section>

      <section>
        <SectionHeading>Your data</SectionHeading>
        <Card className="space-y-3 p-5">
          <p className="text-[14px] text-muted">
            {session
              ? 'A copy also lives in your account. Exports are still yours to keep.'
              : 'Everything lives on this phone. Export now and then, or sign in above for a cloud copy.'}
          </p>
          <div className="flex gap-2">
            <Button icon={FileSpreadsheet} className="flex-1" onClick={() => run('CSV', exportCsv)}>
              CSV
            </Button>
            <Button icon={FileJson} className="flex-1" onClick={() => run('Backup', exportBackup)}>
              Backup
            </Button>
          </div>
          <Button icon={FolderOpen} className="w-full" onClick={() => fileRef.current?.click()}>
            Restore a backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void pickBackup(e.target.files?.[0])}
          />
          {note && <p className="text-[13px] text-muted">{note}</p>}
        </Card>
      </section>

      <section>
        <SectionHeading>Foods and supplements</SectionHeading>
        <Card>
          <ListRow
            icon={Utensils}
            iconTone="accent"
            title="My foods"
            subtitle="Custom foods and scanned products"
            chevron
            onClick={() => navigate('/foods')}
          />
          <ListRow
            icon={CalendarRange}
            iconTone="accent"
            title="Plan the week"
            subtitle="Pick meals, scale portions, shop by aisle"
            chevron
            onClick={() => navigate('/plan')}
          />
          <ListRow
            icon={ChefHat}
            iconTone="accent"
            title="Recipes"
            subtitle="Batch cooking, portions in one tap"
            chevron
            onClick={() => navigate('/recipes')}
          />
          <ListRow
            icon={Pill}
            iconTone="accent"
            title="Supplements"
            subtitle="Your daily list and suggested doses"
            chevron
            onClick={() => navigate('/supplements')}
          />
          <ListRow
            icon={SearchX}
            iconTone="accent"
            title="Foods you couldn’t find"
            subtitle={
              misses.length === 0
                ? 'Nothing missing so far'
                : `${misses.length} ${misses.length === 1 ? 'search' : 'searches'} came up empty`
            }
            chevron
            onClick={() => setMissesOpen(true)}
          />
        </Card>
      </section>

      <Sheet open={missesOpen} onClose={() => setMissesOpen(false)} title="Foods you couldn’t find">
        {misses.length === 0 ? (
          <p className="text-[14px] text-muted">
            When a search finds nothing, offline or in Open Food Facts, it is remembered here so the
            database can grow from what you actually eat.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] text-muted">
              Add these as custom foods from the label, or send the list along so they can be seeded
              properly.
            </p>
            <Card className="divide-y divide-line">
              {misses.map((m) => (
                <SwipeRow key={m.q} onDelete={() => void forgetMiss(m.q)}>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1 truncate text-[16px]">{m.q}</span>
                    <span className="shrink-0 text-[13px] text-muted tabular">
                      {m.count > 1 ? `×${m.count} · ` : ''}
                      {m.date}
                    </span>
                  </div>
                </SwipeRow>
              ))}
            </Card>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                icon={FileSpreadsheet}
                onClick={() =>
                  void shareText(
                    'Kalib — foods not found',
                    misses.map((m) => m.q).join(String.fromCharCode(10)),
                  )
                }
              >
                Share list
              </Button>
              <Button onClick={() => void clearMisses()}>Clear</Button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={signOutOpen} onClose={() => setSignOutOpen(false)} title="Sign out">
        <div className="space-y-3">
          <p className="text-[14px] text-muted">
            Your log stays on this phone and in your account. Remove it from the phone only if
            someone else will use Kalib here.
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={async () => {
              const m = await import('@/services/sync/supabase');
              await m.signOut();
              setSignOutOpen(false);
            }}
          >
            Sign out, keep data on this phone
          </Button>
          <Button
            variant="danger"
            size="lg"
            className="w-full bg-danger/10"
            onClick={async () => {
              const m = await import('@/services/sync/supabase');
              await m.signOut();
              await resetThisPhone();
            }}
          >
            Sign out and remove this phone’s data
          </Button>
          <button
            type="button"
            className="block w-full pt-1 text-center text-[13px] text-muted underline-offset-2 hover:underline"
            onClick={() => {
              setSignOutOpen(false);
              setEraseWord('');
              setEraseOpen(true);
            }}
          >
            Delete my account and everything in it
          </button>
        </div>
      </Sheet>

      <Sheet open={eraseOpen} onClose={() => setEraseOpen(false)} title="Delete account">
        <div className="space-y-3">
          <p className="text-[14px] text-muted">
            This removes your account and every weigh-in, entry, recipe and setting from the server,
            right away and for good. Export a backup first if you want to keep any of it. The copy
            on this phone is removed too.
          </p>
          <input
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="Type DELETE to confirm"
            value={eraseWord}
            onChange={(e) => setEraseWord(e.target.value)}
            className="h-12 w-full rounded-full bg-surface px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-danger"
          />
          <Button
            variant="danger"
            size="lg"
            className="w-full bg-danger/10"
            disabled={eraseWord.trim().toUpperCase() !== 'DELETE' || eraseBusy}
            onClick={async () => {
              setEraseBusy(true);
              try {
                const m = await import('@/services/sync/supabase');
                await m.deleteAccount();
                await resetThisPhone();
              } catch (err) {
                setNote((err as Error).message);
                setEraseBusy(false);
                setEraseOpen(false);
              }
            }}
          >
            {eraseBusy ? 'Deleting…' : 'Delete account'}
          </Button>
        </div>
      </Sheet>

      <Sheet open={addingSwitch} onClose={() => setAddingSwitch(false)} title="Schedule a switch">
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-muted">From this date</span>
            <input
              type="date"
              value={switchDate}
              min={today}
              onChange={(e) => setSwitchDate(e.target.value)}
              className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <div className="space-y-2">
            <span className="block text-[13px] font-medium text-muted">Mode</span>
            <Segmented
              value={switchMode}
              options={[
                { value: 'CUT', label: 'Cut' },
                { value: 'MAINTAIN', label: 'Maintain' },
                { value: 'RECOMP', label: 'Recomp' },
                { value: 'BULK', label: 'Bulk' },
              ]}
              onChange={setSwitchMode}
            />
          </div>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={saveSwitch}
            disabled={!switchDate}
          >
            Save
          </Button>
        </div>
      </Sheet>

      <Sheet open={pending != null} onClose={() => setPending(null)} title="Restore this backup?">
        {pending && (
          <div className="space-y-4">
            <p className="text-[15px] leading-snug text-ink-2">
              From{' '}
              {pending.summary.exported_at
                ? pending.summary.exported_at.slice(0, 10)
                : 'an unknown date'}
              : {pending.summary.log_entries} log entries, {pending.summary.weigh_ins} weigh-ins,{' '}
              {pending.summary.foods} foods, {pending.summary.profiles} profile snapshots.
            </p>
            <p className="text-[14px] text-muted">
              Rows with the same id are replaced; everything else on this phone is kept.
            </p>
            <div className="flex gap-2">
              <Button size="lg" className="px-5" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={confirmRestore}
                disabled={restoring}
              >
                {restoring ? 'Restoring…' : 'Restore'}
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <section>
        <SectionHeading>About</SectionHeading>
        <Card className="space-y-2 p-5 text-[13px] leading-relaxed text-muted">
          <p className="flex items-start gap-2">
            <Database size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Nutrient data: U.S. Department of Agriculture, Agricultural Research Service, FoodData
              Central (Foundation Foods, SR Legacy). Packaged foods: Open Food Facts, Open Database
              License (ODbL).
            </span>
          </p>
          <p>Kalib {__APP_VERSION__}. Not medical advice.</p>
          <Button size="sm" icon={RefreshCw} onClick={checkForUpdate}>
            Check for updates
          </Button>
          {updateNote && <p>{updateNote}</p>}
        </Card>
      </section>
    </div>
  );
}

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function modeLabel(mode: Mode): string {
  return mode === 'CUT'
    ? 'Cut'
    : mode === 'MAINTAIN'
      ? 'Maintain'
      : mode === 'RECOMP'
        ? 'Recomp'
        : 'Bulk';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
