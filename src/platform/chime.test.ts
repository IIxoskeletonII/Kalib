// Node has no Web Audio, so the context is a recording stand-in: it notes what was created,
// connected and scheduled, which is everything the adapter is responsible for. Whether a sine
// wave sounds like a sine wave is the browser's business.
import { describe, expect, it, vi } from 'vitest';
import { createChime, REST_BUZZ, type ChimeEnv } from './chime';

interface Log {
  contexts: number;
  resumes: number;
  oscillators: { hz: number[]; started: number[]; stopped: number[]; type: string }[];
  ramps: number[];
  bufferStarts: number;
  /** The context created, so a test can play the system and suspend it. */
  ctx?: { state: AudioContextState };
}

function fakeAudio(
  opts: { state?: AudioContextState; throwOnCreate?: boolean; resumeRejects?: boolean } = {},
) {
  const log: Log = { contexts: 0, resumes: 0, oscillators: [], ramps: [], bufferStarts: 0 };
  class FakeContext {
    state: AudioContextState = opts.state ?? 'suspended';
    currentTime = 5;
    destination = {};
    constructor() {
      if (opts.throwOnCreate) throw new Error('No audio hardware');
      log.contexts++;
      log.ctx = this;
    }
    resume() {
      log.resumes++;
      if (opts.resumeRejects) return Promise.reject(new Error('Not allowed'));
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      const o = { hz: [] as number[], started: [] as number[], stopped: [] as number[], type: '' };
      log.oscillators.push(o);
      return {
        set type(t: string) {
          o.type = t;
        },
        frequency: { setValueAtTime: (hz: number) => o.hz.push(hz) },
        connect: vi.fn(),
        start: (t: number) => o.started.push(t),
        stop: (t: number) => o.stopped.push(t),
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: (v: number) => log.ramps.push(v),
        },
        connect: vi.fn(),
      };
    }
    createBuffer() {
      return {};
    }
    createBufferSource() {
      return { buffer: null, connect: vi.fn(), start: () => log.bufferStarts++ };
    }
  }
  return { Ctor: FakeContext as unknown as new () => AudioContext, log };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createChime — unlock', () => {
  it('creates and resumes the context inside the tap', () => {
    const { Ctor, log } = fakeAudio();
    createChime({ AudioContext: Ctor }).unlock();
    expect(log.contexts).toBe(1);
    expect(log.resumes).toBe(1);
    expect(log.bufferStarts).toBe(1);
  });

  it('reuses one context however many taps there are', () => {
    const { Ctor, log } = fakeAudio();
    const c = createChime({ AudioContext: Ctor });
    c.unlock();
    c.unlock();
    c.unlock();
    expect(log.contexts).toBe(1);
  });

  it('does nothing more once the context is running, however many taps follow', async () => {
    const { Ctor, log } = fakeAudio({ state: 'running' });
    const c = createChime({ AudioContext: Ctor });
    c.unlock();
    c.unlock();
    await flush();
    expect(log.resumes).toBe(0);
    expect(log.bufferStarts).toBe(0);
  });

  it('unlocks again after the system suspended it (a call, Siri)', () => {
    const { Ctor, log } = fakeAudio();
    const c = createChime({ AudioContext: Ctor });
    c.unlock(); // suspended → running
    c.unlock(); // running: nothing
    expect(log.resumes).toBe(1);
    log.ctx!.state = 'suspended'; // the system takes the audio for a call
    c.unlock();
    expect(log.resumes).toBe(2);
    expect(log.ctx!.state).toBe('running');
  });

  it('survives a refused resume', async () => {
    const { Ctor } = fakeAudio({ resumeRejects: true });
    const c = createChime({ AudioContext: Ctor });
    expect(() => c.unlock()).not.toThrow();
    await flush(); // the rejection must be caught, not left unhandled
  });

  it('does nothing where there is no Web Audio', () => {
    expect(() => createChime({}).unlock()).not.toThrow();
  });

  it('copes with a context that cannot be created', () => {
    const { Ctor } = fakeAudio({ throwOnCreate: true });
    const c = createChime({ AudioContext: Ctor });
    expect(() => c.unlock()).not.toThrow();
    expect(c.play()).toBe(false);
  });
});

describe('createChime — play', () => {
  it('schedules two rising notes, one after the other', () => {
    const { Ctor, log } = fakeAudio({ state: 'running' });
    expect(createChime({ AudioContext: Ctor }).play()).toBe(true);
    expect(log.oscillators).toHaveLength(2);
    const [a, b] = log.oscillators;
    expect(a!.type).toBe('sine');
    expect(a!.hz[0]).toBeLessThan(b!.hz[0]!);
    // The second starts after the first stops: two notes, not a chord.
    expect(b!.started[0]!).toBeGreaterThanOrEqual(a!.stopped[0]! - 0.02);
    // Timed from now, never in the past.
    expect(a!.started[0]!).toBeGreaterThan(5);
  });

  it('fades in and out rather than switching on and off, so it never clicks', () => {
    const { Ctor, log } = fakeAudio({ state: 'running' });
    createChime({ AudioContext: Ctor }).play();
    // Per note: up to a quiet peak, down to near silence.
    expect(log.ramps).toHaveLength(4);
    expect(Math.max(...log.ramps)).toBeLessThanOrEqual(0.3);
    expect(Math.min(...log.ramps)).toBeLessThan(0.001);
  });

  it('tries to resume a suspended context before playing', () => {
    const { Ctor, log } = fakeAudio({ state: 'suspended' });
    createChime({ AudioContext: Ctor }).play();
    expect(log.resumes).toBe(1);
  });

  it('reports that it cannot play where there is no Web Audio', () => {
    expect(createChime({}).play()).toBe(false);
  });
});

describe('createChime — buzz', () => {
  it('buzzes the rest pattern where the phone can', () => {
    const vibrate = vi.fn(() => true);
    expect(createChime({ vibrate }).buzz()).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(REST_BUZZ);
  });

  it('reports false where it cannot (every iPhone)', () => {
    expect(createChime({}).buzz()).toBe(false);
  });

  it('reports false when the browser refuses', () => {
    // Chrome returns false without a prior user gesture.
    expect(createChime({ vibrate: () => false }).buzz()).toBe(false);
  });

  it('survives a vibrate that throws', () => {
    const env: ChimeEnv = {
      vibrate: () => {
        throw new Error('blocked');
      },
    };
    expect(createChime(env).buzz()).toBe(false);
  });

  it('is distinct from the short tick a set gives', () => {
    expect(REST_BUZZ.reduce((a, b) => a + b, 0)).toBeGreaterThan(8 * 10);
  });
});
