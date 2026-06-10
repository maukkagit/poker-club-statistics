import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests cover the pure modules under `lib/` (no React, no IO). The `@`
// alias mirrors tsconfig so test imports match app imports.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
