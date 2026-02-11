"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [gitRepoPath, setGitRepoPath] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        gitRepoPath: gitRepoPath.trim() || undefined,
      }),
    });

    const data = await res.json();
    if (data.data?.id) {
      router.push(`/projects/${data.data.id}`);
    }
    setLoading(false);
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">New Project</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Project Name *
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Awesome Project"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about?"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Git Repository Path
          </label>
          <Input
            value={gitRepoPath}
            onChange={(e) => setGitRepoPath(e.target.value)}
            placeholder="/path/to/your/repo (optional)"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Path to an existing local git repository
          </p>
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? "Creating..." : "Create Project"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
