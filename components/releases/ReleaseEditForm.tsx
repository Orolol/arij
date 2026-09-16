"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  FieldKicker,
  GhostInputPill,
  Mono,
  PillButton,
  QuietLink,
  SurfaceCard,
} from "@/components/piscine";

import type { ReleaseEdit, ReleaseRow } from "./derive";

export interface ReleaseEditFormProps {
  release: ReleaseRow;
  /** Resolves to an error message, or null once the edit is stored. */
  onSave: (edit: ReleaseEdit) => Promise<string | null>;
  /** Leaves edit mode — after a successful save, or on cancel. */
  onClose: () => void;
}

/**
 * The inspect card of an unpublished release, in edit mode (#117): its title
 * and its changelog source, saved together through PATCH.
 *
 * Mounted with `key={release.id}` by the band, so the draft below is seeded
 * once from the release being edited and never has to catch up with a prop.
 * The seed can go stale while the form is open (the changelog agent delivers,
 * another tab saves): that is the server's call, through the expected values
 * the save sends — see {@link ReleaseEdit}.
 * The field is a plain textarea on the card's own mono recipe: the changelog
 * is a text artefact here (see ChangelogCard), and Piscine has no multi-line
 * primitive to reach for.
 */
export function ReleaseEditForm({ release, onSave, onClose }: ReleaseEditFormProps) {
  const t = useTranslations("Releases");
  const [title, setTitle] = useState(release.title ?? "");
  const [changelog, setChangelog] = useState(release.changelog ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    // Only what changed against the seed, each with its seed as the guard: a
    // title fix must not resend a changelog the agent may have replaced since
    // the form opened.
    const seedTitle = release.title ?? null;
    const seedChangelog = release.changelog ?? "";
    const nextTitle = title.trim() || null;
    const edit: ReleaseEdit = {};
    if (nextTitle !== seedTitle) {
      edit.title = nextTitle;
      edit.expectedTitle = seedTitle;
    }
    if (changelog !== seedChangelog) {
      edit.changelog = changelog;
      edit.expectedChangelog = release.changelog;
    }
    if (Object.keys(edit).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    void onSave(edit).then((failure) => {
      setSaving(false);
      if (failure) {
        setError(failure);
        return;
      }
      onClose();
    });
  };

  return (
    <SurfaceCard
      radius={11}
      className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-hidden px-[16px] py-[13px]"
    >
      <div className="flex items-baseline gap-[10px]">
        <FieldKicker stratum="land" size={10}>
          {t("next.changelog")}
        </FieldKicker>
      </div>

      <GhostInputPill
        aria-label={t("next.titleLabel")}
        data-testid="release-edit-title-input"
        value={title}
        onChange={setTitle}
        placeholder={t("next.titlePlaceholder")}
        // Not `width="flex"`: that is `flex-1`, which in this column would
        // grow the pill's HEIGHT. The row is filled through `w-full` instead.
        className="w-full shrink-0"
        disabled={saving}
      />

      <textarea
        aria-label={t("edit.changelogLabel")}
        data-testid="release-changelog-editor"
        value={changelog}
        onChange={(e) => setChangelog(e.target.value)}
        disabled={saving}
        spellCheck={false}
        className="min-h-[120px] w-full flex-1 resize-none rounded-[10px] border-[1.5px] border-input bg-field px-[12px] py-[9px] font-mono text-[11.5px] leading-[1.6] text-foreground tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
      />

      {error ? (
        <span data-testid="release-edit-error">
          <Mono size={11} tone="danger">
            {error}
          </Mono>
        </span>
      ) : null}

      <div className="flex items-center gap-[12px]">
        <QuietLink
          tone="muted"
          size={11.5}
          testId="release-edit-cancel"
          onClick={onClose}
          className="ml-auto"
        >
          {t("edit.cancel")}
        </QuietLink>
        <PillButton
          variant="filled"
          size="md"
          pending={saving}
          pendingLabel={t("edit.saving")}
          onClick={save}
          data-testid="release-edit-save"
          className="h-[31px] px-[15px]"
        >
          {t("edit.save")}
        </PillButton>
      </div>
    </SurfaceCard>
  );
}
