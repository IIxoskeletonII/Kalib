// SPEC §20.3 — saying a set out loud.
//
// The worst moment in gym logging is the one right after a hard set: hands chalky or sweaty,
// heart rate up, phone somewhere on the floor. Typing two numbers then is the single most
// annoying thing the app asks of anyone, and it is the thing it asks most often.
//
// So the session screen takes dictation, reusing the recogniser already in platform/speech.ts.
// "eighty for eight" is one sentence and no taps. Hevy has no equivalent.
//
// This module is only the parser, and it is deliberately strict: it returns undefined rather
// than guessing. A misheard set written silently into history is far worse than one that asks
// to be typed, because the wrong number would then become the thing you try to beat next week.
import type { WeightUnit } from './types';

export interface SpokenSet {
  /** In the unit that was spoken, if one was; otherwise in whatever the user's unit is. */
  weight?: number;
  unit?: WeightUnit;
  reps?: number;
  seconds?: number;
  rir?: number;
}

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/**
 * Turns spoken numbers into digits. Recognisers usually emit numerals already ("80 for 8"), so
 * this is the fallback for the ones that spell them out, and for "a hundred".
 */
export function wordsToNumbers(text: string): string {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let acc: number | null = null;
  let pending = false;

  const flush = () => {
    if (acc != null) out.push(String(acc));
    acc = null;
    pending = false;
  };

  for (let i = 0; i < words.length; i++) {
    const raw = words[i]!;
    const w = raw.toLowerCase();
    // "a hundred" means one hundred; "a bench" means a bench. Only the next word tells them
    // apart, so look at it rather than flushing and losing the chance.
    if ((w === 'a' || w === 'an') && words[i + 1]?.toLowerCase() === 'hundred') {
      flush();
      acc = 1;
      pending = true;
      continue;
    }
    if (w === 'and' && pending) continue; // "a hundred and five"
    if (w === 'hundred' && (acc != null || pending)) {
      acc = (acc ?? 1) * 100;
      pending = true;
      continue;
    }
    if (w === 'a' || w === 'an') {
      flush();
      out.push(raw);
      continue;
    }
    if (w in TENS) {
      if (acc != null && acc % 100 === 0) acc += TENS[w]!;
      else {
        flush();
        acc = TENS[w]!;
      }
      pending = true;
      continue;
    }
    if (w in ONES) {
      const n = ONES[w]!;
      if (acc != null && (acc % 100 === 0 || acc % 10 === 0)) acc += n;
      else {
        flush();
        acc = n;
      }
      pending = true;
      continue;
    }
    flush();
    out.push(raw);
  }
  flush();
  return out.join(' ');
}

const KG = /\b(?:kg|kilo|kilos|kilogram|kilograms|kilogrammes)\b/;
const LB = /\b(?:lb|lbs|pound|pounds)\b/;

function unitIn(text: string): WeightUnit | undefined {
  if (KG.test(text)) return 'kg';
  if (LB.test(text)) return 'lb';
  return undefined;
}

const N = String.raw`(\d+(?:[.,]\d+)?)`;
const num = (s: string | undefined): number | undefined => {
  if (s == null) return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Plausibility gates. A misheard "eighty" as "eight hundred" must not become a set. */
const MAX_WEIGHT = 600;
const MAX_REPS = 100;
const MAX_SECONDS = 3600;

/**
 * Parses one spoken set. Understands the orders people actually say:
 *
 *   "eighty for eight"        "80 by 8"        "80 x 8"
 *   "eight reps at eighty"    "12 reps"        "60 kilos"
 *   "45 seconds"              "80 for 8 rir 2"
 *
 * Returns undefined when it cannot be sure, which the caller shows as "say that again".
 */
export function parseSpokenSet(raw: string): SpokenSet | undefined {
  if (!raw.trim()) return undefined;
  const text = wordsToNumbers(
    raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N}.,@ ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

  const out: SpokenSet = {};
  const unit = unitIn(text);
  if (unit) out.unit = unit;

  // RIR is read first and removed, so its number cannot be mistaken for reps.
  let body = text;
  const rir =
    body.match(new RegExp(String.raw`\brir\s*${N}`)) ??
    body.match(new RegExp(String.raw`${N}\s*(?:reps? )?in reserve`));
  if (rir) {
    const v = num(rir[1]);
    if (v != null && v >= 0 && v <= 10) out.rir = Math.round(v);
    body = body.replace(rir[0], ' ');
  }

  const seconds = body.match(new RegExp(String.raw`${N}\s*(?:seconds?|secs?|s)\b`));
  if (seconds) {
    const v = num(seconds[1]);
    if (v != null && v > 0 && v <= MAX_SECONDS) {
      out.seconds = Math.round(v);
      return out.seconds ? out : undefined;
    }
  }

  // "<weight> for/by/x/at <reps>" — the usual order.
  const pair = body.match(
    new RegExp(
      String.raw`${N}\s*(?:kg|kilos?|kilograms?|lbs?|pounds?)?\s*(?:for|by|x|times|@|at)\s*${N}`,
    ),
  );
  if (pair) {
    const w = num(pair[1]);
    const r = num(pair[2]);
    if (w != null && r != null && w > 0 && w <= MAX_WEIGHT && r > 0 && r <= MAX_REPS) {
      out.weight = w;
      out.reps = Math.round(r);
      return out;
    }
  }

  // "<reps> reps at <weight>" — the other order, where the word "reps" disambiguates.
  const repsFirst = body.match(new RegExp(String.raw`${N}\s*reps?\s*(?:at|with|@|for|of)\s*${N}`));
  if (repsFirst) {
    const r = num(repsFirst[1]);
    const w = num(repsFirst[2]);
    if (w != null && r != null && w > 0 && w <= MAX_WEIGHT && r > 0 && r <= MAX_REPS) {
      out.weight = w;
      out.reps = Math.round(r);
      return out;
    }
  }

  const repsOnly = body.match(new RegExp(String.raw`${N}\s*reps?\b`));
  if (repsOnly) {
    const r = num(repsOnly[1]);
    if (r != null && r > 0 && r <= MAX_REPS) {
      out.reps = Math.round(r);
      return out;
    }
  }

  const weightOnly = body.match(
    new RegExp(String.raw`${N}\s*(?:kg|kilos?|kilograms?|lbs?|pounds?)\b`),
  );
  if (weightOnly) {
    const w = num(weightOnly[1]);
    if (w != null && w > 0 && w <= MAX_WEIGHT) {
      out.weight = w;
      return out;
    }
  }

  // Two bare numbers, in weight-then-reps order: "80 8".
  const bare = body.match(new RegExp(String.raw`^${N}\s+${N}$`));
  if (bare) {
    const w = num(bare[1]);
    const r = num(bare[2]);
    if (w != null && r != null && w > 0 && w <= MAX_WEIGHT && r > 0 && r <= MAX_REPS) {
      out.weight = w;
      out.reps = Math.round(r);
      return out;
    }
  }

  return undefined;
}

/** How the parsed set reads back, so it can be confirmed before it is written. */
export function describeSpokenSet(s: SpokenSet, fallback: WeightUnit): string {
  const parts: string[] = [];
  if (s.weight != null) parts.push(`${s.weight} ${s.unit ?? fallback}`);
  if (s.reps != null) parts.push(`${s.reps} reps`);
  if (s.seconds != null) parts.push(`${s.seconds}s`);
  if (s.rir != null) parts.push(`RIR ${s.rir}`);
  return parts.join(' · ');
}
