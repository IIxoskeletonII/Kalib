// Where a screen should start when you arrive on it.
//
// The app scrolls inside <main>, not the window, so none of the browser's own scroll handling
// applies: the element simply keeps whatever offset the previous screen left on it. Nothing
// reset it, which is why opening "How Kalib works" from the bottom of Settings landed you
// 1,718 px down a page you had never seen.
//
// Resetting to zero on every navigation fixes that and introduces a smaller version of the
// same rudeness: going back to a long list drops you at its top instead of beside the row you
// just tapped. Native apps do not do that, so neither does this. The rule is the one every
// platform converged on — forward goes to the top, back goes where you were.
//
// Pure, because the interesting part is the policy and the policy is worth testing. The hook
// in hooks/useScrollRestore.ts owns the element and the timing.

export type NavKind = 'PUSH' | 'REPLACE' | 'POP';

/** How many history entries keep a remembered offset. Beyond this the oldest is forgotten. */
export const SCROLL_MEMORY_LIMIT = 40;

export interface ScrollDecision {
  /** Pixels from the top, or null to leave the scroller exactly where it is. */
  top: number | null;
  /** Whether the offset may need several frames to become reachable (content still arriving). */
  settle: boolean;
}

/**
 * The decision for one navigation.
 *
 * `samePath` covers the case the first draft of this got wrong: Today rewrites `?d=` to change
 * the day and LogFood rewrites the query as you type, both through the router. Those are the
 * same screen, so they keep their place; only a genuine change of screen starts over.
 */
export function scrollFor({
  kind,
  samePath,
  remembered,
}: {
  kind: NavKind;
  samePath: boolean;
  remembered?: number | undefined;
}): ScrollDecision {
  if (kind === 'POP' && remembered !== undefined && remembered > 0) {
    return { top: remembered, settle: true };
  }
  if (samePath) return { top: null, settle: false };
  return { top: 0, settle: false };
}

/**
 * Remembered offsets, keyed by history entry rather than by path: two entries for the same list
 * are two different places you were, and a tab you return to is not the one you left.
 *
 * Bounded, and insertion-ordered by Map so the oldest entry is the first key. A session that
 * visits hundreds of screens must not hold all of them.
 */
export class ScrollMemory {
  private readonly tops = new Map<string, number>();

  constructor(private readonly limit: number = SCROLL_MEMORY_LIMIT) {}

  remember(key: string, top: number): void {
    if (!Number.isFinite(top) || top < 0) return;
    // Delete first so re-remembering moves the key to the end: a screen you keep scrolling is
    // the last one you want evicted.
    this.tops.delete(key);
    this.tops.set(key, Math.round(top));
    if (this.tops.size > this.limit) {
      const oldest = this.tops.keys().next();
      if (!oldest.done) this.tops.delete(oldest.value);
    }
  }

  recall(key: string): number | undefined {
    return this.tops.get(key);
  }

  get size(): number {
    return this.tops.size;
  }
}
