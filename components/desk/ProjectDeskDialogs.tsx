"use client";
import { AutoModeDialog } from "@/components/auto-mode/AutoModeDialog";
import { BugCreateDialog } from "@/components/kanban/BugCreateDialog";
import { EpicCreateDialog } from "@/components/kanban/EpicCreateDialog";
import { NightRunDialog } from "@/components/night/NightRunDialog";
import { NightRunSummaryDialog } from "@/components/night/NightRunSummaryDialog";
import type { ToastTone } from "@/components/toast/ToastStack";
import { useTranslations } from "next-intl";
interface Props {
  projectId: string; namedAgentId: string | null;
  epicDialogOpen: boolean; setEpicDialogOpen: (open: boolean) => void;
  bugDialogOpen: boolean; setBugDialogOpen: (open: boolean) => void;
  nightDialogOpen: boolean; setNightDialogOpen: (open: boolean) => void;
  autoModeDialogOpen: boolean; setAutoModeDialogOpen: (open: boolean) => void;
  nightSummaryRunId: string | null; setNightSummaryRunId: (id: string | null) => void;
  onChanged: () => void; onOpenTicket: (id: string) => void;
  addToast: (tone: ToastTone, message: string) => void;
}
export function ProjectDeskDialogs({ projectId, namedAgentId, epicDialogOpen, setEpicDialogOpen, bugDialogOpen, setBugDialogOpen, nightDialogOpen, setNightDialogOpen, autoModeDialogOpen, setAutoModeDialogOpen, nightSummaryRunId, setNightSummaryRunId, onChanged, onOpenTicket, addToast }: Props) {
  const t = useTranslations("Desk");
  return <>
      <EpicCreateDialog
        projectId={projectId}
        open={epicDialogOpen}
        onOpenChange={setEpicDialogOpen}
        onCreated={(epicId) => {
          onChanged();
          addToast("success", t("projectDesk.epicCreated"));
          if (epicId) onOpenTicket(epicId);
        }}
      />

      <BugCreateDialog
        projectId={projectId}
        open={bugDialogOpen}
        onOpenChange={setBugDialogOpen}
        onCreated={(bugId) => {
          onChanged();
          addToast("success", t("projectDesk.bugCreated"));
          if (bugId) onOpenTicket(bugId);
        }}
        namedAgentId={namedAgentId}
      />

      <NightRunDialog
        projectId={projectId}
        open={nightDialogOpen}
        onOpenChange={setNightDialogOpen}
        defaultNamedAgentId={namedAgentId}
        onStarted={(result) => {
          addToast("success", result.message);
          onChanged();
        }}
        onError={(message) => addToast("error", message)}
      />

      <AutoModeDialog
        projectId={projectId}
        open={autoModeDialogOpen}
        onOpenChange={setAutoModeDialogOpen}
        defaultNamedAgentId={namedAgentId}
        onSaved={(status) => {
          addToast(
            "success",
            status.enabled
              ? t("projectDesk.autoOn", {
                  build: status.candidates.build,
                  review: status.candidates.review,
                })
              : t("projectDesk.autoOff")
          );
          onChanged();
        }}
        onError={(message) => addToast("error", message)}
      />

      <NightRunSummaryDialog
        projectId={projectId}
        runId={nightSummaryRunId}
        open={nightSummaryRunId !== null}
        onOpenChange={(open) => {
          if (!open) setNightSummaryRunId(null);
        }}
      />

  </>;
}
