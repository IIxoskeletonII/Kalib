// Tests run in Node with no DOM, so the document and the Wake Lock API are stand-ins that
// behave the way the specification says the real ones do: a sentinel can be released once,
// the browser releases it itself when the page is hidden, and a request can be refused.
import { describe, expect, it, vi } from 'vitest';
import { canKeepScreenOn, keepScreenOn, type WakeLockEnv } from './wakeLock';

class FakeSentinel {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
  });
}

function fakeEnv(opts: { refuse?: boolean; visible?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const sentinels: FakeSentinel[] = [];
  let resolveNext: (() => void) | null = null;
  const doc = {
    visibilityState: (opts.visible === false ? 'hidden' : 'visible') as DocumentVisibilityState,
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_: string, fn: () => void) => listeners.delete(fn)),
  };
  let refuse = opts.refuse ?? false;
  let hold = false;
  const request = vi.fn(async () => {
    if (hold) await new Promise<void>((r) => (resolveNext = r));
    if (refuse) throw new DOMException('Battery saver', 'NotAllowedError');
    const s = new FakeSentinel();
    sentinels.push(s);
    return s as unknown as WakeLockSentinel;
  });
  return {
    env: { wakeLock: { request }, doc } as unknown as WakeLockEnv,
    request,
    sentinels,
    listeners,
    /** The page goes away: the browser drops the lock on its own. */
    hide() {
      doc.visibilityState = 'hidden';
      for (const s of sentinels) s.released = true;
      for (const fn of [...listeners]) fn();
    },
    show() {
      doc.visibilityState = 'visible';
      for (const fn of [...listeners]) fn();
    },
    setRefuse(v: boolean) {
      refuse = v;
    },
    /** Makes the next request wait until `release()`, to test overlapping requests. */
    holdRequests() {
      hold = true;
      return () => {
        hold = false;
        resolveNext?.();
      };
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('keepScreenOn', () => {
  it('asks for a screen lock straight away', async () => {
    const f = fakeEnv();
    keepScreenOn(f.env);
    await flush();
    expect(f.request).toHaveBeenCalledWith('screen');
    expect(f.sentinels).toHaveLength(1);
  });

  it('lets the lock go when released', async () => {
    const f = fakeEnv();
    const release = keepScreenOn(f.env);
    await flush();
    release();
    expect(f.sentinels[0]!.release).toHaveBeenCalledTimes(1);
    expect(f.listeners.size).toBe(0);
  });

  it('is safe to release twice', async () => {
    const f = fakeEnv();
    const release = keepScreenOn(f.env);
    await flush();
    release();
    release();
    expect(f.sentinels[0]!.release).toHaveBeenCalledTimes(1);
  });

  it('asks again when the page comes back, because the browser dropped it', async () => {
    const f = fakeEnv();
    keepScreenOn(f.env);
    await flush();
    f.hide();
    await flush();
    // Hidden: no request may be made, it would only be refused.
    expect(f.request).toHaveBeenCalledTimes(1);
    f.show();
    await flush();
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.sentinels[1]!.released).toBe(false);
  });

  it('does not stack a second lock on a held one', async () => {
    const f = fakeEnv();
    keepScreenOn(f.env);
    await flush();
    f.show(); // a visibility event with the lock still held
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('does not stack locks when events arrive while a request is in flight', async () => {
    const f = fakeEnv();
    const go = f.holdRequests();
    keepScreenOn(f.env);
    f.show();
    f.show();
    go();
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.sentinels).toHaveLength(1);
  });

  it('waits for the page to be visible before asking', async () => {
    const f = fakeEnv({ visible: false });
    keepScreenOn(f.env);
    await flush();
    expect(f.request).not.toHaveBeenCalled();
    f.show();
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('swallows a refusal and tries again next time the page is shown', async () => {
    const f = fakeEnv({ refuse: true });
    const release = keepScreenOn(f.env);
    await flush();
    expect(f.sentinels).toHaveLength(0);
    f.setRefuse(false);
    f.hide();
    f.show();
    await flush();
    expect(f.sentinels).toHaveLength(1);
    release();
    expect(f.sentinels[0]!.release).toHaveBeenCalled();
  });

  it('releases a lock that arrives after the hold was already let go', async () => {
    const f = fakeEnv();
    const go = f.holdRequests();
    const release = keepScreenOn(f.env);
    release();
    go();
    await flush();
    expect(f.sentinels).toHaveLength(1);
    expect(f.sentinels[0]!.release).toHaveBeenCalledTimes(1);
  });

  it('stops listening once released', async () => {
    const f = fakeEnv();
    const release = keepScreenOn(f.env);
    await flush();
    release();
    f.show();
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('does nothing where the API does not exist', () => {
    const doc = {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const release = keepScreenOn({ doc } as unknown as WakeLockEnv);
    expect(doc.addEventListener).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
    expect(canKeepScreenOn({ doc } as unknown as WakeLockEnv)).toBe(false);
  });

  it('does nothing in Node, where there is neither a navigator lock nor a document', () => {
    expect(canKeepScreenOn()).toBe(false);
    expect(() => keepScreenOn()()).not.toThrow();
  });
});
