import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installRecovery } from './platform/recovery';
import './index.css';

// Before anything else: a build whose files are gone must heal itself, not hang.
installRecovery();

// autoUpdate installs a new build in the background and reloads once it takes control. iOS
// keeps an installed PWA suspended for days, so also check whenever the app comes back to the
// foreground; otherwise an update only lands after a force-quit.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (document.visibilityState === 'visible') void registration.update();
    };
    document.addEventListener('visibilitychange', check);
    setInterval(check, 60 * 60 * 1000);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
