import { defineConfig } from "vitest/config";

export default defineConfig({
  mode: "node",
  test: {
    deps: {
      interopDefault: true
    },
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules"],
    root: ".",
    testTimeout: 120_000,
    reporters: ["default"]
  },
  resolve: {
    extensions: [".ts", ".js"],
    conditions: ["import", "node", "default"]
  }
});
