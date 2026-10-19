// SPEC §20.3 — keeping a routine's structure honest as it is edited.
//
// A superset is two or more exercises done back to back, which in a routine means *adjacent*
// items sharing a letter. Nothing in the data model enforces that: reordering or deleting can
// leave the letters behind while separating the exercises they joined, and the session screen
// would then draw a superset rule around two movements with something else in between.
//
// So every structural edit runs its result through here. The letter is a label, never the
// source of truth; adjacency is.
import type { RoutineItem } from './types';

function withoutSuperset(it: RoutineItem): RoutineItem {
  const next = { ...it };
  delete next.superset;
  return next;
}

/**
 * Drops a superset letter from any item that no longer has a neighbour sharing it, then
 * relabels the surviving groups from A so the letters read in order down the list.
 */
export function normaliseSupersets(items: readonly RoutineItem[]): RoutineItem[] {
  // A letter with no adjacent partner is not a superset, whatever it says.
  const paired = items.map((it, i) => {
    if (!it.superset) return it;
    const before = items[i - 1];
    const after = items[i + 1];
    const joined = before?.superset === it.superset || after?.superset === it.superset;
    return joined ? it : withoutSuperset(it);
  });

  // Relabel: the first group becomes A whatever it was called before, so deleting group A does
  // not leave a routine whose only superset is "B".
  const letters = 'ABCDEFGHIJ';
  const out: RoutineItem[] = [];
  let group = -1;
  for (let i = 0; i < paired.length; i++) {
    const it = paired[i]!;
    if (!it.superset) {
      out.push(it);
      continue;
    }
    const prev = paired[i - 1];
    const continues = prev?.superset != null && prev.superset === it.superset;
    if (!continues) group++;
    out.push({ ...it, superset: letters[group % letters.length] ?? 'A' });
  }
  return out;
}

/** Moves an item and repairs any superset the move broke. */
export function moveItem(items: readonly RoutineItem[], from: number, by: number): RoutineItem[] {
  const to = from + by;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [row] = next.splice(from, 1);
  if (row) next.splice(to, 0, row);
  return normaliseSupersets(next);
}

export function removeItem(items: readonly RoutineItem[], index: number): RoutineItem[] {
  return normaliseSupersets(items.filter((_, i) => i !== index));
}

/**
 * Joins an item to the one above it, or breaks the pair. Joining an item that already belongs
 * to a group above extends that group rather than starting a new one.
 */
export function toggleSuperset(items: readonly RoutineItem[], index: number): RoutineItem[] {
  if (index <= 0 || index >= items.length) return [...items];
  const next = [...items];
  const me = next[index]!;
  const above = next[index - 1]!;

  if (me.superset && me.superset === above.superset) {
    return normaliseSupersets(next.map((it, i) => (i === index ? withoutSuperset(it) : it)));
  }
  const letter = above.superset ?? 'A';
  next[index - 1] = { ...above, superset: letter };
  next[index] = { ...me, superset: letter };
  return normaliseSupersets(next);
}

/**
 * A name nothing else is using, so writing a week twice does not leave two routines called
 * "Upper A" that you have to open to tell apart.
 */
export function uniqueRoutineName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.trim().toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
