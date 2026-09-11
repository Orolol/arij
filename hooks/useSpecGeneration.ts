"use client";

import { useTranslations } from "next-intl";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/** What POST /generate-spec answers on success. */
export interface SpecGenerationResult {
  spec: string | null;
  epicsCreated: number;
}

/**
 * What the generation is grounded on. Both optional: without a conversation
 * the server falls back to the project's recent chat, without an agent it
 * resolves the project's spec_generation assignment.
 */
export interface SpecGenerationScope {
  conversationId?: string | null;
  namedAgentId?: string | null;
}

/**
 * Generate-spec fetch flow for a project: POSTs the scope to the
 * generate-spec endpoint, tracks in-flight/error state, and exposes the
 * success payload so the surface can say what happened (spec written, how
 * many epics) instead of refreshing silently.
 */
export function useSpecGeneration(projectId: string, scope: SpecGenerationScope = {}) {
  const tErrors = useTranslations("ClientErrors");
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpecGenerationResult | null>(null);
  const conversationId = scope.conversationId ?? null;
  const namedAgentId = scope.namedAgentId ?? null;

  const generateSpec = useCallback(async (): Promise<SpecGenerationResult | null> => {
    setGenerating(true);
    setError(null);
    setResult(null);
    const outcome = await requestSpecGeneration(projectId, { conversationId, namedAgentId });
    if ("error" in outcome) {
      // A 409 carries the conflict message and the saved proposal's name.
      setError(
        outcome.error ??
          (outcome.status === null
            ? tErrors("specGenerationRequestFailed")
            : tErrors("specHttp", { status: outcome.status }))
      );
      setGenerating(false);
      return null;
    }
    setResult(outcome.data);
    setGenerating(false);
    router.refresh();
    return outcome.data;
  }, [projectId, conversationId, namedAgentId, router, tErrors]);

  return { generateSpec, generating, error, result };
}

type SpecGenerationOutcome =
  | { data: SpecGenerationResult }
  /** `status` is null when the request never got an answer. */
  | { error: string | null; status: number | null };

/**
 * The fetch itself, outside the hook: the React Compiler bails on value
 * blocks (conditionals, optional chaining) inside a try/catch, so the
 * branching lives here where it costs nothing.
 */
async function requestSpecGeneration(
  projectId: string,
  scope: { conversationId: string | null; namedAgentId: string | null }
): Promise<SpecGenerationOutcome> {
  const body: Record<string, string> = {};
  if (scope.conversationId) body.conversationId = scope.conversationId;
  if (scope.namedAgentId) body.namedAgentId = scope.namedAgentId;
  // The route tolerates an absent body; only send one when there is
  // something to scope, so a stray empty object never reads as intent.
  const init: RequestInit =
    Object.keys(body).length > 0
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { method: "POST" };

  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/generate-spec`, init);
  } catch (err) {
    return { error: err instanceof Error ? err.message : null, status: null };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    return { error: json.error || null, status: res.status };
  }
  return {
    data: {
      spec: json.data?.spec ?? null,
      epicsCreated: Number(json.data?.epicsCreated ?? 0),
    },
  };
}
