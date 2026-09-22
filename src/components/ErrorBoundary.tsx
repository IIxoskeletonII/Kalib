// The last line of defence: a screen that fails to load (usually a chunk from a build that no
// longer exists) triggers the same recovery the global listeners do, and says so plainly
// instead of leaving a blank page.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isStaleBuildError, recoverNow } from '@/platform/recovery';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[kalib] screen failed', error, info.componentStack);
    if (isStaleBuildError(error.message)) recoverNow('boundary');
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleBuildError(error.message);
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-8 text-center">
        <p className="text-[17px] font-semibold">
          {stale ? 'Finishing the update…' : 'Something went wrong'}
        </p>
        <p className="mt-2 text-[14px] text-muted">
          {stale
            ? 'This app was running an older version. It is clearing the old files and reloading — your log is untouched.'
            : 'The screen could not be drawn. Your data is safe on this phone.'}
        </p>
        <button
          type="button"
          onClick={() => recoverNow('manual')}
          className="mt-6 h-12 rounded-full bg-primary px-6 text-[15px] font-semibold text-on-primary"
        >
          Reload the app
        </button>
      </div>
    );
  }
}
