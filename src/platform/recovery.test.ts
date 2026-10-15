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

  it('still leaves the message a missing chunk used to surface as', () => {
    // A chunk that resolved to undefined reached React as this, which matches nothing here and
    // so stranded the screen. lazyScreen now reports that case in the words above instead;
    // this message must stay unrecognised, because almost any bug can produce it.
    expect(isStaleBuildError("Cannot read properties of undefined (reading 'default')")).toBe(
      false,
    );
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
