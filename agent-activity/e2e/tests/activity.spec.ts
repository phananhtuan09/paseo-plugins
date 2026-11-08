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

// The two cases below need an agent in `default` mode so Bash asks for permission.
test("@R1 live: a command waiting for approval shows Waiting for approval, then a clock after Allow", async ({ page }, info) => {
  test.skip(process.env.E2E_LIVE !== "1", "consumes an agent turn; opt in with E2E_LIVE=1");
  await openAgent(page);
  await setLevel(page, "Brief");
  execFile("paseo", ["send", agentId, "Run the shell command `touch r1.txt && sleep 6 && echo done` and then reply with the single word DONE.", "--home", home], () => {});
  const waiting = page.getByRole("button", { name: /^Running touch r1\.txt.*, waiting for approval, collapsed$/ }).last();
  await expect(waiting).toBeVisible({ timeout: 60_000 });
  await expect(waiting).toContainText("Waiting for approval");
  await expect(waiting).not.toContainText(/\d+s/);
  await shot(page, info, "waiting");
  await page.waitForTimeout(3000);
  execFile("paseo", ["permit", "allow", agentId, "--all", "--home", home], () => {});
  const running = page.getByRole("button", { name: /^Running touch r1\.txt.*, running, collapsed$/ }).last();
  await expect(running).toBeVisible({ timeout: 20_000 });
  await expect(running).toHaveText(/\d+s$/);
  await shot(page, info, "approved");
  await expect(page.getByRole("button", { name: /^Ran touch r1\.txt.*, done, collapsed$/ }).last()).toBeVisible({ timeout: 30_000 });
});

test("@R2 live: a command moved to the background shows In background with a clock, then its total time", async ({ page }, info) => {
  test.skip(process.env.E2E_LIVE !== "1", "consumes an agent turn; opt in with E2E_LIVE=1");
  await openAgent(page);
  await setLevel(page, "Steps");
  const stamp = String(Date.now());
  const command = `: r2-${stamp}; i=0; while [ $i -lt 30 ]; do sleep 1; i=$((i+1)); done; echo finished-r2`;
  execFile("paseo", ["send", agentId, `Run this exact Bash command with the timeout parameter set to 5000: ${command} . Then reply with the single word DONE.`, "--home", home], () => {});
  const allow = setInterval(() => execFile("paseo", ["permit", "allow", agentId, "--all", "--home", home], () => {}), 1500);
  try {
    const background = page.getByRole("button", { name: new RegExp(`r2-${stamp}.*in background, collapsed$`) });
    await expect(background).toBeVisible({ timeout: 60_000 });
    await expect(background).toContainText(/In background · \d+s/);
    await shot(page, info, "background");
    const ended = page.getByRole("button", { name: new RegExp(`^Ran .*r2-${stamp}.*, done, collapsed$`) });
    await expect(ended).toBeVisible({ timeout: 90_000 });
    await expect(ended).toContainText(/\d+s/);
    await checkpoint(info, "background", { ended: await ended.innerText() });
    await shot(page, info, "background-done");
  } finally {
    clearInterval(allow);
  }
});

const autoAllow = () => setInterval(() => execFile("paseo", ["permit", "allow", agentId, "--all", "--home", home], () => {}), 1500);

test("@R3 live: run_in_background shows In background right away, then its total time", async ({ page }, info) => {
  test.skip(process.env.E2E_LIVE !== "1", "consumes an agent turn; opt in with E2E_LIVE=1");
  await openAgent(page);
  await setLevel(page, "Brief");
  const stamp = String(Date.now());
  const command = `: r3-${stamp}; i=0; while [ $i -lt 12 ]; do sleep 1; i=$((i+1)); done; echo finished-r3`;
  execFile("paseo", ["send", agentId, `Run this exact Bash command with run_in_background set to true: ${command} . Then reply with the single word DONE.`, "--home", home], () => {});
  const allow = autoAllow();
  try {
    const background = page.getByRole("button", { name: new RegExp(`r3-${stamp}.*in background, collapsed$`) });
    await expect(background).toBeVisible({ timeout: 60_000 });
    await expect(background).toContainText(/In background · \d+s/);
    await shot(page, info, "run-in-background");
    const ended = page.getByRole("button", { name: new RegExp(`^Ran .*r3-${stamp}.*, done, collapsed$`) });
    await expect(ended).toBeVisible({ timeout: 60_000 });
    await expect(ended).toHaveText(/\d+s/);
    await shot(page, info, "run-in-background-done");
  } finally {
    clearInterval(allow);
  }
});

