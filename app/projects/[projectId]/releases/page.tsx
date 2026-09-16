"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { PillButton, projectTone, projectToneIndex } from "@/components/piscine";
import { ToastStack } from "@/components/toast/ToastStack";
import { useToastStack } from "@/components/toast/useToastStack";
import { NextReleaseBand } from "@/components/releases/NextReleaseBand";
import { ReleaseHeaderCluster } from "@/components/releases/ReleaseHeaderCluster";
import { ReleaseHistory } from "@/components/releases/ReleaseHistory";
import { ReleaseStatTiles } from "@/components/releases/ReleaseStatTiles";
import type { ReleaseTicketEpic } from "@/components/releases/ReleaseTicketRow";
import {
  buildChangelogPreview,
  nextPatchVersion,
  parseEpicIds,
  releaseState,
  versionBumps,
  type ReleaseEdit,
  type ReleaseEpic,
  type ReleaseRow,
} from "@/components/releases/derive";
import { useGitHubConfig } from "@/hooks/useGitHubConfig";
import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import { useReleasePublish } from "@/hooks/useReleasePublish";
import { fetchJson } from "@/lib/api/client";

/** Reload cadence while a release is still being written; see the effect. */
const PENDING_RELEASE_REFRESH_MS = 15_000;

/** The fields of the project row this screen reads. */
interface ProjectRecord {
  defaultBranch?: string | null;
  gitRepoPath?: string | null;
  /** Not a column today; read defensively so the day it lands nothing changes. */
  colorIndex?: number | null;
}

export default function ReleasesPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  return <ProjectReleases key={projectId} projectId={projectId} />;
}

