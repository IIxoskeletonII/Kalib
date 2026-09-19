import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

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
      <App />
    </BrowserRouter>
  </StrictMode>,
);
