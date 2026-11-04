import { defineConfig, devices } from "@playwright/test";

// Runs against the isolated E2E daemon only; see
// .claude/skills/runtime-e2e-test/references/project-runtime.md.
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["junit", { outputFile: "test-results/junit.xml" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:6801",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "compact", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
