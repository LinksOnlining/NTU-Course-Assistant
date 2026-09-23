import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageManifest from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageManifest.version),
  },
  server: {
    port: 1420,
    strictPort: true,
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
});
