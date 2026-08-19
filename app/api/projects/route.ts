import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, epics, agentSessions } from "@/lib/db/schema";
import { count, eq, sql } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { createProjectSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { validatePath } from "@/lib/validation/path";
import { parseGitHubOwnerRepoFromRemoteUrl, detectGitHubRemote } from "@/lib/git/remote";

export async function GET() {
  const queryStartedAt = Date.now();

  const epicCounts = db
    .select({
      projectId: epics.projectId,
      epicCount: count(epics.id).as("epic_count"),
      epicsDone:
        sql<number>`SUM(CASE WHEN ${epics.status} = 'done' THEN 1 ELSE 0 END)`.as(
          "epics_done"
        ),
      epicsInProgress:
        sql<number>`SUM(CASE WHEN ${epics.status} = 'in_progress' THEN 1 ELSE 0 END)`.as(
          "epics_in_progress"
        ),
      epicsReview:
        sql<number>`SUM(CASE WHEN ${epics.status} = 'review' THEN 1 ELSE 0 END)`.as(
          "epics_review"
        ),
      epicsReleased:
        sql<number>`SUM(CASE WHEN ${epics.status} = 'released' THEN 1 ELSE 0 END)`.as(
          "epics_released"
        ),
    })
    .from(epics)
    .groupBy(epics.projectId)
    .as("epic_counts");

  const activeAgentCounts = db
    .select({
      projectId: agentSessions.projectId,
      activeAgents: count(agentSessions.id).as("active_agents"),
    })
    .from(agentSessions)
    .where(eq(agentSessions.status, "running"))
    .groupBy(agentSessions.projectId)
    .as("active_agent_counts");

  // `agent_sessions.created_at` defaults to sqlite CURRENT_TIMESTAMP
  // ("YYYY-MM-DD HH:MM:SS", UTC) while rows written by the app carry a full
  // ISO string. Normalise to ISO-UTC *before* MAX() so the comparison and the
  // value handed to the client are both unambiguous.
  const lastSessionTimes = db
    .select({
      projectId: agentSessions.projectId,
      lastSessionAt: sql<string | null>`MAX(
        CASE
          WHEN ${agentSessions.createdAt} LIKE '%T%' THEN ${agentSessions.createdAt}
          ELSE replace(${agentSessions.createdAt}, ' ', 'T') || 'Z'
        END
      )`.as("last_session_at"),
    })
    .from(agentSessions)
    .groupBy(agentSessions.projectId)
    .as("last_session_times");

  const result = db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      gitRepoPath: projects.gitRepoPath,
      githubOwnerRepo: projects.githubOwnerRepo,
      imported: projects.imported,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      epicCount: sql<number>`COALESCE(${epicCounts.epicCount}, 0)`,
      epicsDone: sql<number>`COALESCE(${epicCounts.epicsDone}, 0)`,
      epicsInProgress: sql<number>`COALESCE(${epicCounts.epicsInProgress}, 0)`,
      epicsReview: sql<number>`COALESCE(${epicCounts.epicsReview}, 0)`,
      epicsReleased: sql<number>`COALESCE(${epicCounts.epicsReleased}, 0)`,
      activeAgents: sql<number>`COALESCE(${activeAgentCounts.activeAgents}, 0)`,
      lastSessionAt: sql<string | null>`${lastSessionTimes.lastSessionAt}`,
    })
    .from(projects)
    .leftJoin(epicCounts, eq(projects.id, epicCounts.projectId))
    .leftJoin(activeAgentCounts, eq(projects.id, activeAgentCounts.projectId))
    .leftJoin(lastSessionTimes, eq(projects.id, lastSessionTimes.projectId))
    .orderBy(projects.updatedAt)
    .all();

  console.debug("[projects/GET] query profile", {
    rowCount: result.length,
    queryMs: Date.now() - queryStartedAt,
  });

  return NextResponse.json({ data: result });
}

