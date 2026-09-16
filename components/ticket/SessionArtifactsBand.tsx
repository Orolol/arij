"use client";

/**
 * VISUAL PROOF on the land ground — the screenshots build agents attach
 * through `attach_artifact`, next to the verification report they complement.
 *
 * WHY IT EXISTS. The server chain (MCP tool, prompt section, durable copy in
 * `data/sessions/<id>/artifacts`, the list and file routes) outlived its only
 * reader, `SessionArtifactGallery`, when the old EpicDetail panel was removed
 * (7fec5315). Every proof an agent attached since was stored and never shown.
 *
 * WHAT IT DRAWS. One thumbnail per artifact, served by its opaque id through
 * `sessionArtifactUrl` (never a path), with the agent's caption and the
 * session that produced it. A thumbnail opens the shared `ImageLightbox`.
 *
 * EMPTY STATE: nothing at all, like `TicketScreenshots`. Visual proof is an
 * opt-in (`visual_proof_enabled`) and most tickets never carry one, so a bare
 * label line on every ticket would advertise an absence. A failed read is the
 * exception — it renders the band, the error in words and a Retry, so a proof
 * that exists is never silently missing. While loading, nothing either: the
 * overlay never prints a loading string (`e2e/fixtures/board.ts`).
 *
 * No state colour: the error line is the band's own deep ink, the words carry it.
 */

import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  BandHeader,
  Mono,
  PillButton,
  QuietLink,
  StrataBand,
  SurfaceCard,
} from "@/components/piscine";
import {
  ImageLightbox,
  type LightboxImage,
} from "@/components/shared/ImageLightbox";
import {
  sessionArtifactUrl,
  type SessionArtifactSummary,
} from "@/lib/agent-sessions/artifact-view";
import { formatDateTime } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locales";

export interface SessionArtifactsBandProps {
  projectId: string;
  /** Oldest first, as the list route orders them. */
  artifacts: SessionArtifactSummary[];
  /** The last read failed; the previous list, if any, is still in `artifacts`. */
  error: string | null;
  onRetry: () => void;
}

export function SessionArtifactsBand({
  projectId,
  artifacts,
  error,
  onRetry,
}: SessionArtifactsBandProps) {
  const t = useTranslations("Ticket");
  const locale = useLocale() as UiLocale;
  const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(
    null,
  );

  /**
   * ESCAPE PRECEDENCE, as in `TicketScreenshots`: the lightbox sits on top of
   * the ticket overlay and both close on Escape. Marking the key handled in
   * the capture phase lets the lightbox (document, bubble) close while the
   * overlay (window, bubble, skips handled keys) stays open.
   */
  useEffect(() => {
    if (!lightboxImage) return;
    const markHandled = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    window.addEventListener("keydown", markHandled, true);
    return () => window.removeEventListener("keydown", markHandled, true);
  }, [lightboxImage]);

  if (artifacts.length === 0 && !error) return null;

  return (
    // `StrataBand` drops unknown props, so the test id rides a
    // `display: contents` wrapper that adds no box (see VerifyBand).
    <div className="contents" data-testid="ticket-artifacts-band">
      <StrataBand
        stratum="land"
        density="rail"
        gap={8}
        className="shrink-0 pb-[15px]"
      >
        <BandHeader
          label={t("artifacts.label")}
          stratum="land"
          className="gap-[10px]"
          meta={
            artifacts.length > 0
              ? t("artifacts.meta", { count: artifacts.length })
              : undefined
          }
        />

        {artifacts.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {artifacts.map((artifact) => (
              <ArtifactFigure
                key={artifact.id}
                projectId={projectId}
                artifact={artifact}
                locale={locale}
                onOpen={setLightboxImage}
              />
            ))}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <p
              data-testid="ticket-artifacts-error"
              className="m-0 text-[12px] leading-[1.5] text-strata-land-deep"
            >
              {error}
            </p>
            <PillButton
              variant="outline"
              outlineTone="action"
              size="sm"
              icon={RotateCw}
              onClick={onRetry}
              data-testid="ticket-artifacts-retry"
            >
              {t("artifacts.retry")}
            </PillButton>
          </div>
        ) : null}
      </StrataBand>

      <ImageLightbox
        image={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />
    </div>
  );
}

function ArtifactFigure({
  projectId,
  artifact,
  locale,
  onOpen,
}: {
  projectId: string;
  artifact: SessionArtifactSummary;
  locale: UiLocale;
  onOpen: (image: LightboxImage) => void;
}) {
  const t = useTranslations("Ticket");
  const url = sessionArtifactUrl(projectId, artifact.id);
  const when = formatDateTime(artifact.createdAt, { locale });
  const sessionHref = `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(artifact.agentSessionId)}`;

  return (
    <SurfaceCard radius={10} className="min-w-0 overflow-hidden">
      <figure className="m-0 flex flex-col">
        <button
          type="button"
          onClick={() =>
            onOpen({ url, alt: artifact.caption, caption: artifact.caption })
          }
          aria-label={t("artifacts.open", { caption: artifact.caption })}
          className="block w-full border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        >
          {/* Project-scoped local route serving an opaque id — not a remote asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={artifact.caption}
            loading="lazy"
            className="block aspect-video w-full bg-field object-cover"
          />
        </button>
        <figcaption className="flex flex-col gap-[3px] px-3 py-2">
          <span className="line-clamp-3 text-[12.5px] leading-[1.45] text-foreground">
            {artifact.caption}
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <QuietLink tone="land" size={11.5} href={sessionHref}>
              {t("artifacts.session", {
                id: artifact.agentSessionId.slice(0, 6),
              })}
            </QuietLink>
            {when ? (
              <Mono size={10} tone="land-mid">
                {when}
              </Mono>
            ) : null}
          </span>
        </figcaption>
      </figure>
    </SurfaceCard>
  );
}

export default SessionArtifactsBand;
