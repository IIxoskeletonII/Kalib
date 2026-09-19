// One-time / rare form: native inputs are acceptable here (the §8 number-pad rule is about
// the logging paths, not settings).
import { useMemo, useState, type ReactNode } from 'react';
import { ageOn, todayKey } from '@/core/dates';
import { computeTargets, type Targets } from '@/core/targets';
import type { ActivityLevel, Mode, Profile, Sex } from '@/core/types';
import type { ProfileInput } from '@/db/repo/profiles';
import { Button, Chip, Row, fmt } from './ui';

export interface ProfileFormValues extends ProfileInput {
  weight_kg?: number | undefined;
}

const ACTIVITY: { v: ActivityLevel; label: string; hint: string }[] = [
  { v: 'sedentary', label: 'Sedentary', hint: 'desk, little walking' },
  { v: 'light', label: 'Light', hint: '1–3 sessions/wk' },
  { v: 'moderate', label: 'Moderate', hint: '3–5 sessions/wk' },
  { v: 'heavy', label: 'Heavy', hint: '6–7 sessions/wk' },
];
const MODES: { v: Mode; label: string; hint: string }[] = [
  { v: 'CUT', label: 'Cut', hint: 'lose fat' },
  { v: 'MAINTAIN', label: 'Maintain', hint: 'hold weight' },
  { v: 'RECOMP', label: 'Recomp', hint: 'small deficit, max protein' },
];
const RATES = [0.25, 0.5, 0.75, 1.0];

