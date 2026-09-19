// Who this phone belongs to, always in view: the person's initial, and a dot when signed in
// and synced. Tapping it opens Settings.
import { Cloud } from 'lucide-react';
import { Link } from 'react-router';
import { useSetting } from '@/hooks/useData';
import { useSync } from '@/hooks/useSync';

export const NAME_KEY = 'name';

export function AccountChip() {
  const name = useSetting<string>(NAME_KEY, '');
  const { status, session } = useSync();
  const initial = (name.trim() || session?.user.email || '?').charAt(0).toUpperCase();
  const signedIn = Boolean(session) && status.state !== 'mismatch';
  const label = signedIn
    ? `${name.trim() || session!.user.email}, signed in`
    : name.trim()
      ? `${name.trim()}, not signed in`
      : 'Account';
  return (
    <Link
      to="/settings"
      aria-label={label}
      className="relative mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[16px] font-bold text-ink transition-transform duration-200 active:scale-95"
    >
      {initial}
      {signedIn && (
        <span className="absolute -right-0.5 -bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-on-accent">
            <Cloud size={10} strokeWidth={3} aria-hidden />
          </span>
        </span>
      )}
    </Link>
  );
}
