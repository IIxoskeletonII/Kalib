// SPEC §17.2–17.3 — manage the supplement list. Add from the catalogue (dose worked out for
// this person, with its basis) or by hand; edit dose, unit and timing; remove.
import { ChevronLeft, Pill, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useBack } from '@/hooks/useBack';
import { NumberPad } from '@/components/NumberPad';
import { SwipeRow } from '@/components/SwipeRow';
import { toast } from '@/components/Toast';
import { Button, Card, EmptyState, IconButton, ListRow, Segmented, Sheet } from '@/components/ui';
import {
  SUPPLEMENT_CATALOGUE,
  TIMING_LABEL,
  UNIT_OPTIONS,
  catalogueItem,
  doseWarning,
  factorNote,
  formatDose,
  type CatalogueItem,
  type DoseGuide,
  type Person,
} from '@/core/supplements';
import type { Supplement, SupplementTiming, SupplementUnit } from '@/core/types';
import { deleteSupplement, restoreSupplement } from '@/db/repo/supplements';
import { usePerson, useSupplements } from '@/hooks/useData';
import { createSupplement, editSupplement, type SupplementDraft } from '@/services/supplements';

type Editing =
  { kind: 'new'; item: CatalogueItem | undefined } | { kind: 'edit'; supplement: Supplement };

const TIMING_OPTIONS = (Object.keys(TIMING_LABEL) as SupplementTiming[]).map((t) => ({
  value: t,
  label: TIMING_LABEL[t],
}));

