import { expect, test } from "./fixtures/arij-project";
import { withDatabase } from "./fixtures/data-root";

// Real routes and database; no agent dispatch is needed for this read-only view.
test("filters tickets by project and exact state and sorts from headers", async ({ page, project }, testInfo) => {
  const otherId = `${project.id}-other`;
  // Titles carry the project id because the last third of this test asserts on
  // the registry with NO project filter, where the rows of every concurrently
  // running spec are legitimately present too.
  const alpha = `Alpha registry ticket ${project.id}`;
  const zulu = `Zulu registry ticket ${project.id}`;
  const review = `Review registry ticket ${project.id}`;
  const other = `Other registry ticket ${project.id}`;
  withDatabase((db) => {
    db.prepare("INSERT INTO projects (id, name, git_repo_path) VALUES (?, ?, ?)").run(otherId, "Other registry project", project.repoPath);
    const insert = db.prepare("INSERT INTO epics (id, project_id, title, status, priority, position) VALUES (?, ?, ?, ?, ?, ?)");
    insert.run(`${project.id}-a`, project.id, alpha, "todo", 1, 1);
    insert.run(`${project.id}-z`, project.id, zulu, "todo", 3, 0);
    insert.run(`${project.id}-r`, project.id, review, "review", 2, 2);
    insert.run(`${project.id}-x`, otherId, other, "todo", 0, 0);
  });
  try {
    await page.goto(`/tickets?project=${project.id}`);
    const rows = page.getByTestId("tickets-row");
    await expect(rows).toHaveCount(3);
    await page.getByRole("button", { name: /^État :/ }).click();
    await page.getByRole("menuitem", { name: "To Do", exact: true }).click();
    await expect(rows).toHaveCount(2);
    const titleHeader = page.getByRole("columnheader", { name: "Titre" });
    await titleHeader.getByRole("button").click();
    await expect(rows.first()).toContainText(alpha);
    await expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
    await titleHeader.getByRole("button").press("Enter");
    await expect(rows.first()).toContainText(zulu);
    await expect(titleHeader).toHaveAttribute("aria-sort", "descending");
    await page.getByRole("button", { name: /^Projet :/ }).click();
    await page.getByRole("menuitem", { name: "Other registry project", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(other);
    await page.getByRole("button", { name: /^État :/ }).click();
    await page.getByRole("menuitem", { name: "Review", exact: true }).click();
    await expect(rows).toHaveCount(0);
    await page.getByRole("button", { name: /^Projet :/ }).click();
    await page.getByRole("menuitem", { name: "Tous les projets", exact: true }).click();
    // BY IDENTITY, not by count. With no project filter the registry spans
    // EVERY project in the workspace (app/tickets/page.tsx), and all four
    // workers share one e2e database under `fullyParallel` — so a concurrent
    // spec's ticket is a legitimate extra row. `toHaveCount(1)` here read 2 as
    // soon as anything else held a `review` ticket. Same defect and same
    // repair as the eight-chips test in `piscine-finishing`.
    //
    // What this step is about is the project filter widening: the review
    // ticket of THIS project comes back, while the state filter still hides
    // its two To Do ones and the other project's.
    await expect(rows.filter({ hasText: review })).toHaveCount(1);
    for (const title of [alpha, zulu, other]) {
      await expect(rows.filter({ hasText: title })).toHaveCount(0);
    }
    // The state filter's reset, asserted back under this project — the only
    // scope where an exact count means anything. Not merely racy globally:
    // `GROUP_PREVIEW` truncates each group to a handful of rows, so with the
    // whole workspace in view a spec's own tickets can be pushed past the
    // "+ n autres" line and vanish from an unfiltered registry.
    await page.getByRole("button", { name: /^Projet :/ }).click();
    await page.getByRole("menuitem", { name: project.name, exact: true }).click();
    await page.getByRole("button", { name: /^État :/ }).click();
    await page.getByRole("menuitem", { name: "Tous les états", exact: true }).click();
    await expect(rows).toHaveCount(3);
    for (const title of [alpha, zulu, review]) {
      await expect(rows.filter({ hasText: title })).toHaveCount(1);
    }
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("tickets-registry-filters.png"), fullPage: true });
  } finally {
    withDatabase((db) => {
      db.prepare("DELETE FROM epics WHERE project_id = ?").run(otherId);
      db.prepare("DELETE FROM projects WHERE id = ?").run(otherId);
    });
  }
});


test("filtering keeps shipped prerequisites satisfied and real blockers readable", async ({ page, project }, testInfo) => {
  withDatabase((db) => {
    const insert = db.prepare("INSERT INTO epics (id, project_id, title, readable_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    insert.run(`${project.id}-dep`, project.id, "Old shipped prerequisite", "ARJ-001", "done", "2020-01-01 00:00:00");
    for (let index = 0; index < 40; index++) {
      insert.run(`${project.id}-done-${index}`, project.id, `Recent shipped ${index}`, null, "done", "2026-09-05T08:00:00Z");
    }
    insert.run(`${project.id}-ready`, project.id, "Ready dependent", null, "todo", "2026-09-05T08:00:00Z");
    insert.run(`${project.id}-blocked`, project.id, "Blocked dependent", null, "todo", "2026-09-05T08:00:00Z");
    insert.run(`${project.id}-review`, project.id, "Review prerequisite", "ARJ-002", "review", "2026-09-05T08:00:00Z");
    const edge = db.prepare("INSERT INTO ticket_dependencies (id, project_id, scope_id, ticket_id, depends_on_ticket_id) VALUES (?, ?, ?, ?, ?)");
    edge.run(`${project.id}-edge1`, project.id, project.id, `${project.id}-ready`, `${project.id}-dep`);
    edge.run(`${project.id}-edge2`, project.id, project.id, `${project.id}-blocked`, `${project.id}-review`);
  });
  await page.goto(`/tickets?project=${project.id}`);
  await page.getByRole("button", { name: /^État :/ }).click();
  await page.getByRole("menuitem", { name: "To Do", exact: true }).click();
  const rows = page.getByTestId("tickets-row");
  await expect(rows).toHaveCount(2);
  const ready = rows.filter({ hasText: "Ready dependent" });
  const blocked = rows.filter({ hasText: "Blocked dependent" });
  await expect(ready).toContainText("#1");
  await expect(ready).not.toContainText("blocked");
  await expect(blocked).toContainText("ARJ-002");
  await expect(blocked).not.toContainText(`${project.id}-review`);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("tickets-registry-dependencies.png"), fullPage: true, animations: "disabled" });
});
