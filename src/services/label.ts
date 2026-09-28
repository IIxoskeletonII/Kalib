// SPEC §9.6 — photograph a nutrition label, get the fields. The image is downscaled on the
// device (labels are small print, so less aggressively than a meal photo) and never stored.
import { parseLabel, type LabelReading } from '@/core/label';
import { downscale } from '@/services/barcode';
import { authHeaders } from '@/services/apiAuth';

export async function readLabel(file: File): Promise<{ reading: LabelReading; model: string }> {
  const auth = await authHeaders();
  if (!('authorization' in auth)) {
    throw new Error('Sign in first (Settings → Sync). Reading a label runs on the server.');
  }
  const canvas = await downscale(file, 1400);
  const image = canvas.toDataURL('image/jpeg', 0.85);
  const res = await fetch('/api/label', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ image }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    result?: unknown;
    model?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? `Could not read the label (${res.status}).`);
  const reading = parseLabel(data.result);
  if (!reading) throw new Error('No nutrition table was legible in that photo.');
  return { reading, model: data.model ?? 'unknown' };
}
