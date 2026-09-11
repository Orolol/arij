"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ExternalLink, Tag, Upload } from "lucide-react";

import {
  BandHeader,
  GhostInputPill,
  Mono,
  PillButton,
  QuietLink,
  StrataBand,
  pillButtonVariants,
  type ProjectTone,
} from "@/components/piscine";
import { formatRelative } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

import { ChangelogAgentPopover } from "./ChangelogAgentPopover";
import { ChangelogCard } from "./ChangelogCard";
import { ReleaseEditForm } from "./ReleaseEditForm";
import { ReleaseTicketRow, type ReleaseTicketEpic } from "./ReleaseTicketRow";
import { VersionPill } from "./VersionPill";
import {
  parseEpicIds,
  releaseState,
  RELEASE_STATE_KEYS,
  ticketExclusionReason,
  type ReleaseEdit,
  type ReleaseEpic,
  type ReleaseRow,
} from "./derive";

export interface NextReleaseBandProps {
  projectId: string;
  /** Project identity colour for every ticket chip on the screen. */
  tone: ProjectTone;
  loading: boolean;

  /** null = compose mode. A release = inspect mode. */
  inspectRelease: ReleaseRow | null;
  /** The inspected release's recorded tickets, in the order it recorded them. */
  inspectEpics: ReleaseTicketEpic[];
  onLeaveInspect: () => void;

  /* ---- compose ---- */
  version: string;
  /** The release title typed in the compose form; "" = none. */
  title: string;
  onTitleChange: (title: string) => void;
  bumps: { patch: string; minor: string; major: string } | null;
  onVersionSelect: (version: string) => void;
  candidates: ReleaseEpic[];
  isChecked: (epic: ReleaseEpic) => boolean;
  onToggleEpic: (epicId: string) => void;
  selectedCount: number;
  changelogPreview: string;
  namedAgentId: string | null;
  onNamedAgentChange: (id: string | null) => void;
  selectedAgentProvider: string | undefined;
  resumeSessionId: string | undefined;
  onResumeSessionChange: (id: string | undefined) => void;
  /** `!ghLoading && hasGitHub` — both halves, so the control does not flash. */
  showGitHubToggle: boolean;
  pushToGitHub: boolean;
  onTogglePushToGitHub: () => void;
  creating: boolean;
  onCreate: () => void;

  /* ---- inspect ---- */
  /** The inspected release is not published: its title and changelog can change. */
  canEdit: boolean;
  /** PATCHes the inspected release; resolves to an error message or null. */
  onSaveEdit: (releaseId: string, edit: ReleaseEdit) => Promise<string | null>;
  canPublish: boolean;
  isPublishing: boolean;
  publishError: string | null;
  onPublish: () => void;
}

/**
 * The left 6/10 of frame 8c: the sun-yellow band where the next release is
 * composed, and — in inspect mode — where a past release's changelog is read
 * and its GitHub draft published.
 *
 * Rule (5) is what shapes the layout: only the changelog card grows, so with
 * zero candidates the band collapses to its label line, and with many tickets
 * the capped list grows while the changelog card gives up its slack. The footer
 * is never pushed out of view.
 */
