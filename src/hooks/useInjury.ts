import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { getInjuryConsent, type InjuryConsent } from '@/services/injuryConsent';

/** The current agreement to injury help, null when there is none, undefined while loading. */
export function useInjuryConsent(): InjuryConsent | null | undefined {
  return useLiveQuery(async () => (await getInjuryConsent()) ?? null, []);
}

/** Whether the browser believes it is online, kept current. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
