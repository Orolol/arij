"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Trash2 } from "lucide-react";

interface ImportData {
  project: {
    name: string;
    description: string;
    stack?: string;
    architecture?: string;
  };
  epics: Array<{
    title: string;
    description?: string;
    status: string;
    confidence?: number;
    evidence?: string;
    user_stories: Array<{
      title: string;
      description?: string;
      acceptance_criteria?: string;
      status: string;
    }>;
  }>;
}

interface ImportPreviewProps {
  data: ImportData;
  onValidate: (data: ImportData) => void;
  onCancel: () => void;
}

export function ImportPreview({ data, onValidate, onCancel }: ImportPreviewProps) {
  const [editData, setEditData] = useState<ImportData>(structuredClone(data));

  function updateEpic(index: number, field: string, value: string) {
    const updated = structuredClone(editData);
    (updated.epics[index] as Record<string, unknown>)[field] = value;
    setEditData(updated);
  }

  function removeEpic(index: number) {
    const updated = structuredClone(editData);
    updated.epics.splice(index, 1);
    setEditData(updated);
  }

  function removeUS(epicIndex: number, usIndex: number) {
    const updated = structuredClone(editData);
    updated.epics[epicIndex].user_stories.splice(usIndex, 1);
    setEditData(updated);
  }

  const statusColor: Record<string, string> = {
    done: "bg-green-500/10 text-green-500",
    in_progress: "bg-yellow-500/10 text-yellow-500",
    backlog: "bg-muted text-muted-foreground",
    todo: "bg-blue-500/10 text-blue-500",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Project</h2>
        <Input
          value={editData.project.name}
          onChange={(e) =>
            setEditData({
              ...editData,
              project: { ...editData.project, name: e.target.value },
            })
          }
          className="mb-2"
        />
        <Textarea
          value={editData.project.description}
          onChange={(e) =>
            setEditData({
              ...editData,
              project: { ...editData.project, description: e.target.value },
            })
          }
          rows={2}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">
          Epics ({editData.epics.length})
        </h2>
        <div className="space-y-3">
          {editData.epics.map((epic, ei) => (
            <Card key={ei} className="p-4">
              <div className="flex items-start gap-2 mb-2">
                <Input
                  value={epic.title}
                  onChange={(e) => updateEpic(ei, "title", e.target.value)}
                  className="flex-1"
                />
                <Badge className={statusColor[epic.status] || ""}>
                  {epic.status}
                </Badge>
                {epic.confidence != null && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {Math.round(epic.confidence * 100)}%
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => removeEpic(ei)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {epic.user_stories.length > 0 && (
                <div className="ml-4 space-y-1">
                  {epic.user_stories.map((us, usi) => (
                    <div key={usi} className="flex items-center gap-2 text-sm">
                      <Badge
                        variant="outline"
                        className={`text-xs ${statusColor[us.status] || ""}`}
                      >
                        {us.status}
                      </Badge>
                      <span className="flex-1">{us.title}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeUS(ei, usi)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => onValidate(editData)}>
          Validate & Import
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
