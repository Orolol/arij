import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubIssues, namedAgents, projects, epics } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { createOctokit, parseOwnerRepo } from "@/lib/github/client";
import { generateReadableId } from "@/lib/db/readable-id";

export interface RemoteIssue {
  issueNumber: number;
  title: string;
  body: string | null;
  labels: string[];
  milestone: string | null;
  assignees: string[];
  githubUrl: string;
  createdAtGitHub: string;
  updatedAtGitHub: string;
}

function toLowerSet(values: string[]): Set<string> {
  return new Set(values.map((v) => v.toLowerCase()));
}

function mapIssueType(labels: string[]): "feature" | "bug" {
  const lower = toLowerSet(labels);
  const bugLabels = ["bug", "defect", "error"];
  if (bugLabels.some((label) => lower.has(label))) {
    return "bug";
  }

  const featureLabels = ["feature", "enhancement", "epic"];
  if (featureLabels.some((label) => lower.has(label))) {
    return "feature";
  }

  return "feature";
}

function parseEpicMention(body: string | null): number | null {
  if (!body) return null;
  const match = body.match(/epic\s*#(\d+)/i);
  if (!match) return null;
  return Number.parseInt(match[1], 10) || null;
}

export async function fetchOpenGitHubIssues(ownerRepo: string): Promise<RemoteIssue[]> {
  const octokit = createOctokit();
  const { owner, repo } = parseOwnerRepo(ownerRepo);

  const allIssues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });

  return allIssues
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      labels: (issue.labels || [])
        .map((label) => (typeof label === "string" ? label : label.name || ""))
        .filter((label): label is string => Boolean(label)),
      milestone: issue.milestone?.title || null,
      assignees: (issue.assignees || []).map((assignee) => assignee.login).filter(Boolean),
      githubUrl: issue.html_url,
      createdAtGitHub: issue.created_at,
      updatedAtGitHub: issue.updated_at,
    }));
}

export async function syncProjectGitHubIssues(projectId: string): Promise<{ synced: number }> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project || !project.githubOwnerRepo) {
    throw new Error("GitHub repository is not configured for this project.");
  }

  const issues = await fetchOpenGitHubIssues(project.githubOwnerRepo);
  const now = new Date().toISOString();

  for (const issue of issues) {
    const existing = db
      .select({ id: githubIssues.id })
      .from(githubIssues)
      .where(
        and(
          eq(githubIssues.projectId, projectId),
          eq(githubIssues.issueNumber, issue.issueNumber)
        )
      )
      .get();

    const payload = {
      projectId,
      issueNumber: issue.issueNumber,
      title: issue.title,
      body: issue.body,
      labels: JSON.stringify(issue.labels),
      milestone: issue.milestone,
      assignees: JSON.stringify(issue.assignees),
      githubUrl: issue.githubUrl,
      createdAtGitHub: issue.createdAtGitHub,
      updatedAtGitHub: issue.updatedAtGitHub,
      syncedAt: now,
    };

    if (existing) {
      db.update(githubIssues).set(payload).where(eq(githubIssues.id, existing.id)).run();
    } else {
      db.insert(githubIssues)
        .values({
          id: createId(),
          ...payload,
        })
        .run();
    }
  }

  return { synced: issues.length };
}

export function isGitHubIssueSyncDue(projectId: string, intervalMinutes = 15): boolean {
  const last = db
    .select({ syncedAt: sql<string | null>`MAX(${githubIssues.syncedAt})` })
    .from(githubIssues)
    .where(eq(githubIssues.projectId, projectId))
    .get();

  if (!last?.syncedAt) return true;

  const lastAt = new Date(last.syncedAt).getTime();
  const intervalMs = intervalMinutes * 60_000;
  return Date.now() - lastAt > intervalMs;
}

export function listTriagedIssues(
  projectId: string,
  filters: { label?: string | null; milestone?: string | null }
) {
  const rows = db
    .select()
    .from(githubIssues)
    .where(eq(githubIssues.projectId, projectId))
    .orderBy(desc(githubIssues.issueNumber))
    .all();

  return rows
    .map((row) => ({
      ...row,
      labels: row.labels ? (JSON.parse(row.labels) as string[]) : [],
      assignees: row.assignees ? (JSON.parse(row.assignees) as string[]) : [],
    }))
    .filter((row) => {
      if (filters.label && !row.labels.some((label) => label.toLowerCase() === filters.label!.toLowerCase())) {
        return false;
      }
      if (filters.milestone && row.milestone !== filters.milestone) {
        return false;
      }
      return true;
    });
}

