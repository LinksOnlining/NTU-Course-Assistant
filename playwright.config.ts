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
    { name: "1280-100", use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
    { name: "1280-125", use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.25 } },
    { name: "900-150", use: { viewport: { width: 900, height: 600 }, deviceScaleFactor: 1.5 } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
