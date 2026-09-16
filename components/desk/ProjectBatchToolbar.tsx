"use client";
import { useMergeBatch } from "@/hooks/useMergeBatch";

import { PillButton, SelectPill } from "@/components/piscine";
import { AgentSelectPill } from "@/components/shared/AgentSelectPill";
import type { ToastAction, ToastTone } from "@/components/toast/ToastStack";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { useBatchSelection } from "@/hooks/useBatchSelection";
import { cn } from "@/lib/utils";
import { Bot, GitMerge, Hammer, Layers, Loader2, Search, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface ProjectBatchToolbarProps {
  projectId: string;
  batch: ReturnType<typeof useBatchSelection>;
  namedAgentId: string | null;
  onAgentChange: (agentId: string | null) => void;
  onToast: (tone: ToastTone, message: string, action?: ToastAction) => void;
  onChanged: () => void;
}

/** Project batch controls share one selection and one in-flight action. */
export function ProjectBatchToolbar({
  projectId, batch, namedAgentId, onAgentChange, onToast: addToast, onChanged,
}: ProjectBatchToolbarProps) {
  const t = useTranslations("Desk");
  const [buildMode, setBuildMode] = useState<"parallel" | "sequential" | "dag">(
    "parallel"
  );
  const [teamModeRequested, setTeamMode] = useState(false);
  const [autoMergeAgent, setAutoMergeAgent] = useState(false);
  const [building, setBuilding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const { merge: mergeBatch, pending: batchMerging } = useMergeBatch(projectId, addToast, onChanged);
  // Team mode is a decision about the selection that was standing when the box
  // was ticked. Falling below two tickets retires it outright: merely masking
  // it lets a later re-selection resurrect a `team: true` build the user never
  // asked for a second time. Adjusting state during render is React's own
  // answer to "reset when a value changes" — the reset lands in this same pass,
  // before anything is committed, so no one ever observes the stale value.
  if (teamModeRequested && batch.allSelected.size < 2) {
    setTeamMode(false);
  }

  const teamMode = teamModeRequested && batch.allSelected.size >= 2;

  async function handleBuild() {
    if (batchBusy) return;
    if (batch.allSelected.size === 0) return;
    setBuilding(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epicIds: Array.from(batch.allSelected),
          mode: buildMode,
          team: teamMode,
          namedAgentId,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        if (
          res.status === 409 &&
          data.code === "AGENT_ALREADY_RUNNING" &&
          data.data?.activeSessionId
        ) {
          addToast("error", data.error, {
            href:
              data.data.sessionUrl ||
              `/projects/${projectId}/sessions/${data.data.activeSessionId}`,
            label: t("projectDesk.openActiveSession"),
          });
        } else {
          addToast("error", data.error || t("projectDesk.buildFailed"));
        }
      } else {
        addToast(
          "success",
          teamMode
            ? t("projectDesk.teamBuildLaunched", {
                count: batch.allSelected.size,
              })
            : data.data.orchestrationMode === "dag"
              ? t("projectDesk.waveBuildLaunched", { waves: data.data.waves })
              : t("projectDesk.buildLaunched", { count: data.data.count })
        );
        batch.clear();
        onChanged();
      }
    } catch {
      addToast("error", t("projectDesk.buildFailed"));
    }

    setBuilding(false);
  }

  async function handleBatchReview() {
    if (batchBusy) return;
    if (batch.allSelected.size === 0) return;
    setReviewing(true);

    let launched = 0;
    for (const epicId of batch.allSelected) {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/epics/${epicId}/review`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reviewTypes: ["feature_review"],
              namedAgentId,
            }),
          }
        );
        if (res.ok) launched++;
      } catch {
        // continue with other epics
      }
    }

    if (launched > 0) {
      addToast("success", t("projectDesk.reviewLaunched", { count: launched }));
      batch.clear();
      onChanged();
    } else {
      addToast("error", t("projectDesk.reviewLaunchFailed"));
    }
    setReviewing(false);
  }

  async function handleBatchMerge() {
    if (batchBusy) return;
    if (batch.allSelected.size === 0) return;
    await mergeBatch([...batch.allSelected].map((epicId) => ({ projectId, epicId })), autoMergeAgent);
    batch.clear();
  }

  const totalSelected = batch.allSelected.size;
  const autoCount = batch.autoIncluded.size;
  const canTeamMode = totalSelected >= 2;
  const batchBusy = building || reviewing || batchMerging || batch.loading;

  if (totalSelected === 0) return null;

  return (
    <div className="flex min-h-[48px] shrink-0 flex-wrap items-center gap-[10px] border-b border-border bg-card px-[22px] py-[8px]">
      <span className="text-[13px] font-medium">
        {t("projectDesk.selectedCount", {
          count: batch.userSelected.size,
        })}
        {autoCount > 0 && (
          <span className="ml-[8px] font-normal text-agent">
            {t("projectDesk.autoIncluded", { count: autoCount })}
          </span>
        )}
      </span>
    
      <AgentSelectPill
        mode="dispatch"
        selection={{ namedAgentId, provider: null }}
        onSelect={(selection) => onAgentChange(selection.namedAgentId)}
      />
    
      <SelectPill testId="build-mode-select" label={t(buildMode === "parallel" ? "projectDesk.modeParallel" : buildMode === "sequential" ? "projectDesk.modeSequential" : "projectDesk.modeDag")} disabled={batchBusy}>
        <DropdownMenuItem onSelect={() => setBuildMode("parallel")}>{t("projectDesk.modeParallel")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setBuildMode("sequential")}>{t("projectDesk.modeSequential")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setBuildMode("dag")}>{t("projectDesk.modeDag")}</DropdownMenuItem>
      </SelectPill>
    
      {/* Waves mode explainer — visible only when selected */}
      {buildMode === "dag" && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid="dag-mode-hint"
                className="flex cursor-help items-center gap-1 text-[12.5px] text-meta"
              >
                <Layers className="h-3 w-3" />
                {t("projectDesk.wavesHint")}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("projectDesk.wavesTooltip")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    
      {/* Team mode checkbox — visible when 2+ epics selected */}
      {totalSelected >= 2 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 text-[12.5px]",
                  !canTeamMode && "cursor-not-allowed opacity-50"
                )}
              >
                <input
                  type="checkbox"
                  checked={teamMode}
                  onChange={(e) => setTeamMode(e.target.checked)}
                  disabled={!canTeamMode}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                <Users className="h-3 w-3" />
                {t("projectDesk.teamMode")}
              </label>
            </TooltipTrigger>
            <TooltipContent>
              {t("projectDesk.teamModeTooltip")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    
      {/* Merge auto-fix — sits with its Merge all button on the right */}
      {totalSelected >= 2 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={autoMergeAgent}
                  onChange={(e) => setAutoMergeAgent(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border"
                  data-testid="auto-merge-agent-checkbox"
                />
                <Bot className="h-3 w-3" />
                {t("projectDesk.autoFix")}
              </label>
            </TooltipTrigger>
            <TooltipContent>
              {t("projectDesk.autoFixTooltip")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    
      <div className="ml-auto flex flex-wrap items-center gap-[8px]">
        <PillButton
          size="sm"
          onClick={handleBuild}
          disabled={batchBusy}
          className="h-[29px] rounded-[7px] text-[12.5px]"
        >
          {building ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1 motion-reduce:animate-none" />
          ) : teamMode ? (
            <Users className="h-3 w-3 mr-1" />
          ) : (
            <Hammer className="h-3 w-3 mr-1" />
          )}
          {teamMode
            ? t("projectDesk.buildAsTeam")
            : t("projectDesk.buildAll")}
        </PillButton>
    
        {/* Review all — appears when multiple selected */}
        {totalSelected >= 2 && (
          <PillButton
            size="sm"
            variant="outline"
            onClick={handleBatchReview}
            disabled={batchBusy}
            className="h-[29px] rounded-[7px] text-[12.5px]"
          >
            {reviewing ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1 motion-reduce:animate-none" />
            ) : (
              <Search className="h-3 w-3 mr-1" />
            )}
            {t("projectDesk.reviewAll")}
          </PillButton>
        )}
    
        {/* Merge all — appears when multiple selected */}
        {totalSelected >= 2 && (
          <PillButton
            size="sm"
            variant="outline"
            onClick={handleBatchMerge}
            disabled={batchBusy}
            className="h-[29px] rounded-[7px] text-[12.5px]"
          >
            {batchMerging ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1 motion-reduce:animate-none" />
            ) : (
              <GitMerge className="h-3 w-3 mr-1" />
            )}
            {t("projectDesk.mergeAll")}
          </PillButton>
        )}
    
        <PillButton
          size="sm"
          variant="outline"
          onClick={batch.clear}
          className="h-[29px] rounded-[7px] text-[12.5px] text-meta"
        >
          {t("projectDesk.clear")}
        </PillButton>
      </div>
    </div>
  );
}
