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
  Bug,
  Sparkles,
  GitBranch,
  Calendar,
} from "lucide-react";
import { useGitHubConfig } from "@/hooks/useGitHubConfig";
import { useReleasePublish } from "@/hooks/useReleasePublish";
import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";
import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";

interface Epic {
  id: string;
  title: string;
  status: string;
  type?: string;
  readableId?: string | null;
  releaseId?: string | null;
  usCount?: number;
  usDone?: number;
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

function ReleaseDetailDialog({
  release,
  projectId,
  open,
  onOpenChange,
}: {
  release: Release;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [epics, setEpics] = useState<Epic[]>([]);
  const [loadingEpics, setLoadingEpics] = useState(false);

  useEffect(() => {
    if (!open) return;
    let epicIds: string[] = [];
    try {
      epicIds = release.epicIds ? JSON.parse(release.epicIds) : [];
    } catch {
      // Ignore malformed JSON
    }
    if (epicIds.length === 0) {
      setEpics([]);
      return;
    }
    setLoadingEpics(true);
    fetch(`/api/projects/${projectId}/epics`)
      .then((r) => r.json())
      .then((data) => {
        const all: Epic[] = data.data || [];
        const idSet = new Set(epicIds);
        setEpics(all.filter((e) => idSet.has(e.id)));
      })
      .catch(() => setEpics([]))
      .finally(() => setLoadingEpics(false));
  }, [open, release.epicIds, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            v{release.version}
            {release.title && (
              <span className="text-muted-foreground font-normal">
                — {release.title}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
            {release.gitTag && (
              <span className="flex items-center gap-1">
                <Tag className="h-3.5 w-3.5" />
                {release.gitTag}
              </span>
            )}
            {release.releaseBranch && (
              <span className="flex items-center gap-1">
                <GitBranch className="h-3.5 w-3.5" />
                <span className="font-mono text-xs">{release.releaseBranch}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(release.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">
              Included Tickets ({loadingEpics ? "..." : epics.length})
            </h4>
            {loadingEpics ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading tickets...
              </div>
            ) : epics.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tickets in this release</p>
            ) : (
              <div className="space-y-1">
                {epics.map((epic) => (
                  <div
                    key={epic.id}
                    className="flex items-center gap-2 p-2 rounded bg-muted/30 text-sm"
                  >
                    {epic.type === "bug" ? (
                      <Bug className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    )}
                    {epic.readableId && (
                      <span className="text-xs text-muted-foreground font-mono shrink-0">
                        {epic.readableId}
                      </span>
                    )}
                    <span className="flex-1 truncate">{epic.title}</span>
                    {epic.usCount != null && epic.usCount > 0 && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {epic.usDone ?? 0}/{epic.usCount} US
                      </span>
                    )}
                    <Badge variant="outline" className="text-xs shrink-0">
                      {epic.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {release.changelog && (
            <div>
              <h4 className="text-sm font-medium mb-2">Changelog</h4>
              <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-sm text-muted-foreground bg-muted/20 rounded-lg p-4">
                {release.changelog}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
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
  const [detailOpen, setDetailOpen] = useState(false);

  const isDraft = release.githubReleaseId !== null && !release.pushedAt;
  const isPublished = release.githubReleaseId !== null && release.pushedAt !== null;

  async function handlePublish(e: React.MouseEvent) {
    e.stopPropagation();
    const success = await publish(release.id);
    if (success) {
      onPublished();
    }
  }

  return (
    <>
      <Card
        className="p-5 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => setDetailOpen(true)}
      >
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

          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
          <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-sm text-muted-foreground line-clamp-3">
            {release.changelog}
          </div>
        )}
      </Card>
      <ReleaseDetailDialog
        release={release}
        projectId={projectId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
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
  // When no named agent is selected, let the server resolve the default via agentType
  const selectedAgentProvider = namedAgentId
    ? namedAgents.find((a) => a.id === namedAgentId)?.provider
    : undefined;

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
