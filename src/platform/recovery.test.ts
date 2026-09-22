import { describe, expect, it } from 'vitest';
import { isStaleBuildError, shouldRecover } from './recovery';

describe('isStaleBuildError', () => {
  it('recognises the ways a browser reports a chunk that is gone', () => {
    for (const m of [
      'Failed to fetch dynamically imported module: https://kalib.kalib.workers.dev/assets/Plan-C5.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
      "Unexpected token '<'",
    ]) {
      expect(isStaleBuildError(m), m).toBe(true);
    }
  });

  it('leaves ordinary errors alone', () => {
    expect(isStaleBuildError('Cannot read properties of undefined')).toBe(false);
    expect(isStaleBuildError(undefined)).toBe(false);
    expect(isStaleBuildError({ message: 'x' })).toBe(false);
  });
});

describe('shouldRecover', () => {
  it('runs once, then refuses until the cooldown has passed, and never offline', () => {
    const now = 1_000_000;
    expect(shouldRecover(now, 0, true)).toBe(true);
    expect(shouldRecover(now, now - 1_000, true)).toBe(false);
    expect(shouldRecover(now, now - 61_000, true)).toBe(true);
    expect(shouldRecover(now, 0, false)).toBe(false);
  });
});
