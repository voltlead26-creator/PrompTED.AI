import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/web/src/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
