// SPEC §9.7 — eating out. Photograph the menu, see what each dish costs you, log what you order.
//
// The one screen in the app that leads with a range instead of a number, because that is the
// truth about a restaurant plate and hiding it would make the number less useful, not more.
import { Camera, ChevronLeft, Utensils, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useBack } from '@/hooks/useBack';
import { toast } from '@/components/Toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Segmented,
  Spinner,
  fmt,
} from '@/components/ui';
import { MicButton } from '@/components/MicButton';
import { mealSlotForTime, todayKey } from '@/core/dates';
import type { GroundedItem } from '@/core/estimate';
import { MEAL_SLOTS, type MealSlot } from '@/core/types';
import { captureImage } from '@/platform/camera';
import { logEstimate } from '@/services/estimate';
import { dishRange, MENU_UNCERTAINTY, readMenu, type MenuOutcome } from '@/services/menu';

type Phase =
  | { state: 'input' }
  | { state: 'busy' }
  | { state: 'error'; message: string }
  | { state: 'result'; outcome: MenuOutcome };

const SLOT_OPTIONS = MEAL_SLOTS.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
}));

export default function Menu() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const back = useBack('/log');
  const date = params.get('d') ?? todayKey();
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [place, setPlace] = useState('');
  const [slot, setSlot] = useState<MealSlot>(mealSlotForTime(new Date()));
  const [phase, setPhase] = useState<Phase>({ state: 'input' });
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [logging, setLogging] = useState(false);

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
    setPhase({ state: 'input' });
  };

  const run = async () => {
    if (!photo) return;
    setPhase({ state: 'busy' });
    try {
      const outcome = await readMenu(photo.file, place);
      setChosen(new Set());
      setPhase({ state: 'result', outcome });
    } catch (err) {
      setPhase({ state: 'error', message: (err as Error).message });
    }
  };

  const toggle = (i: number) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const log = async () => {
    if (phase.state !== 'result' || chosen.size === 0 || logging) return;
    setLogging(true);
    try {
      const items = [...chosen]
        .sort((a, b) => a - b)
        .map((i) => phase.outcome.items[i])
        .filter((g): g is GroundedItem => g != null);
      await logEstimate(
        phase.outcome,
        items,
        slot,
        date,
        place.trim() ? `Menu at ${place.trim()}` : 'From a menu',
      );
      toast(`${items.length} ${items.length === 1 ? 'dish' : 'dishes'} logged`);
      navigate(`/?d=${date}`, { replace: true });
    } finally {
      setLogging(false);
    }
  };

  const items = phase.state === 'result' ? phase.outcome.items : [];
  const pickedKcal = [...chosen].reduce((n, i) => n + (items[i]?.kcal ?? 0), 0);

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">Eating out</h1>
          <p className="text-[13px] text-muted">Photograph the menu, log what you order.</p>
        </div>
      </div>

      {phase.state !== 'result' && (
        <>
          <div className="mt-4 flex gap-3">
            {photo ? (
              <div className="relative h-[120px] w-[120px] shrink-0">
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
                aria-label="Photograph the menu"
                className="flex h-[120px] w-[120px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[18px] bg-surface text-[13px] font-semibold text-ink-2 transition-transform duration-200 active:scale-95"
              >
                <Camera size={26} strokeWidth={2} aria-hidden />
                Menu
              </button>
            )}
            <div className="relative min-w-0 flex-1">
              <textarea
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                rows={3}
                placeholder="Where is this? A name or a cuisine narrows the guesswork."
                className="h-[120px] w-full resize-none rounded-[20px] bg-surface px-4 py-3 pb-12 text-[15px] leading-snug outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
              />
              <MicButton
                className="absolute right-2 bottom-2"
                label="Say where you are"
                onText={(text) => setPlace(text)}
              />
            </div>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="mt-4 w-full"
            disabled={!photo || phase.state === 'busy'}
            onClick={run}
          >
            {phase.state === 'busy' ? (
              <>
                <Spinner size={16} /> Reading the menu
              </>
            ) : (
              'Read the menu'
            )}
          </Button>

          {phase.state === 'error' && (
            <p className="mt-3 px-1 text-[13px] text-danger">{phase.message}</p>
          )}

          {!photo && phase.state === 'input' && (
            <EmptyState
              icon={Utensils}
              title="A restaurant plate is a guess"
              body={`No database holds an independent kitchen's recipes, so every figure here carries about a fifth either way. That beats logging nothing, and it is shown rather than hidden.`}
            />
          )}
        </>
      )}

      {phase.state === 'result' && (
        <>
          <p className="mt-4 px-1 text-[13px] leading-snug text-muted">
            {items.length} {items.length === 1 ? 'dish' : 'dishes'} read. Every figure is a range:
            restaurants vary by about {Math.round(MENU_UNCERTAINTY * 100)}% either way, and often
            more. Pick what you are having.
          </p>

          <Card className="mt-3 divide-y divide-line">
            {items.map((g, i) => {
              const range = dishRange(g);
              const picked = chosen.has(i);
              return (
                <button
                  key={`${g.item.name}-${i}`}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => toggle(i)}
                  className={`rise-in flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ${
                    picked ? 'bg-accent/10' : 'active:bg-surface-2'
                  }`}
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <span className="min-w-0 flex-1">
                    {/* A menu is read for its dish names; the badge moves down rather than
                        squeezing the one thing the row exists to say. */}
                    <span className="block text-[16px] leading-snug font-medium">
                      {g.item.name}
                    </span>
                    {/* One line, always: the badge leads and the macros clip, so every row in
                        the list has the same two-line rhythm whatever the dish is called. */}
                    <span className="mt-1 flex items-center gap-2 text-[13px] text-muted">
                      {g.kind === 'matched' ? (
                        <Badge tone="accent">database</Badge>
                      ) : (
                        <Badge>estimate</Badge>
                      )}
                      {/* Calories are the column on the right and protein is the other number
                          that decides an order; fiber is detail, and detail that clips is worse
                          than detail left for the log. */}
                      <span className="truncate tabular">
                        {fmt(g.grams)} g · {fmt(g.protein_g)} g protein
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular text-[16px] font-semibold">
                      {fmt(range.low)}–{fmt(range.high)}
                    </span>
                    <span className="block text-[12px] text-muted">kcal</span>
                  </span>
                </button>
              );
            })}
          </Card>

          {phase.outcome.result.hidden_ingredients_assumed.length > 0 && (
            <p className="mt-3 px-1 text-[13px] leading-snug text-muted">
              Counted what the kitchen adds and the menu does not mention:{' '}
              {phase.outcome.result.hidden_ingredients_assumed.join(', ')}.
            </p>
          )}
          {phase.outcome.result.notes && (
            <p className="mt-2 px-1 text-[13px] leading-snug text-muted">
              {phase.outcome.result.notes}
            </p>
          )}

          <div className="mt-5">
            <Segmented value={slot} options={SLOT_OPTIONS} onChange={setSlot} />
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              disabled={chosen.size === 0 || logging}
              onClick={log}
            >
              {logging
                ? 'Logging'
                : chosen.size === 0
                  ? 'Pick a dish'
                  : `Log ${chosen.size} · ${fmt(pickedKcal)} kcal`}
            </Button>
            <Button size="lg" onClick={() => setPhase({ state: 'input' })}>
              Retake
            </Button>
          </div>

          <p className="mt-4 px-1 text-[12px] leading-snug text-muted">
            Logged as a medium-confidence estimate, so your measured burn stays honest about it.
            Adjust the amount on Today if the plate turned out bigger than it looked.
          </p>
        </>
      )}
    </div>
  );
}
