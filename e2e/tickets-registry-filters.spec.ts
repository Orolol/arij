import { expect, test } from "./fixtures/arij-project";
import { withDatabase } from "./fixtures/data-root";

// Real routes and database; no agent dispatch is needed for this read-only view.
test("filters tickets by project and exact state and sorts from headers", async ({ page, project }, testInfo) => {
  const otherId = `${project.id}-other`;
  // Titles carry the project id because the last third of this test asserts on
  // the registry with NO project filter, where the rows of every concurrently
  // running spec are legitimately present too. It is also the OWNED MARKER the
  // registry's search field is given there, so it has to be unique to this run.
  const alpha = `Alpha registry ticket ${project.id}`;
  const zulu = `Zulu registry ticket ${project.id}`;
  const review = `Review registry ticket ${project.id}`;
  const other = `Other registry ticket ${project.id}`;
  // Rows seeded mid-test to crowd the unfiltered registry. Deliberately WITHOUT
  // `project.id`: they have to be invisible to the owned marker, which is the
  // point they exist to make.
  const noisePrefix = "ZZZ sibling review";
  const noiseRows = 5;
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

    // THE INTERFERENCE, seeded rather than hoped for.
    //
    // Five `review` tickets whose titles sort ahead of this test's own under
    // the descending title sort now in effect — one more than
    // `GROUP_PREVIEW.waiting` (4, `lib/tickets-registry/aggregate.ts`), and
    // that margin is the whole point. `RegistryTable` renders a group's first
    // four rows and hides the rest behind "+ n autres", so on an unfiltered
    // registry the owned row is not merely outnumbered: it is ABSENT FROM THE
    // DOM. `.filter({ hasText: … })` narrows a locator, and a locator cannot
    // find a row that was never rendered — on this surface PRESENCE is exactly
    // as unreliable as a count. They live in the other project so the scoped
    // assertions above keep their meaning, and the `finally` below removes
    // them with the rest of that project's rows.
    withDatabase((db) => {
      const insert = db.prepare("INSERT INTO epics (id, project_id, title, status, priority, position) VALUES (?, ?, ?, ?, ?, ?)");
      for (let index = 0; index < noiseRows; index++) {
        insert.run(`${project.id}-noise-${index}`, otherId, `${noisePrefix} ${index}`, "review", 0, index);
      }
    });

    await page.getByRole("button", { name: /^Projet :/ }).click();
    await page.getByRole("menuitem", { name: "Tous les projets", exact: true }).click();
    // The crowd is really on screen and the group really is truncated, so the
    // step below is proving something rather than passing by luck.
    await expect(rows.filter({ hasText: noisePrefix }).first()).toBeVisible();
    await expect(page.getByTestId("tickets-show-all").first()).toBeVisible();
    // THE HAZARD, ASSERTED: the owned row is not merely outnumbered, it is
    // absent from the DOM. Zero is deterministic here — five rows sort ahead
    // of it and the preview holds four, whatever else the workspace holds.
    await expect(rows.filter({ hasText: review })).toHaveCount(0);
    // Kept as the artefact of the hazard: the crowd on screen, the owned row
    // not on it, and the truncation line that swallowed it. Photographed with
    // the project menu closed, or it covers the rows the picture is about.
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("tickets-registry-crowded.png"), fullPage: true });

    // NARROW THE SURFACE, not just the locator. The registry's own search
    // field is the only control that reduces what gets RENDERED here: it
    // filters both the client rows and the `q=` the route runs, which drops
    // the group back under its preview cap and puts the owned row in the DOM.
    // With no project filter the registry spans EVERY project in the workspace
    // (app/tickets/page.tsx), and all four workers share one e2e database
    // under `fullyParallel` — so a concurrent spec's ticket is a legitimate
    // extra row here, and an absolute count read 2 as soon as anything else
    // held a `review` ticket.
    //
    // What this step is about is the project filter widening: the review
    // ticket of THIS project comes back, while the state filter still hides
    // its two To Do ones and the other project's.
    const field = page.getByTestId("tickets-filter-field");
    await field.fill(project.id);
    await expect(rows.filter({ hasText: review })).toHaveCount(1);
    for (const title of [alpha, zulu, other]) {
      await expect(rows.filter({ hasText: title })).toHaveCount(0);
    }
    await expect(rows.filter({ hasText: noisePrefix })).toHaveCount(0);

    // The state filter's reset, asserted back under this project — the only
    // scope where an exact count means anything. The marker is cleared first
    // so that what the last step demonstrates is the state filter alone.
    await field.fill("");
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