export function NextReleaseBand({
  projectId,
  tone,
  loading,
  inspectRelease,
  inspectEpics,
  onLeaveInspect,
  version,
  title,
  onTitleChange,
  bumps,
  onVersionSelect,
  candidates,
  isChecked,
  onToggleEpic,
  selectedCount,
  changelogPreview,
  namedAgentId,
  onNamedAgentChange,
  selectedAgentProvider,
  resumeSessionId,
  onResumeSessionChange,
  showGitHubToggle,
  pushToGitHub,
  onTogglePushToGitHub,
  creating,
  onCreate,
  canEdit,
  onSaveEdit,
  canPublish,
  isPublishing,
  publishError,
  onPublish,
}: NextReleaseBandProps) {
  const locale = useLocale();
  const t = useTranslations("Releases");
  const all = useTranslations();
  const inspecting = inspectRelease !== null;
  // Keyed by release id rather than a boolean, so leaving inspect mode or
  // inspecting another release drops the edit without an effect to reset it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = inspectRelease !== null && canEdit && editingId === inspectRelease.id;
  // Only reached after loading: an unknown candidate list is not an empty one.
  const composeEmpty = !inspecting && !loading && candidates.length === 0;

  const bandClass = "min-h-0 min-w-0 flex-[6] shrink px-[20px] py-[16px]";

  const header = (
    <BandHeader
      stratum="land"
      labelSize={12}
      label={inspecting ? t("next.inspectLabel") : t("next.label")}
      meta={
        inspectRelease ? (
          <span className="inline-flex items-baseline gap-[10px]">
            {all(RELEASE_STATE_KEYS[releaseState(inspectRelease)])}
            {inspectRelease.changelogPending ? (
              <span>{t("state.changelogPending")}</span>
            ) : null}
            {inspectRelease.finalizeErrors?.length ? (
              <span>{t("state.syncFailed")}</span>
            ) : null}
            <QuietLink tone="next" size={11.5} onClick={onLeaveInspect}>
              {t("next.backToDraft")}
            </QuietLink>
          </span>
        ) : composeEmpty ? (
          t("next.noCandidates")
        ) : (
          t("next.draft")
        )
      }
      right={
        <VersionPill
          version={inspectRelease ? inspectRelease.version : version}
          bumps={bumps}
          onSelect={onVersionSelect}
          readOnly={inspecting}
        />
      }
    />
  );

  // The band collapses to its label line: no list, no changelog card, no footer.
  if (composeEmpty || (!inspecting && loading)) {
    return (
      <StrataBand stratum="land" gap={11} className={bandClass}>
        {header}
      </StrataBand>
    );
  }

  const rowCount = inspectRelease ? inspectEpics.length : candidates.length;

  /**
   * `3 tickets · tag v0.4.2 on release/v0.4.2`, dropping each null clause.
   *
   * Local to the band on purpose: the sentence is composed from parts, and
   * `lib/i18n/catalogue.ts` wants every key a literal at a real call site
   * rather than a translator threaded through a module-scope helper.
   */
  function inspectSummary(release: ReleaseRow): string {
    const count = parseEpicIds(release).length;
    if (release.gitTag && release.releaseBranch) {
      return t("summary.tagAndBranch", {
        count,
        tag: release.gitTag,
        branch: release.releaseBranch,
      });
    }
    if (release.gitTag) return t("summary.tagOnly", { count, tag: release.gitTag });
    if (release.releaseBranch) {
      return t("summary.branchOnly", { count, branch: release.releaseBranch });
    }
    return t("summary.ticketsOnly", { count });
  }

  const footerSummary = inspectRelease
    ? inspectSummary(inspectRelease)
    : t("summary.compose", { count: selectedCount, version });

  return (
    <StrataBand stratum="land" gap={11} className={bandClass}>
      {header}

      {inspectRelease ? (
        inspectRelease.title ? (
          <span data-testid="release-inspect-title">
            <Mono size={12} weight={700} clamp={1}>
              {inspectRelease.title}
            </Mono>
          </span>
        ) : null
      ) : null}

      {/* What went wrong while tagging and syncing, spelled out: that step
          runs in the background, and the row is the only lasting record. */}
      {inspectRelease?.finalizeErrors?.length ? (
        <div data-testid="release-finalize-errors" className="flex min-w-0 shrink-0 flex-col gap-[3px] break-words">
          {inspectRelease.finalizeErrors.map((message, index) => (
            <Mono key={index} size={11} tone="muted">
              {message}
            </Mono>
          ))}
        </div>
      ) : null}

      {inspectRelease ? null : (
        <GhostInputPill
          aria-label={t("next.titleLabel")}
          data-testid="release-title-input"
          value={title}
          onChange={onTitleChange}
          placeholder={t("next.titlePlaceholder")}
          fill="card"
          // `w-full`, not `width="flex"`: `flex-1` in this column would grow
          // the pill's height instead of its width.
          className="w-full shrink-0"
        />
      )}

      {rowCount > 0 ? (
        <div className="flex max-h-[42%] min-h-0 shrink-0 flex-col gap-[7px] overflow-y-auto">
          {inspectRelease
            ? inspectEpics.map((row) => (
                <ReleaseTicketRow
                  key={row.id}
                  epic={row}
                  tone={tone}
                  checked
                  reason={null}
                  meta={null}
                  readOnly
                />
              ))
            : candidates.map((epic) => (
                <ReleaseTicketRow
                  key={epic.id}
                  epic={epic}
                  tone={tone}
                  checked={isChecked(epic)}
                  reason={ticketExclusionReason(epic, (count) => t("next.storiesLeft", { count }))}
                  // There is no mergedAt column; for a `done` epic updatedAt IS
                  // the transition timestamp. An unknown one is an em-dash.
                  meta={t("next.merged", {
                    age: formatRelative(epic.updatedAt, { locale }) || "—",
                  })}
                  onToggle={() => onToggleEpic(epic.id)}
                />
              ))}
        </div>
      ) : null}

      {editing && inspectRelease ? (
        <ReleaseEditForm
          key={inspectRelease.id}
          release={inspectRelease}
          onSave={(edit) => onSaveEdit(inspectRelease.id, edit)}
          onClose={() => setEditingId(null)}
        />
      ) : (
        <ChangelogCard
          caption={
            inspecting ? t("next.changelog") : t("next.changelogCompose")
          }
          markdown={inspectRelease ? inspectRelease.changelog : changelogPreview}
          right={
            inspectRelease ? (
              canEdit ? (
                <QuietLink
                  tone="next"
                  size={11.5}
                  testId="release-edit-button"
                  onClick={() => setEditingId(inspectRelease.id)}
                >
                  {t("edit.open")}
                </QuietLink>
              ) : undefined
            ) : (
              <ChangelogAgentPopover
                projectId={projectId}
                namedAgentId={namedAgentId}
                onNamedAgentChange={onNamedAgentChange}
                selectedAgentProvider={selectedAgentProvider}
                resumeSessionId={resumeSessionId}
                onResumeSessionChange={onResumeSessionChange}
              />
            )
          }
        />
      )}

      {inspecting && publishError ? (
        <span data-testid="release-publish-error">
          <Mono size={11} tone="danger">
            {publishError}
          </Mono>
        </span>
      ) : null}

      <div className="flex items-center gap-[10px]">
        <Mono size={10.5} tone="land-mid" clamp={1}>
          {footerSummary}
        </Mono>

        {inspectRelease ? (
          <>
            {inspectRelease.githubReleaseUrl ? (
              <a
                href={inspectRelease.githubReleaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="release-view-on-github"
                className={cn(
                  pillButtonVariants({
                    variant: "outline",
                    outlineTone: "action",
                    size: "md",
                  }),
                  "ml-auto h-[31px] px-[14px] no-underline",
                )}
              >
                <ExternalLink size={13} aria-hidden="true" />
                {t("next.viewOnGitHub")}
              </a>
            ) : null}
            {canPublish ? (
              <PillButton
                variant="filled"
                size="lg"
                icon={Upload}
                pending={isPublishing}
                pendingLabel={t("next.publishing")}
                disabled={isPublishing}
                onClick={onPublish}
                data-testid="release-publish-button"
                className={`h-[31px] px-[15px] ${inspectRelease.githubReleaseUrl ? "" : "ml-auto"}`}
              >
                {t("next.publish")}
              </PillButton>
            ) : null}
          </>
        ) : (
          <>
            {showGitHubToggle ? (
              <PillButton
                variant="outline"
                outlineTone="action"
                size="md"
                aria-pressed={pushToGitHub}
                icon={pushToGitHub ? Check : undefined}
                onClick={onTogglePushToGitHub}
                data-testid="release-github-draft-toggle"
                className="ml-auto h-[31px] px-[14px]"
              >
                {t("next.githubDraft")}
              </PillButton>
            ) : null}
            <PillButton
              variant="filled"
              size="lg"
              icon={Tag}
              pending={creating}
              pendingLabel={t("next.creating")}
              disabled={creating || !version.trim() || selectedCount === 0}
              onClick={onCreate}
              data-testid="release-create-button"
              className={`h-[31px] px-[15px] ${showGitHubToggle ? "" : "ml-auto"}`}
            >
              {t("next.create")}
            </PillButton>
          </>
        )}
      </div>
    </StrataBand>
  );
}
