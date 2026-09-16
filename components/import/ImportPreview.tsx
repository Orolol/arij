"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PillButton, Stamp, type StampTone, SurfaceCard } from "@/components/piscine";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import type { ImportData } from "@/components/import/types";

interface ImportPreviewProps {
  data: ImportData;
  /** True while the import chain is running. */
  busy?: boolean;
  /** A project row already exists from a (partial) import — re-submitting
   *  would duplicate it. The button stays disabled but is labelled
   *  "Already imported" so it does not read as a hung operation. */
  locked?: boolean;
  /** Disables Cancel while the import chain is in flight, so leaving the
   *  preview cannot race the running chain (late redirects or state writes
   *  landing on a second import). */
  cancelDisabled?: boolean;
  onValidate: (data: ImportData) => void;
  onCancel: () => void;
}

export function ImportPreview({
  data,
  busy = false,
  locked = false,
  cancelDisabled = false,
  onValidate,
  onCancel,
}: ImportPreviewProps) {
  const [editData, setEditData] = useState<ImportData>(structuredClone(data));
  const t = useTranslations("Import");

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
    // Defensive: an epic handed in without user_stories must not crash the
    // remove handler either (the page validates the shape before rendering).
    updated.epics[epicIndex].user_stories?.splice(usIndex, 1);
    setEditData(updated);
  }

  function importStatusTone(status: string): StampTone {
    if (status === "done") return "land";
    if (status === "in_progress") return "live";
    if (status === "todo") return "next";
    return "asks";
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">{t("preview.project")}</h2>
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
          {t("preview.epics", { count: editData.epics.length })}
        </h2>
        <div className="space-y-3">
          {editData.epics.map((epic, ei) => {
            // Defensive: the import page rejects a preview whose epics lack
            // user_stories before rendering, but the component must not throw
            // on a malformed entry either — `epic.user_stories.length` used to
            // crash the whole app (no error boundary) on such a preview.
            const stories = epic.user_stories ?? [];
            return (
            <SurfaceCard key={ei} radius={12} className="p-4">
              <div className="flex items-start gap-2 mb-2">
                <Input
                  value={epic.title}
                  onChange={(e) => updateEpic(ei, "title", e.target.value)}
                  className="flex-1"
                />
                <Stamp tone={importStatusTone(epic.status)}>
                  {epic.status}
                </Stamp>
                {epic.confidence != null && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {Math.round(epic.confidence * 100)}%
                  </span>
                )}
                <button
                  type="button"
                  className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
                  onClick={() => removeEpic(ei)}
                  aria-label={t("preview.removeEpic")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {stories.length > 0 && (
                <div className="ml-4 space-y-1">
                  {stories.map((us, usi) => (
                    <div key={usi} className="flex items-center gap-2 text-sm">
                      <Stamp tone={importStatusTone(us.status)}>
                        {us.status}
                      </Stamp>
                      <span className="flex-1">{us.title}</span>
                      <button
                        type="button"
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
                        onClick={() => removeUS(ei, usi)}
                        aria-label={t("preview.removeStory")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <PillButton
          variant="filled"
          onClick={() => onValidate(editData)}
          disabled={busy || locked}
        >
          {busy
            ? t("preview.importing")
            : locked
              ? t("preview.alreadyImported")
              : t("preview.validate")}
        </PillButton>
        <PillButton
          variant="outline"
          onClick={onCancel}
          disabled={cancelDisabled}
        >
          {t("preview.cancel")}
        </PillButton>
      </div>
    </div>
  );
}