/**
 * The filters ARE the URL (epic 5sCe4w0bxRYl).
 *
 * The unit coverage in `__tests__/tickets-registry-url-state.test.tsx` drives a
 * stand-in address bar; this is the real one — a real reload, a real Back and a
 * real Forward through Chrome's session history, against the real route.
 */
test("keeps the filters in the URL across a reload and browser history", async ({ page, project }, testInfo) => {
  const otherId = `${project.id}-url`;
  withDatabase((db) => {
    db.prepare("INSERT INTO projects (id, name, git_repo_path) VALUES (?, ?, ?)").run(otherId, "Other URL project", project.repoPath);
    const insert = db.prepare("INSERT INTO epics (id, project_id, title, status, priority, position) VALUES (?, ?, ?, ?, ?, ?)");
    insert.run(`${project.id}-scoped`, project.id, "Scoped registry ticket", "todo", 1, 0);
    insert.run(`${project.id}-other`, otherId, "Other URL ticket", "todo", 1, 0);
  });
  try {
    await page.goto(`/tickets?project=${project.id}`);
    const rows = page.getByTestId("tickets-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Scoped registry ticket");

    // Selecting another project moves the parameter with it, synchronously.
    await page.getByRole("button", { name: /^Projet :/ }).click();
    await page.getByRole("menuitem", { name: "Other URL project", exact: true }).click();
    await expect(page).toHaveURL(`/tickets?project=${otherId}`);
    await expect(rows.first()).toContainText("Other URL ticket");

    // A sort and a state pill join it rather than replacing it.
    await page.getByRole("columnheader", { name: "Titre" }).getByRole("button").click();
    await expect(page).toHaveURL(`/tickets?project=${otherId}&sort=titre`);
    await page.getByTestId("tickets-filter-done").click();
    await expect(page).toHaveURL(`/tickets?project=${otherId}&state=done&sort=titre`);
    await expect(rows).toHaveCount(0);

    // THE RELOAD the ticket is about: the screen comes back as it was left.
    await page.reload();
    await expect(page.getByTestId("tickets-filter-done")).toHaveAttribute("data-active", "true");
    await expect(page.getByRole("button", { name: /^Projet :/ })).toContainText("Other URL project");
    await expect(page.getByRole("button", { name: /^sort:/ })).toContainText("titre ↑");
    await expect(rows).toHaveCount(0);

    // Back walks the filters one gesture at a time; Forward replays them.
    await page.goBack();
    await expect(page).toHaveURL(`/tickets?project=${otherId}&sort=titre`);
    await expect(rows.first()).toContainText("Other URL ticket");
    await page.goBack();
    await expect(page).toHaveURL(`/tickets?project=${otherId}`);
    await page.goBack();
    await expect(page).toHaveURL(`/tickets?project=${project.id}`);
    await expect(rows.first()).toContainText("Scoped registry ticket");
    await page.goForward();
    await expect(page).toHaveURL(`/tickets?project=${otherId}`);
    await expect(rows.first()).toContainText("Other URL ticket");

    await page.screenshot({ path: testInfo.outputPath("tickets-registry-url-filters.png"), fullPage: true });
  } finally {
    withDatabase((db) => {
      db.prepare("DELETE FROM epics WHERE project_id = ?").run(otherId);
      db.prepare("DELETE FROM projects WHERE id = ?").run(otherId);
    });
  }
});
