"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { QuietDangerAction, SurfaceCard } from "@/components/piscine";
import { PermanentDeleteDialog } from "@/components/shared/PermanentDeleteDialog";
import { useProjects } from "@/hooks/useProjects";
import { requestJson } from "@/lib/api/client";

export function DeleteProjectSection({ projectId }: { projectId: string }) {
  const t = useTranslations("ProjectSettings");
  const router = useRouter();
  const { allProjects, refresh } = useProjects();
  const project = allProjects.find((row) => row.id === projectId);
  const [open, setOpen] = useState(false);
  const [removeDirectory, setRemoveDirectory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  async function remove() {
    if (pending.current || !project) return;
    pending.current = true;
    setDeleting(true);
    const result = await requestJson(`/api/projects/${projectId}?removeDirectory=${removeDirectory && project.cloneSource === "github"}`, { method: "DELETE", errorMessage: t("delete.failed") });
    if (result.error) { setError(result.error); setOpen(false); }
    else { setOpen(false); await refresh(); router.push("/"); }
    pending.current = false;
    setDeleting(false);
  }
  return <SurfaceCard className="space-y-3 p-4">
    {project?.cloneSource === "github" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={removeDirectory} disabled={deleting} onChange={(event) => setRemoveDirectory(event.target.checked)} />{t("delete.removeDirectory")}</label>}
    <QuietDangerAction disabled={!project || deleting} onClick={() => { setError(null); setOpen(true); }}>{t("delete.action")}</QuietDangerAction>
    {error && <p role="alert">{error}</p>}
    <PermanentDeleteDialog open={open} onOpenChange={setOpen} title={t("delete.action")} description={t("delete.description", { name: project?.name ?? "" })} confirmLabel={t("delete.action")} deleting={deleting} onConfirm={remove} />
  </SurfaceCard>;
}
