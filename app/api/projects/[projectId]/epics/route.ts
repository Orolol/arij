import {
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { ChatEpicProposalError, findChatEpicProposal, identifyChatEpicProposal } from "@/lib/chat/epic-proposals";
import { readEpicActivityFacts } from "@/lib/control-desk/read-model";
import { db } from "@/lib/db";
import {
  chatEpicProposals,
  epics,
  frictions,
  ticketActivityLog
} from "@/lib/db/schema";
import { insertDependencies } from "@/lib/dependencies/crud";
import {
  CrossProjectError,
  CycleError,
  DependencyTargetNotFoundError,
} from "@/lib/dependencies/validation";
import { emitTicketCreated, emitTicketDependenciesChanged } from "@/lib/events/emit";
import { OPEN_FRICTION_STATUSES } from "@/lib/frictions/constants";
import {
  findOpenDuplicateBug,
  type OpenBugDuplicate,
} from "@/lib/mcp/create-bug";
import {
  buildMcpCreateBugActivityReason,
  MCP_CREATE_BUG_ACTION_HEADER,
  MCP_CREATE_BUG_SOURCE_TICKET_HEADER,
} from "@/lib/mcp/create-bug-contract";
import { resolveOptionalMcpToken } from "@/lib/mcp/http-auth";
import { insertEpicWithStories } from "@/lib/planning/create";
import { tryExportArjiJson } from "@/lib/sync/export";
import { createId } from "@/lib/utils/nanoid";
import { createEpicSchema } from "@/lib/validation/schemas";
import { isValidationError, validateBody } from "@/lib/validation/validate";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

class FrictionConversionConflict extends Error {}

/** Optional prose: blank is absence, so it is stored as NULL, not `""`. */
function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

class DuplicateMcpBugError extends Error {
  constructor(readonly existingBug: OpenBugDuplicate) {
    super(
      `An open bug with the same normalized title already exists: ${existingBug.readableId ?? existingBug.id}.`
    );
    this.name = "DuplicateMcpBugError";
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (request.nextUrl.searchParams.get("view") === "index") {
    const data = db.select({ id: epics.id, readableId: epics.readableId, title: epics.title })
      .from(epics).where(eq(epics.projectId, projectId)).orderBy(epics.position).all();
    return NextResponse.json({ data });
  }
  const rows = db.select().from(epics).where(eq(epics.projectId, projectId)).orderBy(epics.position).all();
  const facts = readEpicActivityFacts(db, rows.map((row) => row.id), [projectId], [], false);
  return NextResponse.json({ data: rows.map((row) => ({
    ...row,
    ...facts.storyCountsByEpic.get(row.id) ?? { usCount: 0, usDone: 0 },
    latestSessionOutcome: facts.latestSessionByEpic.get(row.id)?.outcome ?? null,
  })) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(createEpicSchema, request);
  if (isValidationError(validated)) return validated;

  const body = validated.data;

  // create_bug still enters through this exact UI route. A valid short-lived
  // MCP token upgrades its creation audit from an ordinary UI write to a
  // session-attributed agent write. Unauthenticated/spoofed headers are
  // ignored, so callers cannot impersonate an agent session.
  const optionalMcpAuth = resolveOptionalMcpToken(request);
  const isAttributedAgentBug =
    body.type === "bug" &&
    request.headers.get(MCP_CREATE_BUG_ACTION_HEADER) === "create_bug" &&
    optionalMcpAuth?.projectId === projectId &&
    optionalMcpAuth.agentType !== "chat";

  let sourceTicketForAudit: { id: string; readableId: string | null } | null = null;
  if (isAttributedAgentBug) {
    const sourceTicketId = request.headers.get(
      MCP_CREATE_BUG_SOURCE_TICKET_HEADER,
    );
    if (sourceTicketId) {
      sourceTicketForAudit =
        db
          .select({ id: epics.id, readableId: epics.readableId })
          .from(epics)
          .where(
            and(
              eq(epics.id, sourceTicketId),
              eq(epics.projectId, projectId),
            ),
          )
          .get() ?? null;
    }
  }

  const foundProject = getProjectOr404(projectId);
  if (isErrorResponse(foundProject)) return foundProject;
  const { project } = foundProject;

  const proposal = identifyChatEpicProposal(projectId, body);
  if (proposal) {
    try {
      const previous = findChatEpicProposal(db, proposal);
      if (previous) return NextResponse.json({ data: previous });
    } catch (error) {
      if (error instanceof ChatEpicProposalError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  }

  const sourceFriction = body.frictionId
    ? db
        .select({ id: frictions.id, status: frictions.status })
        .from(frictions)
        .where(
          and(
            eq(frictions.id, body.frictionId),
            eq(frictions.projectId, projectId),
          ),
        )
        .get()
    : null;

  if (body.frictionId && !sourceFriction) {
    return NextResponse.json({ error: "Friction not found" }, { status: 404 });
  }
  if (
    sourceFriction &&
    !OPEN_FRICTION_STATUSES.includes(
      sourceFriction.status as (typeof OPEN_FRICTION_STATUSES)[number],
    )
  ) {
    return NextResponse.json(
      { error: "Only an open friction can be converted", code: "FRICTION_CLOSED" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  // Every story the caller sent gets inserted. `userStoryInput` already
  // rejected untitled ones, so there is nothing left to filter here — and
  // filtering is precisely what must not happen: silently dropping a member and
  // still answering 201 makes partial persistence look like success.
  const normalizedUserStories = (body.userStories ?? []).map((story) => ({
    title: story.title,
    description: trimmedOrNull(story.description),
    acceptanceCriteria: trimmedOrNull(story.acceptanceCriteria),
  }));

  // Friction conversions always enter through the ordinary backlog feature
  // path, even if a caller tries to smuggle another board status or type.
  const targetStatus = body.frictionId ? "backlog" : body.status || "backlog";
  const targetType = body.frictionId ? "feature" : body.type || "feature";

  const maxPos = db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(epics)
    .where(and(eq(epics.projectId, projectId), eq(epics.status, targetStatus)))
    .get();

  const id = createId();

  const storiesToInsert = normalizedUserStories.map((story, index) => ({
    id: createId(),
    epicId: id,
    title: story.title,
    description: story.description,
    acceptanceCriteria: story.acceptanceCriteria,
    status: "todo",
    position: index,
    createdAt: now,
  }));

  // Normalize dependency edges provided by the generation agent, replacing
  // placeholder "$self" references with the newly created epic ID.
  const dependencyEdges = (Array.isArray(body.dependencies) ? body.dependencies : [])
    .filter(
      (dep) =>
        typeof dep?.ticketId === "string" &&
        typeof dep?.dependsOnTicketId === "string"
    )
    .map((dep) => ({
      ticketId: dep.ticketId === "$self" ? id : dep.ticketId,
      dependsOnTicketId:
        dep.dependsOnTicketId === "$self" ? id : dep.dependsOnTicketId,
    }));

  let proposalDependencies: ReturnType<typeof insertDependencies> = [];
  try {
    const previous = db.transaction((tx) => {
      // BEGIN IMMEDIATE serializes separate server connections as well as tabs.
      // The lookup and claim share the epic/stories transaction, so a failed
      // insert never consumes the proposal or its readable ticket number.
      if (proposal) {
        const existing = findChatEpicProposal(tx, proposal);
        if (existing) return existing;
      }
      if (isAttributedAgentBug) {
        const duplicate = findOpenDuplicateBug(projectId, body.title, tx);
        if (duplicate) throw new DuplicateMcpBugError(duplicate);
      }

      insertEpicWithStories(tx, project.name, {
          id,
          projectId,
          title: body.title,
          description: body.description || null,
          priority: body.priority ?? 0,
          status: targetStatus,
          position: (maxPos?.max ?? -1) + 1,
          branchName: body.branchName || null,
          confidence: body.confidence ?? null,
          evidence: body.evidence || null,
          createdAt: now,
          updatedAt: now,
          type: targetType,
          linkedEpicId: body.linkedEpicId || null,
          images: body.images ? JSON.stringify(body.images) : null,
        }, storiesToInsert);
      if (body.frictionId) {
        const result = tx
          .update(frictions)
          .set({ status: "converted", epicId: id })
          .where(
            and(
              eq(frictions.id, body.frictionId),
              eq(frictions.projectId, projectId),
              inArray(frictions.status, [...OPEN_FRICTION_STATUSES]),
            ),
          )
          .run();
        if (result.changes !== 1) {
          throw new FrictionConversionConflict();
        }
      }
      if (isAttributedAgentBug && optionalMcpAuth) {
        const sourceTicketRef =
          sourceTicketForAudit?.readableId ??
          sourceTicketForAudit?.id ??
          "project-scoped session";
        tx.insert(ticketActivityLog)
          .values({
            id: createId(),
            projectId,
            epicId: id,
            fromStatus: body.status || "backlog",
            toStatus: body.status || "backlog",
            actor: "agent",
            reason: buildMcpCreateBugActivityReason({
              sourceTicketRef,
              sourceStoryId: optionalMcpAuth.userStoryId,
              sessionId: optionalMcpAuth.sessionId,
            }),
            sessionId: optionalMcpAuth.sessionId,
            createdAt: now,
          })
          .run();
      }
      if (dependencyEdges.length > 0) {
        proposalDependencies = insertDependencies(projectId, dependencyEdges);
      }
      if (proposal) {
        tx.insert(chatEpicProposals).values({ ...proposal, epicId: id,
          userStoriesCreated: storiesToInsert.length, dependenciesCreated: proposalDependencies.length,
          createdAt: now,
        }).run();
      }
      return null;
    }, { behavior: "immediate" });
    if (previous) return NextResponse.json({ data: previous });
  } catch (error) {
    if (error instanceof DependencyTargetNotFoundError || error instanceof CrossProjectError || error instanceof CycleError) {
      return NextResponse.json({ error: error.message,
        code: error instanceof DependencyTargetNotFoundError ? "DEPENDENCY_TARGET_NOT_FOUND" : error instanceof CycleError ? "CYCLE_DETECTED" : "CROSS_PROJECT_DEPENDENCY",
        ...(error instanceof CycleError ? { cycle: error.cycle } : {}),
      }, { status: 422 });
    }
    if (error instanceof ChatEpicProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof FrictionConversionConflict) {
      return NextResponse.json(
        { error: "Friction is no longer open", code: "FRICTION_CLOSED" },
        { status: 409 },
      );
    }
    if (error instanceof DuplicateMcpBugError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "DUPLICATE_BUG",
          existing_bug: {
            id: error.existingBug.id,
            readable_id: error.existingBug.readableId,
            title: error.existingBug.title,
            status: error.existingBug.status,
          },
        },
        { status: 409 }
      );
    }
    console.error("[epics/POST] Failed to create epic transaction:", error);
    return NextResponse.json({ error: "Failed to create epic" }, { status: 500 });
  }

  // Persist dependency edges (already validated above, before the insert)
  const dependenciesCreated = proposalDependencies.length;
  if (proposalDependencies.length > 0) {
    emitTicketDependenciesChanged(projectId, proposalDependencies.flatMap((edge) => [edge.ticketId, edge.dependsOnTicketId]));
  }

  const epic = db.select().from(epics).where(eq(epics.id, id)).get();
  emitTicketCreated(projectId, id, body.title);
  tryExportArjiJson(projectId);
  return NextResponse.json(
    {
      data: {
        ...epic,
        userStoriesCreated: storiesToInsert.length,
        dependenciesCreated,
      },
    },
    { status: 201 },
  );
}
