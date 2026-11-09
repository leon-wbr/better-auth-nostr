import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    restoreMocks: true,
    unstubGlobals: true,
    // Worktrees live under .claude/, and their copies of tests/ would
    // otherwise be collected alongside the real ones.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "examples/**"],
  },
});
