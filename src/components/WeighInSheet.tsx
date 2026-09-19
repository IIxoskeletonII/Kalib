// SPEC §8: weigh-in ≤5 s, number pad, no navigation.
import { useState } from 'react';
import { deleteWeighIn, upsertWeighIn } from '@/db/repo/weighIns';
import { NumberPad } from './NumberPad';
import { Button, Sheet } from './ui';

export interface WeighInSheetProps {
  open: boolean;
  date: string;
  /** Saved weight for `date`, if any. */
  current?: number | undefined;
  /** Most recent earlier weight, shown as the placeholder. */
  previous?: number | undefined;
  onClose: () => void;
}

export function WeighInSheet(p: WeighInSheetProps) {
  return (
    <Sheet open={p.open} onClose={p.onClose} title="Weigh-in">
      {/* The form mounts fresh each time the sheet opens, so its state starts from props. */}
      {p.open && <WeighInForm key={`${p.date}:${p.current ?? ''}`} {...p} />}
    </Sheet>
  );
}

function WeighInForm({ date, current, previous, onClose }: WeighInSheetProps) {
  const [value, setValue] = useState(current != null ? String(current) : '');
  const kg = Number(value);
  const valid = Number.isFinite(kg) && kg >= 20 && kg <= 400;

  const save = async () => {
    if (!valid) return;
    await upsertWeighIn(date, kg);
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="tabular text-5xl font-semibold">
          {value === '' ? (
            <span className="text-line">{previous != null ? previous.toFixed(1) : '0.0'}</span>
          ) : (
            value
          )}
          <span className="ml-1 text-2xl text-muted">kg</span>
        </div>
        {previous != null && value !== '' && valid && (
          <div className="tabular text-sm text-muted">
            {kg - previous >= 0 ? '+' : ''}
            {(kg - previous).toFixed(1)} vs last
          </div>
        )}
      </div>
      <NumberPad onChange={setValue} onSubmit={save} decimal maxDigits={4} />
      <div className="flex gap-2">
        {current != null && (
          <Button
            variant="danger"
            className="px-3"
            onClick={async () => {
              await deleteWeighIn(date);
              onClose();
            }}
          >
            Delete
          </Button>
        )}
        <Button variant="primary" className="flex-1" disabled={!valid} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
