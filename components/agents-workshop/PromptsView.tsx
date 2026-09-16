"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { AgentConfigError } from "./AgentConfigError";
import { ScopeSwitcher } from "@/components/agents-workshop/ScopeSwitcher";
import { sourceLabelKey } from "@/components/agents-workshop/agent-initials";
import {
  BandHeader,
  Mono,
  PillButton,
  StrataBand,
  SurfaceCard,
} from "@/components/piscine";
import {
  useAgentPrompts,
  type ResolvedAgentPrompt,
} from "@/hooks/useAgentConfig";
import {
  AGENT_TYPES,
  AGENT_TYPE_LABELS,
  type AgentType,
} from "@/lib/agent-config/constants";

/**
 * Role prompts and review agents.
 *
 * Frame 7a has no picture of this page — the workshop's tab bar names it and
 * the deleted sheet owned the behaviour, so this is a functional port in the
 * band grammar rather than pixel work. The textareas keep `font-mono`: they
 * hold prompt text, where alignment carries meaning.
 */
// `outline-none` on its own would leave a keyboard user with NO focus
// indicator at all; the ring is the replacement, matching the buttons below
// and FieldBoxInput's own focus treatment.
const PROMPT_TEXTAREA =
  "min-h-32 w-full resize-y rounded-[10px] border-0 bg-card px-3 py-2 font-mono text-[12.5px] leading-[1.5] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring placeholder:text-muted-foreground disabled:opacity-60";

export function PromptsView({ projectId }: { projectId?: string }) {
  return <PromptsContent key={projectId ?? "global"} projectId={projectId} />;
}

function PromptsContent({ projectId }: { projectId?: string }) {
  const t = useTranslations("AgentsWorkshop");
  const [scope, setScope] = useState<"global" | "project">(
    projectId ? "project" : "global",
  );
  const scopedProjectId = scope === "project" ? projectId : undefined;

  const { data, loading, error, refresh, updatePrompt, resetPrompt } = useAgentPrompts(
    scope,
    scopedProjectId,
  );

  const promptMap = new Map(data.map((prompt) => [prompt.agentType, prompt]));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[14px] pb-[14px]">
      <ScopeSwitcher
        projectId={projectId}
        scope={scope}
        onScopeChange={setScope}
      />

      <StrataBand stratum="feed" density="full" gap={8}>
        <BandHeader
          stratum="feed"
          labelSize={12}
          label={t("prompts.rolePromptsLabel")}
          meta={t("prompts.rolePromptsMeta")}
        />
        {error && <AgentConfigError onRetry={refresh} />}
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-strata-feed-deep motion-reduce:animate-none" />
        ) : error && data.length === 0 ? null : (
          <div className="flex flex-col gap-1.5">
            {AGENT_TYPES.map((agentType) => {
              // Every one of the 21 roles renders, even with no stored row:
              // a missing prompt is a builtin, not an absence.
              const prompt: ResolvedAgentPrompt = promptMap.get(agentType) ?? {
                agentType,
                systemPrompt: "",
                source: "builtin",
                scope: "global",
              };
              return (
                <PromptRow
                  key={`${scope}:${agentType}`}
                  prompt={prompt}
                  scope={scope}
                  onSave={updatePrompt}
                  onReset={resetPrompt}
                />
              );
            })}
          </div>
        )}
      </StrataBand>

    </div>
  );
}

function PromptRow({
  prompt,
  scope,
  onSave,
  onReset,
}: {
  prompt: ResolvedAgentPrompt;
  scope: "global" | "project";
  onSave: (agentType: AgentType, text: string) => Promise<boolean>;
  onReset: (agentType: AgentType) => Promise<boolean>;
}) {
  const t = useTranslations("AgentsWorkshop");
  // Namespace-less, for the KEY REFERENCES `agent-initials.ts` holds.
  const tKey = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? prompt.systemPrompt;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const dirty = value !== prompt.systemPrompt;
  const panelId = `agent-prompt-${prompt.agentType}-panel`;

  async function submit(reset: boolean) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    const submitted = value;
    const failure = reset ? t("prompts.resetFailed") : t("prompts.saveFailed");
    const action = reset ? () => onReset(prompt.agentType) : () => onSave(prompt.agentType, submitted);
    let ok = false;
    try {
      ok = await action();
    } catch {
      // Keep the editable draft; the same feedback handles HTTP and network failures.
    }
    if (ok) {
      // A reload supplies the inherited prompt after reset. Preserve typing
      // performed while the request was in flight instead of erasing it.
      setDraft((current) => current === submitted || current === null ? null : current);
    } else {
      setError(failure);
    }
    pending.current = false;
    setSaving(false);
  }

  return (
    <SurfaceCard radius={10} className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex items-center gap-3 rounded-[9px] px-4 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-sans text-[13px] font-semibold text-foreground">
          {AGENT_TYPE_LABELS[prompt.agentType]}
        </span>
        <Mono size={10} tone="muted">
          {tKey(sourceLabelKey(prompt.source))}
        </Mono>
      </button>
      {expanded ? (
        <div id={panelId} className="flex flex-col gap-2 px-4 pb-3">
          <textarea
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("prompts.promptPlaceholder")}
            aria-label={t("prompts.instructionsAria", {
              role: AGENT_TYPE_LABELS[prompt.agentType],
            })}
            className={PROMPT_TEXTAREA}
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            {(scope === "project" && prompt.source === "project") ||
            (scope === "global" && prompt.source === "global") ? (
              <PillButton
                variant="outline"
                outlineTone="neutral"
                size="sm"
                disabled={saving}
                onClick={() => void submit(true)}
              >
                {t("prompts.resetToGlobal")}
              </PillButton>
            ) : null}
            <PillButton
              variant="filled"
              size="sm"
              disabled={saving || !dirty}
              pending={saving}
              pendingLabel={t("common.saving")}
              onClick={() => void submit(false)}
            >
              {t("common.save")}
            </PillButton>
          </div>
        </div>
      ) : null}
    </SurfaceCard>
  );
}
