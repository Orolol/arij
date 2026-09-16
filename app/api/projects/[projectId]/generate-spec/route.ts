import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatMessages } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { buildSpecGenerationPrompt } from "@/lib/claude/prompt-builder";
import { extractJsonFromOutput, isNoTextualOutputFallback, parseClaudeOutput } from "@/lib/claude/json-parser";
import { tryExportArjiJson } from "@/lib/sync/export";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { getProvider } from "@/lib/providers";
import { commitGeneratedSpec, ProjectSpecChangedError, saveConflictingSpecProposal, type GeneratedSpec } from "@/lib/projects/spec-write";

import { activityRegistry } from "@/lib/activity-registry";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import {
  enrichPromptWithDocumentMentions,
  userAuthoredTexts,
} from "@/lib/documents/mentions";

export const POST = withAgentResolutionErrors(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  let namedAgentId: string | null = null;
  try {
    const body = await request.json();
    if (body.namedAgentId) {
      namedAgentId = body.namedAgentId;
    }
  } catch {
    // No body or invalid JSON — use default
  }

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;
  const { project } = found;

  const chatHistory = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.projectId, projectId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(30)
    .all()
    .reverse();

  const specSystemPrompt = await resolveAgentPrompt(
    "spec_generation",
    projectId
  );

  const prompt = buildSpecGenerationPrompt(
    project,
    [],
    chatHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    specSystemPrompt
  );
  // User messages only: an assistant reply naming a codebase file is not a
  // reference to an Arij document, and a dangling one never blocks generation.
  const mentionEnrichment = enrichPromptWithDocumentMentions({
    projectId,
    prompt,
    textSources: userAuthoredTexts(chatHistory),
  });
  const enrichedPrompt = mentionEnrichment.prompt;
  const resolvedAgent = resolveAgentByNamedId(
    "spec_generation",
    projectId,
    namedAgentId
  );

  const specActivityId = `spec-${createId()}`;
  activityRegistry.register({
    id: specActivityId,
    projectId,
    type: "spec_generation",
    label: "Generating Spec & Plan",
    provider: resolvedAgent.provider,
    namedAgentName: resolvedAgent.name ?? null,
    startedAt: new Date().toISOString(),
  });

  let generatedOutput: string | null = null;
  try {
    // Every provider goes through the provider abstraction, claude-code
    // included: the resolved provider is the one that runs, and the activity
    // record says which.
    const session = getProvider(resolvedAgent.provider).spawn({
      sessionId: `spec-${createId()}`,
      prompt: enrichedPrompt,
      cwd: project.gitRepoPath || process.cwd(),
      mode: "plan",
      model: resolvedAgent.model,
    });
    const result = await session.promise;

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Claude Code failed" }, { status: 500 });
    }

    const rawOutput = result.result || "";
    generatedOutput = rawOutput;

    // Try to extract structured JSON
    const specData = extractJsonFromOutput<GeneratedSpec>(rawOutput);
    const generated = specData && (specData.epics || typeof specData.spec === "string")
      ? specData
      : { spec: parseClaudeOutput(rawOutput).content };
    if (!generated.epics && (!generated.spec?.trim() || isNoTextualOutputFallback(generated.spec))) {
      throw new Error("The agent returned no specification.");
    }
    const epicsCreated = commitGeneratedSpec(projectId, project.spec, generated, { status: "specifying" });
    tryExportArjiJson(projectId);
    return NextResponse.json({ data: { spec: generated.spec, epicsCreated } });
  } catch (e) {
    if (e instanceof ProjectSpecChangedError && generatedOutput) {
      const proposal = saveConflictingSpecProposal(projectId, generatedOutput);
      return NextResponse.json({
        error: `${e.message} The agent's proposal is available in Documents as ${proposal.filename}.`,
        code: "SPEC_CHANGED",
        proposalDocumentId: proposal.id,
      }, { status: 409 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    activityRegistry.unregister(specActivityId);
  }
});