test("@R4 live: stopping the agent shows the step as canceled with no clock", async ({ page }, info) => {
  test.skip(process.env.E2E_LIVE !== "1", "consumes an agent turn; opt in with E2E_LIVE=1");
  await openAgent(page);
  await setLevel(page, "Brief");
  const stamp = String(Date.now());
  const command = `: r4-${stamp}; i=0; while [ $i -lt 40 ]; do sleep 1; i=$((i+1)); done`;
  execFile("paseo", ["send", agentId, `Run this exact Bash command: ${command}`, "--home", home], () => {});
  const allow = autoAllow();
  try {
    const running = page.getByRole("button", { name: new RegExp(`r4-${stamp}.*, running, collapsed$`) });
    await expect(running).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    execFile("paseo", ["stop", agentId, "--home", home], () => {});
    const canceled = page.getByRole("button", { name: new RegExp(`r4-${stamp}.*, canceled, collapsed$`) });
    await expect(canceled).toBeVisible({ timeout: 30_000 });
    await expect(canceled).not.toContainText(/\d+s$/);
    await shot(page, info, "stopped");
  } finally {
    clearInterval(allow);
  }
});

test("@R5 live: reloading the page mid-run keeps the clock", async ({ page }, info) => {
  test.skip(process.env.E2E_LIVE !== "1", "consumes an agent turn; opt in with E2E_LIVE=1");
  await openAgent(page);
  await setLevel(page, "Brief");
  const stamp = String(Date.now());
  const command = `: r5-${stamp}; i=0; while [ $i -lt 40 ]; do sleep 1; i=$((i+1)); done`;
  execFile("paseo", ["send", agentId, `Run this exact Bash command: ${command}`, "--home", home], () => {});
  const allow = autoAllow();
  try {
    const running = () => page.getByRole("button", { name: new RegExp(`r5-${stamp}.*, running, collapsed$`) });
    await expect(running()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(9000);
    await openAgent(page);
    await setLevel(page, "Brief");
    await expect(running()).toBeVisible({ timeout: 20_000 });
    const seconds = Number(/(\d+)s$/.exec(await running().innerText())?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(9);
    await checkpoint(info, "reload", { secondsAfterReload: seconds });
    await shot(page, info, "reload");
  } finally {
    clearInterval(allow);
    execFile("paseo", ["stop", agentId, "--home", home], () => {});
  }
});

test("@R6 live: a daemon restart kills a background command and the step shows killed", async ({ page }, info) => {
  test.skip(process.env.E2E_LIVE !== "1" || process.env.E2E_RESTART !== "1", "restarts the isolated E2E daemon; opt in with E2E_LIVE=1 E2E_RESTART=1");
  test.setTimeout(180_000);
  await openAgent(page);
  await setLevel(page, "Brief");
  const stamp = String(Date.now());
  const command = `: r6-${stamp}; i=0; while [ $i -lt 120 ]; do sleep 1; i=$((i+1)); done`;
  execFile("paseo", ["send", agentId, `Run this exact Bash command with the timeout parameter set to 5000: ${command}`, "--home", home], () => {});
  const allow = autoAllow();
  try {
    await expect(page.getByRole("button", { name: new RegExp(`r6-${stamp}.*in background, collapsed$`) })).toBeVisible({ timeout: 60_000 });
  } finally {
    clearInterval(allow);
  }
  // Restarting the daemon stops the background process; Claude Code reports it as a `killed` task notification with no exit code.
  // `status unknown` (agent closed, no notification) could not be reproduced here and is covered by unit tests only.
  execFileSync("paseo", ["daemon", "restart", "--home", home], { encoding: "utf8", timeout: 90_000 });
  await page.waitForTimeout(5000);
  await openAgent(page);
  await setLevel(page, "Brief");
  const killed = page.getByRole("button", { name: new RegExp(`r6-${stamp}.*failed, collapsed$`) });
  await expect(killed).toBeVisible({ timeout: 60_000 });
  await expect(killed).toContainText(/killed/);
  await shot(page, info, "killed");
});
