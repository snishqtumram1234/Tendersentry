// Integration tests: real Express app + real Prisma client against a live database (spec §23.2).
// Run with `pnpm test:int`, which loads .env via dotenv-cli first — these tests need DATABASE_URL,
// DIRECT_URL and the rest of the real config to be set, same as `pnpm dev`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    testTimeout: 30_000, // hosted Supabase round-trips are slower than local
    hookTimeout: 30_000,
    fileParallelism: false, // these share the same database; avoid interleaving side effects
    setupFiles: ["./vitest.int.setup.ts"],
  },
});
