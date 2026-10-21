import { CalendarDays, Dumbbell, LineChart, Plus, Sparkles, type LucideIcon } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { lazyScreen } from '@/platform/recovery';
import { ActiveWorkoutBar, WORKOUT_BAR_H, workoutBarShown } from '@/components/ActiveWorkoutBar';
import { ensureSeeded, type SeedProgress } from '@/db/seed';
import { ensureExercisesSeeded } from '@/db/seedExercises';
import { useProfile } from '@/hooks/useData';
import { useActiveSession } from '@/hooks/useWorkouts';
import { ToastHost } from '@/components/Toast';
import { useBarcodeReplay, useReminderPing } from '@/hooks/useData';
import { useSync } from '@/hooks/useSync';
import { useScrollRestore } from '@/hooks/useScrollRestore';
import { useTheme } from '@/hooks/useTheme';
import { startSync } from '@/services/sync/manager';
import Today from '@/screens/Today';

// Today is the cold-start path; everything else loads on first visit (uPlot lives in Trend).
const Trend = lazyScreen(() => import('@/screens/Trend'));
const Train = lazyScreen(() => import('@/screens/Train'));
const Session = lazyScreen(() => import('@/screens/Session'));
const ExerciseDetail = lazyScreen(() => import('@/screens/ExerciseDetail'));
const RoutineEditor = lazyScreen(() => import('@/screens/RoutineEditor'));
const BuildWeek = lazyScreen(() => import('@/screens/BuildWeek'));
const SessionSummary = lazyScreen(() => import('@/screens/SessionSummary'));
const Achievements = lazyScreen(() => import('@/screens/Achievements'));
const Circle = lazyScreen(() => import('@/screens/Circle'));
const Injury = lazyScreen(() => import('@/screens/Injury'));
const HowItWorks = lazyScreen(() => import('@/screens/HowItWorks'));
const Coach = lazyScreen(() => import('@/screens/Coach'));
const Settings = lazyScreen(() => import('@/screens/Settings'));
const LogFood = lazyScreen(() => import('@/screens/LogFood'));
const QuickAdd = lazyScreen(() => import('@/screens/QuickAdd'));
const Onboarding = lazyScreen(() => import('@/screens/Onboarding'));
const MyFoods = lazyScreen(() => import('@/screens/MyFoods'));
const FoodEditor = lazyScreen(() => import('@/screens/FoodEditor'));
const PasswordReset = lazyScreen(() => import('@/screens/PasswordReset'));
const Supplements = lazyScreen(() => import('@/screens/Supplements'));
const Recipes = lazyScreen(() => import('@/screens/Recipes'));
const RecipeEditor = lazyScreen(() => import('@/screens/RecipeEditor'));
const Estimate = lazyScreen(() => import('@/screens/Estimate'));
const Menu = lazyScreen(() => import('@/screens/Menu'));
const Review = lazyScreen(() => import('@/screens/Review'));
const RecipeImport = lazyScreen(() => import('@/screens/RecipeImport'));
const Plan = lazyScreen(() => import('@/screens/Plan'));
const Shopping = lazyScreen(() => import('@/screens/Shopping'));
const Cook = lazyScreen(() => import('@/screens/Cook'));

/** The tab bar's height, including its top rule. The one number the floating surfaces share. */
const NAV_H = 69;

