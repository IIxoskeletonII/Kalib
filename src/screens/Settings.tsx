import { useState } from 'react';
import { ProfileForm } from '@/components/ProfileForm';
import { Button, Card, Row, fmt } from '@/components/ui';
import { todayKey } from '@/core/dates';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { useDailyTarget, useProfile, useWeighIns } from '@/hooks/useData';
import { exportCsv, exportJson } from '@/services/exportData';
import { refreshTargetForDate } from '@/services/targets';

export default function Settings() {
  const profile = useProfile();
  const weighIns = useWeighIns();
  const today = todayKey();
  const target = useDailyTarget(today);
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
    <div className="space-y-4 pb-20">
      <h1 className="text-lg font-semibold">Settings</h1>

      {target && (
        <Card>
          <div className="mb-1 text-sm text-muted">
            Today's targets · {target.provisional ? 'provisional (formula)' : 'measured'}
          </div>
          <Row label="Calories" value={fmt(target.kcal)} sub="kcal" />
          <Row label="Protein" value={fmt(target.protein_g)} sub="g" />
          <Row label="Fiber" value={fmt(target.fiber_g)} sub="g" />
          <Row label="Carbs" value={fmt(target.carb_g)} sub="g" />
          <Row label="Fat" value={fmt(target.fat_g)} sub="g" />
          <Row label="Water" value={fmt(target.water_ml / 1000, 1)} sub="L" />
          <Row label="Weekly budget" value={fmt(target.kcal * 7)} sub="kcal" />
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Profile</h2>
          {profile && !editing && (
            <Button className="h-9 px-3 text-sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        {profile && !editing && (
          <div className="text-sm text-muted">
            {profile.sex} · born {profile.birth_date} · {profile.height_cm} cm ·{' '}
            {profile.activity_level} · {profile.mode.toLowerCase()}
            {profile.mode !== 'MAINTAIN' && ` ${profile.goal_rate_kg_per_week} kg/wk`}
            {profile.bodyfat_pct != null && ` · ${profile.bodyfat_pct}% bf`}
            {profile.target_weight_kg != null && ` · target ${profile.target_weight_kg} kg`}
          </div>
        )}
        {profile && editing && (
          <ProfileForm
            initial={profile}
            askWeight={false}
            latestWeight={latestWeight}
            submitLabel="Save profile"
            onSubmit={async (values) => {
              // Snapshot, never mutate: history keeps the parameters that produced each target.
              await saveProfileSnapshot(values);
              await refreshTargetForDate(today);
              setEditing(false);
            }}
          />
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-medium">Your data</h2>
        <p className="text-sm text-muted">
          Everything lives on this device. Export regularly — there is no cloud copy yet.
        </p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => run('CSV', exportCsv)}>
            Export CSV
          </Button>
          <Button className="flex-1" onClick={() => run('Backup', exportJson)}>
            JSON backup
          </Button>
        </div>
        {note && <p className="text-sm text-muted">{note}</p>}
      </Card>

      <Card className="space-y-2 text-xs text-muted">
        <p>
          Nutrient data: U.S. Department of Agriculture, Agricultural Research Service. FoodData
          Central (Foundation Foods, SR Legacy). fdc.nal.usda.gov
        </p>
        <p>Kalib v{__APP_VERSION__} · not medical advice.</p>
      </Card>
    </div>
  );
}
