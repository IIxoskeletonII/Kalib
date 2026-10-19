import { describe, expect, it } from 'vitest';
import {
  moveItem,
  normaliseSupersets,
  removeItem,
  toggleSuperset,
  uniqueRoutineName,
} from './routines';
import type { RoutineItem } from './types';

const item = (name: string, superset?: string): RoutineItem => ({
  exercise_id: `library:${name}`,
  name,
  load_type: 'weight_reps',
  sets: 3,
  ...(superset ? { superset } : {}),
});

const shape = (items: RoutineItem[]) => items.map((i) => `${i.name}${i.superset ?? ''}`).join(' ');

describe('normaliseSupersets', () => {
  it('leaves a genuine adjacent pair alone', () => {
    expect(shape(normaliseSupersets([item('a', 'A'), item('b', 'A'), item('c')]))).toBe('aA bA c');
  });

  it('drops a letter from an item with no neighbour sharing it', () => {
    // This is the bug: reordering put `c` between a pair, so neither is a superset any more.
    expect(shape(normaliseSupersets([item('a', 'A'), item('c'), item('b', 'A')]))).toBe('a c b');
  });

  it('keeps a group of three', () => {
    expect(shape(normaliseSupersets([item('a', 'A'), item('b', 'A'), item('c', 'A')]))).toBe(
      'aA bA cA',
    );
  });

  it('relabels from A, so deleting the first group does not leave only a B', () => {
    expect(shape(normaliseSupersets([item('a'), item('b', 'B'), item('c', 'B')]))).toBe('a bA cA');
  });

  it('numbers several groups in the order they appear', () => {
    const out = normaliseSupersets([
      item('a', 'C'),
      item('b', 'C'),
      item('c'),
      item('d', 'A'),
      item('e', 'A'),
    ]);
    expect(shape(out)).toBe('aA bA c dB eB');
  });

  it('handles an empty list and a single item', () => {
    expect(normaliseSupersets([])).toEqual([]);
    expect(shape(normaliseSupersets([item('a', 'A')]))).toBe('a');
  });
});

describe('moveItem', () => {
  it('reorders', () => {
    expect(shape(moveItem([item('a'), item('b'), item('c')], 2, -1))).toBe('a c b');
  });

  it('repairs a superset the move broke', () => {
    // Exactly the sequence that produced the bug: pair a+b, then lift c between them.
    const items = [item('a', 'A'), item('b', 'A'), item('c')];
    expect(shape(moveItem(items, 2, -1))).toBe('a c b');
  });

  it('keeps a pair intact when the whole pair moves relative to something else', () => {
    const items = [item('x'), item('a', 'A'), item('b', 'A')];
    expect(shape(moveItem(items, 0, 2))).toBe('aA bA x');
  });

  it('refuses to move off either end', () => {
    const items = [item('a'), item('b')];
    expect(shape(moveItem(items, 0, -1))).toBe('a b');
    expect(shape(moveItem(items, 1, 1))).toBe('a b');
    expect(shape(moveItem(items, 5, 1))).toBe('a b');
  });
});

describe('removeItem', () => {
  it('removes and repairs', () => {
    expect(shape(removeItem([item('a', 'A'), item('b', 'A'), item('c')], 1))).toBe('a c');
  });

  it('keeps a group of three intact when one of the others goes', () => {
    expect(shape(removeItem([item('a', 'A'), item('b', 'A'), item('c', 'A')], 2))).toBe('aA bA');
  });
});

describe('toggleSuperset', () => {
  it('joins an item to the one above', () => {
    expect(shape(toggleSuperset([item('a'), item('b')], 1))).toBe('aA bA');
  });

  it('breaks the pair when toggled again', () => {
    expect(shape(toggleSuperset([item('a', 'A'), item('b', 'A')], 1))).toBe('a b');
  });

  it('extends an existing group rather than starting a new one', () => {
    const items = [item('a', 'A'), item('b', 'A'), item('c')];
    expect(shape(toggleSuperset(items, 2))).toBe('aA bA cA');
  });

  it('does nothing to the first item, which has nothing above it', () => {
    expect(shape(toggleSuperset([item('a'), item('b')], 0))).toBe('a b');
  });
});

describe('uniqueRoutineName', () => {
  it('keeps a name nobody is using', () => {
    expect(uniqueRoutineName('Upper A', ['Legs'])).toBe('Upper A');
  });

  it('numbers a clash from two, ignoring case and stray spaces', () => {
    expect(uniqueRoutineName('Upper A', [' upper a '])).toBe('Upper A (2)');
  });

  it('skips numbers already taken', () => {
    expect(uniqueRoutineName('Upper A', ['Upper A', 'Upper A (2)'])).toBe('Upper A (3)');
  });
});