export async function POST(request: NextRequest) {
  const validated = await validateBody(createProjectSchema, request);
  if (isValidationError(validated)) return validated;

  const {
    name,
    description,
    gitRepoPath,
    githubOwnerRepo,
    cloneSource,
    gitRemoteUrl,
    defaultBranch,
  } = validated.data;

  // Validate gitRepoPath if provided. The *normalised* path is what gets
  // stored: every downstream consumer (worktrees, git manager, arji.json sync)
  // resolves against it, so a relative or untidy input must not survive here.
  let normalizedRepoPath: string | null = null;
  if (gitRepoPath) {
    const pathResult = await validatePath(gitRepoPath);
    if (!pathResult.valid) {
      return NextResponse.json(
        { error: pathResult.error },
        { status: 400 }
      );
    }
    normalizedRepoPath = pathResult.normalizedPath;
  }

  const id = createId();
  const now = new Date().toISOString();

  // `git_remote_url` is a clean-URL column: it is rendered in the UI and
  // later re-cloned from, so a credential-bearing or non-GitHub URL must not
  // be persisted. Validate it whenever it is present — not only on the
  // cloneSource path, where a crafted request would otherwise park a dirty
  // URL on a manual project.
  let parsedRemote: ReturnType<typeof parseGitHubOwnerRepoFromRemoteUrl> = null;
  if (gitRemoteUrl) {
    parsedRemote = parseGitHubOwnerRepoFromRemoteUrl(gitRemoteUrl);
    if (!parsedRemote) {
      return NextResponse.json(
        {
          error:
            "gitRemoteUrl is not a parseable clean GitHub remote URL (credentials are not allowed)",
        },
        { status: 400 }
      );
    }
  }

  // `cloneSource: "github"` marks the directory as Arij-owned — the flag a
  // later clone cleanup acts on. The client asserting it is not enough: the
  // full provenance tuple must be present, internally consistent, and the
  // directory must actually be a clone of the claimed repository. Without
  // this, a crafted request could mark any existing directory as Arij-owned.
  if (cloneSource) {
    if (
      !githubOwnerRepo ||
      !gitRemoteUrl ||
      !defaultBranch ||
      !normalizedRepoPath
    ) {
      return NextResponse.json(
        {
          error:
            "cloneSource requires githubOwnerRepo, gitRemoteUrl, defaultBranch and gitRepoPath",
        },
        { status: 400 }
      );
    }

    // The stored remote URL must name the same owner/repo as githubOwnerRepo
    // (parseability was already enforced above for any gitRemoteUrl).
    if (
      !parsedRemote ||
      parsedRemote.ownerRepo.toLowerCase() !== githubOwnerRepo.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error:
            "gitRemoteUrl does not describe the claimed GitHub repository (githubOwnerRepo)",
        },
        { status: 400 }
      );
    }

    // The directory on disk must be a real clone of that repository — its
    // origin is the clean URL Arij wrote, so an unrelated directory cannot
    // pass this check. A non-repository directory makes getRemotes() reject
    // ("fatal: not a git repository"): treat that as "no origin" rather
    // than letting it escape as a 500 — the directory is provably not a
    // clone either way (a partial clone whose .git went missing included).
    let detected: Awaited<ReturnType<typeof detectGitHubRemote>>;
    try {
      detected = await detectGitHubRemote(normalizedRepoPath);
    } catch {
      detected = null;
    }
    if (
      !detected ||
      detected.ownerRepo.toLowerCase() !== githubOwnerRepo.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error:
            "The git repository path is not a clone of the claimed GitHub repository",
        },
        { status: 400 }
      );
    }

    // TODO(workspace-epic): anchor `normalizedRepoPath` to the deterministic
    // managed destination (<projects_root>/<owner>-<repo>) once
    // lib/projects/workspace.ts lands. Until then, a user's own clone of the
    // same repository elsewhere would pass every check above and get marked
    // Arij-owned. clone_source is the flag a later recursive clone cleanup
    // acts on, so that cleanup must not ship before this anchor exists.
  }

  db.insert(projects)
    .values({
      id,
      name,
      description: description || null,
      gitRepoPath: normalizedRepoPath,
      githubOwnerRepo: githubOwnerRepo || null,
      cloneSource: cloneSource || null,
      gitRemoteUrl: gitRemoteUrl || null,
      defaultBranch: defaultBranch || null,
      status: "ideation",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const project = db.select().from(projects).where(eq(projects.id, id)).get();

  return NextResponse.json({ data: project }, { status: 201 });
}
