"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Tag, Loader2 } from "lucide-react";

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
  gitTag: string | null;
  createdAt: string;
}

export default function ReleasesPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [releases, setReleases] = useState<Release[]>([]);
  const [doneEpics, setDoneEpics] = useState<Epic[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Create release form
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<string>>(
    new Set()
  );
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadData();
  }, [projectId]);

  async function loadData() {
    const [releasesRes, epicsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/releases`),
      fetch(`/api/projects/${projectId}/epics`),
    ]);

    const releasesData = await releasesRes.json();
    const epicsData = await epicsRes.json();

    setReleases(releasesData.data || []);
    setDoneEpics(
      (epicsData.data || []).filter(
        (e: Epic) => e.status === "done" || e.status === "review"
      )
    );
    setLoading(false);
  }

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
      }),
    });

    if (res.ok) {
      setVersion("");
      setTitle("");
      setSelectedEpicIds(new Set());
      setDialogOpen(false);
      loadData();
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
                    No completed/review epics available
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
            <Card key={release.id} className="p-5">
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
                  <div className="flex items-center gap-2 mt-1">
                    {release.gitTag && (
                      <Badge variant="outline" className="text-xs">
                        <Tag className="h-3 w-3 mr-1" />
                        {release.gitTag}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(release.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
              {release.changelog && (
                <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-sm text-muted-foreground">
                  {release.changelog}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
