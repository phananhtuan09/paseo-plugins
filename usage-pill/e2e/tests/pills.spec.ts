import { expect, test } from "@playwright/test";

// Requires a Claude fixture agent on the E2E daemon that finished one turn, alone in its workspace;
// E2E_WORKSPACE_NAME is that workspace's sidebar name.
// Deep links redirect to the home screen on a fresh load, so navigate through the sidebar.
const workspaceName = process.env.E2E_WORKSPACE_NAME;

test("@usage-pill shows provider usage and context pills for a finished agent", async ({ page }, info) => {
  test.skip(!workspaceName, "E2E_WORKSPACE_NAME is required");

  await page.goto("/");
  // Compact layout hides the sidebar behind a menu button.
  const openMenu = page.getByRole("button", { name: "Open menu" });
  await expect(openMenu.or(page.getByText(workspaceName!, { exact: true }).last())).toBeVisible({ timeout: 20_000 });
  if (await openMenu.isVisible()) await openMenu.click();
  await page.getByText(workspaceName!, { exact: true }).last().click({ timeout: 20_000 });
  // Compact layout shows only the workspace name in the header, so wait for the composer instead of the agent title.
  await expect(page.getByPlaceholder(/^Message/)).toBeVisible({ timeout: 20_000 });

  const usagePill = page.getByText(/^Claude \d+%\/\d+%$/);
  const contextPill = page.getByText(/^Ctx \d+%$/);
  await expect(usagePill).toBeVisible({ timeout: 30_000 });
  await expect(contextPill).toBeVisible();

  const usageLabel = (await usagePill.innerText()).trim();
  const contextLabel = (await contextPill.innerText()).trim();
  const contextAria = await page.getByLabel(/^Context window \d+% used$/).first().getAttribute("aria-label");

  // The context pill label and the host's accessibility label report the same percentage.
  expect(contextAria).toBe(`Context window ${contextLabel.replace("Ctx ", "")} used`);

  await info.attach("checkpoint.json", {
    contentType: "application/json",
    body: JSON.stringify({ check: "pills-visible", usageLabel, contextLabel, contextAria }),
  });
  await page.screenshot({ path: info.outputPath(`usage-pill-pills-${info.project.name}.png`) });
});
