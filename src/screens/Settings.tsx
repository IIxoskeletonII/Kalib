import {
  Database,
  FileJson,
  FileSpreadsheet,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { ProfileForm } from '@/components/ProfileForm';
import { Button, Card, ListRow, Row, SectionHeading, Segmented, fmt } from '@/components/ui';
import { todayKey } from '@/core/dates';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { useDailyTarget, useProfile, useWeighIns } from '@/hooks/useData';
import { useTheme, type ThemePref } from '@/hooks/useTheme';
import { exportCsv, exportJson } from '@/services/exportData';
import { refreshTargetForDate } from '@/services/targets';

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
  const latestWeight = weighIns?.at(-1)?.weight_kg;

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
              askWeight={false}
              latestWeight={latestWeight}
              submitLabel="Save profile"
              onCancel={() => setEditing(false)}
              onSubmit={async (values) => {
                // Snapshot, never mutate: history keeps the parameters that produced each target.
                await saveProfileSnapshot(values);
                await refreshTargetForDate(today);
                setEditing(false);
              }}
            />
          )}
        </Card>
      </section>

      <section>
        <SectionHeading>Appearance</SectionHeading>
        <Segmented value={theme} options={THEMES} onChange={setTheme} />
      </section>

      <section>
        <SectionHeading>Your data</SectionHeading>
        <Card className="space-y-3 p-5">
          <p className="text-[14px] text-muted">
            Everything lives on this phone. Export now and then; there is no cloud copy yet.
          </p>
          <div className="flex gap-2">
            <Button icon={FileSpreadsheet} className="flex-1" onClick={() => run('CSV', exportCsv)}>
              CSV
            </Button>
            <Button icon={FileJson} className="flex-1" onClick={() => run('Backup', exportJson)}>
              Backup
            </Button>
          </div>
          {note && <p className="text-[13px] text-muted">{note}</p>}
        </Card>
      </section>

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

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