function ProjectReleases({ projectId }: { projectId: string }) {
  const t = useTranslations("Releases");
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [allEpics, setAllEpics] = useState<ReleaseEpic[]>([]);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const readSeq = useRef(0);
  const creatingRef = useRef(false);
  const { toasts, raise: showToast, dismiss: dismissToast } = useToastStack();

  // GitHub config. `isConfigured` reads the MASKED settings shape
  // (`github_pat.hasToken === true`); testing it as a string made it
  // permanently false once. `!ghLoading &&` keeps the control from flashing
  // in and out on first paint.
  const { isConfigured: hasGitHub, loading: ghLoading } =
    useGitHubConfig(projectId);
  const { publish, isPublishing, error: publishError } =
    useReleasePublish(projectId);

  // Compose-form state. The version and the ticket selection are DERIVED from
  // the loaded data with a user override on top, so neither needs a
  // set-state-in-effect to catch up when the fetch lands.
  const [versionOverride, setVersionOverride] = useState<string | null>(null);
  const [checkOverrides, setCheckOverrides] = useState<Map<string, boolean>>(
    new Map()
  );
  const [pushToGitHub, setPushToGitHub] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resumeSessionId, setResumeSessionId] = useState<string | undefined>(undefined);
  const [namedAgentId, setNamedAgentId] = useState<string | null>(null);
  const { agents: namedAgents } = useNamedAgentsList();

  // The optional release title (#117). It names the GitHub draft
  // (`v1.2.0 — Title`) and heads the fallback changelog, so the preview
  // below follows it as it is typed.
  const [title, setTitle] = useState("");

  // Resolve selected agent's provider for SessionPicker filtering
  // When no named agent is selected, let the server resolve the default via agentType
  const selectedAgentProvider = namedAgentId
    ? namedAgents.find((a) => a.id === namedAgentId)?.provider
    : undefined;

  const loadData = useCallback(async () => {
    const request = ++readSeq.current;
    const payloads = await Promise.all([
      `/api/projects/${projectId}/releases`,
      `/api/projects/${projectId}/epics`,
      `/api/projects/${projectId}`,
    ].map(async (url) => {
      const response = await fetch(url);
      return response.ok ? response.json() : null;
    })).catch(() => null);
    if (request !== readSeq.current) return;
    if (!payloads || !Array.isArray(payloads[0]?.data) ||
        !Array.isArray(payloads[1]?.data) || !payloads[2]?.data) {
      setLoadError(t("feedback.loadFailed"));
    } else {
      setReleases(payloads[0].data);
      setAllEpics(payloads[1].data);
      setProject(payloads[2].data);
      setLoadError(null);
    }
    setLoading(false);
  }, [projectId, t]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void loadData(); });
    return () => { active = false; readSeq.current += 1; };
  }, [loadData]);

  // The changelog agent runs in the background (#109): the release is
  // created at once, and its tag, CHANGELOG commit and GitHub draft land
  // when the run ends. The server announces that with `release:updated`,
  // whose `githubErrors` raise a toast right away — nobody is waiting on the
  // POST any more. The failures also stay on the row (`finalizeErrors`) for
  // whoever was not looking at that moment.
  const { pollTick } = useProjectEvents(projectId, {
    "release:created": () => void loadData(),
    "release:updated": (event) => {
      const githubErrors = Array.isArray(event.data.githubErrors)
        ? (event.data.githubErrors as string[])
        : [];
      if (githubErrors.length > 0) {
        const release = releases.find((r) => r.id === event.data.releaseId);
        showToast(
          "error",
          t("toast.backgroundGithubFailed", {
            version: release?.version ?? "?",
            error: githubErrors[0],
          })
        );
      }
      void loadData();
    },
  });

  // Without the event stream the hook falls back to a poll tick. Only worth
  // a reload while some changelog is still being written.
  const anyPending = releases.some((release) => release.changelogPending);
  // `loadData`'s sequence number drops a reload that a newer one overtook,
  // or that lands after unmount (the mount effect's cleanup bumps it).
  useEffect(() => {
    if (pollTick === 0 || !anyPending) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) void loadData(); });
    return () => { active = false; };
    // `anyPending` flipping to true re-runs this once more at the current
    // tick — one redundant reload, only while the stream is down, and no
    // lint suppression (which would also switch the React Compiler off here).
  }, [pollTick, anyPending, loadData]);

  // A pending release also finishes WITHOUT an event: when its run is
  // cancelled while still queued, or reaped by a restart, it is finalised by
  // the server's reconciliation on the next GET — which nothing on this page
  // would otherwise issue. A slow reload while anything is pending is that GET.
  useEffect(() => {
    if (!anyPending) return;
    const timer = setInterval(() => {
      void loadData();
    }, PENDING_RELEASE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [anyPending, loadData]);

  // Both halves matter: the second is what stops an already-released ticket
  // from being offered again.
  const doneEpics = useMemo(
    () => allEpics.filter((e) => e.status === "done" && !e.releaseId),
    [allEpics]
  );

  const epicById = useMemo(
    () => new Map(allEpics.map((epic) => [epic.id, epic] as const)),
    [allEpics]
  );

  const latest = releases[0] ?? null;
  const bumps = versionBumps(latest?.version);
  const version =
    versionOverride ?? nextPatchVersion(latest?.version) ?? "0.1.0";

  const isChecked = useCallback(
    (epic: ReleaseEpic) =>
      checkOverrides.get(epic.id) ?? (epic.usCount ?? 0) <= (epic.usDone ?? 0),
    [checkOverrides]
  );

  const selectedEpics = useMemo(
    () => doneEpics.filter(isChecked),
    [doneEpics, isChecked]
  );
  const selectedEpicIds = useMemo(
    () => new Set(selectedEpics.map((epic) => epic.id)),
    [selectedEpics]
  );

  // Mirrors the server's own fallback changelog byte for byte, so what the user
  // reads is what they get if the changelog agent run fails.
  const changelogPreview = useMemo(
    () => buildChangelogPreview(version, title || null, selectedEpics),
    [version, title, selectedEpics]
  );

  // Derived, not stored: the composer is shown until a release is picked, and
  // a release that disappears on reload falls back to the composer.
  const [inspectReleaseId, setInspectReleaseId] = useState<string | null>(null);
  const inspectRelease =
    releases.find((release) => release.id === inspectReleaseId) ?? null;

  const inspectEpics: ReleaseTicketEpic[] = useMemo(() => {
    if (!inspectRelease) return [];
    return parseEpicIds(inspectRelease).map((id) => {
      const epic = epicById.get(id);
      // The epic was deleted; the release still recorded it.
      return epic
        ? { id: epic.id, title: epic.title, readableId: epic.readableId }
        : { id, title: "—", readableId: null };
    });
  }, [inspectRelease, epicById]);

  async function handleCreateRelease() {
    if (!version.trim() || selectedEpicIds.size === 0 || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);

    const res = await fetch(`/api/projects/${projectId}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: version.trim(),
        title: title.trim() || undefined,
        epicIds: Array.from(selectedEpicIds),
        generateChangelog: true,
        // The conjunction matters: without it a stale toggle would ask the
        // server to push to a repo that has no GitHub config.
        pushToGitHub: hasGitHub && pushToGitHub,
        resumeSessionId,
        namedAgentId: namedAgentId || undefined,
      }),
    }).catch(() => null);

    const json = res ? await res.json().catch(() => ({})) : {};

    if (res?.ok) {
      setVersionOverride(null);
      setCheckOverrides(new Map());
      setPushToGitHub(false);
      setTitle("");
      // A stale resume id otherwise survives into the next release.
      setResumeSessionId(undefined);
      setNamedAgentId(null);
      // PARTIAL SUCCESS. The route answers 201 with `githubErrors` when the
      // release row WAS written but the tag push or the GitHub draft failed.
      // res.ok is true and the release exists, so this must still be an
      // ERROR-toned toast and must still reload — treating 201 as
      // unconditional success tells the user a GitHub release exists when it
      // does not.
      const githubErrors: string[] = json.data?.githubErrors || [];
      if (githubErrors.length > 0) {
        showToast(
          "error",
          t("feedback.githubFailed", { version: version.trim(), error: githubErrors[0] }),
        );
      } else {
        showToast("success", t("feedback.created", { version: version.trim() }));
      }
      loadData();
    } else {
      showToast("error", json.error || t("feedback.createFailed"));
    }

    setCreating(false);
    creatingRef.current = false;
  }

  async function handlePublish(release: ReleaseRow) {
    const success = await publish(release.id);
    if (success) loadData();
  }

  /** PATCH of an unpublished release's title and changelog (#117). */
  async function handleSaveRelease(
    releaseId: string,
    edit: ReleaseEdit
  ): Promise<string | null> {
    const res = await fetchJson<{ error?: string; code?: string }>(
      `/api/projects/${projectId}/releases/${releaseId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      },
    );
    if (!res) return t("edit.failed");
    const json = res.body ?? {};
    if (!res.ok) {
      // The two refusals the user can act on get words of their own; the
      // row they refer to arrives with the next reload.
      if (json.code === "release_changed") {
        void loadData();
        return t("edit.stale");
      }
      if (json.code === "release_finalizing") return t("edit.finalizing");
      return json.error || t("edit.failed");
    }
    void loadData();
    return null;
  }

  function toggleEpic(epicId: string) {
    const epic = doneEpics.find((e) => e.id === epicId);
    if (!epic) return;
    const next = !isChecked(epic);
    setCheckOverrides((prev) => {
      const copy = new Map(prev);
      copy.set(epicId, next);
      return copy;
    });
  }

  // The stored default branch is authoritative; "main" is only the legacy
  // fallback for rows that predate the column.
  const branch = project?.defaultBranch || "main";
  const hasRepo = Boolean(project?.gitRepoPath);
  const tone = projectTone(
    typeof project?.colorIndex === "number"
      ? project.colorIndex
      : projectToneIndex(projectId)
  );

  return (
    <div
      data-testid="releases-screen"
      className="flex h-full min-h-0 flex-col font-sans text-foreground"
    >
      {/* The screen's second row. The project layout draws no header at all
          any more (frame 13a), so this is the page's own pinned row above the
          body — on the same 14px gutter as the columns under it. */}
      <ReleaseHeaderCluster
        projectId={projectId}
        branch={branch}
        enabled={hasRepo}
      />

      {loadError && (
        <div role="alert" className="flex items-center gap-3 px-[14px] py-2">
          <span>{loadError}</span>
          <PillButton variant="outline" onClick={() => void loadData()}>
            {t("feedback.retry")}
          </PillButton>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-[12px] px-[14px] pb-[14px]">
        <NextReleaseBand
          projectId={projectId}
          tone={tone}
          loading={loading}
          inspectRelease={inspectRelease}
          inspectEpics={inspectEpics}
          onLeaveInspect={() => setInspectReleaseId(null)}
          version={version}
          title={title}
          onTitleChange={setTitle}
          bumps={bumps}
          onVersionSelect={setVersionOverride}
          candidates={doneEpics}
          isChecked={isChecked}
          onToggleEpic={toggleEpic}
          selectedCount={selectedEpicIds.size}
          changelogPreview={changelogPreview}
          namedAgentId={namedAgentId}
          onNamedAgentChange={setNamedAgentId}
          selectedAgentProvider={selectedAgentProvider}
          resumeSessionId={resumeSessionId}
          onResumeSessionChange={setResumeSessionId}
          showGitHubToggle={!ghLoading && hasGitHub}
          pushToGitHub={pushToGitHub}
          onTogglePushToGitHub={() => setPushToGitHub((prev) => !prev)}
          creating={creating}
          onCreate={handleCreateRelease}
          canEdit={
            inspectRelease !== null && releaseState(inspectRelease) !== "published"
          }
          onSaveEdit={handleSaveRelease}
          canPublish={
            inspectRelease !== null &&
            releaseState(inspectRelease) === "draft" &&
            hasGitHub
          }
          isPublishing={isPublishing}
          publishError={publishError}
          onPublish={() => {
            if (inspectRelease) void handlePublish(inspectRelease);
          }}
        />

        <div className="flex min-w-0 flex-[4] flex-col gap-[12px]">
          <ReleaseStatTiles
            loading={loading}
            latest={latest}
            readyCount={selectedEpicIds.size}
            releaseCount={releases.length}
            version={version}
          />
          <ReleaseHistory
            releases={releases}
            epicById={epicById}
            loading={loading}
            onInspect={setInspectReleaseId}
          />
        </div>
      </div>

      <ToastStack items={toasts} onDismiss={dismissToast} testId="release-toast" />
    </div>
  );
}
