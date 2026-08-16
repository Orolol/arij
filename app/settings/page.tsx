"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface GitHubPatSetting {
  hasToken?: boolean;
}

interface ProjectWebhook {
  projectId: string;
  projectName: string;
  url: string;
}

export default function SettingsPage() {
  const [globalPrompt, setGlobalPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [githubPat, setGitHubPat] = useState("");
  const [hasSavedGitHubPat, setHasSavedGitHubPat] = useState(false);
  const [savingGitHubPat, setSavingGitHubPat] = useState(false);
  const [validatingGitHubPat, setValidatingGitHubPat] = useState(false);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [gitHubMessage, setGitHubMessage] = useState<string | null>(null);
  const [gitHubError, setGitHubError] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<ProjectWebhook[]>([]);
  const [savingWebhookId, setSavingWebhookId] = useState<string | null>(null);
  const [webhookMessage, setWebhookMessage] = useState<string | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/webhooks")
      .then((r) => r.json())
      .then((d) => {
        const list = d?.data?.webhooks;
        if (Array.isArray(list)) {
          setWebhooks(list as ProjectWebhook[]);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.data?.global_prompt) {
          setGlobalPrompt(d.data.global_prompt);
        }
        const githubSetting = d.data?.github_pat as GitHubPatSetting | undefined;
        setHasSavedGitHubPat(Boolean(githubSetting?.hasToken));
      })
      .catch(() => {});
  }, []);

  async function handleSaveGlobalPrompt() {
    setSavingPrompt(true);
    setGlobalMessage(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          global_prompt: globalPrompt,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setGlobalMessage(
          payload?.error ??
            "Failed to save global prompt. Check the server response and try again."
        );
        return;
      }

      setGlobalMessage("Global prompt saved.");
    } catch {
      setGlobalMessage(
        "Failed to save global prompt. Check your connection and try again."
      );
    } finally {
      setSavingPrompt(false);
    }
  }

  function handleWebhookChange(projectId: string, url: string) {
    setWebhooks((current) =>
      current.map((entry) =>
        entry.projectId === projectId ? { ...entry, url } : entry
      )
    );
  }

  async function handleSaveWebhook(projectId: string) {
    const entry = webhooks.find((w) => w.projectId === projectId);
    if (!entry) return;

    setWebhookMessage(null);
    setWebhookError(null);
    setSavingWebhookId(projectId);

    try {
      const response = await fetch("/api/settings/webhooks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, url: entry.url.trim() }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setWebhookError(
          payload?.error ??
            "Failed to save webhook URL. Check the error details and retry."
        );
        return;
      }

      setWebhookMessage(
        entry.url.trim()
          ? `Webhook saved for ${entry.projectName}.`
          : `Webhook cleared for ${entry.projectName}.`
      );
    } catch {
      setWebhookError(
        "Failed to save webhook URL. Check your connection and retry."
      );
    } finally {
      setSavingWebhookId(null);
    }
  }

  async function handleValidateGitHubPat() {
    setGitHubMessage(null);
    setGitHubError(null);

    if (!githubPat.trim()) {
      setGitHubError("Enter a GitHub personal access token before validating.");
      return;
    }

    setValidatingGitHubPat(true);
    try {
      const response = await fetch("/api/settings/github/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: githubPat }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.data?.valid) {
        setGitHubError(
          payload?.error ??
            "Token validation failed. Verify the token and retry."
        );
        return;
      }

      const login = payload?.data?.login;
      setGitHubMessage(
        login
          ? `Token is valid for GitHub account: ${login}.`
          : "Token is valid."
      );
    } catch {
      setGitHubError(
        "Could not validate token right now. Check your network and try again."
      );
    } finally {
      setValidatingGitHubPat(false);
    }
  }

  async function handleSaveGitHubPat() {
    setGitHubMessage(null);
    setGitHubError(null);

    if (!githubPat.trim()) {
      setGitHubError("Enter a GitHub personal access token before saving.");
      return;
    }

    setSavingGitHubPat(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          github_pat: githubPat.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setGitHubError(
          payload?.error ??
            "Failed to save GitHub token. Check the error details and retry."
        );
        return;
      }

      setHasSavedGitHubPat(true);
      setGitHubPat("");
      setGitHubMessage("GitHub token saved.");
    } catch {
      setGitHubError(
        "Failed to save GitHub token. Check your connection and retry."
      );
    } finally {
      setSavingGitHubPat(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <section className="space-y-6">
        <div>
          <label htmlFor="global-prompt" className="block text-sm font-medium mb-2">
            Global Prompt
          </label>
          <p className="text-sm text-muted-foreground mb-2">
            This prompt is injected into all Claude Code sessions across all projects.
          </p>
          <Textarea
            id="global-prompt"
            value={globalPrompt}
            onChange={(e) => setGlobalPrompt(e.target.value)}
            rows={10}
            placeholder="Enter global instructions for Claude Code..."
          />
          {globalMessage && <p className="mt-2 text-sm text-muted-foreground">{globalMessage}</p>}
        </div>

        <Button onClick={handleSaveGlobalPrompt} disabled={savingPrompt}>
          {savingPrompt ? "Saving..." : "Save Settings"}
        </Button>
      </section>

      <section className="space-y-4 rounded-md border border-border p-4">
        <div>
          <h2 className="text-lg font-semibold">GitHub</h2>
          <p className="text-sm text-muted-foreground">
            Configure a personal access token for pull requests and release APIs.
          </p>
          {hasSavedGitHubPat && (
            <p className="mt-2 text-xs text-muted-foreground">
              A GitHub token is already saved for this workspace.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="github-pat" className="block text-sm font-medium">
            GitHub PAT
          </label>
          <Input
            id="github-pat"
            type="password"
            value={githubPat}
            onChange={(e) => setGitHubPat(e.target.value)}
            placeholder="ghp_..."
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleValidateGitHubPat}
            disabled={validatingGitHubPat}
          >
            {validatingGitHubPat ? "Validating..." : "Validate Token"}
          </Button>
          <Button
            type="button"
            onClick={handleSaveGitHubPat}
            disabled={savingGitHubPat}
          >
            {savingGitHubPat ? "Saving..." : "Save Token"}
          </Button>
        </div>

        {gitHubMessage && <p className="text-sm text-muted-foreground">{gitHubMessage}</p>}
        {gitHubError && <p className="text-sm text-destructive">{gitHubError}</p>}
      </section>

      <section className="space-y-4 rounded-md border border-border p-4">
        <div>
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            Post a JSON notification when an agent session finishes or a release
            is created. Works with ntfy.sh, Discord and Slack-compatible
            endpoints. Leave a field empty to disable it.
          </p>
        </div>

        {webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects yet. Create a project to configure a webhook.
          </p>
        ) : (
          <div className="space-y-4">
            {webhooks.map((entry) => (
              <div key={entry.projectId} className="space-y-2">
                <label
                  htmlFor={`webhook-${entry.projectId}`}
                  className="block text-sm font-medium"
                >
                  {entry.projectName}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`webhook-${entry.projectId}`}
                    type="url"
                    value={entry.url}
                    onChange={(e) =>
                      handleWebhookChange(entry.projectId, e.target.value)
                    }
                    placeholder="https://ntfy.sh/my-topic"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleSaveWebhook(entry.projectId)}
                    disabled={savingWebhookId === entry.projectId}
                  >
                    {savingWebhookId === entry.projectId ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {webhookMessage && (
          <p className="text-sm text-muted-foreground">{webhookMessage}</p>
        )}
        {webhookError && <p className="text-sm text-destructive">{webhookError}</p>}
      </section>
    </div>
  );
}
