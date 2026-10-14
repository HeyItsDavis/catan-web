import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (NOT part of `npm test` / CI).
 *
 *   npm run e2e        — dev server (vite) on :5199; test hooks are on in dev builds
 *   npm run e2e:pages  — production build served under /catan-web/ (like GitHub Pages) on :5299
 *
 * The multiplayer specs drive two real browser contexts through the public PeerJS
 * cloud broker, so they need internet access.
 */
const PAGES = !!process.env.E2E_PAGES;
const PORT = Number(process.env.E2E_PORT ?? (PAGES ? 5299 : 5199));
const BASE = PAGES ? '/catan-web/' : '/';

export default defineConfig({
  testDir: './e2e',
  testMatch: PAGES ? /pages\.spec\.ts$/ : /\.spec\.ts$/,
  testIgnore: PAGES ? [] : [/pages\.spec\.ts$/],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e/.results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}${BASE}`,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: PAGES
      ? `npm run build && npx vite preview --base ${BASE} --port ${PORT} --strictPort`
      : `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !PAGES,
    timeout: 180_000,
  },
});
