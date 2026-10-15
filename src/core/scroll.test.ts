import { describe, expect, it } from 'vitest';
import { ScrollMemory, SCROLL_MEMORY_LIMIT, scrollFor } from './scroll';

describe('scrollFor', () => {
  it('starts a new screen at the top', () => {
    expect(scrollFor({ kind: 'PUSH', samePath: false })).toEqual({ top: 0, settle: false });
  });

  it('starts a tab at the top too — a tab swap is a replace, not a back', () => {
    expect(scrollFor({ kind: 'REPLACE', samePath: false })).toEqual({ top: 0, settle: false });
  });

  it('leaves the same screen alone when only the query changed', () => {
    // Today rewrites ?d= to change the day; LogFood rewrites it as you type.
    expect(scrollFor({ kind: 'PUSH', samePath: true })).toEqual({ top: null, settle: false });
    expect(scrollFor({ kind: 'REPLACE', samePath: true, remembered: 400 })).toEqual({
      top: null,
      settle: false,
    });
  });

  it('puts you back where you were when you go back', () => {
    expect(scrollFor({ kind: 'POP', samePath: false, remembered: 820 })).toEqual({
      top: 820,
      settle: true,
    });
  });

  it('goes to the top on a back with nothing remembered', () => {
    // A reload, or history restored by the browser: better the top than a guess.
    expect(scrollFor({ kind: 'POP', samePath: false })).toEqual({ top: 0, settle: false });
  });

  it('does not bother settling on a remembered top of zero', () => {
    expect(scrollFor({ kind: 'POP', samePath: false, remembered: 0 })).toEqual({
      top: 0,
      settle: false,
    });
  });
});

describe('ScrollMemory', () => {
  it('remembers and recalls by history key', () => {
    const m = new ScrollMemory();
    m.remember('a', 120);
    expect(m.recall('a')).toBe(120);
    expect(m.recall('b')).toBeUndefined();
  });

  it('rounds, because a scroller can report fractions', () => {
    const m = new ScrollMemory();
    m.remember('a', 120.6);
    expect(m.recall('a')).toBe(121);
  });

  it('ignores nonsense rather than storing it', () => {
    const m = new ScrollMemory();
    m.remember('a', Number.NaN);
    m.remember('b', -40);
    expect(m.size).toBe(0);
  });

  it('forgets the oldest entry past the limit', () => {
    const m = new ScrollMemory(3);
    m.remember('a', 1);
    m.remember('b', 2);
    m.remember('c', 3);
    m.remember('d', 4);
    expect(m.size).toBe(3);
    expect(m.recall('a')).toBeUndefined();
    expect(m.recall('d')).toBe(4);
  });

  it('keeps a screen you are still scrolling', () => {
    const m = new ScrollMemory(3);
    m.remember('a', 1);
    m.remember('b', 2);
    m.remember('a', 10); // still on a
    m.remember('c', 3);
    m.remember('d', 4);
    expect(m.recall('a')).toBe(10);
    expect(m.recall('b')).toBeUndefined();
  });

  it('defaults to a bound that covers a long session without growing forever', () => {
    const m = new ScrollMemory();
    for (let i = 0; i < SCROLL_MEMORY_LIMIT + 10; i++) m.remember(`k${i}`, i + 1);
    expect(m.size).toBe(SCROLL_MEMORY_LIMIT);
  });
});
