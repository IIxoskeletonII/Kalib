// Platform adapter: the sound and buzz at the end of a rest. Under Capacitor: a local
// notification with a sound, which would also reach a locked phone — something no web page can.
//
// The tone is synthesised, not a file: two short sine notes a fifth apart with a soft attack
// and an exponential tail, so it reads as a cue rather than an alarm and never clicks. A file
// would be one more asset to cache for the offline gym, for half a second of sound.
//
// Three browser rules shape the rest:
//
//   - Audio may only start inside a user gesture until the page has been "unlocked". iOS is the
//     strict one: an AudioContext created or resumed outside a tap stays silent. So the context
//     is created and resumed on the first tap of the session (`unlock`), long before the rest
//     ends, and the chime itself then needs no gesture.
//   - Web Audio on iPhone follows the ring/silent switch and mixes with whatever music is
//     playing. Both are the right behaviour for a gym: the chime never stops someone's playlist,
//     and a phone set to silent stays silent. The visible countdown is the fallback.
//   - `navigator.vibrate` exists on Android and not on iOS. Where it exists it is the better cue
//     with headphones in, so it fires alongside the tone.

type Ctor = new () => AudioContext;

export interface ChimeEnv {
  AudioContext?: Ctor;
  vibrate?: (pattern: number | number[]) => boolean;
}

function defaults(): ChimeEnv {
  // Older Safari only has the prefixed constructor.
  const g = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  const Ctx = g.AudioContext ?? g.webkitAudioContext;
  const env: ChimeEnv = {};
  if (Ctx) env.AudioContext = Ctx;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    env.vibrate = (p) => navigator.vibrate(p);
  }
  return env;
}

/** Two notes: A5 then E6, a rising fifth. */
const NOTES_HZ = [880, 1318.5];
const NOTE_SEC = 0.16;
const GAP_SEC = 0.04;
const PEAK_GAIN = 0.22;
/** Short-long, felt rather than heard: distinct from the 8 ms tick a set gives. */
export const REST_BUZZ: number[] = [120, 80, 220];

export interface Chime {
  /** Call from inside a tap. Creates or resumes the audio context; harmless to call often. */
  unlock(): void;
  /** Sounds the cue. Returns whether a tone was scheduled (false where audio is unavailable). */
  play(): boolean;
  /** Buzzes where the phone can. Returns whether it did. */
  buzz(): boolean;
}

export function createChime(env: ChimeEnv = defaults()): Chime {
  let ctx: AudioContext | null = null;

  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    if (!env.AudioContext) return null;
    try {
      ctx = new env.AudioContext();
    } catch {
      ctx = null;
    }
    return ctx;
  };

  return {
    unlock() {
      const c = context();
      // Called on every tap of a session, so the common case — already running — costs nothing.
      // iOS can still suspend a running context (a phone call, Siri), which is why the taps
      // keep calling rather than stopping after the first success.
      if (!c || c.state === 'running') return;
      void c.resume().catch(() => {});
      // The old iOS unlock: a silent one-sample buffer started inside the gesture. Modern Safari
      // only needs resume(), but this costs nothing and covers the versions that do not.
      try {
        const buffer = c.createBuffer(1, 1, 22050);
        const src = c.createBufferSource();
        src.buffer = buffer;
        src.connect(c.destination);
        src.start(0);
      } catch {
        // Nothing to unlock with; play() will simply be silent.
      }
    },

    play() {
      const c = context();
      if (!c) return false;
      // Outside a gesture this only succeeds if the context was unlocked earlier. If it was
      // not, the notes are scheduled into a suspended context and never heard — no error, no
      // late burst of sound when something resumes it, because they are timed to now.
      if (c.state === 'suspended') void c.resume().catch(() => {});
      try {
        const t0 = c.currentTime + 0.01;
        NOTES_HZ.forEach((hz, i) => {
          const start = t0 + i * (NOTE_SEC + GAP_SEC);
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(hz, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_SEC);
          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(start);
          osc.stop(start + NOTE_SEC + 0.02);
        });
        return true;
      } catch {
        return false;
      }
    },

    buzz() {
      if (!env.vibrate) return false;
      try {
        return env.vibrate(REST_BUZZ);
      } catch {
        return false;
      }
    },
  };
}

/** The one the app uses. Created lazily so importing this module touches no browser API. */
let shared: Chime | null = null;
export function restChime(): Chime {
  shared ??= createChime();
  return shared;
}
