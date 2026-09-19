// SPEC §12: CSV export of all log entries and weigh-ins from v0, plus a full JSON backup.
import { MICRO_KEYS } from '@/core/nutrients';
import type { LogEntry, WeighIn } from '@/core/types';
import { listAllEntries } from '@/db/repo/logEntries';
import { listWeighIns } from '@/db/repo/weighIns';
import { exportFiles, type ExportFile } from '@/platform/exportFile';

export function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly unknown[][]): string {
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function entriesCsv(entries: readonly LogEntry[]): string {
  const header = [
    'id',
    'date',
    'logged_at',
    'meal_slot',
    'name',
    'food_id',
    'grams',
    'kcal',
    'protein_g',
    'carb_g',
    'fat_g',
    'fiber_g',
    'entry_method',
    'confidence',
    ...MICRO_KEYS,
  ];
  const rows = entries.map((e) => [
    e.id,
    e.date,
    e.logged_at,
    e.meal_slot,
    e.name,
    e.food_id ?? '',
    e.grams,
    r(e.kcal),
    r(e.protein_g),
    r(e.carb_g),
    r(e.fat_g),
    r(e.fiber_g),
    e.entry_method,
    e.confidence,
    ...MICRO_KEYS.map((k) => (e.micros[k] != null ? r(e.micros[k]!, 3) : '')),
  ]);
  return toCsv(header, rows);
}

export function weighInsCsv(weighIns: readonly WeighIn[]): string {
  const header = ['id', 'date', 'weight_kg', 'bodyfat_pct', 'source', 'created_at'];
  return toCsv(
    header,
    weighIns.map((w) => [w.id, w.date, w.weight_kg, w.bodyfat_pct ?? '', w.source, w.created_at]),
  );
}

function r(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export async function exportCsv(): Promise<'shared' | 'downloaded'> {
  const [entries, weighIns] = await Promise.all([listAllEntries(), listWeighIns()]);
  const stamp = new Date().toISOString().slice(0, 10);
  const files: ExportFile[] = [
    { name: `kalib-log-${stamp}.csv`, mime: 'text/csv', content: entriesCsv(entries) },
    { name: `kalib-weight-${stamp}.csv`, mime: 'text/csv', content: weighInsCsv(weighIns) },
  ];
  return exportFiles(files);
}
