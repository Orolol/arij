import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock fetch globally
let mockSettings: Record<string, string> = {};
let patchCalls: { body: Record<string, string> }[] = [];

beforeEach(() => {
  mockSettings = {};
  patchCalls = [];
  global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (opts?.method === "PATCH") {
      const body = JSON.parse(opts.body as string);
      patchCalls.push({ body });
      return Promise.resolve({
        json: () => Promise.resolve({ data: { updated: true } }),
      });
    }
    // GET
    return Promise.resolve({
      json: () => Promise.resolve({ data: mockSettings }),
    });
  });
});

import SettingsPage from "@/app/settings/page";

describe("Settings Page — Codex API Key", () => {
  it("renders the Codex API Key field", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Codex API Key")).toBeInTheDocument();
    });
  });

  it("shows password input by default (hidden)", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText("sk-...");
      expect(input).toHaveAttribute("type", "password");
    });
  });

  it("toggles visibility when show/hide button clicked", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
    });

    const toggleBtn = screen.getByLabelText("Show API key");
    fireEvent.click(toggleBtn);

    const input = screen.getByPlaceholderText("sk-...");
    expect(input).toHaveAttribute("type", "text");

    const hideBtn = screen.getByLabelText("Hide API key");
    fireEvent.click(hideBtn);
    expect(input).toHaveAttribute("type", "password");
  });

  it("loads existing codex_api_key from settings", async () => {
    mockSettings = { codex_api_key: "sk-test-key-123" };
    render(<SettingsPage />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText("sk-...") as HTMLInputElement;
      expect(input.value).toBe("sk-test-key-123");
    });
  });

  it("saves codex_api_key when Save is clicked", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("sk-...");
    fireEvent.change(input, { target: { value: "sk-new-key" } });

    const saveBtn = screen.getByText("Save Settings");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(patchCalls[0].body.codex_api_key).toBe("sk-new-key");
    });
  });

  it("saves both global_prompt and codex_api_key together", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
    });

    const keyInput = screen.getByPlaceholderText("sk-...");
    fireEvent.change(keyInput, { target: { value: "sk-my-key" } });

    const promptInput = screen.getByPlaceholderText("Enter global instructions for Claude Code...");
    fireEvent.change(promptInput, { target: { value: "Be concise" } });

    const saveBtn = screen.getByText("Save Settings");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(patchCalls[0].body.global_prompt).toBe("Be concise");
      expect(patchCalls[0].body.codex_api_key).toBe("sk-my-key");
    });
  });

  it("renders description text for the Codex API Key", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/Your OpenAI API key for the Codex provider/)
      ).toBeInTheDocument();
    });
  });
});
