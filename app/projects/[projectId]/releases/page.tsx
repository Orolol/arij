"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SessionPicker } from "@/components/shared/SessionPicker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Tag,
  Loader2,
  ExternalLink,
  Upload,
  FileEdit,
} from "lucide-react";
import { useGitHubConfig } from "@/hooks/useGitHubConfig";
import { useReleasePublish } from "@/hooks/useReleasePublish";
import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";
import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";

interface Epic {
  id: string;
  title: string;
  status: string;
}

interface Release {
  id: string;
  version: string;
  title: string | null;
  changelog: string | null;
  epicIds: string | null;
  releaseBranch: string | null;
  gitTag: string | null;
  githubReleaseId: number | null;
  githubReleaseUrl: string | null;
  pushedAt: string | null;
  createdAt: string;
}

function ReleaseCard({
  release,
  projectId,
  githubConfigured,
  onPublished,
}: {
  release: Release;
  projectId: string;
  githubConfigured: boolean;
  onPublished: () => void;
}) {
  const { publish, isPublishing, error } = useReleasePublish(projectId);

  const isDraft = release.githubReleaseId !== null && !release.pushedAt;
  const isPublished = release.githubReleaseId !== null && release.pushedAt !== null;

  async function handlePublish() {
    const success = await publish(release.id);
    if (success) {
      onPublished();
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">v{release.version}</h3>
            {release.title && (
              <span className="text-muted-foreground">
                — {release.title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {release.gitTag && (
              <Badge variant="outline" className="text-xs">
                <Tag className="h-3 w-3 mr-1" />
                {release.gitTag}
              </Badge>
            )}
            {release.releaseBranch && (
              <Badge variant="outline" className="text-xs font-mono">
                {release.releaseBranch}
              </Badge>
            )}
            {isDraft && (
              <Badge variant="secondary" className="text-xs">
                <FileEdit className="h-3 w-3 mr-1" />
                Draft
              </Badge>
            )}
            {isPublished && (
              <Badge className="text-xs bg-green-600 text-white hover:bg-green-700">
                Published
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {new Date(release.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDraft && githubConfigured && (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePublish}
              disabled={isPublishing}
            >
              {isPublishing ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              Publish
            </Button>
          )}
          {release.githubReleaseUrl && (
            <a
              href={release.githubReleaseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" variant="ghost">
                <ExternalLink className="h-3 w-3 mr-1" />
                View on GitHub
              </Button>
            </a>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive mb-2">{error}</p>
      )}

      {release.changelog && (
        <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-sm text-muted-foreground">
          {release.changelog}
        </div>
      )}
    </Card>
  );
}

interface Toast {
  id: string;
  type: "success" | "error";
  message: string;
}

export default function ReleasesPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [releases, setReleases] = useState<Release[]>([]);
  const [doneEpics, setDoneEpics] = useState<Epic[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // GitHub config
  const { isConfigured: hasGitHub, loading: ghLoading } =
    useGitHubConfig(projectId);

  // Create release form
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<string>>(
    new Set()
  );
  const [pushToGitHub, setPushToGitHub] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resumeSessionId, setResumeSessionId] = useState<string | undefined>(undefined);
  const [namedAgentId, setNamedAgentId] = useState<string | null>(null);
  const { agents: namedAgents } = useNamedAgentsList();

  // Resolve selected agent's provider for SessionPicker filtering
  const selectedAgentProvider = namedAgentId
    ? namedAgents.find((a) => a.id === namedAgentId)?.provider ?? "claude-code"
    : "claude-code";

  const loadData = useCallback(async () => {
    const [releasesRes, epicsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/releases`),
      fetch(`/api/projects/${projectId}/epics`),
    ]);

    const releasesData = await releasesRes.json();
    const epicsData = await epicsRes.json();

    setReleases(releasesData.data || []);
    setDoneEpics(
      (epicsData.data || []).filter(
        (e: Epic & { releaseId?: string | null }) =>
          e.status === "done" && !e.releaseId
      )
    );
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCreateRelease() {
    if (!version.trim() || selectedEpicIds.size === 0) return;
    setCreating(true);

    const res = await fetch(`/api/projects/${projectId}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: version.trim(),
        title: title.trim() || undefined,
        epicIds: Array.from(selectedEpicIds),
        generateChangelog: true,
        pushToGitHub: hasGitHub && pushToGitHub,
        resumeSessionId,
        namedAgentId: namedAgentId || undefined,
      }),
    });

    if (res.ok) {
      setVersion("");
      setTitle("");
      setSelectedEpicIds(new Set());
      setPushToGitHub(false);
      setResumeSessionId(undefined);
      setNamedAgentId(null);
      setDialogOpen(false);
      showToast("success", "Release v" + version.trim() + " created");
      loadData();
    } else {
      showToast("error", "Failed to create release");
    }

    setCreating(false);
  }

  function toggleEpic(epicId: string) {
    setSelectedEpicIds((prev) => {
      const next = new Set(prev);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground">Loading releases...</div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Releases</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Release
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Release</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium block mb-1">
                  Version *
                </label>
                <Input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0.0"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Initial Release"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">
                  Include Epics ({selectedEpicIds.size} selected)
                </label>
                {doneEpics.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No completed epics available for release
                  </p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-auto">
                    {doneEpics.map((epic) => (
                      <button
                        key={epic.id}
                        onClick={() => toggleEpic(epic.id)}
                        className={`w-full text-left p-2 rounded text-sm transition-colors ${
                          selectedEpicIds.has(epic.id)
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-accent/50"
                        }`}
                      >
                        {epic.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">
                  Changelog Agent
                </label>
                <NamedAgentSelect
                  value={namedAgentId}
                  onChange={(id) => {
                    setNamedAgentId(id);
                    setResumeSessionId(undefined);
                  }}
                  className="w-full h-9 text-sm"
                />
              </div>

              {!ghLoading && hasGitHub && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="push-to-github"
                    checked={pushToGitHub}
                    onCheckedChange={(checked) =>
                      setPushToGitHub(checked === true)
                    }
                  />
                  <label
                    htmlFor="push-to-github"
                    className="text-sm font-medium leading-none cursor-pointer"
                  >
                    Push to GitHub as draft
                  </label>
                </div>
              )}

              <SessionPicker
                projectId={projectId}
                agentType="release_notes"
                namedAgentId={namedAgentId}
                provider={selectedAgentProvider}
                selectedSessionId={resumeSessionId}
                onSelect={setResumeSessionId}
              />

              <Button
                onClick={handleCreateRelease}
                disabled={
                  creating || !version.trim() || selectedEpicIds.size === 0
                }
                className="w-full"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Tag className="h-4 w-4 mr-1" />
                )}
                Create Release
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {releases.length === 0 ? (
        <p className="text-muted-foreground text-sm">No releases yet</p>
      ) : (
        <div className="space-y-4">
          {releases.map((release) => (
            <ReleaseCard
              key={release.id}
              release={release}
              projectId={projectId}
              githubConfigured={hasGitHub}
              onPublished={loadData}
            />
          ))}
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-all animate-in fade-in slide-in-from-bottom-2 ${
                toast.type === "success"
                  ? "bg-green-600 text-white"
                  : "bg-destructive text-destructive-foreground"
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
