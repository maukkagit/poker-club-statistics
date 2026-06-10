import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests cover the pure modules under `lib/` (no React, no IO) plus
// characterization tests under `tests/` and lightweight component smoke tests.
// The `@` alias mirrors tsconfig so test imports match app imports.
//
// Default environment is `node`; any `.tsx` test (component smoke tests) runs
// under `jsdom`. Individual files can still override via a
// `// @vitest-environment jsdom` docblock.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  // Use the automatic JSX runtime (matches Next.js) so component tests don't
  // need an explicit `import React`.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    include: [
      "lib/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
  },
});
