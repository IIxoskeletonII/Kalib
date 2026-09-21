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
import { ToastHost } from '@/components/Toast';
import { useReminderPing } from '@/hooks/useData';
import { useSync } from '@/hooks/useSync';
import { useTheme } from '@/hooks/useTheme';
import { startSync } from '@/services/sync/manager';
import Today from '@/screens/Today';

// Today is the cold-start path; everything else loads on first visit (uPlot lives in Trend).
const Trend = lazy(() => import('@/screens/Trend'));
const Coach = lazy(() => import('@/screens/Coach'));
const Settings = lazy(() => import('@/screens/Settings'));
const LogFood = lazy(() => import('@/screens/LogFood'));
const QuickAdd = lazy(() => import('@/screens/QuickAdd'));
const Onboarding = lazy(() => import('@/screens/Onboarding'));
const MyFoods = lazy(() => import('@/screens/MyFoods'));
const FoodEditor = lazy(() => import('@/screens/FoodEditor'));
const PasswordReset = lazy(() => import('@/screens/PasswordReset'));
const Supplements = lazy(() => import('@/screens/Supplements'));
const Recipes = lazy(() => import('@/screens/Recipes'));
const RecipeEditor = lazy(() => import('@/screens/RecipeEditor'));
const Estimate = lazy(() => import('@/screens/Estimate'));
const Review = lazy(() => import('@/screens/Review'));
const RecipeImport = lazy(() => import('@/screens/RecipeImport'));

export default function App() {
  const profile = useProfile();
  const location = useLocation();
  const [seed, setSeed] = useState<SeedProgress | 'error' | null>(null);
  const { recovery, session } = useSync();
  useReminderPing();
  useTheme();

  useEffect(() => {
    void startSync();
  }, []);

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

  // A password-reset link lands here (often in Safari, with no profile): handle it before
  // any onboarding redirect.
  if (recovery) {
    return (
      <Suspense fallback={null}>
        <PasswordReset email={session?.user.email} />
      </Suspense>
    );
  }

  if (profile === undefined) return null; // first paint waits for one IndexedDB read
  const onboarding = location.pathname === '/onboarding';
  // A shared-recipe link must show its code even on a browser with no profile (Safari).
  const importing = location.pathname === '/recipes/import';
  if (profile === null && !onboarding && !importing) return <Navigate to="/onboarding" replace />;
  if (profile && onboarding) return <Navigate to="/" replace />;

  const hideNav = /^\/(log|quick|onboarding|foods|supplements|recipes|estimate|review)/.test(
    location.pathname,
  );
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
              <Route path="/foods" element={<MyFoods />} />
              <Route path="/foods/new" element={<FoodEditor />} />
              <Route path="/foods/:id" element={<FoodEditor />} />
              <Route path="/supplements" element={<Supplements />} />
              <Route path="/recipes" element={<Recipes />} />
              <Route path="/recipes/import" element={<RecipeImport />} />
              <Route path="/recipes/:id" element={<RecipeEditor />} />
              <Route path="/estimate" element={<Estimate />} />
              <Route path="/review" element={<Review />} />
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

      <ToastHost />
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
      replace
      viewTransition
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
            // The active pill morphs between tabs through the View Transitions API (Safari 18+).
            style={isActive ? { viewTransitionName: 'tab-pill' } : undefined}
          >
            <Icon size={22} strokeWidth={isActive ? 2.4 : 2} aria-hidden />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}
