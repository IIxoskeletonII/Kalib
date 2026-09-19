// Create or edit a custom food (SPEC §8.1). Macros are entered per serving; the serving size
// becomes the food's first portion so it logs in one tap.
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { NumberPad } from '@/components/NumberPad';
import { Button, IconButton } from '@/components/ui';
import { todayKey } from '@/core/dates';
import { deleteFood, getFood } from '@/db/repo/foods';
import { createCustomFood, fromFood, updateCustomFood } from '@/services/customFoods';

type Field = 'serving_g' | 'kcal' | 'protein_g' | 'carb_g' | 'fat_g' | 'fiber_g';
const FIELDS: { key: Field; label: string; unit: string; color: string }[] = [
  { key: 'serving_g', label: 'Serving', unit: 'g', color: 'text-ink-2' },
  { key: 'kcal', label: 'Calories', unit: 'kcal', color: 'text-kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g', color: 'text-protein' },
  { key: 'carb_g', label: 'Carbs', unit: 'g', color: 'text-carb' },
  { key: 'fat_g', label: 'Fat', unit: 'g', color: 'text-fat' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g', color: 'text-fiber' },
];
type Values = Record<Field, string>;
const EMPTY: Values = {
  serving_g: '100',
  kcal: '',
  protein_g: '',
  carb_g: '',
  fat_g: '',
  fiber_g: '',
};

export default function FoodEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const date = params.get('d') ?? todayKey();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [values, setValues] = useState<Values>(EMPTY);
  const [focus, setFocus] = useState<Field>('kcal');
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getFood(id).then((food) => {
      if (!food || food.source !== 'custom') {
        navigate(-1);
        return;
      }
      const v = fromFood(food);
      setName(v.name);
      setBrand(v.brand ?? '');
      setValues({
        serving_g: String(v.serving_g),
        kcal: String(v.kcal),
        protein_g: String(v.protein_g),
        carb_g: String(v.carb_g),
        fat_g: String(v.fat_g),
        fiber_g: String(v.fiber_g),
      });
      setLoaded(true);
    });
  }, [id, navigate]);

  const num = (f: Field) => Number(values[f]) || 0;
  const canSave = name.trim().length > 0 && num('serving_g') > 0 && num('kcal') > 0;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      const input = {
        name,
        brand,
        serving_g: num('serving_g'),
        kcal: num('kcal'),
        protein_g: num('protein_g'),
        carb_g: num('carb_g'),
        fat_g: num('fat_g'),
        fiber_g: num('fiber_g'),
      };
      if (id) {
        await updateCustomFood(id, input);
        navigate(-1);
      } else {
        const food = await createCustomFood(input);
        navigate(`/log?d=${date}&q=${encodeURIComponent(food.name)}`, { replace: true });
      }
    } finally {
      setBusy(false);
    }
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
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">
            {id ? 'Edit food' : 'New food'}
          </h1>
          <p className="text-[13px] text-muted">
            Nutrition per serving, from the label or a recipe.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <input
          type="text"
          placeholder="Name — e.g. Gyro pita, Mum's lasagne"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          className="h-12 w-full rounded-full bg-surface px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
        <input
          type="text"
          placeholder="Brand or place (optional)"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          autoComplete="off"
          className="h-12 w-full rounded-full bg-surface px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Field">
        {FIELDS.map((f) => {
          const active = focus === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setFocus(f.key)}
              className={`card px-2 py-3 text-center transition-[box-shadow] duration-150 ${active ? 'ring-2 ring-accent' : 'active:bg-surface-2'}`}
            >
              <div className={`text-[12px] font-semibold ${f.color}`}>{f.label}</div>
              <div className="tabular text-[22px] font-bold leading-tight">
                {values[f.key] || <span className="text-surface-3">0</span>}
              </div>
              <div className="text-[11px] text-muted">{f.unit}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-auto space-y-3 pb-2">
        <NumberPad
          onChange={(u) => setValues((prev) => ({ ...prev, [focus]: u(prev[focus]) }))}
          onSubmit={nextField}
          decimal={focus !== 'kcal'}
          maxDigits={4}
        />
        <div className="flex gap-2">
          {id && (
            <IconButton
              icon={Trash2}
              label="Delete food"
              className="h-14 w-14 bg-surface-2 text-danger"
              onClick={async () => {
                await deleteFood(id);
                navigate('/foods', { replace: true });
              }}
            />
          )}
          <Button size="lg" icon={ChevronRight} onClick={nextField} className="px-4">
            Next
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={save}
            disabled={!canSave || busy}
            className="flex-1"
          >
            {id ? 'Save' : 'Save food'}
          </Button>
        </div>
      </div>
    </div>
  );
}
