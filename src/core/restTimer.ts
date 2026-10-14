// SPEC §20.3 — the rest timer, as arithmetic rather than as a ticking clock.
//
// No JavaScript timer survives an iOS screen lock: `setInterval` is throttled when the tab is
// hidden and stops entirely when the phone sleeps. A timer that counts its own ticks would
// therefore be wrong by however long the screen was off — which, for a rest timer, is exactly
// the interval it is meant to measure.
//
// So nothing counts. The timer is an absolute end instant written down once, and every reading
// is a subtraction against the current time. The interval in the UI exists only to repaint;
// if it misses a hundred ticks the displayed number is still right. The same applies across a
// reload, which is why the end instant is persisted with the session rather than held in state.

export interface RestTimer {
  /** ISO instant the rest ends. The single source of truth. */
  ends_at: string;
  /** What it was set to, so "+15 s" and a progress ring have something to measure against. */
  duration_sec: number;
}

/** Rest lengths the UI offers; anything else is reachable with the plus and minus controls. */
export const REST_PRESETS_SEC = [30, 60, 90, 120, 150, 180, 240, 300];

export const DEFAULT_REST_SEC = 120;

/** Nobody rests for a fortnight, and a corrupt value should not freeze the bar forever. */
export const MAX_REST_SEC = 60 * 30;

export function startRest(duration_sec: number, now: Date = new Date()): RestTimer {
  const d = Math.max(0, Math.min(MAX_REST_SEC, Math.round(duration_sec)));
  return { ends_at: new Date(now.getTime() + d * 1000).toISOString(), duration_sec: d };
}

/** Seconds left, never negative. Zero means the rest is over, however long ago. */
export function restRemaining(t: RestTimer, now: Date = new Date()): number {
  const ms = new Date(t.ends_at).getTime() - now.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
}

/** Seconds since the rest ended, for "resting 0:45 over" after a long gap. */
export function restOverrun(t: RestTimer, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(t.ends_at).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
}

export function isRestDone(t: RestTimer, now: Date = new Date()): boolean {
  return restRemaining(t, now) === 0;
}

/** 0 to 1, for a ring or a bar. A zero-length rest reads as finished rather than dividing by it. */
export function restProgress(t: RestTimer, now: Date = new Date()): number {
  if (t.duration_sec <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - restRemaining(t, now) / t.duration_sec));
}

/**
 * Moves the end instant without restarting: "+15 s" during a rest should add fifteen seconds
 * to what is left, not begin a fresh countdown. Never lands before now, so a double tap of
 * "−15" on a nearly finished rest simply ends it.
 */
export function adjustRest(t: RestTimer, delta_sec: number, now: Date = new Date()): RestTimer {
  const end = new Date(t.ends_at).getTime() + delta_sec * 1000;
  const floor = now.getTime();
  const ends = Math.max(floor, end);
  return {
    ends_at: new Date(ends).toISOString(),
    duration_sec: Math.max(0, Math.min(MAX_REST_SEC, t.duration_sec + Math.round(delta_sec))),
  };
}

/** "1:30", "0:05", "12:00" — the way a clock reads, for anything under an hour. */
export function formatClock(total_sec: number): string {
  const s = Math.max(0, Math.round(total_sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, '0')}`
    : `${mm}:${String(sec).padStart(2, '0')}`;
}

/** "1h 12m", "45m", "50s" — for a finished session, where seconds are false precision. */
export function formatDuration(total_sec: number): string {
  const s = Math.max(0, Math.round(total_sec));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
