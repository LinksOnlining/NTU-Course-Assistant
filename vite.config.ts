import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageManifest from "./package.json" with { type: "json" };

const playwrightDiagnosticsScript = `
  const entries = [];
  const record = (stage, details) => {
    const entry = { stage, at: performance.now(), details };
    entries.push(entry);
    if (entries.length > 40) entries.shift();
    document.documentElement.dataset.lwBoot = stage;
    console.info("[LW_BOOT]", JSON.stringify(entry));
  };
  window.__LW_STARTUP_DIAGNOSTICS__ = { entries, record };
  window.addEventListener("error", (event) =>
    record("window-error", {
      message: String(event.message || "resource load error").slice(0, 300),
      source: String(event.filename || "").slice(0, 200),
      line: event.lineno,
    }),
  );
  window.addEventListener("unhandledrejection", (event) =>
    record("unhandled-rejection", { reason: String(event.reason).slice(0, 300) }),
  );
  record("html-root-ready", { rootPresent: Boolean(document.getElementById("root")) });
`;

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "playwright"
      ? [
          {
            name: "playwright-startup-diagnostics",
            transformIndexHtml(html: string) {
              return html.replace(
                '<script type="module" src="/src/main.tsx"></script>',
                `<script>${playwrightDiagnosticsScript}</script>\n    <script type="module" src="/src/main.tsx"></script>`,
              );
            },
          },
        ]
      : []),
  ],
  build:
    mode === "playwright"
      ? {
          rollupOptions: {
            input: [
              "index.html",
              ...[
                "ai-proposal-review",
                "ai-sensitive-consent",
                "daily-brief",
                "inbox-ai-panel",
                "today-assistant",
              ].map((name) => `tests/ui/fixtures/${name}.html`),
            ],
            output: {
              manualChunks(id) {
                if (
                  id.endsWith(".html") ||
                  /[\\/]src[\\/]main\.tsx$/.test(id) ||
                  /[\\/]tests[\\/]ui[\\/]fixtures[\\/].*-harness\.tsx$/.test(id)
                ) {
                  return undefined;
                }
                return "playwright-shared";
              },
            },
          },
        }
      : undefined,
  define: {
    __APP_VERSION__: JSON.stringify(packageManifest.version),
    ...(mode === "playwright"
      ? { "import.meta.env.DEV": "true", "import.meta.env.PROD": "false" }
      : {}),
  },
  server: {
    port: 1420,
    strictPort: true,
    hmr: mode === "playwright" ? false : undefined,
    watch: {
      // Rust owns these outputs; watching loaded DLLs can fail with EBUSY on Windows.
      ignored: [
        "**/src-tauri/target/**",
        "**/target/**",
        "**/src-tauri/gen/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
        "**/.local/**",
      ],
    },
  },
  clearScreen: false,
}));
