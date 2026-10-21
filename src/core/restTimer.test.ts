import { describe, expect, it } from 'vitest';
import {
  adjustRest,
  formatClock,
  formatDuration,
  isRestDone,
  MAX_REST_SEC,
  restOverrun,
  REST_ALERT_GRACE_SEC,
  restAlertDue,
  restProgress,
  restRemaining,
  startRest,
} from './restTimer';

const T0 = new Date('2026-10-14T09:00:00.000Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

describe('startRest', () => {
  it('writes down the instant it ends, not a countdown', () => {
    expect(startRest(90, T0).ends_at).toBe('2026-10-14T09:01:30.000Z');
  });

  it('clamps nonsense rather than freezing the bar forever', () => {
    expect(startRest(-10, T0).duration_sec).toBe(0);
    expect(startRest(999999, T0).duration_sec).toBe(MAX_REST_SEC);
  });

  it('rounds a fractional request', () => {
    expect(startRest(90.4, T0).duration_sec).toBe(90);
  });
});

describe('restRemaining', () => {
  const t = startRest(90, T0);

  it('counts down', () => {
    expect(restRemaining(t, T0)).toBe(90);
    expect(restRemaining(t, at(30))).toBe(60);
    expect(restRemaining(t, at(89))).toBe(1);
  });

  it('is right after the phone slept through the whole rest', () => {
    // This is the entire point: a tick-counting timer would be stuck at whatever it reached
    // before the screen locked. Arithmetic against the clock cannot be.
    expect(restRemaining(t, at(600))).toBe(0);
    expect(isRestDone(t, at(600))).toBe(true);
  });

  it('never goes negative', () => {
    expect(restRemaining(t, at(10_000))).toBe(0);
  });

  it('survives a corrupt end instant without producing NaN', () => {
    expect(restRemaining({ ends_at: 'not a date', duration_sec: 90 }, T0)).toBe(0);
  });
});

describe('restOverrun', () => {
  const t = startRest(60, T0);

  it('is zero while resting', () => {
    expect(restOverrun(t, at(30))).toBe(0);
  });

  it('counts up once the rest is over', () => {
    expect(restOverrun(t, at(105))).toBe(45);
  });
});

describe('restProgress', () => {
  const t = startRest(100, T0);

  it('runs from nothing to everything', () => {
    expect(restProgress(t, T0)).toBe(0);
    expect(restProgress(t, at(50))).toBeCloseTo(0.5, 2);
    expect(restProgress(t, at(100))).toBe(1);
  });

  it('stays inside 0 and 1 past the end', () => {
    expect(restProgress(t, at(500))).toBe(1);
  });

  it('calls a zero-length rest finished rather than dividing by it', () => {
    expect(restProgress(startRest(0, T0), T0)).toBe(1);
  });
});

describe('adjustRest', () => {
  const t = startRest(90, T0);

  it('adds to what is left rather than restarting', () => {
    const later = adjustRest(t, 15, at(30));
    expect(restRemaining(later, at(30))).toBe(75);
    expect(later.duration_sec).toBe(105);
  });

  it('takes time off', () => {
    const shorter = adjustRest(t, -30, at(10));
    expect(restRemaining(shorter, at(10))).toBe(50);
  });

  it('cannot be pushed into the past, so over-subtracting just ends it', () => {
    const ended = adjustRest(t, -600, at(10));
    expect(restRemaining(ended, at(10))).toBe(0);
    expect(isRestDone(ended, at(10))).toBe(true);
  });

  it('records a rest ended early as a rest of nothing', () => {
    const ended = adjustRest(t, -15, at(80));
    expect(ended.duration_sec).toBe(0);
    expect(ended.ends_at).toBe(at(80).toISOString());
    expect(restProgress(ended, at(80))).toBe(1);
  });

  it('a "−15" that leaves time on the clock keeps the duration it took off', () => {
    const shorter = adjustRest(t, -15, at(10));
    expect(shorter.duration_sec).toBe(75);
    expect(restRemaining(shorter, at(10))).toBe(65);
  });

  it('keeps the recorded duration sane', () => {
    expect(adjustRest(t, -9999, T0).duration_sec).toBe(0);
    expect(adjustRest(t, 999999, T0).duration_sec).toBe(MAX_REST_SEC);
  });
});

describe('formatClock', () => {
  it('reads like a clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(600)).toBe('10:00');
  });

  it('adds hours only when there are any', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('does not go negative', () => {
    expect(formatClock(-30)).toBe('0:00');
  });
});

describe('formatDuration', () => {
  it('drops seconds once they are false precision', () => {
    expect(formatDuration(50)).toBe('50s');
    expect(formatDuration(90)).toBe('2m');
    expect(formatDuration(2700)).toBe('45m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(4320)).toBe('1h 12m');
  });
});

describe('restAlertDue', () => {
  const rest = startRest(90, T0);

  it('is silent while the rest is still running', () => {
    expect(restAlertDue(rest, at(0))).toBe(false);
    expect(restAlertDue(rest, at(89))).toBe(false);
    // 89.5 s in, half a second remains, which rounds up to one: still resting.
    expect(restAlertDue(rest, at(89.5))).toBe(false);
  });

  it('sounds the moment the rest ends', () => {
    expect(restAlertDue(rest, at(90))).toBe(true);
  });

  it('still sounds for a tick that arrived a little late', () => {
    expect(restAlertDue(rest, at(91))).toBe(true);
    expect(restAlertDue(rest, at(90 + REST_ALERT_GRACE_SEC))).toBe(true);
  });

  it('stays quiet when the app is opened long after the rest ended', () => {
    // The hidden-page case: the phone was locked through the end, and the first repaint on
    // waking is minutes late. That is news about the past, not a cue to lift.
    expect(restAlertDue(rest, at(90 + REST_ALERT_GRACE_SEC + 1))).toBe(false);
    expect(restAlertDue(rest, at(90 + 180))).toBe(false);
    expect(restAlertDue(rest, at(90 + 3600))).toBe(false);
  });

  it('sounds once per end, not once per repaint', () => {
    expect(restAlertDue(rest, at(90), rest.ends_at)).toBe(false);
    expect(restAlertDue(rest, at(92), rest.ends_at)).toBe(false);
  });

  it('sounds again for a new end after "+15 s"', () => {
    const later = adjustRest(rest, 15, at(80));
    expect(restAlertDue(later, at(90), rest.ends_at)).toBe(false);
    expect(restAlertDue(later, at(105), rest.ends_at)).toBe(true);
  });

  it('stays quiet for a rest the person ended themselves with "−15"', () => {
    // They were looking at the screen to press it; the chime is for someone who is not.
    const cut = adjustRest(rest, -60, at(85));
    expect(cut.ends_at).toBe(at(85).toISOString());
    expect(restAlertDue(cut, at(85))).toBe(false);
    expect(restAlertDue(cut, at(86))).toBe(false);
  });

  it('still sounds for a rest merely shortened, when it runs out by itself', () => {
    const shorter = adjustRest(rest, -30, at(10));
    expect(restAlertDue(shorter, at(59))).toBe(false);
    expect(restAlertDue(shorter, at(60))).toBe(true);
  });

  it('never sounds for a zero-length rest', () => {
    const none = startRest(0, T0);
    expect(restAlertDue(none, at(0))).toBe(false);
    expect(restAlertDue(none, at(1))).toBe(false);
  });

  it('never sounds for a corrupt end instant', () => {
    expect(restAlertDue({ ends_at: 'not a date', duration_sec: 90 }, at(90))).toBe(false);
  });

  it('is unaffected by a clock that runs backwards', () => {
    // A phone whose time is corrected mid-rest: "now" before the start is simply still resting.
    expect(restAlertDue(rest, at(-30))).toBe(false);
  });
});
