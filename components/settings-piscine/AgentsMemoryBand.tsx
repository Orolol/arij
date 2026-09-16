"use client";

import { useTranslations } from "next-intl";

import { BandHeader, Mono, StrataBand } from "@/components/piscine";
import { VISUAL_PROOF_ENABLED_SETTING_KEY } from "@/lib/claude/visual-proof-constants";

import { SettingRow } from "./SettingRow";
import { SettingToggle } from "./SettingToggle";
import { SettingsSection } from "./SettingsSection";
import {
  MCP_TOOLS_ENABLED_SETTING_KEY,
  MEMORY_AUTO_DISTILL_SETTING_KEY,
  SPEC_AUTO_REWRITE_SETTING_KEY,
} from "./settings-fields";
import type { SettingsDraft } from "./useSettingsDraft";

/**
 * AGENTS & MÉMOIRE — the turquoise stratum of the Pipeline tab.
 *
 * Four switches that change what an agent session IS: whether it gets the
 * structured tool channel, whether a build is asked to leave visual proof
 * through that channel, whether a green build refreshes the project memory,
 * whether a release rewrites the spec. Each keeps the sentence that explains
 * it — those sentences are the only documentation of what the switches do.
 *
 * `mcp_tools_enabled` is the one DEFAULT-ON flag in the whole table: only an
 * explicitly-false value disables it. The asymmetry is reproduced in
 * `settings-fields.ts`, not here.
 */
export interface AgentsMemoryBandProps {
  draft: SettingsDraft;
}

export function AgentsMemoryBand({ draft }: AgentsMemoryBandProps) {
  const t = useTranslations("Settings");

  return (
    <SettingsSection
      testId="agents-memory-settings"
      heading={t("agentsMemory.heading")}
    >
      <StrataBand stratum="live">
        <BandHeader
          stratum="live"
          label={t("agentsMemory.label")}
          meta={
            <span className="font-sans text-[11.5px] leading-normal">
              {t("agentsMemory.meta")}
            </span>
          }
        />

        <SettingRow
          toggle={
            <SettingToggle
              on={draft.flag(MCP_TOOLS_ENABLED_SETTING_KEY)}
              onChange={(next) => draft.set(MCP_TOOLS_ENABLED_SETTING_KEY, next)}
              label={t("agentsMemory.mcpTools")}
              testId="mcp-tools-toggle"
            />
          }
          off={!draft.flag(MCP_TOOLS_ENABLED_SETTING_KEY)}
          label={t("agentsMemory.mcpTools")}
          suffix={t("agentsMemory.mcpToolsSuffix")}
          suffixTone="live-mid"
        />
        <Mono size={10.5} tone="live-mid" as="div">
          {t("agentsMemory.mcpToolsNote")}
        </Mono>

        {/* Right under the MCP tools: `attach_artifact` is one of them, so the
            proof needs that channel. Not a PIPELINE option — every build
            prompt reads it, pipeline or not. */}
        <SettingRow
          toggle={
            <SettingToggle
              on={draft.flag(VISUAL_PROOF_ENABLED_SETTING_KEY)}
              onChange={(next) => draft.set(VISUAL_PROOF_ENABLED_SETTING_KEY, next)}
              label={t("agentsMemory.visualProof")}
              testId="visual-proof-toggle"
            />
          }
          off={!draft.flag(VISUAL_PROOF_ENABLED_SETTING_KEY)}
          label={t("agentsMemory.visualProof")}
        />
        <Mono size={10.5} tone="live-mid" as="div">
          {t("agentsMemory.visualProofNote")}
        </Mono>

        <SettingRow
          toggle={
            <SettingToggle
              on={draft.flag(MEMORY_AUTO_DISTILL_SETTING_KEY)}
              onChange={(next) => draft.set(MEMORY_AUTO_DISTILL_SETTING_KEY, next)}
              label={t("agentsMemory.memoryDistill")}
              testId="memory-auto-distill-toggle"
            />
          }
          off={!draft.flag(MEMORY_AUTO_DISTILL_SETTING_KEY)}
          label={t("agentsMemory.memoryDistill")}
        />
        <Mono size={10.5} tone="live-mid" as="div">
          {t("agentsMemory.memoryDistillNote")}
        </Mono>

        <SettingRow
          toggle={
            <SettingToggle
              on={draft.flag(SPEC_AUTO_REWRITE_SETTING_KEY)}
              onChange={(next) => draft.set(SPEC_AUTO_REWRITE_SETTING_KEY, next)}
              label={t("agentsMemory.specRewrite")}
              testId="spec-auto-rewrite-toggle"
            />
          }
          off={!draft.flag(SPEC_AUTO_REWRITE_SETTING_KEY)}
          label={t("agentsMemory.specRewrite")}
        />
        <Mono size={10.5} tone="live-mid" as="div">
          {t("agentsMemory.specRewriteNote")}
        </Mono>
      </StrataBand>
    </SettingsSection>
  );
}
