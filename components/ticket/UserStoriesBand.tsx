"use client";

/**
 * USER STORIES on the pool ground (frame 6a, lines 221-247).
 *
 * The discs have no `onToggle` and there is no add field — story editing lives
 * on the story surface, not in the ticket overlay. That surface is
 * `/projects/:projectId/stories/:storyId`, and the row's trailing QuietLink is
 * the only door to it anywhere in the app, so it is not decoration: without it
 * the route is unreachable.
 *
 * ACCEPTANCE GRADING lands here because that is what it grades — the stories'
 * acceptance criteria. It is a `Stamp`: mono, uppercase, state carried by the
 * WORD, in a colour family the screen already spends (coral for anything that
 * wants you, the land green for a clean pass). Never a per-status colour.
 *
 * EMPTY STATE: zero stories renders the band header and nothing else.
 * `StrataBand` has no min-height, no padding floor and no filler, and its
 * `gap` only materialises *between* children, so the band collapses to its
 * label line for free. That is the system's universal fallback — there is no
 * "No stories yet" copy anywhere in this design.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { fetchJson } from "@/lib/api/client";
import {
  BandHeader,
  CheckMark,
  Mono,
  PillButton,
  Stamp,
  StrataBand,
  type StampTone,
} from "@/components/piscine";
import type { GradingStatus } from "@/lib/grading/report";
import type { TranslationKey } from "@/lib/i18n/catalogue";
import { cn } from "@/lib/utils";
import { countAcceptanceCriteria } from "@/components/ticket/derive";

export interface UserStoryRow {
  id: string;
  title: string;
  status: string;
  acceptanceCriteria: string | null;
  position?: number;
}

export interface UserStoriesBandProps {
  stories: UserStoryRow[];
  /** Needed to perform story updates and deletions in place. */
  projectId?: string;
  /** Aggregate of the latest grading report. `null` = never graded. */
  gradingStatus?: GradingStatus | null;
  /** The grader's one-line verdict, shown under the header when there is one. */
  gradingSummary?: string | null;
  /** Called after a story is updated or deleted in place. */
  onStoryUpdated?: () => void;
}

/**
 * met → the land family (this is what "ready" looks like on this screen),
 * partial and missed → the coral family, which is the screen's one colour for
 * "this wants you". Two families, no third loud colour.
 *
 * A module-scope copy table, so it holds catalogue KEY REFERENCES resolved at
 * render with the namespace-less translator (`lib/i18n/catalogue.ts`,
 * pattern 3).
 */
const GRADING_STAMP: Record<
  GradingStatus,
  { tone: StampTone; labelKey: TranslationKey }
> = {
  met: { tone: "land", labelKey: "Ticket.stories.gradedMet" },
  partial: { tone: "asks", labelKey: "Ticket.stories.gradedPartial" },
  missed: { tone: "failed", labelKey: "Ticket.stories.gradedMissed" },
};

export function UserStoriesBand({
  stories,
  projectId,
  gradingStatus = null,
  gradingSummary = null,
  onStoryUpdated,
}: UserStoriesBandProps) {
  const t = useTranslations("Ticket");
  // `GRADING_STAMP` holds full dotted paths, so the stamp resolves through the
  // namespace-less translator.
  const tKey = useTranslations();
  const done = stories.filter((story) => story.status === "done").length;
  const grading = gradingStatus ? GRADING_STAMP[gradingStatus] : null;

  return (
    <StrataBand
      stratum="next"
      density="rail"
      gap={8}
      className="shrink-0 pb-[15px]"
    >
      <BandHeader
        label={t("stories.label")}
        stratum="next"
        // BandHeader hard-codes gap-[12px]; every 6a band draws 10.
        className="gap-[10px]"
        meta={
          stories.length > 0
            ? t("stories.meta", {
                done: String(done),
                total: String(stories.length),
              })
            : undefined
        }
        right={
          grading ? (
            <Stamp tone={grading.tone} className="shrink-0">
              {tKey(grading.labelKey)}
            </Stamp>
          ) : undefined
        }
      />
      {/* Only ever the grader's own words — no verdict is manufactured for an
          ungraded ticket, which simply has no line here. */}
      {gradingSummary ? (
        <div data-testid="ticket-grading-summary">
          <Mono as="div" size={11} tone="next-mid" clamp={1}>
            {gradingSummary}
          </Mono>
        </div>
      ) : null}
      {stories.map((story) => (
        <StoryRow
          key={story.id}
          story={story}
          projectId={projectId}
          onStoryUpdated={onStoryUpdated}
        />
      ))}
    </StrataBand>
  );
}

