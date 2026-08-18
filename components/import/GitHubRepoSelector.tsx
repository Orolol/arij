"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Github } from "lucide-react";
import { parseGitHubRepoInput } from "@/lib/git/remote-parse";

interface GitHubRepoSelectorProps {
  /**
   * Controlled by the page: a failed clone unmounts this component, and
   * whoever pasted a long URL should not have to paste it again to retry.
   */
  value: string;
  onChange: (url: string) => void;
  onClone: (url: string) => void;
  /** Root the clone will land in, shown so the user knows where code goes. */
  projectsRoot?: string | null;
}

/**
 * URL entry for the GitHub import.
 *
 * Validation runs against `parseGitHubRepoInput()` — the very function the
 * clone route uses — so what the field accepts and what the server accepts
 * cannot drift. The server re-validates regardless: this is feedback, not a
 * security boundary.
 */
export function GitHubRepoSelector({
  value,
  onChange,
  onClone,
  projectsRoot,
}: GitHubRepoSelectorProps) {
  const trimmed = value.trim();
  const parsed = useMemo(
    () => (trimmed ? parseGitHubRepoInput(trimmed) : null),
    [trimmed]
  );
  // An empty field is "nothing typed yet", not an error — don't shout at
  // someone who has not started.
  const showError = trimmed.length > 0 && !parsed;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Paste a GitHub repository URL. Arij clones it into its own workspace,
        then Claude Code analyzes the clone and generates epics and user
        stories.
      </p>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Github className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://github.com/owner/repo"
            aria-label="GitHub repository URL"
            aria-invalid={showError || undefined}
            aria-describedby={showError ? "github-url-error" : "github-url-hint"}
            className="pl-10"
            onKeyDown={(e) => {
              if (e.key === "Enter" && parsed) onClone(trimmed);
            }}
          />
        </div>
        <Button onClick={() => parsed && onClone(trimmed)} disabled={!parsed}>
          Clone &amp; Analyze
        </Button>
      </div>

      {showError ? (
        <p id="github-url-error" role="alert" className="text-sm text-destructive">
          Not a GitHub repository. Use https://github.com/owner/repo,
          git@github.com:owner/repo.git, or owner/repo.
        </p>
      ) : (
        <p id="github-url-hint" className="text-sm text-muted-foreground">
          {parsed ? (
            <>
              Will clone <span className="font-medium">{parsed.ownerRepo}</span>
              {projectsRoot ? (
                <>
                  {" "}
                  into{" "}
                  <span className="font-mono text-xs">
                    {projectsRoot}/{parsed.owner}-{parsed.repo}
                  </span>
                </>
              ) : null}
            </>
          ) : (
            "Private repositories need a GitHub PAT configured in Settings."
          )}
        </p>
      )}
    </div>
  );
}
