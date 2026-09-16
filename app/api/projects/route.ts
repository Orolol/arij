import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, agentSessions } from "@/lib/db/schema";
import { count, eq, sql } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { createProjectSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { validatePath } from "@/lib/validation/path";
import { deriveCloneProvenance } from "@/lib/projects/clone-provenance";

export async function GET() {
  const queryStartedAt = Date.now();

  const activeAgentCounts = db
    .select({
      projectId: agentSessions.projectId,
      activeAgents: count(agentSessions.id).as("active_agents"),
    })
    .from(agentSessions)
    .where(eq(agentSessions.status, "running"))
    .groupBy(agentSessions.projectId)
    .as("active_agent_counts");

  const result = db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      gitRepoPath: projects.gitRepoPath,
      githubOwnerRepo: projects.githubOwnerRepo,
      cloneSource: projects.cloneSource,
      defaultBranch: projects.defaultBranch,
      gitRemoteUrl: projects.gitRemoteUrl,
      imported: projects.imported,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      // The ONLY aggregate any screen reads from this route is the live
      // agent count (the TopBar's breathing dot). The five per-status epic
      // counts and the last-session stamp were carried for the retired
      // dashboard cards; dropping them removes two GROUP BY scans from a
      // route the TopBar hits on every mount.
      activeAgents: sql<number>`COALESCE(${activeAgentCounts.activeAgents}, 0)`,
    })
    .from(projects)
    .leftJoin(activeAgentCounts, eq(projects.id, activeAgentCounts.projectId))
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
    gitRemoteUrl,
    defaultBranch,
  } = validated.data;

  const cleanDefaultBranch = defaultBranch?.trim();
  if (cleanDefaultBranch && cleanDefaultBranch.startsWith("-")) {
    return NextResponse.json(
      { error: `Invalid default branch: ${cleanDefaultBranch}` },
      { status: 400 }
    );
  }

  // Validate gitRepoPath if provided
  if (gitRepoPath) {
    const pathResult = await validatePath(gitRepoPath);
    if (!pathResult.valid) {
      return NextResponse.json(
        { error: pathResult.error },
        { status: 400 }
      );
    }
  }

  // Provenance is read off the disk, not off the request: `clone_source` is what
  // later authorises deleting this directory, so it may only be granted by a
  // marker the clone service wrote into a repository it created itself.
  const provenance = deriveCloneProvenance(gitRepoPath);

  const id = createId();
  const now = new Date().toISOString();

  db.insert(projects)
    .values({
      id,
      name,
      description: description || null,
      gitRepoPath: gitRepoPath || null,
      githubOwnerRepo:
        githubOwnerRepo || provenance.githubOwnerRepo || null,
      cloneSource: provenance.cloneSource,
      gitRemoteUrl: provenance.gitRemoteUrl || gitRemoteUrl || null,
      defaultBranch: cleanDefaultBranch || null,
      status: "ideation",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const project = db.select().from(projects).where(eq(projects.id, id)).get();

  return NextResponse.json({ data: project }, { status: 201 });
}
