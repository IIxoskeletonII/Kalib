// Owns the scroll offset of the app's one scrolling element, applying core/scroll.ts's policy.
//
// Three things make this more than a one-liner.
//
// First, the offset has to be saved continuously rather than on the way out. By the time a
// navigation effect runs, the element already holds the new screen and the old offset is gone,
// so every scroll event writes itself down under the history entry it belongs to.
//
// Second, a remembered offset is not always reachable the instant you arrive. Most screens are
// lazily loaded and most read their data from IndexedDB, so the page is briefly short and the
// browser clamps the offset to whatever fits. Restoring therefore keeps asking across a few
// frames until the content is tall enough — and stops the moment you touch the screen, because
// fighting someone's thumb is worse than losing their place.
//
// Third, this hands back a callback ref rather than taking a RefObject. App renders nothing at
// all until the first profile read returns, so an effect that reads `ref.current` once finds
// null, never runs again, and silently saves nothing — which is how the first version of this
// fixed the jump and quietly lost the going-back half.
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { ScrollMemory, scrollFor, type NavKind } from '@/core/scroll';

/** How long content is given to arrive before a remembered offset is given up on. */
const SETTLE_MS = 700;

/** Anything that means "I am scrolling this myself now". */
const TAKEOVER = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/** Keeps asking for `top` until the content is tall enough to allow it, or the person intervenes. */
function settleAt(el: HTMLElement, top: number): () => void {
  let frame = 0;
  const deadline = performance.now() + SETTLE_MS;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    for (const e of TAKEOVER) el.removeEventListener(e, stop);
  };
  const tick = () => {
    el.scrollTop = top;
    if (el.scrollTop >= top || performance.now() > deadline) stop();
    else frame = requestAnimationFrame(tick);
  };
  for (const e of TAKEOVER) el.addEventListener(e, stop, { passive: true });
  frame = requestAnimationFrame(tick);
  return stop;
}

/** Returns the ref to put on the scrolling element. */
export function useScrollRestore(): (el: HTMLElement | null) => void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const memory = useRef<ScrollMemory | null>(null);
  memory.current ??= new ScrollMemory();
  const el = useRef<HTMLElement | null>(null);
  // The entry currently on screen, so a scroll event knows what it is describing.
  const current = useRef({ key: location.key, pathname: location.pathname });

  // Save. Directly in the handler, not on a frame: a tap that navigates can land in the same
  // frame as the scroll that preceded it, and a deferred write would record the wrong screen.
  const attach = useCallback((node: HTMLElement | null) => {
    el.current = node;
    if (!node) return;
    const save = () => memory.current?.remember(current.current.key, node.scrollTop);
    node.addEventListener('scroll', save, { passive: true });
    return () => {
      node.removeEventListener('scroll', save);
      el.current = null;
    };
  }, []);

  // Apply. Before paint, so no screen is ever shown at the wrong offset first.
  useLayoutEffect(() => {
    const node = el.current;
    const store = memory.current;
    const from = current.current;
    if (!node || !store || from.key === location.key) return;

    const { top, settle } = scrollFor({
      kind: navigationType as NavKind,
      samePath: from.pathname === location.pathname,
      remembered: store.recall(location.key),
    });
    current.current = { key: location.key, pathname: location.pathname };
    if (top === null) return;

    node.scrollTop = top;
    if (!settle || node.scrollTop >= top) return;
    return settleAt(node, top);
  }, [location.key, location.pathname, navigationType]);

  return attach;
}
