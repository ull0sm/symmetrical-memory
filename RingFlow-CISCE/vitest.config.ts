import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests: pure modules only (engines, tallies, validation, env, headers).
// Anything that needs a database or a browser session lives in tests/http.
export default defineConfig({
  resolve: {
    alias: {
      "@event-suite/rules-engine": path.resolve(import.meta.dirname, "src/engine/rules-engine"),
      "@event-suite/draw-engine": path.resolve(import.meta.dirname, "src/engine/draw-engine"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
