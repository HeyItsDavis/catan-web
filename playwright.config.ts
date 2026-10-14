import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (NOT part of `npm test` / CI). Run with `npm run e2e`.
 * They drive two real browser contexts (host + guest) through the PeerJS cloud
 * broker, so they need internet access. Set PEER_SERVER=local to use a local
 * PeerJS server instead (see e2e/peer-server.mjs and docs/QA.md).
 */
const PORT = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'e2e/.results',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
