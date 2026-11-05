import { expect, test } from "@playwright/test";
import { execFileSync, execFile } from "node:child_process";
import { checkpoint, home, openAgent, setLevel, shot, workspaceName } from "./helpers";

// Needs the fixture agent from the run setup: its first turn read notes.txt, edited it (foo -> bar) and ran a failing `ls`.
// E2E_AGENT_ID is that agent; E2E_WORKSPACE_NAME its workspace's sidebar name.
const agentId = process.env.E2E_AGENT_ID ?? "";
const paseo = (...args: string[]) => execFileSync("paseo", [...args, "--home", home], { encoding: "utf8" });

test.beforeEach(() => {
  test.skip(!workspaceName || !agentId, "E2E_WORKSPACE_NAME and E2E_AGENT_ID are required");
});

test("@K2 @K5 @K9 Brief chips: Read, Edited +X −Y, failed Ran with non-zero exit, plugin running", async ({ page }, info) => {
  const ls = paseo("plugin", "ls");
  expect(ls).toMatch(/agent-activity\s+running\s+yes/);
  await openAgent(page);
  await setLevel(page, "Brief");
  const read = page.getByRole("button", { name: /^Read .*notes\.txt, done, collapsed$/ });
  const edit = page.getByRole("button", { name: /^Edited .*notes\.txt, done, collapsed$/ });
  const ran = page.getByRole("button", { name: /^Ran ls \/nonexistent-e2e-path, failed, collapsed$/ });
  await expect(read).toBeVisible();
  await expect(edit).toContainText("+1 −1");
  await expect(ran).toContainText(/exit [1-9]\d*/);
  await expect(page.getByText("OK", { exact: true }).first()).toBeVisible();
  await checkpoint(info, "brief-chips", {
    read: await read.innerText(),
    edit: await edit.innerText(),
    ran: await ran.innerText(),
    pluginLs: ls.split("\n").find((l) => l.startsWith("agent-activity"))?.replace(/\s+/g, " ").slice(0, 60),
  });
  await shot(page, info, "brief");
});

test("@K3 @K6 @K7 Detail Brief → Steps → Full changes every step; tap opens one step", async ({ page }, info) => {
  await openAgent(page);
  await setLevel(page, "Steps");
  // The fixture timeline has a read/edit/failed ls run, then single-step sleep runs split by answers.
  // The model may add a step, and the live case adds a sleep run, so check the structure, not exact counts.
  await expect(page.getByText(/^\d+ steps · .*1 failed$/)).toBeVisible();
  const singles = page.getByText(/^1 step · /);
  await expect.poll(() => singles.count()).toBeGreaterThanOrEqual(2);
  // Each single-step run is a `sleep 8`; its header must show at least that wait, not 0s.
  for (const text of await singles.allInnerTexts()) expect(text).toMatch(/^1 step · (\d+m \d+s|([89]|\d{2})s)$/);
  const phases = await page.getByText(/^(EXPLORE|CHANGE|VERIFY)$/).allInnerTexts();
  expect(phases[0]).toBe("EXPLORE");
  expect(phases).toContain("CHANGE");
  expect(phases.indexOf("CHANGE")).toBeLessThan(phases.lastIndexOf("VERIFY"));
  expect(phases.filter((phase) => phase === "VERIFY").length).toBeGreaterThanOrEqual(3);
  await shot(page, info, "steps");

  // Tapping one step opens only that step's detail.
  const ran = page.getByRole("button", { name: /^Ran ls .*collapsed$/ });
  await ran.click();
  await expect(page.getByRole("button", { name: /^Ran ls .*, expanded$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edited .*, collapsed$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Read .*, collapsed$/ })).toBeVisible();
  await shot(page, info, "steps-one-open");

  // Changing the level drops the per-step selection: Full opens everything.
  await setLevel(page, "Full");
  await expect(page.getByRole("button", { name: /^Read .*, expanded$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edited .*, expanded$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ran ls .*, expanded$/ })).toBeVisible();
  await expect(page.getByText("+hello bar world", { exact: false }).first()).toBeVisible();
  await shot(page, info, "full");

  await setLevel(page, "Brief");
  await expect(page.getByRole("button", { name: /^Read .*, collapsed$/ })).toBeVisible();
  await expect(page.getByText(/^(EXPLORE|CHANGE|VERIFY)$/)).toHaveCount(0);
  await checkpoint(info, "levels", { phases, backToBrief: "collapsed, no headers" });
});

test("@K1 live: sleep 8 && echo done shows Running pill and chip, then Ran and Done", async ({ page }, info) => {
  test.skip(process.env.E2E_LIVE !== "1" || info.project.name !== "desktop", "consumes an agent turn; opt in with E2E_LIVE=1");
  await openAgent(page);
  await setLevel(page, "Brief");
  execFile("paseo", ["send", agentId, "Run the shell command `sleep 8 && echo done` and then reply with the single word DONE.", "--home", home], () => {});
  // Auto-allow the Bash permission the fixture agent asks for.
  const allow = setInterval(() => execFile("paseo", ["permit", "allow", agentId, "--all", "--home", home], () => {}), 1500);
  try {
    const pill = page.getByRole("button", { name: /^(Explore|Change|Verify) · Running sleep 8 && echo done$/ }).first();
    await expect(pill).toBeVisible({ timeout: 60_000 });
    const runningChip = page.getByRole("button", { name: /^Running sleep 8 && echo done, running, collapsed$/ });
    await expect(runningChip).toBeVisible();
    const pillText = await pill.innerText();
    await shot(page, info, "live-running");
    const ranChip = page.getByRole("button", { name: /^Ran sleep 8 && echo done, done, collapsed$/ }).last();
    await expect(ranChip).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Done · \d+ steps?/ }).first()).toBeVisible({ timeout: 20_000 });
    await checkpoint(info, "live", { pillText, doneChip: await ranChip.innerText() });
    await shot(page, info, "live-done");
  } finally {
    clearInterval(allow);
  }
});

test("@K4 plugin disable restores defaults and removes pills; enable brings them back", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "plugin state is daemon-wide; checked once");
  await openAgent(page);
  await expect(page.getByRole("button", { name: /^Read .*collapsed$/ })).toBeVisible();
  paseo("plugin", "disable", "agent-activity");
  try {
    await expect(page.getByRole("button", { name: /^Detail level: / })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Edited .*collapsed$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /, (done|failed), (collapsed|expanded)$/ })).toHaveCount(0);
    await shot(page, info, "disabled");
  } finally {
    paseo("plugin", "enable", "agent-activity");
  }
  await expect(page.getByRole("button", { name: /^Detail level: / }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Read .*collapsed$/ })).toBeVisible({ timeout: 20_000 });
  await checkpoint(info, "disable-enable", { disabledHadNoPill: true, reEnabled: true });
});

test("@K8 answers and user messages keep Paseo's default rendering", async ({ page }, info) => {
  await openAgent(page);
  await expect(page.getByText(/^In this directory: 1\) read notes\.txt/)).toBeVisible();
  await expect(page.getByText("OK", { exact: true }).first()).toBeVisible();
  await checkpoint(info, "defaults", { userMessage: true, answer: true });
});
