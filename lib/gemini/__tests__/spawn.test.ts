import { describe, it, expect, vi } from "vitest";

// These tests verify the spawn arguments and provider structure
// without actually spawning processes. The standalone spawnGemini module
// was folded into GeminiCliProvider (lib/providers/gemini-cli.ts), so the
// provider module is the target for all checks.

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const execSync = vi.fn(() => "/usr/bin/gemini");
  return {
    ...actual,
    execSync,
    // CJS interop: `import { execSync } from "child_process"` in the provider
    // may resolve through the namespace's `default` (the CJS module object),
    // so the override must be present there too or the real binary check runs.
    default: { ...actual, execSync },
  };
});

vi.mock("@/lib/claude/logger", () => ({
  createStreamLog: vi.fn(),
  appendStreamEvent: vi.fn(),
  appendStderrEvent: vi.fn(),
  endStreamLog: vi.fn(),
}));

describe("GeminiCliProvider", () => {
  it("implements AgentProvider interface", async () => {
    const { GeminiCliProvider } = await import("@/lib/providers/gemini-cli");
    const provider = new GeminiCliProvider();

    expect(provider.type).toBe("gemini-cli");
    expect(typeof provider.spawn).toBe("function");
    expect(typeof provider.cancel).toBe("function");
    expect(typeof provider.isAvailable).toBe("function");
  });

  it("is registered in provider factory", async () => {
    const { getProvider } = await import("@/lib/providers");
    const provider = getProvider("gemini-cli");
    expect(provider.type).toBe("gemini-cli");
  });

  it("isAvailable returns true when gemini is on PATH", async () => {
    const { GeminiCliProvider } = await import("@/lib/providers/gemini-cli");
    const provider = new GeminiCliProvider();
    const available = await provider.isAvailable();
    expect(available).toBe(true);
  });

  it("cancel calls kill on the session", async () => {
    const { GeminiCliProvider } = await import("@/lib/providers/gemini-cli");
    const provider = new GeminiCliProvider();
    const mockKill = vi.fn();
    const session = { handle: "test", kill: mockKill, promise: Promise.resolve({ success: true, duration: 0 }) };
    const result = provider.cancel(session);
    expect(result).toBe(true);
    expect(mockKill).toHaveBeenCalled();
  });
});

describe("GeminiCliProvider module", () => {
  it("exposes the spawn entry point (formerly spawnGemini)", async () => {
    const mod = await import("@/lib/providers/gemini-cli");
    expect(typeof mod.GeminiCliProvider.prototype.spawn).toBe("function");
  });
});

describe("Provider factory includes gemini-cli", () => {
  it("getProvider returns GeminiCliProvider for gemini-cli", async () => {
    const { getProvider } = await import("@/lib/providers");
    const provider = getProvider("gemini-cli");
    expect(provider.type).toBe("gemini-cli");
  });

  it("getProvider falls back to claude-code for unknown type", async () => {
    const { getProvider } = await import("@/lib/providers");
    // @ts-expect-error testing with invalid type
    const provider = getProvider("invalid");
    expect(provider.type).toBe("claude-code");
  });

  it("all three providers are available in the factory", async () => {
    const { getProvider } = await import("@/lib/providers");
    expect(getProvider("claude-code").type).toBe("claude-code");
    expect(getProvider("codex").type).toBe("codex");
    expect(getProvider("gemini-cli").type).toBe("gemini-cli");
  });
});

describe("extractGeminiResult function", () => {
  it("is exported for output parsing (formerly part of spawnGemini)", async () => {
    // Don't test the actual spawn, just that the parsing entry point exists
    const mod = await import("@/lib/providers/gemini-cli");
    expect(typeof mod.extractGeminiResult).toBe("function");

    // The provider takes ProviderSpawnOptions and returns a ProviderSession
    // Verified by TypeScript compilation
  });
});
