// SPEC §20.14 — whether a routine's demonstrations are on the phone, and saving them.
import { useCallback, useEffect, useState } from 'react';
import {
  distinctMedia,
  offlineStatus,
  saveMediaOffline,
  type OfflineResult,
  type OfflineStatus,
} from '@/services/exerciseMedia';

export interface OfflineMedia {
  /** null while checking; undefined where the browser keeps no caches a page can use. */
  status: OfflineStatus | null | undefined;
  /** Set while saving. */
  progress: { done: number; total: number } | null;
  /** The last save's outcome, for the list it was made for. */
  result: OfflineResult | null;
  save: () => Promise<void>;
}

export function useOfflineMedia(media: readonly (string | undefined)[]): OfflineMedia {
  // The list as a string, so a new array with the same contents is not a new question.
  const key = distinctMedia(media).join(',');
  const [checked, setChecked] = useState<{ key: string; status: OfflineStatus | undefined }>();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ key: string; result: OfflineResult } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    void offlineStatus(ids).then((status) => {
      if (!cancelled) setChecked({ key, status });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const save = useCallback(async () => {
    const ids = key ? key.split(',') : [];
    setProgress({ done: 0, total: ids.length });
    try {
      const r = await saveMediaOffline(ids, (done, total) => setProgress({ done, total }));
      if (r) setResult({ key, result: r });
      setChecked({ key, status: await offlineStatus(ids) });
    } finally {
      setProgress(null);
    }
  }, [key]);

  return {
    // A status for a different list is a stale answer, not this one.
    status: checked?.key === key ? checked.status : null,
    progress,
    result: result?.key === key ? result.result : null,
    save,
  };
}
