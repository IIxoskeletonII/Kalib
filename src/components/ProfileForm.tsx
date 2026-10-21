// One-time / rare form: native inputs are acceptable here (the §8 number-pad rule is about
// the logging paths, not settings).
import { AlertTriangle } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { ageOn, todayKey } from '@/core/dates';
import {
  bodyUnit,
  cmToFeetInches,
  entryText,
  feetInchesToCm,
  formatRate,
  fromBodyUnit,
  isPlausibleBodyWeight,
  isPlausibleHeight,
  isRateChoice,
  parseDecimal,
  RATE_CHOICES,
  toBodyUnit,
  waterTotalValue,
  waterUnit,
  type UnitSystem,
} from '@/core/measure';
import { computeTargets, type Targets } from '@/core/targets';
import type { ActivityLevel, Mode, Profile, Sex } from '@/core/types';
import type { ProfileInput } from '@/db/repo/profiles';
import { useUnitSystem } from '@/hooks/useUnits';
import { setUnitSystem } from '@/services/units';
import { UNIT_SYSTEM_HINT, UNIT_SYSTEM_OPTIONS } from './UnitsCard';
import { Button, Chip, Row, Segmented, fmt } from './ui';

export interface ProfileFormValues extends ProfileInput {
  weight_kg?: number | undefined;
  /** First name, used for the greeting and the account chip; stored as a setting. */
  name: string;
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
  { value: 'BULK', label: 'Bulk' },
];
const MODE_HINT: Record<Mode, string> = {
  CUT: 'Deficit sized to your goal rate, clamped to 10–25 %.',
  MAINTAIN: 'Eat at maintenance; protein held.',
  RECOMP: 'Small deficit (≤ 10 %), protein at the upper bound.',
  BULK: 'Lean surplus sized to your gain rate, clamped to 5–15 %.',
};
/** Shown only while the field is empty, in whatever order the phone writes dates. */
const BIRTH_EXAMPLE = new Date(1994, 4, 12).toLocaleDateString();
/** Nobody logging their macros was born today; this also blocks a stray future date. */
const MAX_BIRTH = todayKey();

