// Manual macros with no food behind them — the eating-out fallback until custom foods (v1).
// Logged as entry_method=manual, confidence=medium (SPEC §6, §7.4).
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { SLOT_LABEL } from '@/components/AmountSheet';
import { NumberPad } from '@/components/NumberPad';
import { Button, IconButton, Segmented } from '@/components/ui';
import { mealSlotForTime, todayKey } from '@/core/dates';
import { MEAL_SLOTS, type MealSlot } from '@/core/types';
import { deleteEntry, getEntry, updateEntry } from '@/db/repo/logEntries';
import { logManual } from '@/services/logging';

type Field = 'kcal' | 'protein_g' | 'carb_g' | 'fat_g' | 'fiber_g';
const FIELDS: { key: Field; label: string; unit: string; color: string }[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', color: 'text-kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g', color: 'text-protein' },
  { key: 'carb_g', label: 'Carbs', unit: 'g', color: 'text-carb' },
  { key: 'fat_g', label: 'Fat', unit: 'g', color: 'text-fat' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g', color: 'text-fiber' },
];

type Values = Record<Field, string>;
const EMPTY: Values = { kcal: '', protein_g: '', carb_g: '', fat_g: '', fiber_g: '' };
const SLOT_OPTIONS = MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }));

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
    setFocus(FIELDS[(i + 1) % FIELDS.length]!.key);
  };

  if (!loaded) return null;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={() => navigate(-1)} />
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold leading-tight">
            {id ? 'Edit entry' : 'Quick add'}
          </h1>
          <p className="text-[13px] text-muted">Logged as an estimate, without micronutrients.</p>
        </div>
      </div>

      <input
        type="text"
        placeholder="Name (optional) — e.g. gyro"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
        className="h-12 w-full rounded-xl bg-surface px-4 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
      />

      <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Field">
        {FIELDS.map((f) => {
          const active = focus === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setFocus(f.key)}
              className={`rounded-xl px-1 py-2.5 text-center transition-[background-color,box-shadow] duration-150 ${
                active ? 'bg-surface ring-2 ring-accent' : 'bg-surface active:bg-surface-2'
              }`}
            >
              <div className={`text-[11px] font-medium ${f.color}`}>{f.label}</div>
              <div className="tabular text-[20px] font-semibold leading-tight">
                {values[f.key] || <span className="text-surface-3">0</span>}
              </div>
              <div className="text-[10px] text-muted">{f.unit}</div>
            </button>
          );
        })}
      </div>

      <Segmented value={slot} options={SLOT_OPTIONS} onChange={setSlot} />

      <div className="mt-auto space-y-3 pb-2">
        <NumberPad
          onChange={(u) => setValues((prev) => ({ ...prev, [focus]: u(prev[focus]) }))}
          onSubmit={nextField}
          maxDigits={4}
        />
        <div className="flex gap-2">
          {id && (
            <IconButton
              icon={Trash2}
              label="Delete entry"
              className="h-13 w-13 rounded-xl bg-surface-2 text-danger"
              onClick={async () => {
                await deleteEntry(id);
                navigate(`/?d=${date}`, { replace: true });
              }}
            />
          )}
          <Button size="lg" icon={ChevronRight} onClick={nextField} className="px-4">
            Next
          </Button>
          <Button variant="primary" size="lg" onClick={save} disabled={!canSave} className="flex-1">
            {id ? 'Update' : 'Log'}
            {num('kcal') > 0 ? ` · ${num('kcal')} kcal` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}
