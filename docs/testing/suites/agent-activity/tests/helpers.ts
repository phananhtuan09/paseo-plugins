import { expect, type Page, type TestInfo } from "@playwright/test";

export const workspaceName = process.env.E2E_WORKSPACE_NAME ?? "";
export const home = "/tmp/paseo-e2e-home";

// Deep links redirect to the home screen on a fresh load, so navigate through the sidebar.
export async function openAgent(page: Page): Promise<void> {
  await page.goto("/");
  const openMenu = page.getByRole("button", { name: "Open menu" });
  const row = page.getByText(workspaceName, { exact: true }).last();
  const composer = page.getByPlaceholder(/^Message/);
  await expect(openMenu.or(row).or(composer).first()).toBeVisible({ timeout: 20_000 });
  // A reload can land straight on the agent that was open.
  if (await composer.isVisible()) return;
  if (await openMenu.isVisible()) await openMenu.click();
  await row.click({ timeout: 20_000 });
  await expect(page.getByPlaceholder(/^Message/)).toBeVisible({ timeout: 20_000 });
}

export async function setLevel(page: Page, level: "Brief" | "Steps" | "Full"): Promise<void> {
  const pill = page.getByRole("button", { name: /^Detail level: / }).first();
  for (let i = 0; i < 3; i += 1) {
    if ((await pill.innerText()).trim() === level) return;
    await pill.click();
  }
  await expect(pill).toHaveText(level);
}

export async function checkpoint(info: TestInfo, name: string, data: Record<string, unknown>): Promise<void> {
  await info.attach(`${name}.json`, { contentType: "application/json", body: JSON.stringify({ check: name, ...data }) });
}

export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: info.outputPath(`agent-activity-${name}-${info.project.name}-${process.env.E2E_SCHEME ?? "dark"}.png`) });
}
