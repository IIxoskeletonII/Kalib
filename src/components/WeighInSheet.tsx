// SPEC §8: weigh-in <=5 s, number pad, no navigation.
//
// The sheet holds every measurement taken standing in the same spot at the same time of day, so
// the tape measure lives here rather than on a screen of its own: one segmented control swaps
// what the pad is editing, and the weight path is untouched — open, type, save.
import { Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  bodyFatBasis,
  isPlausibleWaist,
  relativeFatMass,
  WAIST_MAX_CM,
  WAIST_MIN_CM,
  waistToHeight,
  WHTR_HEALTHY_MAX,
} from '@/core/body';
import { cyclePhaseLabel } from '@/core/cycle';
import { clearWaist, deleteWeighIn, upsertWeighIn } from '@/db/repo/weighIns';
import { useCycle, useProfile, useWeighIns } from '@/hooks/useData';
import { addCycleStart, removeCycleStart } from '@/services/cycle';
import { NumberPad } from './NumberPad';
import { Button, IconButton, Segmented, Sheet } from './ui';

type Field = 'weight' | 'waist';

export interface WeighInSheetProps {
  open: boolean;
  date: string;
  onClose: () => void;
}

/**
 * The sheet reads its own measurements rather than taking them as props: it is opened from three
 * places (the Today tile, the Today page and the trend list) and each one would otherwise have
 * to derive the same four values — today's weight and waist, and the last known of each.
 */
export function WeighInSheet({ open, date, onClose }: WeighInSheetProps) {
  const weighIns = useWeighIns();
  const today = weighIns?.find((w) => w.date === date);
  const previous = weighIns?.filter((w) => w.date < date).at(-1);
  const previousWaist = weighIns?.filter((w) => w.date < date && w.waist_cm != null).at(-1);
  const measured: Measured = {
    current: today?.weight_kg,
    currentWaist: today?.waist_cm ?? undefined,
    previous: previous?.weight_kg,
    previousWaist: previousWaist?.waist_cm ?? undefined,
  };
  return (
    <Sheet open={open} onClose={onClose} title="Weigh-in">
      {/* The form mounts fresh each time the sheet opens, so its state starts from the store.
          Waiting for the weigh-ins to load keeps it from starting on an empty pad. */}
      {open && weighIns !== undefined && (
        <WeighInForm
          key={`${date}:${measured.current ?? ''}:${measured.currentWaist ?? ''}`}
          date={date}
          onClose={onClose}
          {...measured}
        />
      )}
    </Sheet>
  );
}

interface Measured {
  current?: number | undefined;
  currentWaist?: number | undefined;
  previous?: number | undefined;
  previousWaist?: number | undefined;
}

