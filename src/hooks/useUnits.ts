// SPEC §22 — the units every screen reads. Metric while the session's first read is in flight:
// the switch is a display concern, and a frame of "kg" before "lb" changes nothing stored.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import type { UnitSystem } from '@/core/measure';
import { adoptUnitSystem, getUnits, type UnitsChoice } from '@/services/units';

/**
 * The last answer read, so a screen opened later in the session starts in the right units
 * instead of flashing grams for the moment its own read takes. Only the very first read of a
 * session has nothing to start from.
 */
let lastRead: UnitsChoice | undefined;

async function readUnits(): Promise<UnitsChoice> {
  lastRead = await getUnits();
  return lastRead;
}

export function useUnits(): UnitsChoice | undefined {
  const u = useLiveQuery(readUnits, []) ?? lastRead;
  // First run: write the guess down so it stops depending on where the phone is (services/units).
  useEffect(() => {
    if (u && !u.chosen) void adoptUnitSystem();
  }, [u]);
  return u;
}

export function useUnitSystem(): UnitSystem {
  return useUnits()?.system ?? 'metric';
}
