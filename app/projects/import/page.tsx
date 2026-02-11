"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderSelector } from "@/components/import/FolderSelector";
import { ImportProgress } from "@/components/import/ImportProgress";
import { ImportPreview } from "@/components/import/ImportPreview";

type ImportState = "select" | "analyzing" | "preview";

interface DebugInfo {
  duration?: number;
  rawOutput?: string;
  parsedContent?: string;
  parseError?: string;
  metadata?: Record<string, unknown>;
  stack?: string;
}

interface ImportData {
  project: {
    name: string;
    description: string;
    status?: string;
    spec?: string | null;
    stack?: string;
    architecture?: string;
  };
  epics: Array<{
    title: string;
    description?: string;
    status: string;
    priority?: number;
    position?: number;
    branchName?: string | null;
    confidence?: number;
    evidence?: string;
    user_stories: Array<{
      title: string;
      description?: string;
      acceptance_criteria?: string;
      status: string;
      position?: number;
    }>;
  }>;
}

export default function ImportProjectPage() {
  const router = useRouter();
  const [state, setState] = useState<ImportState>("select");
  const [folderPath, setFolderPath] = useState("");
  const [importData, setImportData] = useState<ImportData | null>(null);
  const [fromExistingFile, setFromExistingFile] = useState(false);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState<DebugInfo | null>(null);

  async function handleAnalyze(path: string) {
    setFolderPath(path);
    setState("analyzing");
    setError("");
    setDebug(null);

    try {
      const res = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setDebug(data.debug || null);
        setState("select");
        return;
      }

      setImportData(data.data.preview);
      setFromExistingFile(!!data.data.fromExistingFile);
      setState("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze project");
      setState("select");
    }
  }

  async function handleValidate(data: ImportData) {
    // Create project
    const projectRes = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.project.name,
        description: data.project.description,
        gitRepoPath: folderPath,
      }),
    });

    const projectData = await projectRes.json();
    const projectId = projectData.data.id;

    // Update project as imported
    const spec = data.project.spec
      ? data.project.spec
      : data.project.architecture
        ? `# ${data.project.name}\n\n${data.project.description}\n\n## Stack\n${data.project.stack}\n\n## Architecture\n${data.project.architecture}`
        : undefined;

    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: data.project.status || "specifying",
        spec,
      }),
    });

    // Create epics and user stories
    for (const epic of data.epics) {
      const epicRes = await fetch(`/api/projects/${projectId}/epics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: epic.title,
          description: epic.description,
          status: epic.status,
          confidence: epic.confidence,
          evidence: epic.evidence,
        }),
      });

      const epicData = await epicRes.json();

      for (const us of epic.user_stories) {
        await fetch(`/api/projects/${projectId}/user-stories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            epicId: epicData.data.id,
            title: us.title,
            description: us.description,
            acceptanceCriteria: us.acceptance_criteria,
            status: us.status,
          }),
        });
      }
    }

    // Write back arij.json with the newly created IDs
    await fetch(`/api/projects/${projectId}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "export" }),
    });

    router.push(`/projects/${projectId}`);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Import Existing Project</h1>

      {error && (
        <div className="bg-destructive/10 text-destructive p-3 rounded-md mb-4 text-sm">
          <p className="font-medium">{error}</p>
          {debug && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs opacity-70 hover:opacity-100">
                Debug info
              </summary>
              <div className="mt-2 space-y-2 text-xs">
                {debug.duration != null && (
                  <p>Duration: {(debug.duration / 1000).toFixed(1)}s</p>
                )}
                {debug.parseError && (
                  <div>
                    <p className="font-medium">Parse error:</p>
                    <pre className="mt-1 p-2 bg-black/20 rounded overflow-auto max-h-24">
                      {debug.parseError}
                    </pre>
                  </div>
                )}
                {debug.parsedContent && (
                  <div>
                    <p className="font-medium">Parsed content:</p>
                    <pre className="mt-1 p-2 bg-black/20 rounded overflow-auto max-h-48 whitespace-pre-wrap">
                      {debug.parsedContent}
                    </pre>
                  </div>
                )}
                {debug.rawOutput && (
                  <div>
                    <p className="font-medium">Raw CLI output:</p>
                    <pre className="mt-1 p-2 bg-black/20 rounded overflow-auto max-h-48 whitespace-pre-wrap">
                      {debug.rawOutput}
                    </pre>
                  </div>
                )}
                {debug.metadata && (
                  <div>
                    <p className="font-medium">Metadata:</p>
                    <pre className="mt-1 p-2 bg-black/20 rounded overflow-auto max-h-24">
                      {JSON.stringify(debug.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {state === "select" && <FolderSelector onAnalyze={handleAnalyze} />}
      {state === "analyzing" && <ImportProgress />}
      {state === "preview" && fromExistingFile && (
        <div className="bg-blue-500/10 text-blue-400 border border-blue-500/20 p-3 rounded-md mb-4 text-sm">
          Imported from existing arij.json — Claude analysis was skipped.
        </div>
      )}
      {state === "preview" && importData && (
        <ImportPreview
          data={importData}
          onValidate={handleValidate}
          onCancel={() => setState("select")}
        />
      )}
    </div>
  );
}
