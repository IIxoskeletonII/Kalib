// End to end against the production build (vite preview). One browser, phone-sized.
//
// Two projects, in order. `flows` is the pair of long journeys — day one, and the same app with
// the network cut — and they get the machine to themselves because each one waits on the full
// 16,000-row food seed. `sweep` is the per-screen walkthrough, one test per screen, and it wants
// every worker it can have. Run together, eight sweep workers all seeding at once starved the
// offline test until it timed out: a gate that flakes is worse than no gate.
import { defineConfig } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'flows', testMatch: /(day-one|offline|build-week)\.spec\.ts/, workers: 2 },
    { name: 'sweep', testMatch: /sweep\.spec\.ts/, dependencies: ['flows'] },
  ],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
