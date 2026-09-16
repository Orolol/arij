/**
 * `visual_proof_enabled` — accepted by PATCH /api/settings and read by every
 * build prompt, yet reachable only by a hand-written API call. The Pipeline
 * tab now carries it in the AGENTS & MEMORY band, next to the MCP tools it
 * depends on, default OFF. Not in the PIPELINE band: that band reads as
 * "chains a review onto every build", while visual proof applies to every
 * build, pipeline or not.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AgentsMemoryBand } from "@/components/settings-piscine/AgentsMemoryBand";
import { PipelineBand } from "@/components/settings-piscine/PipelineBand";
import type { SettingsDraft } from "@/components/settings-piscine/useSettingsDraft";
import {
  SETTING_FIELDS,
  readEditors,
} from "@/components/settings-piscine/settings-fields";
import { isWritableSettingKey } from "@/lib/settings/writable-keys";
import { VISUAL_PROOF_ENABLED_SETTING_KEY } from "@/lib/claude/visual-proof-constants";
import { VISUAL_PROOF_ENABLED_SETTING_KEY as SERVER_KEY } from "@/lib/claude/visual-proof";

function fakeDraft(flags: Record<string, boolean>, set = vi.fn()): SettingsDraft {
  return {
    loaded: true,
    loadFailed: false,
    data: {},
    defaults: {},
    value: (key) => flags[key] ?? "",
    text: () => "",
    flag: (key) => flags[key] === true,
    set,
    dirty: false,
    saving: false,
    save: vi.fn(),
    discard: vi.fn(),
    message: null,
    messageTone: "muted",
    setMessage: vi.fn(),
  } as SettingsDraft;
}

describe("visual proof setting", () => {
  it("is one key, shared by the prompt reader and the client-safe module", () => {
    expect(VISUAL_PROOF_ENABLED_SETTING_KEY).toBe("visual_proof_enabled");
    expect(SERVER_KEY).toBe(VISUAL_PROOF_ENABLED_SETTING_KEY);
    expect(isWritableSettingKey(VISUAL_PROOF_ENABLED_SETTING_KEY)).toBe(true);
  });

  it("is in the settings registry, OFF when absent or malformed", () => {
    const spec = SETTING_FIELDS[VISUAL_PROOF_ENABLED_SETTING_KEY];
    expect(spec).toBeDefined();
    expect(readEditors({})[VISUAL_PROOF_ENABLED_SETTING_KEY]).toBe(false);
    expect(spec.read({ visual_proof_enabled: "nonsense" })).toBe(false);
    expect(spec.read({ visual_proof_enabled: true })).toBe(true);
    expect(spec.read({ visual_proof_enabled: "true" })).toBe(true);
    expect(spec.parse(true)).toEqual({ value: true });
    expect(spec.parse(false)).toEqual({ value: false });
  });

  it("draws a switch next to the MCP tools that says what it needs", () => {
    const set = vi.fn();
    render(<AgentsMemoryBand draft={fakeDraft({}, set)} />);

    const toggle = screen.getByRole("switch", {
      name: "Capture visual proof in builds",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    const band = screen.getByTestId("agents-memory-settings");
    // Best-effort and conditional, as VISUAL_PROOF_SECTION tells the agent:
    // the copy must not promise a screenshot on every build.
    expect(band).toHaveTextContent(/best-effort/i);
    expect(band).toHaveTextContent("Arij MCP tools");
    expect(band).toHaveTextContent("pipeline or not");

    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith(VISUAL_PROOF_ENABLED_SETTING_KEY, true);
  });

  it("is not drawn as a pipeline option", () => {
    render(<PipelineBand draft={fakeDraft({})} />);
    expect(screen.queryByTestId("visual-proof-toggle")).toBeNull();
  });

  it("reflects a stored ON", () => {
    render(
      <AgentsMemoryBand draft={fakeDraft({ [VISUAL_PROOF_ENABLED_SETTING_KEY]: true })} />,
    );
    expect(
      screen.getByRole("switch", { name: "Capture visual proof in builds" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
