import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    restoreMocks: true,
    unstubGlobals: true,
    // Worktrees live under .claude/, and their copies of tests/ would
    // otherwise be collected alongside the real ones.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "examples/**"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary", "json-summary", "html"],
      // A ratchet: just under the numbers measured on main (89.87 / 79.63 /
      // 79.31 / 89.72). Raise them as tests land; never lower them.
      thresholds: { statements: 89, branches: 79, functions: 79, lines: 89 },
    },
  },
});
