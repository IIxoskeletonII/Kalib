// SPEC §9.4 — describe a meal (photo optional), get grounded items back, adjust, log.
import { Camera, ChevronLeft, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useBack } from '@/hooks/useBack';
import { useNavigate, useSearchParams } from 'react-router';
import { SLOT_LABEL } from '@/components/AmountSheet';
import { NumberPad } from '@/components/NumberPad';
import { Badge, Button, Card, IconButton, Segmented, Sheet, fmt } from '@/components/ui';
import { mealSlotForTime, todayKey } from '@/core/dates';
import { regroundItem, totalGrounded, type GroundedItem } from '@/core/estimate';
import { MEAL_SLOTS, type MealSlot } from '@/core/types';
import { captureImage } from '@/platform/camera';
import { estimateMeal, logEstimate, type EstimateOutcome } from '@/services/estimate';

const SLOT_OPTIONS = MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }));

type Phase =
  | { state: 'input' }
  | { state: 'busy' }
  | { state: 'error'; message: string }
  | { state: 'result'; outcome: EstimateOutcome; items: GroundedItem[] };

export default function Estimate() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const back = useBack('/');
  const date = params.get('d') ?? todayKey();
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [slot, setSlot] = useState<MealSlot>(mealSlotForTime(new Date()));
  const [phase, setPhase] = useState<Phase>({ state: 'input' });
  const [editing, setEditing] = useState<number | null>(null);
  const [logging, setLogging] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  const addPhoto = async () => {
    const file = await captureImage();
    if (!file) return;
    setPhoto({ file, url: URL.createObjectURL(file) });
    textRef.current?.focus();
  };

  const run = async () => {
    if (!description.trim() && !photo) return;
    setPhase({ state: 'busy' });
    try {
      const outcome = await estimateMeal(description, photo?.file);
      setPhase({ state: 'result', outcome, items: outcome.items });
    } catch (err) {
      setPhase({ state: 'error', message: (err as Error).message });
    }
  };

  const log = async () => {
    if (phase.state !== 'result' || phase.items.length === 0 || logging) return;
    setLogging(true);
    try {
      await logEstimate(phase.outcome, phase.items, slot, date, description);
      navigate(`/?d=${date}`, { replace: true });
    } finally {
      setLogging(false);
    }
  };

  const canRun = description.trim().length > 0 || photo != null;
  const total = phase.state === 'result' ? totalGrounded(phase.items) : undefined;

  return (
    <div className="flex h-full flex-col pb-6">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">
            Describe a meal
          </h1>
          <p className="text-[13px] text-muted">One line beats four searches.</p>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <div className="min-w-0 flex-1">
          <textarea
            ref={textRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            enterKeyHint="go"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void run();
              }
            }}
            placeholder={
              photo
                ? 'Anything I can’t see? Oil, butter, sauce, sugar?'
                : 'What did you eat? e.g. 2 eggs, toast with butter, a latte'
            }
            className="w-full resize-none rounded-[20px] bg-surface px-4 py-3 text-[16px] leading-snug outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
          />
        </div>
        {photo ? (
          <div className="relative h-[84px] w-[84px] shrink-0">
            <img src={photo.url} alt="" className="h-full w-full rounded-[18px] object-cover" />
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => setPhoto(null)}
              className="absolute -top-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-on-primary shadow"
            >
              <X size={14} strokeWidth={2.6} aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={addPhoto}
            aria-label="Add a photo"
            className="flex h-[84px] w-[84px] shrink-0 flex-col items-center justify-center gap-1 rounded-[18px] bg-surface text-[12px] font-semibold text-ink-2 transition-transform duration-200 active:scale-95"
          >
            <Camera size={22} strokeWidth={2} aria-hidden />
            Photo
          </button>
        )}
      </div>

      {phase.state !== 'result' && (
        <Button
          variant="primary"
          size="lg"
          icon={Sparkles}
          className="mt-3 w-full"
          disabled={!canRun || phase.state === 'busy'}
          onClick={run}
        >
          {phase.state === 'busy' ? 'Looking at it…' : 'Estimate'}
        </Button>
      )}

      {phase.state === 'error' && (
        <Card className="mt-3 p-4 text-[14px]">
          <p>{phase.message}</p>
          {phase.message.includes('OPENROUTER') && (
            <p className="mt-1 text-[13px] text-muted">
              The server needs an OpenRouter key:{' '}
              <code>npx wrangler secret put OPENROUTER_API_KEY</code>.
            </p>
          )}
        </Card>
      )}

      {phase.state === 'busy' && (
        <p className="mt-4 flex items-center gap-2 px-1 text-[14px] text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          Reading the description{photo ? ' and the photo' : ''}, then matching against your foods…
        </p>
      )}

      {phase.state === 'result' && total && (
        <div className="mt-4 flex-1">
          <Card className="divide-y divide-line">
            {phase.items.map((g, i) => (
              <div
                key={i}
                className="rise-in flex items-center gap-3 px-4 py-3"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setEditing(i)}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[16px] font-medium">{g.item.name}</span>
                    {g.kind === 'matched' ? (
                      <Badge tone="accent">
                        {g.food?.source === 'custom'
                          ? 'Mine'
                          : g.food?.source === 'off'
                            ? 'OFF'
                            : 'USDA'}
                      </Badge>
                    ) : (
                      <Badge tone="kcal">estimate</Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted tabular">
                    {fmt(g.grams)} g · {fmt(g.kcal_range[0])}–{fmt(g.kcal_range[1])} kcal
                    {g.food && ` · ${g.food.name.split(',').slice(0, 2).join(',')}`}
                  </span>
                </button>
                <span className="shrink-0 text-right">
                  <span className="block tabular text-[16px] font-semibold">{fmt(g.kcal)}</span>
                  <span className="block text-[12px] text-muted">kcal</span>
                </span>
                <IconButton
                  icon={Trash2}
                  label={`Remove ${g.item.name}`}
                  size={18}
                  className="-mr-2 h-9 w-9 text-muted"
                  onClick={() =>
                    setPhase({ ...phase, items: phase.items.filter((_, j) => j !== i) })
                  }
                />
              </div>
            ))}
          </Card>

          {(phase.outcome.result.hidden_ingredients_assumed.length > 0 ||
            phase.outcome.result.notes) && (
            <p className="mt-3 px-1 text-[13px] leading-snug text-muted">
              {phase.outcome.result.hidden_ingredients_assumed.length > 0 && (
                <>Assumed: {phase.outcome.result.hidden_ingredients_assumed.join(', ')}. </>
              )}
              {phase.outcome.result.notes}
            </p>
          )}

          <div className="mt-4 flex items-end justify-between px-1 tabular">
            <div>
              <div className="text-[13px] font-semibold text-muted">Total</div>
              <div className="text-[28px] leading-none font-bold tracking-[-0.02em]">
                {fmt(total.kcal)}
                <span className="ml-1 text-[14px] font-medium text-muted">kcal</span>
              </div>
              <div className="mt-1 text-[12px] text-muted">
                likely {fmt(total.lo)}–{fmt(total.hi)} · estimates carry +10%
              </div>
            </div>
            <div className="flex gap-2 pb-1 text-[12px] tabular">
              <span className="text-muted">
                <span className="font-medium text-protein">{fmt(total.protein_g)}</span> P
              </span>
              <span className="text-muted">
                <span className="font-medium text-carb">{fmt(total.carb_g)}</span> C
              </span>
              <span className="text-muted">
                <span className="font-medium text-fat">{fmt(total.fat_g)}</span> F
              </span>
              <span className="text-muted">
                <span className="font-medium text-fiber">{fmt(total.fiber_g)}</span> fib
              </span>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <Segmented value={slot} options={SLOT_OPTIONS} onChange={setSlot} />
            <div className="flex gap-2">
              <Button size="lg" onClick={() => setPhase({ state: 'input' })}>
                Redo
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                disabled={phase.items.length === 0 || logging}
                onClick={log}
              >
                Log {phase.items.length} {phase.items.length === 1 ? 'item' : 'items'} ·{' '}
                {fmt(total.kcal)} kcal
              </Button>
            </div>
          </div>
        </div>
      )}

      <Sheet
        open={editing != null}
        onClose={() => setEditing(null)}
        title={
          phase.state === 'result' && editing != null ? phase.items[editing]?.item.name : undefined
        }
      >
        {phase.state === 'result' && editing != null && phase.items[editing] && (
          <GramsForm
            key={editing}
            g={phase.items[editing]}
            onSave={(grams) => {
              const items = phase.items.map((it, j) =>
                j === editing ? regroundItem(it, grams) : it,
              );
              setPhase({ ...phase, items });
              setEditing(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function GramsForm({ g, onSave }: { g: GroundedItem; onSave: (grams: number) => void }) {
  const [value, setValue] = useState(String(Math.round(g.grams)));
  const [pristine, setPristine] = useState(true);
  const grams = Number(value) || 0;
  const preview = grams > 0 ? regroundItem(g, grams) : undefined;
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="display">
          {value === '' ? <span className="text-surface-3">0</span> : value}
          <span className="ml-1.5 text-[22px] font-medium text-muted">g</span>
        </div>
        {preview && (
          <div className="pb-2 text-right text-[15px] tabular">
            <span className="font-semibold">{fmt(preview.kcal)}</span>
            <span className="text-muted"> kcal</span>
            <span className="block text-[12px] text-muted">
              likely {fmt(preview.kcal_range[0])}–{fmt(preview.kcal_range[1])}
            </span>
          </div>
        )}
      </div>
      <p className="text-[13px] text-muted">
        The model guessed {fmt(g.item.grams_range[0])}–{fmt(g.item.grams_range[1])} g.
      </p>
      <NumberPad
        onChange={(u) => {
          setValue((prev) => u(pristine ? '' : prev));
          setPristine(false);
        }}
        onSubmit={() => grams > 0 && onSave(grams)}
        maxDigits={4}
      />
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={grams <= 0}
        onClick={() => onSave(grams)}
      >
        Use {fmt(grams)} g
      </Button>
    </div>
  );
}