export function ProfileForm({
  initial,
  askWeight,
  latestWeight,
  submitLabel,
  onSubmit,
}: {
  initial?: Profile | undefined;
  /** Onboarding also collects the first weigh-in. */
  askWeight: boolean;
  /** Latest weigh-in, for the preview when the form has no weight field. */
  latestWeight?: number | undefined;
  submitLabel: string;
  onSubmit: (values: ProfileFormValues) => Promise<void>;
}) {
  const [sex, setSex] = useState<Sex>(initial?.sex ?? 'male');
  const [birth, setBirth] = useState(initial?.birth_date ?? '');
  const [height, setHeight] = useState(initial ? String(initial.height_cm) : '');
  const [weight, setWeight] = useState('');
  const [bodyfat, setBodyfat] = useState(
    initial?.bodyfat_pct != null ? String(initial.bodyfat_pct) : '',
  );
  const [targetW, setTargetW] = useState(
    initial?.target_weight_kg != null ? String(initial.target_weight_kg) : '',
  );
  const [activity, setActivity] = useState<ActivityLevel>(initial?.activity_level ?? 'light');
  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'CUT');
  const [rate, setRate] = useState(initial?.goal_rate_kg_per_week ?? 0.5);
  const [busy, setBusy] = useState(false);

  const n = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const values: ProfileFormValues | undefined = useMemo(() => {
    const h = n(height);
    if (!birth || !h || h < 100 || h > 250) return undefined;
    const w = n(weight);
    if (askWeight && (!w || w < 20 || w > 400)) return undefined;
    const bf = n(bodyfat);
    const tw = n(targetW);
    if (bf == null && tw == null) return undefined;
    const v: ProfileFormValues = {
      sex,
      birth_date: birth,
      height_cm: h,
      activity_level: activity,
      mode,
      goal_rate_kg_per_week: mode === 'MAINTAIN' ? 0 : rate,
    };
    if (bf != null && bf > 0 && bf < 70) v.bodyfat_pct = bf;
    if (tw != null && tw > 0) v.target_weight_kg = tw;
    if (w != null) v.weight_kg = w;
    return v;
  }, [sex, birth, height, weight, bodyfat, targetW, activity, mode, rate, askWeight]);

  const preview: Targets | undefined = useMemo(() => {
    const w = values?.weight_kg ?? latestWeight;
    if (!values || w == null) return undefined;
    return computeTargets({
      sex: values.sex,
      age: ageOn(values.birth_date, todayKey()),
      height_cm: values.height_cm,
      weight_kg: w,
      bodyfat_pct: values.bodyfat_pct,
      activity_level: values.activity_level,
      mode: values.mode,
      goal_rate_kg_per_week: values.goal_rate_kg_per_week,
      target_weight_kg: values.target_weight_kg,
    });
  }, [values, latestWeight]);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!values || busy) return;
        setBusy(true);
        try {
          await onSubmit(values);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Sex">
        <div className="flex gap-2">
          <Chip active={sex === 'male'} onClick={() => setSex('male')} className="flex-1">
            Male
          </Chip>
          <Chip active={sex === 'female'} onClick={() => setSex('female')} className="flex-1">
            Female
          </Chip>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Birth date">
          <input
            type="date"
            value={birth}
            onChange={(e) => setBirth(e.target.value)}
            className={INPUT}
            required
          />
        </Field>
        <Field label="Height (cm)">
          <input
            type="text"
            inputMode="numeric"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className={INPUT}
            placeholder="186"
          />
        </Field>
        {askWeight && (
          <Field label="Weight today (kg)">
            <input
              type="text"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className={INPUT}
              placeholder="110.0"
            />
          </Field>
        )}
        <Field label="Body fat % (optional)">
          <input
            type="text"
            inputMode="decimal"
            value={bodyfat}
            onChange={(e) => setBodyfat(e.target.value)}
            className={INPUT}
            placeholder="e.g. 30"
          />
        </Field>
        <Field label={bodyfat.trim() ? 'Target weight (optional)' : 'Target weight (kg)'}>
          <input
            type="text"
            inputMode="decimal"
            value={targetW}
            onChange={(e) => setTargetW(e.target.value)}
            className={INPUT}
            placeholder="90"
          />
        </Field>
      </div>
      {!bodyfat.trim() && !targetW.trim() && (
        <p className="text-xs text-muted">
          Enter body fat % or a target weight — protein is set from lean mass, or 1.8 g/kg of target
          weight.
        </p>
      )}

      <Field label="Activity outside training">
        <div className="grid grid-cols-2 gap-2">
          {ACTIVITY.map((a) => (
            <Chip key={a.v} active={activity === a.v} onClick={() => setActivity(a.v)} wrap>
              <span>{a.label}</span>
              <span className="text-[11px] opacity-70">{a.hint}</span>
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Mode">
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <Chip
              key={m.v}
              active={mode === m.v}
              onClick={() => setMode(m.v)}
              wrap
              className="px-1"
            >
              <span>{m.label}</span>
              <span className="text-[11px] opacity-70">{m.hint}</span>
            </Chip>
          ))}
        </div>
      </Field>

      {mode !== 'MAINTAIN' && (
        <Field label="Goal rate (kg / week)">
          <div className="flex gap-2">
            {RATES.map((r) => (
              <Chip key={r} active={rate === r} onClick={() => setRate(r)} className="flex-1 px-0">
                {r.toFixed(2)}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      {preview && (
        <div className="rounded-2xl bg-surface p-4">
          <div className="mb-1 text-sm text-muted">
            Provisional targets · BMR {fmt(preview.bmr)} (
            {preview.bmr_method === 'mean'
              ? 'mean of formulas'
              : preview.bmr_method.replace('_', '-')}
            ){preview.bmr_uncertain && ' · estimate uncertain — replaced after calibration'}
          </div>
          <Row label="Calories" value={fmt(preview.kcal)} sub="kcal" />
          <Row label="Protein" value={fmt(preview.protein_g)} sub="g" />
          <Row label="Fiber" value={fmt(preview.fiber_g)} sub="g" />
          <Row label="Carbs" value={fmt(preview.carb_g)} sub="g" />
          <Row label="Fat" value={fmt(preview.fat_g)} sub="g" />
          <Row label="Water" value={fmt(preview.water_ml / 1000, 1)} sub="L" />
          {preview.floors_applied.length > 0 && (
            <p className="mt-1 text-xs text-kcal">
              Safety floor applied: {preview.floors_applied.join(', ')}
            </p>
          )}
        </div>
      )}

      <Button type="submit" variant="primary" className="w-full" disabled={!values || busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

const INPUT =
  'h-12 w-full rounded-xl bg-surface px-3 text-base outline-none placeholder:text-line focus:ring-2 focus:ring-accent';

// A <div>, not a <label>: a label's click would activate the first chip button inside it.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm text-muted">{label}</div>
      {children}
    </div>
  );
}
