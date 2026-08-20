import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Playwright refuses to install its bundled chromium on this host
 * ("Playwright does not support chromium on ubuntu26.04-x64"), so the suite
 * drives the system Chrome instead. `PLAYWRIGHT_CHANNEL=""` opts back into the
 * bundled build wherever it *is* installable, e.g. CI.
 */
const CHANNEL =
  process.env.PLAYWRIGHT_CHANNEL === undefined
    ? "chrome"
    : process.env.PLAYWRIGHT_CHANNEL || undefined;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: CHANNEL },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NO_PROXY: "127.0.0.1,localhost",
    },
  },
});