export default function Supplements() {
  const back = useBack('/settings');
  const supplements = useSupplements();
  const person = usePerson();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const have = new Set(supplements?.map((s) => s.catalogue_id).filter(Boolean));

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">Supplements</h1>
          <p className="text-[13px] text-muted">Tap one to change its dose.</p>
        </div>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setPicking(true)}>
          Add
        </Button>
      </div>

      {supplements && supplements.length === 0 && (
        <EmptyState
          icon={Pill}
          title="Nothing on the list yet"
          body="Add what you take and it shows up on Today as a checklist, with a dose worked out for you."
          action={
            <Button variant="primary" icon={Plus} onClick={() => setPicking(true)}>
              Add a supplement
            </Button>
          }
        />
      )}

      {supplements && supplements.length > 0 && (
        <Card className="mt-5 divide-y divide-line">
          {supplements.map((s) => {
            const guide = person ? catalogueItem(s.catalogue_id)?.recommend(person) : undefined;
            const warn = guide ? doseWarning(s.dose, guide) : undefined;
            return (
              <SwipeRow
                key={s.id}
                onDelete={() => {
                  void deleteSupplement(s.id).then(() =>
                    toast(`${s.name} removed`, {
                      label: 'Undo',
                      run: () => restoreSupplement(s.id),
                    }),
                  );
                }}
              >
                <ListRow
                  onClick={() => setEditing({ kind: 'edit', supplement: s })}
                  icon={Pill}
                  iconTone="accent"
                  title={s.name}
                  subtitle={
                    warn ??
                    (guide && guide.dose !== s.dose
                      ? `${TIMING_LABEL[s.timing]} · suggested ${formatDose(guide.dose, guide.unit)}`
                      : TIMING_LABEL[s.timing])
                  }
                  value={formatDose(s.dose, s.unit)}
                  chevron
                />
              </SwipeRow>
            );
          })}
        </Card>
      )}

      <p className="mt-4 px-2 text-[12px] leading-snug text-muted">
        Suggested doses come from public reference intakes (NIH ODS, EFSA, ISSN) for healthy adults.
        General guidance, not medical advice.
      </p>

      <Sheet open={picking} onClose={() => setPicking(false)} title="Add a supplement">
        <div className="card divide-y divide-line">
          {SUPPLEMENT_CATALOGUE.map((item) => {
            const guide = person ? item.recommend(person) : undefined;
            return (
              <ListRow
                key={item.id}
                onClick={() => {
                  setPicking(false);
                  setEditing({ kind: 'new', item });
                }}
                title={item.name}
                subtitle={item.tagline}
                badge={
                  have.has(item.id) ? (
                    <span className="text-[12px] text-muted">added</span>
                  ) : undefined
                }
                value={guide ? formatDose(guide.dose, guide.unit) : undefined}
                valueSub={guide ? 'for you' : undefined}
              />
            );
          })}
          <ListRow
            onClick={() => {
              setPicking(false);
              setEditing({ kind: 'new', item: undefined });
            }}
            icon={Plus}
            title="Something else"
            subtitle="Name, dose and unit by hand"
          />
        </div>
      </Sheet>

      <Sheet
        open={editing != null}
        onClose={() => setEditing(null)}
        title={
          editing?.kind === 'edit' ? 'Edit supplement' : (editing?.item?.name ?? 'New supplement')
        }
      >
        {editing && person && (
          <Editor
            key={editing.kind === 'edit' ? editing.supplement.id : (editing.item?.id ?? 'custom')}
            editing={editing}
            person={person}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

function Editor({
  editing,
  person,
  onDone,
}: {
  editing: Editing;
  person: Person;
  onDone: () => void;
}) {
  const item =
    editing.kind === 'new' ? editing.item : catalogueItem(editing.supplement.catalogue_id);
  const guide: DoseGuide | undefined = item?.recommend(person);
  const existing = editing.kind === 'edit' ? editing.supplement : undefined;

  const [name, setName] = useState(existing?.name ?? item?.name ?? '');
  const [dose, setDose] = useState(String(existing?.dose ?? guide?.dose ?? ''));
  const [pristine, setPristine] = useState(dose !== '');
  const [unit, setUnit] = useState<SupplementUnit>(existing?.unit ?? item?.unit ?? 'mg');
  const [timing, setTiming] = useState<SupplementTiming>(existing?.timing ?? item?.timing ?? 'any');
  const [busy, setBusy] = useState(false);

  const n = Number(dose);
  const valid = name.trim().length > 0 && Number.isFinite(n) && n > 0;
  const warn = guide && valid ? doseWarning(n, guide) : undefined;

  const type = (u: (prev: string) => string) => {
    setDose((prev) => u(pristine ? '' : prev));
    setPristine(false);
  };

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const draft: SupplementDraft = {
      name,
      dose: n,
      unit,
      timing,
      catalogue_id: item?.id,
    };
    if (existing) await editSupplement(existing.id, draft);
    else await createSupplement(draft);
    onDone();
  };

  return (
    <div className="space-y-4">
      {!item && (
        <input
          type="text"
          autoComplete="off"
          placeholder="Name, e.g. Electrolytes"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
      )}

      <div className="flex items-end justify-between">
        <div className="display">
          {dose === '' ? <span className="text-surface-3">0</span> : dose}
          <span className="ml-1.5 text-[22px] font-medium text-muted">{unit}</span>
        </div>
        {guide && (
          <button
            type="button"
            className="pb-2 text-right text-[13px] text-accent"
            onClick={() => {
              setDose(String(guide.dose));
              setUnit(guide.unit);
              setPristine(true);
            }}
          >
            Suggested
            <span className="block text-[15px] font-semibold tabular">
              {formatDose(guide.dose, guide.unit)}
            </span>
          </button>
        )}
      </div>

      {guide && (
        <div className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px] leading-snug text-ink-2">
          <p>{guide.basis}.</p>
          <p className="mt-1 text-muted">{factorNote(guide.factor)}</p>
          {item?.tip && <p className="mt-2 text-muted">{item.tip}</p>}
        </div>
      )}
      {warn && <p className="px-1 text-[13px] font-semibold text-fat">{warn}</p>}

      <div className="flex gap-1.5" role="radiogroup" aria-label="Unit">
        {UNIT_OPTIONS.map((u) => (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={u === unit}
            onClick={() => setUnit(u)}
            className={`h-9 flex-1 rounded-full text-[14px] transition-[background-color,color,transform] duration-200 active:scale-95 ${
              u === unit ? 'bg-primary font-semibold text-on-primary' : 'bg-surface-2 text-ink'
            }`}
          >
            {u}
          </button>
        ))}
      </div>

      <NumberPad onChange={type} onSubmit={save} decimal maxDigits={5} />

      <Segmented value={timing} options={TIMING_OPTIONS} onChange={setTiming} />

      <div className="flex gap-2">
        {existing && (
          <IconButton
            icon={Trash2}
            label="Remove supplement"
            className="h-13 w-13 rounded-xl bg-surface-2 text-danger"
            onClick={async () => {
              await deleteSupplement(existing.id);
              onDone();
            }}
          />
        )}
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          disabled={!valid || busy}
          onClick={save}
        >
          {existing ? 'Save' : 'Add to my list'}
        </Button>
      </div>
    </div>
  );
}