function StoryRow({
  story,
  projectId,
  onStoryUpdated,
}: {
  story: UserStoryRow;
  projectId?: string;
  onStoryUpdated?: () => void;
}) {
  const t = useTranslations("Ticket");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(story.title);
  const [status, setStatus] = useState(story.status);
  const [criteria, setCriteria] = useState(story.acceptanceCriteria ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDone = story.status === "done";
  const criteriaCount = countAcceptanceCriteria(story.acceptanceCriteria);

  async function handleToggleStatus() {
    if (!projectId || saving) return;
    const nextStatus = isDone ? "todo" : "done";
    setSaving(true);
    setError(null);
    try {
      const res = await fetchJson<{ error?: string }>(
        `/api/projects/${projectId}/stories/${story.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (!res || !res.ok || res.body?.error) {
        setError(res?.body?.error || t("stories.updateFailed"));
        setEditing(true);
        setStatus(nextStatus);
        setSaving(false);
        return;
      }
      setSaving(false);
      onStoryUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stories.updateFailed"));
      setEditing(true);
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!projectId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetchJson<{ error?: string }>(
        `/api/projects/${projectId}/stories/${story.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || story.title,
            status,
            acceptanceCriteria: criteria.trim() || null,
          }),
        },
      );
      if (!res || !res.ok || res.body?.error) {
        setError(res?.body?.error || t("stories.updateFailed"));
        setSaving(false);
        return;
      }
      setEditing(false);
      setSaving(false);
      onStoryUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stories.updateFailed"));
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!projectId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetchJson<{ error?: string }>(
        `/api/projects/${projectId}/stories/${story.id}`,
        {
          method: "DELETE",
        },
      );
      if (!res || !res.ok || res.body?.error) {
        setError(res?.body?.error || t("stories.deleteFailed"));
        setDeleting(false);
        return;
      }
      setEditing(false);
      setDeleting(false);
      onStoryUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stories.deleteFailed"));
      setDeleting(false);
    }
  }

  const STATUS_OPTIONS = ["todo", "in_progress", "review", "done"];

  if (editing) {
    return (
      <div
        data-testid="ticket-story-row"
        className="flex flex-col gap-2 rounded-[10px] bg-card p-3 border border-border/40"
      >
        <div className="flex items-center justify-between gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("stories.titlePlaceholder")}
            data-testid="ticket-story-edit-title"
            className="flex-1 rounded-[6px] bg-background px-2.5 py-1 text-[13px] font-medium border border-border/50 outline-none focus:border-primary"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 py-1">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setStatus(opt)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-mono transition-colors",
                status === opt
                  ? "bg-foreground text-background font-semibold"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {opt}
            </button>
          ))}
        </div>

        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          rows={3}
          placeholder={t("stories.criteriaPlaceholder")}
          data-testid="ticket-story-edit-criteria"
          className="w-full rounded-[6px] bg-background p-2 text-[12px] font-mono border border-border/50 outline-none focus:border-primary resize-y"
        />

        {error ? (
          <p
            role="alert"
            data-testid="ticket-story-error"
            className="text-[11px] font-mono text-destructive"
          >
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <PillButton
            size="sm"
            onClick={handleSave}
            disabled={saving || deleting}
            data-testid="ticket-story-save"
          >
            {saving ? t("stories.saving") : t("stories.save")}
          </PillButton>
          <PillButton
            size="sm"
            variant="quiet"
            onClick={() => {
              setEditing(false);
              setError(null);
              setTitle(story.title);
              setStatus(story.status);
              setCriteria(story.acceptanceCriteria ?? "");
            }}
            disabled={saving || deleting}
            data-testid="ticket-story-cancel"
          >
            {t("stories.cancel")}
          </PillButton>
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving || deleting}
            data-testid="ticket-story-delete"
            className="ml-auto text-[11px] text-destructive hover:underline disabled:opacity-50 cursor-pointer"
          >
            {deleting ? t("stories.deleting") : t("stories.delete")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="ticket-story-row"
      className="flex items-center gap-[10px] rounded-[10px] bg-card px-3 py-[9px]"
    >
      <button
        type="button"
        onClick={handleToggleStatus}
        disabled={saving}
        className="cursor-pointer bg-transparent border-0 p-0 flex items-center"
        aria-label={t("stories.toggleStatus", { status: story.status })}
      >
        <CheckMark checked={isDone} shape="disc" tone="live" />
      </button>
      <span
        className={cn(
          "min-w-0 flex-1 line-clamp-1 text-[13px] font-medium cursor-pointer",
          isDone ? "text-muted-foreground" : "text-foreground",
        )}
        onClick={() => setEditing(true)}
      >
        {story.title}
      </span>
      {criteriaCount > 0 ? (
        <Mono size={10} tone="muted" className="shrink-0">
          {t("stories.criteria", { count: String(criteriaCount) })}
        </Mono>
      ) : null}
      {projectId ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          data-testid="ticket-story-link"
          className="shrink-0 text-[11.5px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-0 p-0"
        >
          {t("stories.edit")}
        </button>
      ) : null}
    </div>
  );
}
