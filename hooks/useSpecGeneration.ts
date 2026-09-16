"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface SpecGenerationState<Owner> {
  owner: Owner;
  generating: boolean;
  error: string | null;
  result: SpecGenerationResult | null;
}

/**
 * Generate-spec fetch flow for a project: POSTs the scope to the
 * generate-spec endpoint, tracks in-flight/error state, and exposes the
 * success payload so the surface can say what happened (spec written, how
 * many epics) instead of refreshing silently.
 *
 * State is owned by the project it was started for: a completion that lands
 * after the hook moved to another project (or left and came back) is
 * dropped, and a second call while one is in flight is a no-op.
 */
export function useSpecGeneration(projectId: string, scope: SpecGenerationScope = {}) {
  const tErrors = useTranslations("ClientErrors");
  const router = useRouter();
  const conversationId = scope.conversationId ?? null;
  const namedAgentId = scope.namedAgentId ?? null;
  const owner = useMemo(() => ({ projectId }), [projectId]);
  const activeOwner = useRef<typeof owner | null>(owner);
  const inFlight = useRef(new Set<typeof owner>());
  const [state, setState] = useState<SpecGenerationState<typeof owner>>({
    owner, generating: false, error: null, result: null,
  });
  if (state.owner !== owner) setState({ owner, generating: false, error: null, result: null });

  useEffect(() => {
    activeOwner.current = owner;
    return () => { activeOwner.current = null; };
  }, [owner]);

  const generateSpec = useCallback(async (): Promise<SpecGenerationResult | null> => {
    if (!projectId || activeOwner.current !== owner || inFlight.current.has(owner)) return null;
    inFlight.current.add(owner);
    setState({ owner, generating: true, error: null, result: null });
    const outcome = await requestSpecGeneration(projectId, { conversationId, namedAgentId });
    inFlight.current.delete(owner);
    if (activeOwner.current !== owner) return null;
    if ("error" in outcome) {
      // A 409 carries the conflict message and the saved proposal's name.
      setState({
        owner,
        generating: false,
        error:
          outcome.error ??
          (outcome.status === null
            ? tErrors("specGenerationRequestFailed")
            : tErrors("specHttp", { status: outcome.status })),
        result: null,
      });
      return null;
    }
    setState({ owner, generating: false, error: null, result: outcome.data });
    router.refresh();
    return outcome.data;
  }, [projectId, owner, conversationId, namedAgentId, router, tErrors]);

  return {
    generateSpec,
    generating: state.generating,
    error: state.error,
    result: state.result,
  };
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
