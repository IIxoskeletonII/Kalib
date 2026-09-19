// Manual macros with no food behind them — the eating-out fallback until custom foods (v1).
// Logged as entry_method=manual, confidence=medium (SPEC §6, §7.4).
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { SLOT_LABEL } from '@/components/AmountSheet';
import { NumberPad } from '@/components/NumberPad';
import { Button, Chip } from '@/components/ui';
import { mealSlotForTime, todayKey } from '@/core/dates';
import { MEAL_SLOTS, type MealSlot } from '@/core/types';
import { deleteEntry, getEntry, updateEntry } from '@/db/repo/logEntries';
import { logManual } from '@/services/logging';

type Field = 'kcal' | 'protein_g' | 'carb_g' | 'fat_g' | 'fiber_g';
const FIELDS: { key: Field; label: string; unit: string }[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carb_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
];

type Values = Record<Field, string>;
const EMPTY: Values = { kcal: '', protein_g: '', carb_g: '', fat_g: '', fiber_g: '' };

export default function QuickAdd() {
  const [params] = useSearchParams();
  const { id } = useParams();
  const navigate = useNavigate();
  const date = params.get('d') ?? todayKey();

  const [name, setName] = useState('');
  const [slot, setSlot] = useState<MealSlot>(mealSlotForTime(new Date()));
  const [values, setValues] = useState<Values>(EMPTY);
  const [focus, setFocus] = useState<Field>('kcal');
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    if (!id) return;
    void getEntry(id).then((e) => {
      if (!e) {
        navigate(-1);
        return;
      }
      setName(e.name === 'Quick add' ? '' : e.name);
      setSlot(e.meal_slot);
      setValues({
        kcal: String(Math.round(e.kcal)),
        protein_g: String(Math.round(e.protein_g)),
        carb_g: String(Math.round(e.carb_g)),
        fat_g: String(Math.round(e.fat_g)),
        fiber_g: String(Math.round(e.fiber_g)),
      });
      setLoaded(true);
    });
  }, [id, navigate]);

  const num = (f: Field) => Number(values[f]) || 0;
  const canSave = num('kcal') > 0 || num('protein_g') > 0 || num('carb_g') > 0 || num('fat_g') > 0;

  const save = async () => {
    if (!canSave) return;
    const macros = {
      kcal: num('kcal'),
      protein_g: num('protein_g'),
      carb_g: num('carb_g'),
      fat_g: num('fat_g'),
      fiber_g: num('fiber_g'),
    };
    if (id) await updateEntry(id, { ...macros, name: name || 'Quick add', meal_slot: slot });
    else await logManual({ ...macros, name, meal_slot: slot, date });
    navigate(`/?d=${date}`, { replace: true });
  };

  const nextField = () => {
    const i = FIELDS.findIndex((f) => f.key === focus);
    const next = FIELDS[(i + 1) % FIELDS.length]!.key;
    setFocus(next);
  };

  if (!loaded) return null;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-11 w-11 shrink-0 rounded-full text-2xl text-muted"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          ‹
        </button>
        <input
          type="text"
          placeholder="Name (optional) — e.g. gyro"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          className="h-12 w-full rounded-xl bg-surface px-4 text-base outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {FIELDS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFocus(f.key)}
            className={`rounded-xl px-1 py-2 text-center ${focus === f.key ? 'bg-surface-2 ring-2 ring-accent' : 'bg-surface'}`}
          >
            <div className="text-[11px] text-muted">{f.label}</div>
            <div className="tabular text-lg font-semibold">
              {values[f.key] || <span className="text-line">0</span>}
            </div>
            <div className="text-[10px] text-muted">{f.unit}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {MEAL_SLOTS.map((s) => (
          <Chip key={s} active={slot === s} onClick={() => setSlot(s)} className="flex-1 px-0">
            {SLOT_LABEL[s]}
          </Chip>
        ))}
      </div>

      <div className="mt-auto space-y-3">
        <NumberPad
          onChange={(u) => setValues((prev) => ({ ...prev, [focus]: u(prev[focus]) }))}
          onSubmit={nextField}
          maxDigits={4}
        />
        <div className="flex gap-2">
          {id && (
            <Button
              variant="danger"
              className="px-3"
              onClick={async () => {
                await deleteEntry(id);
                navigate(`/?d=${date}`, { replace: true });
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={nextField} className="px-3">
            Next
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave} className="flex-1">
            {id ? 'Update' : 'Log'}
          </Button>
        </div>
        <p className="text-center text-xs text-muted">
          Saved as an estimate (medium confidence, no micronutrients).
        </p>
      </div>
    </div>
  );
}