export function importGitHubIssuesAsTickets(
  projectId: string,
  issueNumbers: number[]
): Array<{ issueNumber: number; epicId: string; type: "feature" | "bug" }> {
  if (issueNumbers.length === 0) {
    return [];
  }

  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) {
    throw new Error("Project not found.");
  }

  const issues = db
    .select()
    .from(githubIssues)
    .where(and(eq(githubIssues.projectId, projectId), inArray(githubIssues.issueNumber, issueNumbers)))
    .all();

  const namedAgentRows = db
    .select({ id: namedAgents.id, name: namedAgents.name })
    .from(namedAgents)
    .all();

  const namedAgentByName = new Map(namedAgentRows.map((row) => [row.name.toLowerCase(), row.id]));
  const importedByIssueNumber = new Map<number, string>();
  const now = new Date().toISOString();
  let nextPosition =
    db
      .select({ max: sql<number>`COALESCE(MAX(${epics.position}), -1)` })
      .from(epics)
      .where(eq(epics.projectId, projectId))
      .get()?.max ?? -1;

  const result: Array<{ issueNumber: number; epicId: string; type: "feature" | "bug" }> = [];

  for (const issue of issues) {
    if (issue.importedEpicId) {
      result.push({
        issueNumber: issue.issueNumber,
        epicId: issue.importedEpicId,
        type: mapIssueType(issue.labels ? (JSON.parse(issue.labels) as string[]) : []),
      });
      importedByIssueNumber.set(issue.issueNumber, issue.importedEpicId);
      continue;
    }

    const labels = issue.labels ? (JSON.parse(issue.labels) as string[]) : [];
    const assignees = issue.assignees ? (JSON.parse(issue.assignees) as string[]) : [];
    const ticketType = mapIssueType(labels);

    const linkedEpicNumber = parseEpicMention(issue.body);
    const linkedEpicId = linkedEpicNumber
      ? importedByIssueNumber.get(linkedEpicNumber) ||
        db
          .select({ importedEpicId: githubIssues.importedEpicId })
          .from(githubIssues)
          .where(
            and(
              eq(githubIssues.projectId, projectId),
              eq(githubIssues.issueNumber, linkedEpicNumber)
            )
          )
          .get()?.importedEpicId || null
      : null;

    const epicId = createId();
    const readableId = generateReadableId(projectId, project.name, ticketType);
    const mappedNamedAgentIds = assignees
      .map((assignee) => namedAgentByName.get(assignee.toLowerCase()) || null)
      .filter((id): id is string => Boolean(id));
    const assigneeNote = assignees
      .map((assignee) => {
        const matchedId = namedAgentByName.get(assignee.toLowerCase());
        return matchedId ? `${assignee} (mapped to named agent ${matchedId})` : assignee;
      })
      .join(", ");
    const githubReference = [
      `Source GitHub Issue: ${issue.githubUrl}`,
      assigneeNote ? `GitHub Assignees: ${assigneeNote}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const enrichedDescription = [issue.body, githubReference]
      .filter(Boolean)
      .join("\n\n");

    db.insert(epics)
      .values({
        id: epicId,
        projectId,
        title: issue.title,
        description: enrichedDescription,
        status: "backlog",
        position: ++nextPosition,
        type: ticketType,
        linkedEpicId,
        readableId,
        githubIssueNumber: issue.issueNumber,
        githubIssueUrl: issue.githubUrl,
        githubIssueState: "open",
        evidence: JSON.stringify({
          githubUrl: issue.githubUrl,
          mappedNamedAgentIds,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.update(githubIssues)
      .set({ importedEpicId: epicId, importedAt: now })
      .where(eq(githubIssues.id, issue.id))
      .run();

    result.push({ issueNumber: issue.issueNumber, epicId, type: ticketType });
    importedByIssueNumber.set(issue.issueNumber, epicId);
  }

  return result;
}