export default function App() {
  const profile = useProfile();
  const location = useLocation();
  const navigate = useNavigate();
  const [seed, setSeed] = useState<SeedProgress | 'error' | 'exercises' | null>(null);
  const { recovery, session } = useSync();
  const workout = useActiveSession();
  useReminderPing();
  useBarcodeReplay((date, name) =>
    navigate(`/log?d=${date}&q=${encodeURIComponent(name)}`, { viewTransition: true }),
  );
  useTheme();
  const scroller = useScrollRestore();

  useEffect(() => {
    // The Supabase client is 200 KB of script the first paint does not need — unless this is
    // a password-reset link arriving, which it must handle before anything else renders.
    const urgent = /access_token|type=recovery/.test(window.location.hash);
    const t = setTimeout(() => void startSync(), urgent ? 0 : 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Food first, then the exercise library: someone opening the app for the first time is far
    // more likely to log a meal in the first minute than to start a workout.
    ensureSeeded((p) => !cancelled && setSeed(p.done ? null : p))
      .then(() => ensureExercisesSeeded((done) => !cancelled && setSeed(done ? null : 'exercises')))
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

  // Logging follows the day on screen: from a past day the + button adds to that day.
  const viewing = new URLSearchParams(location.search).get('d');
  const logTo = location.pathname === '/' && viewing ? `/log?d=${viewing}` : '/log';
  // `/train` is a tab and keeps the bar; everything under it is a full-screen flow.
  const hideNav =
    /^\/(log|quick|onboarding|foods|supplements|recipes|estimate|review|plan)/.test(
      location.pathname,
    ) ||
    /^\/train\//.test(location.pathname) ||
    location.pathname.startsWith('/settings/');
  const screenKey = location.pathname.split('/')[1] ?? '';
  // Everything that floats over the page stacks on the same floor: the tab bar where there is
  // one, then the running-workout bar above it. Each of the three surfaces used to work this
  // out for itself, and two of them were wrong.
  const barShown = workoutBarShown(workout != null, location.pathname);
  const floatFloor = (hideNav ? 0 : NAV_H) + (barShown ? WORKOUT_BAR_H : 0);

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main ref={scroller} className="flex-1 overflow-y-auto px-4 pt-3 safe-top">
        {/* The workout bar floats over the page, so content needs room to clear it. */}
        <div key={screenKey} className={`screen-in h-full ${barShown ? 'pb-[72px]' : ''}`}>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<Today />} />
              <Route path="/log" element={<LogFood />} />
              <Route path="/quick" element={<QuickAdd />} />
              <Route path="/quick/:id" element={<QuickAdd />} />
              <Route path="/trend" element={<Trend />} />
              <Route path="/train" element={<Train />} />
              <Route path="/train/session" element={<Session />} />
              <Route path="/train/exercise/:id" element={<ExerciseDetail />} />
              <Route path="/train/routine/:id" element={<RoutineEditor />} />
              <Route path="/train/build" element={<BuildWeek />} />
              <Route path="/train/summary/:id" element={<SessionSummary />} />
              <Route path="/train/achievements" element={<Achievements />} />
              <Route path="/train/circle" element={<Circle />} />
              <Route path="/train/injury" element={<Injury />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/how" element={<HowItWorks />} />
              <Route path="/foods" element={<MyFoods />} />
              <Route path="/foods/new" element={<FoodEditor />} />
              <Route path="/foods/:id" element={<FoodEditor />} />
              <Route path="/supplements" element={<Supplements />} />
              <Route path="/recipes" element={<Recipes />} />
              <Route path="/recipes/import" element={<RecipeImport />} />
              <Route path="/recipes/:id" element={<RecipeEditor />} />
              <Route path="/recipes/:id/cook" element={<Cook />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/shopping" element={<Shopping />} />
              <Route path="/estimate" element={<Estimate />} />
              <Route path="/menu" element={<Menu />} />
              <Route path="/review" element={<Review />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>

      {seed && (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 mx-auto max-w-md px-4 pb-3 safe-bottom"
          style={{ bottom: floatFloor }}
          role="status"
        >
          <div className="fade-in flex items-center justify-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-center text-[13px] text-ink-2 shadow-fab">
            {seed === 'error' ? (
              'Database not loaded — reconnect and reopen.'
            ) : seed === 'exercises' ? (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                Loading exercise library…
              </>
            ) : (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                Loading {seed.source === 'usda_foundation' ? 'core' : 'extended'} food database…
              </>
            )}
          </div>
        </div>
      )}

      <ActiveWorkoutBar liftedBy={hideNav ? 0 : NAV_H} />
      <ToastHost liftedBy={floatFloor} />
      {!hideNav && (
        <nav
          className="relative border-t border-line bg-bg/90 backdrop-blur-md safe-bottom"
          aria-label="Primary"
        >
          <div className="grid h-[68px] grid-cols-5 items-center">
            <Tab to="/" label="Today" icon={CalendarDays} />
            <Tab to="/train" label="Train" icon={Dumbbell} />
            <div className="flex justify-center">
              <Link
                to={logTo}
                aria-label="Log food"
                className="-mt-7 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary text-on-primary shadow-fab transition-transform duration-200 ease-[var(--ease-out-soft)] active:scale-90"
              >
                <Plus size={28} strokeWidth={2.5} aria-hidden />
              </Link>
            </div>
            <Tab to="/trend" label="Trend" icon={LineChart} />
            <Tab to="/coach" label="Coach" icon={Sparkles} />
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
