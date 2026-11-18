import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  epics,
  userStories,
  documents,
  agentSessions,
  ticketComments,
  customReviewAgents,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import { processManager } from "@/lib/claude/process-manager";
import {
  buildReviewPrompt,
  buildCustomReviewPrompt,
  type ReviewType,
} from "@/lib/claude/prompt-builder";
import { resolveFullPrompt, resolveProvider } from "@/lib/claude/prompt-resolver";
import { parseClaudeOutput } from "@/lib/claude/json-parser";
import type { ProviderType } from "@/lib/providers";
import type { AgentType } from "@/lib/types/agent-config";
import fs from "fs";
import path from "path";

type Params = { params: Promise<{ projectId: string; storyId: string }> };

const VALID_REVIEW_TYPES: ReviewType[] = [
  "security",
  "code_review",
  "compliance",
];

const REVIEW_LABELS: Record<ReviewType, string> = {
  security: "Security Review",
  code_review: "Code Review",
  compliance: "Compliance & Accessibility Review",
};

const REVIEW_TYPE_TO_AGENT_TYPE: Record<ReviewType, AgentType> = {
  security: "review_security",
  code_review: "review_code",
  compliance: "review_compliance",
};

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId, storyId } = await params;
  const body = await request.json();

  const {
    reviewTypes = [],
    customAgentIds = [],
    provider: providerParam,
  } = body as {
    reviewTypes?: ReviewType[];
    customAgentIds?: string[];
    provider?: ProviderType;
  };
  const provider: ProviderType = providerParam || resolveProvider("review_code", projectId);

  // Must have at least one review type or custom agent
  if (
    (!reviewTypes || reviewTypes.length === 0) &&
    (!customAgentIds || customAgentIds.length === 0)
  ) {
    return NextResponse.json(
      { error: "At least one reviewType or customAgentId is required" },
      { status: 400 }
    );
  }

  // Validate built-in review types
  for (const rt of reviewTypes) {
    if (!VALID_REVIEW_TYPES.includes(rt)) {
      return NextResponse.json(
        {
          error: `Invalid review type: ${rt}. Valid types: ${VALID_REVIEW_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }
  }

  // Validate story exists and is in review status
  const story = db
    .select()
    .from(userStories)
    .where(eq(userStories.id, storyId))
    .get();

  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  if (story.status !== "review") {
    return NextResponse.json(
      { error: "Story must be in review status for agent review" },
      { status: 400 }
    );
  }

  // Get epic
  const epic = db
    .select()
    .from(epics)
    .where(eq(epics.id, story.epicId))
    .get();

  if (!epic) {
    return NextResponse.json(
      { error: "Parent epic not found" },
      { status: 404 }
    );
  }

  // Get project
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    return NextResponse.json(
      { error: "Project not found" },
      { status: 404 }
    );
  }

  if (!project.gitRepoPath) {
    return NextResponse.json(
      { error: "Project has no git repository configured" },
      { status: 400 }
    );
  }

  const gitRepoPath = project.gitRepoPath;
  const isRepo = await isGitRepo(gitRepoPath);
  if (!isRepo) {
    return NextResponse.json(
      { error: `Path is not a git repository: ${gitRepoPath}` },
      { status: 400 }
    );
  }

  // Load context
  const docs = db
    .select()
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .all();

  // Ensure worktree exists
  const { worktreePath, branchName } = await createWorktree(
    gitRepoPath,
    epic.id,
    epic.title
  );

  const sessionsCreated: string[] = [];

  // Helper: dispatch a review session
  function dispatchReviewSession(
    prompt: string,
    label: string,
    sessionProvider: ProviderType
  ) {
    const sessionId = createId();
    const now = new Date().toISOString();
    const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
    fs.mkdirSync(logsDir, { recursive: true });
    const logsPath = path.join(logsDir, "logs.json");

    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        epicId: epic!.id,
        userStoryId: storyId,
        status: "running",
        mode: "plan",
        provider: sessionProvider,
        prompt,
        logsPath,
        branchName,
        worktreePath,
        startedAt: now,
        createdAt: now,
      })
      .run();

    processManager.start(sessionId, {
      mode: "plan",
      prompt,
      cwd: worktreePath,
    });

    // Background: wait for completion, post review comment
    ((sid, lbl) => {
      (async () => {
        let info = processManager.getStatus(sid);
        while (info && info.status === "running") {
          await new Promise((r) => setTimeout(r, 2000));
          info = processManager.getStatus(sid);
        }

        const completedAt = new Date().toISOString();
        const result = info?.result;

        try {
          fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
        } catch {
          // ignore
        }

        db.update(agentSessions)
          .set({
            status: result?.success ? "completed" : "failed",
            completedAt,
            error: result?.error || null,
          })
          .where(eq(agentSessions.id, sid))
          .run();

        const output = result?.result
          ? parseClaudeOutput(result.result).content
          : result?.error || "Review agent completed without output.";

        db.insert(ticketComments)
          .values({
            id: createId(),
            userStoryId: storyId,
            author: "agent",
            content: `**${lbl}**\n\n${output}`,
            agentSessionId: sid,
            createdAt: completedAt,
          })
          .run();
      })();
    })(sessionId, label);

    sessionsCreated.push(sessionId);
  }

  // Dispatch built-in review types
  for (const reviewType of reviewTypes) {
    const agentType = REVIEW_TYPE_TO_AGENT_TYPE[reviewType];
    const globalPrompt = resolveFullPrompt(agentType, projectId);

    const prompt = buildReviewPrompt(
      project,
      docs,
      epic,
      story,
      reviewType,
      globalPrompt
    );

    dispatchReviewSession(prompt, REVIEW_LABELS[reviewType], provider);
  }

  // Dispatch custom review agents
  if (customAgentIds.length > 0) {
    const customAgentRows = db
      .select()
      .from(customReviewAgents)
      .where(inArray(customReviewAgents.id, customAgentIds))
      .all();

    for (const agent of customAgentRows) {
      if (agent.isEnabled === 0) continue;

      const globalPrompt = resolveFullPrompt("review_code", projectId);

      const prompt = buildCustomReviewPrompt(
        project,
        docs,
        epic,
        story,
        agent.name,
        agent.systemPrompt,
        globalPrompt
      );

      dispatchReviewSession(prompt, agent.name, provider);
    }
  }

  return NextResponse.json({
    data: {
      sessions: sessionsCreated,
      count: sessionsCreated.length,
    },
  });
}
