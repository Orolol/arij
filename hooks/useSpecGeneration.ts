"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** The server resolves the project's spec_generation agent assignment. */
export function useSpecGeneration(projectId: string) {
  const tErrors = useTranslations("ClientErrors");
  const router = useRouter();
  const owner = useMemo(() => ({ projectId }), [projectId]);
  const activeOwner = useRef<typeof owner | null>(owner);
  const inFlight = useRef(new Set<typeof owner>());
  const [state, setState] = useState<{ owner: typeof owner; generating: boolean; error: string | null }>({
    owner, generating: false, error: null,
  });
  if (state.owner !== owner) setState({ owner, generating: false, error: null });

  useEffect(() => {
    activeOwner.current = owner;
    return () => { activeOwner.current = null; };
  }, [owner]);

  const generateSpec = useCallback(async () => {
    if (!projectId || activeOwner.current !== owner || inFlight.current.has(owner)) return;
    inFlight.current.add(owner);
    setState({ owner, generating: true, error: null });
    let error: string | null = null;
    try {
      const res = await fetch(`/api/projects/${projectId}/generate-spec`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        error = json.error || tErrors("specHttp", { status: res.status });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : tErrors("specGenerationRequestFailed");
    }
    inFlight.current.delete(owner);
    if (activeOwner.current !== owner) return;
    setState({ owner, generating: false, error });
    if (!error) router.refresh();
  }, [projectId, owner, router, tErrors]);

  return { generateSpec, generating: state.generating, error: state.error };
}
