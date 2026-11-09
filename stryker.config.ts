import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/routes.ts", "src/signer.ts"],
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "reports/stryker/incremental.json",
  htmlReporter: { fileName: "reports/stryker/mutation.html" },
  reporters: ["clear-text", "progress", "html"],
  tempDirName: ".stryker-tmp",
  disableTypeChecks: false,
  // Skip the preprocessor: TypeScript 7 removed parseConfigFileTextToJson.
  tsconfigFile: "stryker-no-tsconfig.json",
  thresholds: { high: 80, low: 60, break: 55 },
} satisfies PartialStrykerOptions;
