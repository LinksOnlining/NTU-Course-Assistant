import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
