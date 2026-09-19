// One-time / rare form: native inputs are acceptable here (the §8 number-pad rule is about
// the logging paths, not settings).
import { AlertTriangle } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { ageOn, todayKey } from '@/core/dates';
import { computeTargets, type Targets } from '@/core/targets';
import type { ActivityLevel, Mode, Profile, Sex } from '@/core/types';
import type { ProfileInput } from '@/db/repo/profiles';
import { Button, Chip, Row, Segmented, fmt } from './ui';

export interface ProfileFormValues extends ProfileInput {
  weight_kg?: number | undefined;
}

const ACTIVITY: { v: ActivityLevel; label: string; hint: string }[] = [
  { v: 'sedentary', label: 'Sedentary', hint: 'desk, little walking' },
  { v: 'light', label: 'Light', hint: '1–3 sessions / wk' },
  { v: 'moderate', label: 'Moderate', hint: '3–5 sessions / wk' },
  { v: 'heavy', label: 'Heavy', hint: '6–7 sessions / wk' },
];
const MODES: { value: Mode; label: string }[] = [
  { value: 'CUT', label: 'Cut' },
  { value: 'MAINTAIN', label: 'Maintain' },
  { value: 'RECOMP', label: 'Recomp' },
];
const MODE_HINT: Record<Mode, string> = {
  CUT: 'Deficit sized to your goal rate, clamped to 10–25 %.',
  MAINTAIN: 'Eat at maintenance; protein held.',
  RECOMP: 'Small deficit (≤ 10 %), protein at the upper bound.',
};
const RATES = [0.25, 0.5, 0.75, 1.0];

export function ProfileForm({
  initial,
  askWeight,
  latestWeight,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Profile | undefined;
  /** Onboarding also collects the first weigh-in. */
  askWeight: boolean;
  /** Latest weigh-in, for the preview when the form has no weight field. */
  latestWeight?: number | undefined;
  submitLabel: string;
  onSubmit: (values: ProfileFormValues) => Promise<void>;
  onCancel?: (() => void) | undefined;
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
  const [rate, setRate] = useState(initial?.goal_rate_kg_per_week || 0.5);
  const [busy, setBusy] = useState(false);
  const ids = useId();

  const n = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));
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
      className="space-y-6"
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
        <Segmented
          value={sex}
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
          onChange={setSex}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Birth date" htmlFor={`${ids}-birth`}>
          <input
            id={`${ids}-birth`}
            type="date"
            value={birth}
            onChange={(e) => setBirth(e.target.value)}
            className={INPUT}
            required
          />
        </Field>
        <Field label="Height" htmlFor={`${ids}-height`}>
          <Unit unit="cm">
            <input
              id={`${ids}-height`}
              type="text"
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className={INPUT}
              placeholder="186"
            />
          </Unit>
        </Field>
        {askWeight && (
          <Field label="Weight today" htmlFor={`${ids}-weight`}>
            <Unit unit="kg">
              <input
                id={`${ids}-weight`}
                type="text"
                inputMode="decimal"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className={INPUT}
                placeholder="110.0"
              />
            </Unit>
          </Field>
        )}
        <Field label="Body fat (optional)" htmlFor={`${ids}-bf`}>
          <Unit unit="%">
            <input
              id={`${ids}-bf`}
              type="text"
              inputMode="decimal"
              value={bodyfat}
              onChange={(e) => setBodyfat(e.target.value)}
              className={INPUT}
              placeholder="30"
            />
          </Unit>
        </Field>
        <Field
          label={bodyfat.trim() ? 'Target weight (optional)' : 'Target weight'}
          htmlFor={`${ids}-tw`}
        >
          <Unit unit="kg">
            <input
              id={`${ids}-tw`}
              type="text"
              inputMode="decimal"
              value={targetW}
              onChange={(e) => setTargetW(e.target.value)}
              className={INPUT}
              placeholder="90"
            />
          </Unit>
        </Field>
      </div>
      {!bodyfat.trim() && !targetW.trim() && (
        <p className="-mt-3 text-[13px] text-muted">
          Give either body fat or a target weight — protein is set from lean mass, or 1.8 g per kg
          of target.
        </p>
      )}

      <Field label="Activity outside training">
        <div className="grid grid-cols-2 gap-2">
          {ACTIVITY.map((a) => (
            <Chip key={a.v} active={activity === a.v} onClick={() => setActivity(a.v)} wrap>
              <span className="font-medium">{a.label}</span>
              <span className="text-[12px] opacity-75">{a.hint}</span>
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Mode" hint={MODE_HINT[mode]}>
        <Segmented value={mode} options={MODES} onChange={setMode} />
      </Field>

      {mode !== 'MAINTAIN' && (
        <Field label="Goal rate">
          <div className="grid grid-cols-4 gap-2">
            {RATES.map((r) => (
              <Chip key={r} active={rate === r} onClick={() => setRate(r)} wrap className="px-1">
                <span className="font-medium">{r.toFixed(2)}</span>
                <span className="text-[12px] opacity-75">kg / wk</span>
              </Chip>
            ))}
          </div>
        </Field>
      )}

      {preview && (
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="mb-1 text-[13px] text-muted">
            Provisional targets. BMR {fmt(preview.bmr)} kcal (
            {preview.bmr_method === 'mean'
              ? 'mean of formulas'
              : preview.bmr_method === 'katch_mcardle'
                ? 'Katch-McArdle'
                : 'Mifflin-St Jeor'}
            )
          </div>
          <Row label="Calories" value={fmt(preview.kcal)} sub="kcal" />
          <Row label="Protein" value={fmt(preview.protein_g)} sub="g" />
          <Row label="Fiber" value={fmt(preview.fiber_g)} sub="g" />
          <Row label="Carbs" value={fmt(preview.carb_g)} sub="g" />
          <Row label="Fat" value={fmt(preview.fat_g)} sub="g" />
          <Row label="Water" value={fmt(preview.water_ml / 1000, 1)} sub="L" />
          {preview.bmr_uncertain && (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-kcal">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              The two BMR formulas disagree by more than 10 % — this estimate is uncertain and is
              replaced after calibration.
            </p>
          )}
          {preview.floors_applied.length > 0 && (
            <p className="mt-2 text-[12px] text-kcal">
              Safety floor applied: {preview.floors_applied.join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" size="lg" onClick={onCancel} className="px-5">
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="flex-1"
          disabled={!values || busy}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

const INPUT =
  'h-12 w-full rounded-xl bg-surface-2 px-4 text-[16px] tabular outline-none placeholder:text-muted/60 focus:ring-2 focus:ring-accent';

// A <div>, not a <label>: a label's click would activate the first chip button inside it.
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-muted">
          {label}
        </label>
      ) : (
        <div className="text-[13px] font-medium text-muted">{label}</div>
      )}
      {children}
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

function Unit({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[14px] text-muted">
        {unit}
      </span>
    </div>
  );
}
