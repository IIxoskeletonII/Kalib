// SPEC §8: weigh-in ≤5 s, number pad, no navigation.
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteWeighIn, upsertWeighIn } from '@/db/repo/weighIns';
import { NumberPad } from './NumberPad';
import { Button, IconButton, Sheet } from './ui';

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
  const [pristine, setPristine] = useState(current != null);
  const type = (u: (prev: string) => string) => {
    setValue((prev) => u(pristine ? '' : prev));
    setPristine(false);
  };
  const kg = Number(value);
  const valid = Number.isFinite(kg) && kg >= 20 && kg <= 400;
  const delta = previous != null && valid ? kg - previous : undefined;

  const save = async () => {
    if (!valid) return;
    await upsertWeighIn(date, kg);
    onClose();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div className="display">
          {value === '' ? (
            <span className="text-surface-3">{previous != null ? previous.toFixed(1) : '0.0'}</span>
          ) : (
            value
          )}
          <span className="ml-1.5 text-[22px] font-medium text-muted">kg</span>
        </div>
        {delta != null && value !== '' && (
          <div className={`tabular text-[15px] ${delta <= 0 ? 'text-fiber' : 'text-fat'}`}>
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)} kg vs last
          </div>
        )}
      </div>
      <NumberPad onChange={type} onSubmit={save} decimal maxDigits={4} />
      <div className="flex gap-2">
        {current != null && (
          <IconButton
            icon={Trash2}
            label="Delete weigh-in"
            className="h-14 w-14 rounded-[14px] bg-surface-2 text-danger"
            onClick={async () => {
              await deleteWeighIn(date);
              onClose();
            }}
          />
        )}
        <Button variant="primary" size="lg" className="flex-1" disabled={!valid} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
