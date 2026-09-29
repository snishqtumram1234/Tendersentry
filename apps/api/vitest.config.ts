// Unit tests: pure functions only, no database or network (spec §23.1). Integration tests that
// need the hosted Supabase project live in vitest.int.config.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
