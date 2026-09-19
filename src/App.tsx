import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { ensureSeeded, type SeedProgress } from '@/db/seed';
import { useProfile } from '@/hooks/useData';
import LogFood from '@/screens/LogFood';
import Onboarding from '@/screens/Onboarding';
import QuickAdd from '@/screens/QuickAdd';
import Settings from '@/screens/Settings';
import Today from '@/screens/Today';
import Trend from '@/screens/Trend';

export default function App() {
  const profile = useProfile();
  const location = useLocation();
  const [seed, setSeed] = useState<SeedProgress | 'error' | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureSeeded((p) => !cancelled && setSeed(p.done ? null : p))
      .then(() => !cancelled && setSeed(null))
      .catch((err) => {
        console.error('seed failed', err);
        if (!cancelled) setSeed('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (profile === undefined) return null; // first paint waits for one IndexedDB read
  const onboarding = location.pathname === '/onboarding';
  if (profile === null && !onboarding) return <Navigate to="/onboarding" replace />;
  if (profile && onboarding) return <Navigate to="/" replace />;

  const hideNav = /^\/(log|quick|onboarding)/.test(location.pathname);

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto px-4 pt-3 safe-top">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/log" element={<LogFood />} />
          <Route path="/quick" element={<QuickAdd />} />
          <Route path="/quick/:id" element={<QuickAdd />} />
          <Route path="/trend" element={<Trend />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {seed && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto max-w-md px-4 pt-2 safe-top">
          <div className="rounded-lg bg-surface-2 px-3 py-1.5 text-center text-xs text-muted shadow">
            {seed === 'error'
              ? 'Food database not loaded — reconnect and reopen.'
              : `Loading ${seed.source === 'usda_foundation' ? 'core' : 'extended'} food database…`}
          </div>
        </div>
      )}

      {!hideNav && (
        <nav className="grid grid-cols-3 border-t border-line bg-bg safe-bottom">
          <Tab to="/" label="Today" />
          <Tab to="/trend" label="Trend" />
          <Tab to="/settings" label="Settings" />
        </nav>
      )}
    </div>
  );
}

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex h-14 items-center justify-center text-sm ${isActive ? 'text-accent font-semibold' : 'text-muted'}`
      }
    >
      {label}
    </NavLink>
  );
}
