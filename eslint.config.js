// Shared flat ESLint config for apps/web and apps/api. Kept deliberately light for Phase 0
// (docs/PROGRESS.md deviation log): typescript-eslint's recommended rules, no stylistic/formatting
// rules (Prettier's job, not yet wired), no React-specific plugin yet.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/build/**", "**/node_modules/**", "**/.venv/**", "apps/api/prisma/migrations/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // CLI-style scripts legitimately print progress/status to stdout.
    files: ["**/scripts/**", "**/seed/**"],
    rules: { "no-console": "off" },
  },
  {
    // Matched with "**/*" rather than an "apps/web/" prefix because ESLint is invoked with
    // --config pointing up from inside apps/web, so file paths ESLint sees are relative to that
    // package, not the repo root.
    files: ["**/*.tsx"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      // Only the two well-established correctness rules. eslint-plugin-react-hooks v7's full
      // "recommended" set adds many new React-Compiler-oriented rules (set-state-in-effect,
      // purity, immutability, ...) that flag standard, safe patterns (e.g. fetch-on-mount calling
      // an async function that eventually setStates) as errors — too aggressive for this stage.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "warn",
    },
  }
);
