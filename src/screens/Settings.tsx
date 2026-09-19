import { Database, FileJson, FileSpreadsheet, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { useState } from 'react';
import { ProfileForm } from '@/components/ProfileForm';
import { Button, Card, ListRow, Row, SectionLabel, Segmented, fmt } from '@/components/ui';
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
  const latestWeight = weighIns?.at(-1)?.weight_kg;

  const run = async (label: string, fn: () => Promise<'shared' | 'downloaded'>) => {
    try {
      const how = await fn();
      setNote(`${label} ${how === 'shared' ? 'shared' : 'downloaded'}.`);
    } catch (err) {
      setNote(`${label} failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-5 pb-24">
      <header>
        <h1 className="text-[22px] font-semibold leading-tight">Settings</h1>
      </header>

      {target && (
        <section>
          <SectionLabel trailing={target.provisional ? 'provisional' : 'measured'}>
            Today's targets
          </SectionLabel>
          <Card className="py-2">
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
        <SectionLabel>Profile</SectionLabel>
        <Card className={editing ? '' : 'p-0'}>
          {profile && !editing && (
            <ListRow
              icon={UserRound}
              onClick={() => setEditing(true)}
              wrapTitle
              title={`${profile.sex === 'male' ? 'Male' : 'Female'}, ${profile.height_cm} cm, born ${profile.birth_date.slice(0, 4)}`}
              subtitle={`${cap(profile.activity_level)} · ${cap(profile.mode.toLowerCase())}${
                profile.mode !== 'MAINTAIN' ? ` ${profile.goal_rate_kg_per_week} kg/wk` : ''
              }${profile.bodyfat_pct != null ? ` · ${profile.bodyfat_pct}% body fat` : ''}${
                profile.target_weight_kg != null ? ` · target ${profile.target_weight_kg} kg` : ''
              }`}
              value="Edit"
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
        <SectionLabel>Appearance</SectionLabel>
        <Segmented value={theme} options={THEMES} onChange={setTheme} />
      </section>

      <section>
        <SectionLabel>Your data</SectionLabel>
        <Card className="space-y-3">
          <p className="text-[14px] text-muted">
            Everything lives on this device. Export regularly — there is no cloud copy yet.
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
        <SectionLabel>About</SectionLabel>
        <Card className="space-y-2 text-[12px] leading-relaxed text-muted">
          <p className="flex items-start gap-2">
            <Database size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Nutrient data: U.S. Department of Agriculture, Agricultural Research Service, FoodData
              Central (Foundation Foods, SR Legacy). Packaged foods: Open Food Facts, Open Database
              License (ODbL).
            </span>
          </p>
          <p>Kalib v{__APP_VERSION__} · not medical advice.</p>
        </Card>
      </section>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
