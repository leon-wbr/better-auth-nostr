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
      // The 1.0 gate (#31) is 90% lines and 85% branches; raise the
      // thresholds as tests land, never lower them.
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
