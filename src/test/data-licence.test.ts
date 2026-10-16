// The chain compilation must never enter this repository.
//
// LICENSE-DATA.md keeps it outside the MIT grant so it can be licensed differently later. That
// decision is one-way: a file committed here is MIT-licensed for everyone, forever, and no
// later commit can withdraw it. The release flow is `git add -A`, so a missing .gitignore line
// is all it would take.
//
// A convention cannot protect something irreversible, so this asserts it on every run.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Paths that must never be tracked. Written as files rather than as the directory, because
 * `git check-ignore` resolves a trailing-slash rule only against a directory that exists, and
 * the whole point is that these do not exist yet on a clean checkout.
 */
const RESERVED = ['public/data/foods-chains.json', 'data/chains/any-market.json'];

function tracked(path: string): string[] {
  try {
    return execFileSync('git', ['ls-files', '--', path], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return []; // no git here (a tarball, say): nothing is tracked, so nothing is at risk
  }
}

function ignored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('the chain compilation stays out of the MIT grant', () => {
  it.each(RESERVED)('%s is not tracked', (path) => {
    expect(tracked(path), `${path} is committed — see LICENSE-DATA.md`).toEqual([]);
  });

  it.each(RESERVED)('%s is ignored, so `git add -A` cannot take it', (path) => {
    expect(ignored(path), `${path} is missing from .gitignore`).toBe(true);
  });

  it('the note explaining the split is present and shareable', () => {
    // Tracked once committed; until then it only has to exist and be committable, or the
    // rule above would be enforced by a file nobody can read.
    expect(existsSync('LICENSE-DATA.md'), 'LICENSE-DATA.md is missing').toBe(true);
    expect(ignored('LICENSE-DATA.md'), 'LICENSE-DATA.md is gitignored').toBe(false);
  });
});