function WeighInForm({
  date,
  current,
  currentWaist,
  previous,
  previousWaist,
  onClose,
}: Measured & { date: string; onClose: () => void }) {
  const profile = useProfile();
  const cycle = useCycle(date);
  const [field, setField] = useState<Field>('weight');
  const [weight, setWeight] = useState(current != null ? String(current) : '');
  const [waist, setWaist] = useState(currentWaist != null ? String(currentWaist) : '');
  // "Pristine" means the shown value came from storage: the first keystroke replaces it rather
  // than appending to it, which is what a person expects from a pad.
  const [pristine, setPristine] = useState<Record<Field, boolean>>({
    weight: current != null,
    waist: currentWaist != null,
  });
  // Derived, not initialised: the cycle query can settle after this form mounts, and a stale
  // `false` here would make saving *delete* a start that was already logged. The override is
  // null until the person actually touches the row.
  const [periodOverride, setPeriodOverride] = useState<boolean | null>(null);
  const periodAlready = cycle.starts.includes(date);
  const periodToday = periodOverride ?? periodAlready;
  const [busy, setBusy] = useState(false);

  const value = field === 'weight' ? weight : waist;
  const setValue = field === 'weight' ? setWeight : setWaist;

  const type = (u: (prev: string) => string) => {
    setValue((prev) => u(pristine[field] ? '' : prev));
    setPristine((p) => ({ ...p, [field]: false }));
  };

  const kg = Number(weight);
  const weightValid = weight !== '' && Number.isFinite(kg) && kg >= 20 && kg <= 400;
  const cm = Number(waist);
  const waistFilled = waist !== '';
  const waistValid = waistFilled && Number.isFinite(cm) && isPlausibleWaist(cm);
  const canSave = weightValid && (!waistFilled || waistValid);

  const placeholder = field === 'weight' ? previous : previousWaist;
  const unit = field === 'weight' ? 'kg' : 'cm';
  const delta =
    field === 'weight'
      ? previous != null && weightValid
        ? kg - previous
        : undefined
      : previousWaist != null && waistValid
        ? cm - previousWaist
        : undefined;

  // What the tape measure says, in the two forms it is worth saying it in.
  const rfm =
    waistValid && profile ? relativeFatMass(profile.height_cm, cm, profile.sex) : undefined;
  const whtr = waistValid && profile ? waistToHeight(profile.height_cm, cm) : undefined;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      await upsertWeighIn(date, kg, waistValid ? { waist_cm: cm } : {});
      if (!waistFilled && currentWaist != null) await clearWaist(date);
      // Only act on a deliberate change, never on a default.
      if (cycle.enabled && periodOverride != null && periodOverride !== periodAlready) {
        if (periodOverride) await addCycleStart(date);
        else await removeCycleStart(date);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Segmented<Field>
        value={field}
        onChange={setField}
        options={[
          { value: 'weight', label: 'Weight' },
          { value: 'waist', label: 'Waist' },
        ]}
      />

      <div className="flex items-end justify-between">
        <div className="display">
          {value === '' ? (
            <span className="text-surface-3">
              {placeholder != null ? placeholder.toFixed(1) : field === 'weight' ? '0.0' : '--'}
            </span>
          ) : (
            value
          )}
          <span className="ml-1.5 text-[22px] font-medium text-muted">{unit}</span>
        </div>
        {delta != null && value !== '' && (
          <div className={`tabular text-[15px] ${delta <= 0 ? 'text-fiber' : 'text-fat'}`}>
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)} {unit} vs last
          </div>
        )}
      </div>

      <NumberPad onChange={type} onSubmit={save} decimal maxDigits={4} />

      {/* Why the tape is worth the extra five seconds, stated the moment it is used. */}
      {field === 'waist' && (
        <div className="space-y-1.5 text-[13px]">
          {rfm != null && whtr != null ? (
            <>
              <p className="text-ink-2">
                <span className="font-semibold">{rfm.toFixed(0)}% body fat</span>{' '}
                <span className="text-muted">
                  {bodyFatBasis({ pct: rfm, source: 'waist', waist_cm: cm })}
                </span>
              </p>
              <p className="text-muted">
                Waist is {Math.round(whtr * 100)}% of your height
                {whtr <= WHTR_HEALTHY_MAX ? ', inside the low-risk half' : '; under 50% is the aim'}
                .
              </p>
            </>
          ) : (
            <p className="text-muted">
              {waistFilled && !waistValid
                ? `A waist reading belongs between ${WAIST_MIN_CM} and ${WAIST_MAX_CM} cm.`
                : 'Measure at the navel, relaxed, after breathing out. It moves when the scale will not.'}
            </p>
          )}
        </div>
      )}

      {/* §4.1 — only once the person has asked for it in Settings. */}
      {cycle.enabled && (
        <button
          type="button"
          onClick={() => setPeriodOverride(!periodToday)}
          aria-pressed={periodToday}
          className="flex w-full items-center gap-3 rounded-[18px] bg-surface-2 px-4 py-3 text-left active:bg-surface-3"
        >
          {/* The same mark the supplement checklist uses, so a tick means one thing here. */}
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-200 ${
              periodToday ? 'border-accent bg-accent text-on-accent' : 'border-surface-3'
            }`}
          >
            {periodToday && <Check size={16} strokeWidth={3} aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block text-[15px]">Period started today</span>
            <span className="block text-[12px] text-muted">
              {cyclePhaseLabel(date, cycle.starts) ??
                'The trend will expect water retention around it'}
            </span>
          </span>
        </button>
      )}

      {/* A waist reading is stored on the day's weigh-in, so it needs the weight. Said as soon
          as the tape is opened rather than after typing, with the way out attached. */}
      {field === 'waist' && !weightValid && (
        <p className="text-[13px] text-muted">
          Saved with the day’s weight —{' '}
          <button
            type="button"
            className="font-semibold text-accent underline underline-offset-2"
            onClick={() => setField('weight')}
          >
            enter that first
          </button>
          .
        </p>
      )}

      <div className="flex gap-2">
        {current != null && (
          <IconButton
            icon={Trash2}
            label="Delete weigh-in"
            className="h-13 w-13 rounded-xl bg-surface-2 text-danger"
            onClick={async () => {
              await deleteWeighIn(date);
              onClose();
            }}
          />
        )}
        <Button variant="primary" size="lg" className="flex-1" disabled={!canSave} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
