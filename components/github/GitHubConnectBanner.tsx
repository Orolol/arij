"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { requestJson } from "@/lib/api/client";
import { useStoredValue, writeStoredValue } from "@/hooks/useStoredValue";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import { PillButton } from "@/components/piscine";

interface DetectionPayload {
  detected: boolean;
  owner?: string;
  repo?: string;
  ownerRepo?: string;
}

interface GitHubConnectBannerProps {
  projectId: string;
  gitRepoPath: string | null;
  githubOwnerRepo: string | null;
  onConnected?: (ownerRepo: string) => void;
}

function dismissStorageKey(projectId: string): string {
  return `github-connect-banner-dismissed:${projectId}`;
}

export function GitHubConnectBanner(props: GitHubConnectBannerProps) {
  return <GitHubConnectWorkspace key={JSON.stringify([props.projectId, props.gitRepoPath])} {...props} />;
}

function GitHubConnectWorkspace({
  projectId,
  gitRepoPath,
  githubOwnerRepo,
  onConnected,
}: GitHubConnectBannerProps) {
  const t = useTranslations("Github");
  const storedDismissal = useStoredValue(dismissStorageKey(projectId));
  const [dismissed, setDismissed] = useState(false);
  const [connected, setConnected] = useState(false);
  const shouldAttemptDetect = Boolean(gitRepoPath) && !githubOwnerRepo && !dismissed && storedDismissal !== "1" && !connected;
  const errorMessage = useCallback(() => t("connect.detectError"), [t]);
  const { data: candidate, loading: detecting, error: loadError, refresh } = usePolledResource<DetectionPayload>(
    shouldAttemptDetect ? `/api/projects/${projectId}/github/detect` : null, null, errorMessage,
  );
  const { run, pending: connecting, error: mutationError } = useScopedMutation(shouldAttemptDetect ? projectId : null);
  const error = mutationError || loadError;
  const ownerRepo = candidate?.detected ? candidate.ownerRepo ?? "" : "";

  function handleDismiss() {
    writeStoredValue(dismissStorageKey(projectId), "1");
    setDismissed(true);
  }

  async function handleConnect() {
    if (!ownerRepo) return;
    const result = await run(async () => {
      const response = await requestJson<{ id: string }>(`/api/projects/${projectId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubOwnerRepo: ownerRepo }), errorMessage: t("connect.connectError"),
      });
      if (response.error !== null) throw new Error(response.error);
      return response.data;
    }, t("connect.connectError"));
    if (!result) return;
    writeStoredValue(dismissStorageKey(projectId), null);
    setConnected(true);
    onConnected?.(ownerRepo);
  }

  if (!shouldAttemptDetect || (!ownerRepo && !error)) return null;
  if (!ownerRepo) {
    return <div role="alert" className="border-b border-border px-4 py-2 text-sm">
      {error} <PillButton variant="outline" size="sm" onClick={() => void refresh()}>{t("connect.retry")}</PillButton>
      <PillButton variant="outline" size="sm" onClick={handleDismiss}>{t("connect.dismiss")}</PillButton>
    </div>;
  }

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          {t.rich("connect.question", {
            ownerRepo,
            repo: (chunks) => <span className="font-mono">{chunks}</span>,
          })}
        </p>
        <PillButton
          size="sm"
          variant="filled"
          onClick={handleConnect}
          disabled={connecting || detecting}
        >
          {connecting ? t("connect.connecting") : t("connect.connect")}
        </PillButton>
        <PillButton
          size="sm"
          variant="outline"
          onClick={handleDismiss}
          disabled={connecting}
        >
          {t("connect.dismiss")}
        </PillButton>
        {detecting && (
          <span className="text-xs text-muted-foreground">
            {t("connect.detecting")}
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
