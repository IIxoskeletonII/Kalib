// Theme follows the system unless pinned in Settings. Also keeps the browser chrome /
// iOS status bar colour in step with the page background.
import { useEffect } from 'react';
import { setSetting } from '@/db/repo/settings';
import { useSetting } from './useData';

export type ThemePref = 'system' | 'dark' | 'light';

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const pref = useSetting<ThemePref>('theme', 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') delete root.dataset.theme;
    else root.dataset.theme = pref;
    const sync = () => {
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    };
    sync();
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [pref]);
  return [pref, (t) => void setSetting('theme', t)];
}
