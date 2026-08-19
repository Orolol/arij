import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, epics, agentSessions } from "@/lib/db/schema";
import { count, eq, sql } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { createProjectSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { validatePath } from "@/lib/validation/path";
import { parseGitHubRepoInput } from "@/lib/git/remote";
import { cloneDestinationFor } from "@/lib/projects/workspace";

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

  // Validate gitRepoPath if provided
  let storedRepoPath: string | null = null;
  if (gitRepoPath) {
    const pathResult = await validatePath(gitRepoPath);
    if (!pathResult.valid) {
      return NextResponse.json(
        { error: pathResult.error },
        { status: 400 }
      );
    }
    // Store the resolved path, not what the caller typed: every later git
    // operation joins onto it (worktrees at `<path>/../.arij-worktrees`), and
    // a trailing slash or a `./` segment would otherwise produce a different
    // string for the same directory and defeat path-equality checks.
    storedRepoPath = pathResult.normalizedPath;
  }

  /*
   * Clone provenance is established here, not taken on the caller's word.
   * `cloneSource` is the ownership flag that later authorises Arij to delete
   * the directory, and `gitRemoteUrl` is bound by the no-secret-on-disk
   * contract — so a request must not be able to claim either for a path Arij
   * never created, nor to smuggle credentials into a stored URL.
   */
  let storedRemoteUrl: string | null = null;
  let storedOwnerRepo: string | null = githubOwnerRepo?.trim() || null;

  if (gitRemoteUrl?.trim()) {
    // Rejects userinfo for free: `https://user:token@github.com/o/r` does not
    // match the parser's host anchor, so it never becomes a stored URL.
    const parsedRemote = parseGitHubRepoInput(gitRemoteUrl);
    if (!parsedRemote) {
      return NextResponse.json(
        {
          error:
            "gitRemoteUrl must be a GitHub repository URL and must not embed credentials.",
        },
        { status: 400 }
      );
    }

    // Store the normalised clone URL, never the raw input.
    storedRemoteUrl = parsedRemote.cloneUrl;

    if (
      storedOwnerRepo &&
      storedOwnerRepo.toLowerCase() !== parsedRemote.ownerRepo.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error: `githubOwnerRepo (${storedOwnerRepo}) does not match gitRemoteUrl (${parsedRemote.ownerRepo}).`,
        },
        { status: 400 }
      );
    }
    storedOwnerRepo = storedOwnerRepo ?? parsedRemote.ownerRepo;
  }

  if (cloneSource === "github") {
    if (!storedRepoPath || !storedRemoteUrl || !storedOwnerRepo) {
      return NextResponse.json(
        {
          error:
            'cloneSource "github" requires both gitRepoPath and gitRemoteUrl.',
        },
        { status: 400 }
      );
    }

    // The one path that can legitimately carry this flag is the one the clone
    // service would have produced for this repository. Recomputing it checks
    // containment in the managed root and the `<owner>-<repo>` name in a
    // single comparison, and cloneDestinationFor() re-runs the traversal guard.
    const [owner, repo] = storedOwnerRepo.split("/");
    let managedPath: string;
    try {
      managedPath = cloneDestinationFor(owner, repo);
    } catch {
      return NextResponse.json(
        { error: `Invalid GitHub repository: ${storedOwnerRepo}` },
        { status: 400 }
      );
    }

    if (storedRepoPath !== managedPath) {
      return NextResponse.json(
        {
          error:
            'cloneSource "github" is reserved for repositories Arij cloned itself. Import this directory as a local folder instead.',
        },
        { status: 400 }
      );
    }
  }

  const id = createId();
  const now = new Date().toISOString();

  db.insert(projects)
    .values({
      id,
      name,
      description: description || null,
      gitRepoPath: storedRepoPath,
      githubOwnerRepo: storedOwnerRepo,
      // Clone provenance (0027): NULL for a user-supplied path, so Arij never
      // treats a directory it did not create as its own. The values below are
      // the verified/normalised ones, not the raw request fields.
      cloneSource: cloneSource || null,
      gitRemoteUrl: storedRemoteUrl,
      defaultBranch: defaultBranch?.trim() || null,
      status: "ideation",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const project = db.select().from(projects).where(eq(projects.id, id)).get();

  return NextResponse.json({ data: project }, { status: 201 });
}