export function ProfileForm({
  initial,
  initialName,
  askWeight,
  latestWeight,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Profile | undefined;
  initialName?: string | undefined;
  /** Onboarding also collects the first weigh-in. */
  askWeight: boolean;
  /** Latest weigh-in, for the preview when the form has no weight field. */
  latestWeight?: number | undefined;
  submitLabel: string;
  onSubmit: (values: ProfileFormValues) => Promise<void>;
  onCancel?: (() => void) | undefined;
}) {
  const units = useUnitSystem();
  const [name, setName] = useState(initialName ?? '');
  const [sex, setSex] = useState<Sex>(initial?.sex ?? 'male');
  const [birth, setBirth] = useState(initial?.birth_date ?? '');
  // Lengths and weights are held as typed, in the units on screen, and converted once on the
  // way out (§22). Each also remembers the stored value it opened on: a field nobody touched
  // saves exactly what was there, not its rounded conversion — 178 cm shown as 5 ft 10 in must
  // not come back as 177.8.
  const [height, setHeight] = useState<HeightFields>(() => heightFields(initial?.height_cm));
  const [weight, setWeight] = useState<BodyField>({ text: '' });
  const [bodyfat, setBodyfat] = useState(
    initial?.bodyfat_pct != null ? String(initial.bodyfat_pct) : '',
  );
  const [targetW, setTargetW] = useState<BodyField>(() =>
    bodyField(initial?.target_weight_kg, units),
  );
  const [activity, setActivity] = useState<ActivityLevel>(initial?.activity_level ?? 'light');
  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'CUT');
  // Untouched, a new profile's rate is the second chip of whichever units are showing: half a
  // kilo, or a pound, a week. A stored rate is kept as stored until a chip is tapped.
  const [chosenRate, setRate] = useState<number | undefined>(
    initial?.goal_rate_kg_per_week || undefined,
  );
  const rate = chosenRate ?? fromBodyUnit(RATE_CHOICES[units].cut[1]!, units);
  const [busy, setBusy] = useState(false);
  const ids = useId();

  // The units can change under the form: in onboarding from the switch at its top, and on any
  // screen when the first read of the setting lands after the form mounted. What was typed is
  // converted, not cleared, and an untouched field re-renders its stored value.
  const [shownIn, setShownIn] = useState<UnitSystem>(units);
  if (shownIn !== units) {
    setShownIn(units);
    setHeight((h) => convertHeight(h, shownIn));
    setWeight((w) => convertBody(w, shownIn, units));
    setTargetW((t) => convertBody(t, shownIn, units));
  }

  const n = (s: string) => parseDecimal(s);
  const values: ProfileFormValues | undefined = useMemo(() => {
    const h = heightCm(height, units);
    if (!birth || h == null || !isPlausibleHeight(h)) return undefined;
    const w = bodyKg(weight, units);
    if (askWeight && (w == null || !isPlausibleBodyWeight(w))) return undefined;
    const bf = n(bodyfat);
    const tw = bodyKg(targetW, units);
    if (bf == null && tw == null) return undefined;
    const v: ProfileFormValues = {
      name: name.trim(),
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
  }, [name, sex, birth, height, weight, bodyfat, targetW, activity, mode, rate, askWeight, units]);

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

  const rateChips = mode === 'BULK' ? RATE_CHOICES[units].bulk : RATE_CHOICES[units].cut;

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
      {/* Onboarding asks before the first number: every field below is typed in it. */}
      {askWeight && (
        <Field label="Units" hint={UNIT_SYSTEM_HINT[units]}>
          <Segmented
            value={units}
            options={UNIT_SYSTEM_OPTIONS}
            onChange={(u) => void setUnitSystem(u)}
          />
        </Field>
      )}

      <Field label="Your name" htmlFor={`${ids}-name`}>
        <input
          id={`${ids}-name`}
          type="text"
          autoComplete="given-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
          placeholder="Alex"
        />
      </Field>

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
        <Field label="Birth date" hint={birth ? undefined : `e.g. ${BIRTH_EXAMPLE}`}>
          <div className="relative">
            <input
              id={`${ids}-birth`}
              type="date"
              aria-label="Birth date"
              value={birth}
              max={MAX_BIRTH}
              onChange={(e) => setBirth(e.target.value)}
              className={`${INPUT} ${birth ? '' : 'text-transparent'}`}
              required
            />
            {!birth && (
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-[16px] text-muted">
                Tap to choose
              </span>
            )}
          </div>
        </Field>
        <Field label="Height" htmlFor={`${ids}-height`}>
          {units === 'us' ? (
            // Feet and inches, the way a US height is said and written on a licence.
            <div className="grid grid-cols-2 gap-2">
              <Unit unit="ft">
                <input
                  id={`${ids}-height`}
                  type="text"
                  inputMode="numeric"
                  aria-label="Height, feet"
                  value={height.feet}
                  onChange={(e) => setHeight(typed(height, { feet: e.target.value }))}
                  className={INPUT}
                  placeholder="5"
                />
              </Unit>
              <Unit unit="in">
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Height, inches"
                  value={height.inches}
                  onChange={(e) => setHeight(typed(height, { inches: e.target.value }))}
                  className={INPUT}
                  placeholder="9"
                />
              </Unit>
            </div>
          ) : (
            <Unit unit="cm">
              <input
                id={`${ids}-height`}
                type="text"
                inputMode="numeric"
                value={height.cm}
                onChange={(e) => setHeight(typed(height, { cm: e.target.value }))}
                className={INPUT}
                placeholder="e.g. 175"
              />
            </Unit>
          )}
        </Field>
        {askWeight && (
          <Field label="Weight today" htmlFor={`${ids}-weight`}>
            <Unit unit={bodyUnit(units)}>
              <input
                id={`${ids}-weight`}
                type="text"
                inputMode="decimal"
                value={weight.text}
                onChange={(e) => setWeight({ text: e.target.value })}
                className={INPUT}
                placeholder={units === 'us' ? 'e.g. 160' : 'e.g. 72.5'}
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
              placeholder="e.g. 22"
            />
          </Unit>
        </Field>
        <Field
          label={bodyfat.trim() ? 'Target weight (optional)' : 'Target weight'}
          htmlFor={`${ids}-tw`}
        >
          <Unit unit={bodyUnit(units)}>
            <input
              id={`${ids}-tw`}
              type="text"
              inputMode="decimal"
              value={targetW.text}
              onChange={(e) => setTargetW({ text: e.target.value })}
              className={INPUT}
              placeholder={units === 'us' ? 'e.g. 150' : 'e.g. 68'}
            />
          </Unit>
        </Field>
      </div>
      {!bodyfat.trim() && !targetW.text.trim() && (
        <p className="-mt-3 text-[13px] text-muted">
          Give either body fat or a target weight — protein is set from lean mass, or{' '}
          {units === 'us' ? '0.8 g per lb' : '1.8 g per kg'} of target.
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
        <Field
          label={mode === 'BULK' ? 'Gain per week' : 'Goal rate'}
          hint={
            rateChips.some((r) => isRateChoice(rate, r, units))
              ? undefined
              : `Now ${formatRate(rate, units)}.`
          }
        >
          <div className="grid grid-cols-4 gap-2">
            {rateChips.map((r) => (
              <Chip
                key={r}
                active={isRateChoice(rate, r, units)}
                onClick={() => setRate(fromBodyUnit(r, units))}
                wrap
                className="px-1"
              >
                <span className="font-medium">
                  {units === 'us' ? String(r) : r.toFixed((r * 1000) % 10 ? 3 : 2)}
                </span>
                <span className="text-[12px] opacity-75">{bodyUnit(units)} / wk</span>
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
          <Row
            label="Water"
            value={waterTotalValue(preview.water_ml, units)}
            sub={waterUnit(units)}
          />
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
  hint?: string | undefined;
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

// ---- §22: typed in the units on screen, stored metric ----------------------------------------

/** A body weight field: the text on screen, and the stored kilos it opened on, if any. */
interface BodyField {
  text: string;
  /** Set only while the text is the untouched rendering of a stored value. */
  stored?: number;
}

function bodyField(kg: number | undefined, s: UnitSystem): BodyField {
  return kg == null ? { text: '' } : { text: entryText(toBodyUnit(kg, s), 1), stored: kg };
}

function bodyKg(f: BodyField, s: UnitSystem): number | undefined {
  if (f.stored != null) return f.stored;
  const v = parseDecimal(f.text);
  return v == null ? undefined : fromBodyUnit(v, s);
}

function convertBody(f: BodyField, from: UnitSystem, to: UnitSystem): BodyField {
  if (f.stored != null) return bodyField(f.stored, to);
  const kg = bodyKg(f, from);
  return kg == null ? f : { text: entryText(toBodyUnit(kg, to), 1) };
}

/**
 * Height in both renderings at once — centimetres, and feet and inches — so switching units
 * shows the same height without a conversion step. `stored` is the value it opened on, kept
 * until a key is pressed.
 */
interface HeightFields {
  cm: string;
  feet: string;
  inches: string;
  stored?: number;
}

function heightFields(cm: number | undefined): HeightFields {
  if (cm == null) return { cm: '', feet: '', inches: '' };
  const fi = cmToFeetInches(cm);
  return { cm: entryText(cm, 1), feet: String(fi.feet), inches: String(fi.inches), stored: cm };
}

/** A keystroke: the field changes and the stored value no longer speaks for it. */
function typed(h: HeightFields, patch: Partial<Omit<HeightFields, 'stored'>>): HeightFields {
  return { cm: h.cm, feet: h.feet, inches: h.inches, ...patch };
}

function heightCm(h: HeightFields, s: UnitSystem): number | undefined {
  if (h.stored != null) return h.stored;
  if (s === 'metric') return parseDecimal(h.cm);
  const feet = parseDecimal(h.feet);
  const inches = parseDecimal(h.inches) ?? 0;
  return feet == null ? undefined : feetInchesToCm(feet, inches);
}

/** Re-renders what was typed in `from` so the other rendering shows the same height. */
function convertHeight(h: HeightFields, from: UnitSystem): HeightFields {
  if (h.stored != null) return h;
  const cm = heightCm(h, from);
  if (cm == null) return h;
  const fresh = heightFields(cm);
  return { cm: fresh.cm, feet: fresh.feet, inches: fresh.inches };
}
