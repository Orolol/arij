"use client";

import { requestJson } from "@/lib/api/client";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/i18n/format";
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, CheckCircle2, FileCode2, Loader2, X } from "lucide-react";
import type { Friction } from "@/lib/db/schema";
import {
  FRICTION_CATEGORIES,
  FRICTION_STATUSES,
  OPEN_FRICTION_STATUSES,
  type FrictionCategory,
  type FrictionStatus,
} from "@/lib/frictions/constants";
import type { ManualEpicDraft } from "@/lib/epics/manual-epic-form";
import type { TranslationKey } from "@/lib/i18n/catalogue";
import { EpicCreateDialog } from "@/components/kanban/EpicCreateDialog";
import { FieldKicker, Mono, PillButton, Stamp, SurfaceCard } from "@/components/piscine";
import { usePolledResource } from "@/hooks/usePolledResource";

type CategoryFilter = "all" | FrictionCategory;
type StatusFilter = "all" | "open" | FrictionStatus;

const FRICTION_CATEGORY_KEYS: Record<FrictionCategory, TranslationKey> = {
  broken_tooling: "ProjectFrictions.category.broken_tooling",
  misleading_docs: "ProjectFrictions.category.misleading_docs",
  flaky_test: "ProjectFrictions.category.flaky_test",
  unclear_convention: "ProjectFrictions.category.unclear_convention",
  other: "ProjectFrictions.category.other",
};

const FRICTION_STATUS_KEYS: Record<FrictionStatus, TranslationKey> = {
  new: "ProjectFrictions.status.new",
  triaged: "ProjectFrictions.status.triaged",
  converted: "ProjectFrictions.status.converted",
  dismissed: "ProjectFrictions.status.dismissed",
};

interface FrictionsData { frictions: Friction[]; openCount: number }
const NO_FRICTIONS: Friction[] = [];
function isFrictionsData(value: unknown): value is FrictionsData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<FrictionsData>;
  return Array.isArray(data.frictions) && typeof data.openCount === "number";
}

function isOpen(friction: Friction): boolean {
  return OPEN_FRICTION_STATUSES.includes(
    friction.status as (typeof OPEN_FRICTION_STATUSES)[number],
  );
}

export default function ProjectFrictionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ProjectFrictionsContent key={projectId} projectId={projectId} />;
}

