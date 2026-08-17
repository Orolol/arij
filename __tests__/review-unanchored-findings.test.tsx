/**
 * Findings round-trip into the review surface.
 *
 * submit_findings stores one reviewComments row per finding (author "agent",
 * status "open", body "[severity] …"). Inline threads only render on diff
 * lines whose (filePath, lineNumber) matches, so findings anchored to
 * unchanged lines or files outside the diff must surface through the
 * UnanchoredFindings partition — otherwise they'd invisibly block approval.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-utils";
import { projects, epics, reviewComments } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import type { FileDiff } from "@/lib/git/diff";
import type { ReviewComment } from "@/hooks/useReviewComments";
import {
  UnanchoredFindings,
  partitionUnanchoredComments,
} from "@/components/review/UnanchoredFindings";

const noop = async () => {};

function makeFiles(): FileDiff[] {
  return [
    {
      filePath: "lib/auth.ts",
      status: "modified",
      hunks: [
        {
          oldStart: 10,
          oldLines: 3,
          newStart: 10,
          newLines: 4,
          lines: [
            { type: "context", content: "a", oldLineNumber: 10, newLineNumber: 10 },
            { type: "add", content: "b", oldLineNumber: null, newLineNumber: 11 },
            { type: "del", content: "c", oldLineNumber: 11, newLineNumber: null },
            { type: "context", content: "d", oldLineNumber: 12, newLineNumber: 12 },
          ],
        },
      ],
    },
  ];
}

function comment(
  filePath: string,
  lineNumber: number,
  overrides: Partial<ReviewComment> = {}
): ReviewComment {
  return {
    id: createId(),
    epicId: "e-1",
    filePath,
    lineNumber,
    body: "[major] Unvalidated input",
    author: "agent",
    status: "open",
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("partitionUnanchoredComments", () => {
  it("excludes comments that anchor to a rendered diff line", () => {
    const anchoredNew = comment("lib/auth.ts", 11); // add line (new number)
    const anchoredOld = comment("lib/auth.ts", 11, { id: createId() }); // del line shares the anchor
    expect(
      partitionUnanchoredComments(makeFiles(), [anchoredNew, anchoredOld])
    ).toEqual([]);
  });

  it("keeps comments on lines outside the hunks and files outside the diff", () => {
    const outsideLine = comment("lib/auth.ts", 400);
    const outsideFile = comment("lib/legacy/session.ts", 12);
    const result = partitionUnanchoredComments(makeFiles(), [
      comment("lib/auth.ts", 10),
      outsideLine,
      outsideFile,
    ]);
    expect(result).toEqual([outsideLine, outsideFile]);
  });

  it("treats every comment as unanchored when the diff is empty", () => {
    const c = comment("lib/auth.ts", 10);
    expect(partitionUnanchoredComments([], [c])).toEqual([c]);
  });
});

describe("UnanchoredFindings", () => {
  it("renders agent findings grouped by file:line with severity-prefixed bodies", () => {
    render(
      <UnanchoredFindings
        comments={[
          comment("lib/legacy/session.ts", 42, {
            body: "[critical] Token compared with ==",
          }),
          comment("lib/legacy/session.ts", 42, {
            body: "[minor] Prefer const here",
          }),
        ]}
        onUpdateComment={noop}
        onDeleteComment={noop}
      />
    );

    expect(screen.getByTestId("unanchored-findings")).toBeInTheDocument();
    expect(screen.getByText("lib/legacy/session.ts:42")).toBeInTheDocument();
    expect(
      screen.getByText("[critical] Token compared with ==")
    ).toBeInTheDocument();
    expect(screen.getByText("[minor] Prefer const here")).toBeInTheDocument();
    // Agent authorship is visible in the thread header.
    expect(screen.getAllByText("Agent")).toHaveLength(2);
  });

  it("renders nothing when every comment is anchored", () => {
    const { container } = render(
      <UnanchoredFindings
        comments={[]}
        onUpdateComment={noop}
        onDeleteComment={noop}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("round-trips a submit_findings row from the DB into the review surface", () => {
    // Insert exactly what the /api/mcp/submit-findings route stores.
    const { db } = createTestDb();
    const projectId = createId();
    const epicId = createId();
    const now = new Date().toISOString();

    db.insert(projects)
      .values({ id: projectId, name: "P", createdAt: now, updatedAt: now })
      .run();
    db.insert(epics)
      .values({
        id: epicId,
        projectId,
        title: "E",
        status: "review",
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(reviewComments)
      .values({
        id: createId(),
        epicId,
        filePath: "lib/payments/charge.ts",
        lineNumber: 88,
        body: "[critical] Amount is not validated before charge",
        author: "agent",
        status: "open",
      })
      .run();

    const rows = db
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.epicId, epicId))
      .all()
      .map((row) => ({
        ...row,
        createdAt: row.createdAt ?? now,
        updatedAt: row.updatedAt ?? now,
      })) as ReviewComment[];

    // The finding targets a file absent from the diff.
    const unanchored = partitionUnanchoredComments(makeFiles(), rows);
    expect(unanchored).toHaveLength(1);

    render(
      <UnanchoredFindings
        comments={unanchored}
        onUpdateComment={noop}
        onDeleteComment={noop}
      />
    );

    expect(screen.getByText("lib/payments/charge.ts:88")).toBeInTheDocument();
    expect(
      screen.getByText("[critical] Amount is not validated before charge")
    ).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });
});
