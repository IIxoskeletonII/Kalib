import { CalendarDays, LineChart, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { ensureSeeded, type SeedProgress } from '@/db/seed';
import { useProfile } from '@/hooks/useData';
import { useTheme } from '@/hooks/useTheme';
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
  useTheme();

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
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md px-4"
          role="status"
        >
          <div className="fade-in flex items-center justify-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-center text-[13px] text-ink-2 shadow-fab">
            {seed === 'error' ? (
              'Food database not loaded — reconnect and reopen.'
            ) : (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                Loading {seed.source === 'usda_foundation' ? 'core' : 'extended'} food database…
              </>
            )}
          </div>
        </div>
      )}

      {!hideNav && (
        <nav
          className="grid grid-cols-3 border-t border-line bg-bg/95 backdrop-blur safe-bottom"
          aria-label="Primary"
        >
          <Tab to="/" label="Today" icon={CalendarDays} />
          <Tab to="/trend" label="Trend" icon={LineChart} />
          <Tab to="/settings" label="Settings" icon={SettingsIcon} />
        </nav>
      )}
    </div>
  );
}

function Tab({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex h-15 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 ${
          isActive ? 'text-accent' : 'text-muted active:text-ink-2'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={24} strokeWidth={isActive ? 2.25 : 2} aria-hidden />
          {label}
        </>
      )}
    </NavLink>
  );
}
