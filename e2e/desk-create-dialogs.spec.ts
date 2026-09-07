import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/arij-project";
import { openNewMenu } from "./fixtures/board";
import { withDatabase } from "./fixtures/data-root";

/**
 * The two creation dialogs on /projects/:id confirm and open what they made.
 *
 * A fresh ticket is `backlog`, which no stratum of the desk draws, so the toast
 * and the overlay are the only visible proof that "Create" did anything —
 * `desk-toasts.spec.ts` pins the same contract for the composer. The
 * screenshots land under `data/` (gitignored), one per viewport.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

interface StoredTicket {
  id: string;
  readableId: string | null;
  status: string;
}

function storedTicket(projectId: string, title: string): StoredTicket | undefined {
  return withDatabase((db) =>
    db
      .prepare(
        "SELECT id, readable_id AS readableId, status FROM epics WHERE project_id = ? AND title = ?",
      )
      .get(projectId, title),
  ) as StoredTicket | undefined;
}

/** Where keyboard focus sits, as `tag#data-testid`. */
async function focusedElement(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    return `${el.tagName.toLowerCase()}#${el.getAttribute("data-testid") ?? ""}`;
  });
}

for (const viewport of VIEWPORTS) {
  test(`bug dialog confirms the creation and opens its ticket (${viewport.name})`, async ({
    page,
    project,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(project.boardUrl);

    await openNewMenu(page, "header-new-bug");
    const dialog = page.getByTestId("bug-create-drop-zone");
    await expect(dialog).toBeVisible();
    const title = `Silent bug ${viewport.name} ${project.id}`;
    await dialog.getByPlaceholder("Bug title...").fill(title);
    await dialog.getByRole("button", { name: "Create Bug" }).click();
    await expect(dialog).toBeHidden();

    const toast = page.getByRole("status").filter({ hasText: "Bug created" });
    await expect(toast).toBeVisible();
    // Reading a toast pauses its expiry, so the screenshot below still has it.
    await toast.hover();

    const ticket = storedTicket(project.id, title);
    expect(ticket).toBeTruthy();
    expect(ticket!.status).toBe("backlog");

    const overlay = page.getByTestId("ticket-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(title);
    if (ticket!.readableId) await expect(overlay).toContainText(ticket!.readableId);

    // Past the dialog's 200ms exit animation: Radix returns focus to what
    // was focused before the dialog opened, and that must not pull it out of
    // the overlay the page just opened.
    await page.waitForTimeout(600);
    expect(await focusedElement(page)).toBe("div#epic-detail-panel");
    await page.screenshot({ path: `data/bug-created-${viewport.name}.png` });
    expect(browserErrors).toEqual([]);
  });
}

test("manual epic dialog confirms the creation and opens its ticket", async ({
  page,
  project,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(project.boardUrl);

  await openNewMenu(page, "header-new-epic-manual");
  const dialog = page.getByTestId("epic-create-dialog");
  await expect(dialog).toBeVisible();
  const title = `Confirmed epic ${project.id}`;
  await dialog.getByTestId("epic-title-input").fill(title);
  await dialog.getByTestId("epic-create-submit").click();
  await expect(dialog).toBeHidden();

  const toast = page.getByRole("status").filter({ hasText: "Epic created" });
  await expect(toast).toBeVisible();
  await toast.hover();

  const ticket = storedTicket(project.id, title);
  expect(ticket).toBeTruthy();
  expect(ticket!.status).toBe("backlog");

  const overlay = page.getByTestId("ticket-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(title);
  if (ticket!.readableId) await expect(overlay).toContainText(ticket!.readableId);

  await page.waitForTimeout(600);
  expect(await focusedElement(page)).toBe("div#epic-detail-panel");
  await page.screenshot({ path: "data/epic-created-desktop.png" });
  expect(browserErrors).toEqual([]);
});
