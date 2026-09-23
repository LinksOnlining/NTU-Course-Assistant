import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/ui",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: "msedge",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    ...[1, 1.25, 1.5].map((deviceScaleFactor) => ({
      name: `1280-${deviceScaleFactor * 100}`,
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor },
    })),
    ...[1, 1.25, 1.5].map((deviceScaleFactor) => ({
      name: `1000-${deviceScaleFactor * 100}`,
      use: { viewport: { width: 1000, height: 700 }, deviceScaleFactor },
    })),
    ...[1, 1.25, 1.5].map((deviceScaleFactor) => ({
      name: `900-${deviceScaleFactor * 100}`,
      use: { viewport: { width: 900, height: 600 }, deviceScaleFactor },
    })),
  ],
  webServer: {
    command: "npm run dev -- --mode playwright",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