function ProjectFrictionsContent({ projectId }: { projectId: string }) {
  const locale = useLocale();
  const t = useTranslations("ProjectFrictions");
  const tKey = useTranslations();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [actionError, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const [selectedFriction, setSelectedFriction] = useState<Friction | null>(null);

  const errorMessage = useCallback(() => t("page.loadFailed"), [t]);
  const { data, loading, error: loadError, refresh: loadFrictions } = usePolledResource<FrictionsData>(
    `/api/projects/${projectId}/frictions`, null, errorMessage, { validateData: isFrictionsData },
  );
  const frictions = data?.frictions ?? NO_FRICTIONS;
  const error = actionError ?? loadError;

  const visibleFrictions = useMemo(
    () =>
      frictions
        .filter(
          (friction) =>
            categoryFilter === "all" || friction.category === categoryFilter,
        )
        .filter((friction) => {
          if (statusFilter === "all") return true;
          if (statusFilter === "open") return isOpen(friction);
          return friction.status === statusFilter;
        })
        .sort(
          (left, right) =>
            right.occurrences - left.occurrences ||
            right.createdAt.localeCompare(left.createdAt) ||
            left.id.localeCompare(right.id),
        ),
    [categoryFilter, frictions, statusFilter],
  );

  const selectedDraft = useMemo((): ManualEpicDraft | undefined => {
    if (!selectedFriction) return undefined;
    const categoryLabel = tKey(FRICTION_CATEGORY_KEYS[selectedFriction.category]);
    const subject = selectedFriction.filePath
      ? `${categoryLabel}: ${selectedFriction.filePath}`
      : `${categoryLabel} ${t("draft.frictionSuffix")}`;
    const title = subject.length <= 200 ? subject : `${subject.slice(0, 197)}...`;
    const location = selectedFriction.filePath ? t("draft.location", { path: selectedFriction.filePath }) : "";
    const recurrence = t("draft.recurrence", { count: selectedFriction.occurrences });

    return {
      title,
      description: `${selectedFriction.description}${location}${recurrence}`,
      userStories: [],
    };
  }, [selectedFriction, t, tKey]);

  async function updateFrictionStatus(frictionId: string, status: "triaged" | "dismissed") {
    if (pending.current.has(frictionId)) return;
    pending.current.add(frictionId);
    setPendingIds(new Set(pending.current));
    setError(null);
    const response = await requestJson<Friction>(`/api/projects/${projectId}/frictions/${frictionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
      errorMessage: t("page.dismissFailed"),
    });
    if (response.error) setError(response.error);
    else await loadFrictions();
    pending.current.delete(frictionId);
    setPendingIds(new Set(pending.current));
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Controls row: filters on the left, open count on the right */}
        <div className="flex flex-wrap items-center justify-between gap-3" aria-label={t("page.filtersLabel")}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {t("page.category")}
              <select
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.target.value as CategoryFilter)
                }
                className="h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-action"
              >
                <option value="all">{t("page.allCategories")}</option>
                {FRICTION_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {tKey(FRICTION_CATEGORY_KEYS[category])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {t("page.status")}
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-action"
              >
                <option value="open">{t("page.open")}</option>
                <option value="all">{t("page.allStatuses")}</option>
                {FRICTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {tKey(FRICTION_STATUS_KEYS[status])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <FieldKicker stratum="land" size={11}>
            {data ? t("page.openCount", { count: data.openCount }) : "—"}
          </FieldKicker>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-xs text-foreground">
            <span>{error}</span>
            <PillButton variant="secondary" size="sm" onClick={() => { setError(null); void loadFrictions(); }}>
              {t("page.retry")}
            </PillButton>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
            <span className="sr-only">{t("page.loading")}</span>
          </div>
        ) : error && !data ? null : visibleFrictions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-xs text-muted-foreground">
            {t("page.empty")}
          </div>
        ) : (
          <div className="space-y-2.5" data-testid="friction-list">
            {visibleFrictions.map((friction) => (
              <SurfaceCard key={friction.id} data-testid={`friction-${friction.id}`} className="p-3.5">
                <div className="flex flex-wrap items-start gap-3">
                  <div
                    className="flex h-8 min-w-8 items-center justify-center rounded bg-card-translucent text-xs font-semibold"
                    title={t("page.occurrences", {
                      count: friction.occurrences,
                    })}
                  >
                    <Mono size={11}>×{friction.occurrences}</Mono>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {tKey(FRICTION_CATEGORY_KEYS[friction.category])}
                      </span>
                      <Stamp tone="card" size="xs">
                        {tKey(FRICTION_STATUS_KEYS[friction.status])}
                      </Stamp>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                      {friction.description}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {friction.filePath && (
                        <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                          <FileCode2 className="h-3 w-3 shrink-0" />
                          <code className="truncate">{friction.filePath}</code>
                        </span>
                      )}
                      <span>
                        {friction.agentSessionId ? (
                          <Link
                            href={`/projects/${projectId}/sessions/${friction.agentSessionId}`}
                            className="underline hover:text-foreground"
                          >
                            {t("page.sourceSession")}
                          </Link>
                        ) : (
                          t("page.sourceSession")
                        )}
                      </span>
                      <time dateTime={friction.createdAt}>
                        {formatDateTime(friction.createdAt, locale, "short")}
                      </time>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {isOpen(friction) && (
                      <>
                        <PillButton
                          size="sm"
                          variant="primary"
                          onClick={() => setSelectedFriction(friction)}
                          disabled={pendingIds.has(friction.id)}
                        >
                          {t("page.createTicket")}
                        </PillButton>
                        {friction.status === "new" && (
                          <PillButton
                            size="sm"
                            variant="secondary"
                            onClick={() => void updateFrictionStatus(friction.id, "triaged")}
                            disabled={pendingIds.has(friction.id)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            {t("actions.markTriaged")}
                          </PillButton>
                        )}
                        <PillButton
                          size="sm"
                          variant="secondary"
                          onClick={() => void updateFrictionStatus(friction.id, "dismissed")}
                          disabled={pendingIds.has(friction.id)}
                        >
                          {pendingIds.has(friction.id) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                          {t("page.dismiss")}
                        </PillButton>
                      </>
                    )}
                    {friction.status === "converted" && friction.epicId && (
                      <Link href={`/projects/${projectId}?ticket=${friction.epicId}`}>
                        <PillButton size="sm" variant="secondary">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {t("page.viewTicket")}
                        </PillButton>
                      </Link>
                    )}
                  </div>
                </div>
              </SurfaceCard>
            ))}
          </div>
        )}
      </div>

      <EpicCreateDialog
        projectId={projectId}
        open={selectedFriction !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedFriction(null);
        }}
        initialDraft={selectedDraft}
        frictionId={selectedFriction?.id}
        dialogTitle={t("createDialog.title")}
        dialogDescription={t("createDialog.description")}
        submitLabel={t("createDialog.submit")}
        onCreated={() => {
          setSelectedFriction(null);
          void loadFrictions();
        }}
      />
    </div>
  );
}
