import {
  CalendarDays,
  LineChart,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { ensureSeeded, type SeedProgress } from '@/db/seed';
import { useProfile } from '@/hooks/useData';
import { useTheme } from '@/hooks/useTheme';
import Today from '@/screens/Today';

// Today is the cold-start path; everything else loads on first visit (uPlot lives in Trend).
const Trend = lazy(() => import('@/screens/Trend'));
const Coach = lazy(() => import('@/screens/Coach'));
const Settings = lazy(() => import('@/screens/Settings'));
const LogFood = lazy(() => import('@/screens/LogFood'));
const QuickAdd = lazy(() => import('@/screens/QuickAdd'));
const Onboarding = lazy(() => import('@/screens/Onboarding'));

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
  const screenKey = location.pathname.split('/')[1] ?? '';

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto px-4 pt-3 safe-top">
        <div key={screenKey} className="screen-in h-full">
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<Today />} />
              <Route path="/log" element={<LogFood />} />
              <Route path="/quick" element={<QuickAdd />} />
              <Route path="/quick/:id" element={<QuickAdd />} />
              <Route path="/trend" element={<Trend />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>

      {seed && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md px-4"
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
          className="relative border-t border-line bg-bg/90 backdrop-blur-md safe-bottom"
          aria-label="Primary"
        >
          <div className="grid h-[68px] grid-cols-5 items-center">
            <Tab to="/" label="Today" icon={CalendarDays} />
            <Tab to="/trend" label="Trend" icon={LineChart} />
            <div className="flex justify-center">
              <Link
                to="/log"
                aria-label="Log food"
                className="-mt-7 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary text-on-primary shadow-fab transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-90"
              >
                <Plus size={28} strokeWidth={2.5} aria-hidden />
              </Link>
            </div>
            <Tab to="/coach" label="Coach" icon={Sparkles} />
            <Tab to="/settings" label="Settings" icon={SettingsIcon} />
          </div>
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
        `flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors duration-200 ${
          isActive ? 'text-ink' : 'text-muted active:text-ink-2'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors duration-200 ${isActive ? 'bg-surface-2' : ''}`}
          >
            <Icon size={22} strokeWidth={isActive ? 2.4 : 2} aria-hidden />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}
