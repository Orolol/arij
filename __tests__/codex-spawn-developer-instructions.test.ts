import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted so the mock fn is available when vi.mock factories run
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
  execSync: vi.fn(),
  // Re-export default to satisfy `import { spawn } from "child_process"`
  default: { spawn: mockSpawn, execSync: vi.fn() },
}));

// Mock fs to avoid file system side effects
vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => ""),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

// Mock the logger to avoid side effects
vi.mock("@/lib/claude/logger", () => ({
  createStreamLog: vi.fn(),
  appendStreamEvent: vi.fn(),
  appendStderrEvent: vi.fn(),
  endStreamLog: vi.fn(),
}));

// Mock the json-parser to avoid side effects
vi.mock("@/lib/claude/json-parser", () => ({
  hasAskUserQuestion: vi.fn(() => false),
  extractCliSessionIdFromOutput: vi.fn(() => null),
}));

import { CodexProvider } from "@/lib/providers/codex";
import type { ProviderSpawnOptions } from "@/lib/providers/types";

/**
 * Test subclass that overrides the developer-instructions extension point,
 * mirroring the old spawnCodex({ developerInstructions }) option.
 */
class TestCodexProvider extends CodexProvider {
  constructor(private readonly instructions?: string) {
    super();
  }

  protected get developerInstructions(): string | undefined {
    return this.instructions;
  }
}

function spawnWith(
  provider: CodexProvider,
  overrides: Partial<ProviderSpawnOptions> = {},
) {
  return provider.spawn({
    sessionId: "test-session",
    cwd: "/tmp/test",
    mode: "code",
    prompt: "implement feature X",
    ...overrides,
  });
}

describe("CodexProvider developer instructions args", () => {
  let mockProcess: {
    stdout: { on: ReturnType<typeof vi.fn> };
    stderr: { on: ReturnType<typeof vi.fn> };
    on: ReturnType<typeof vi.fn>;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSpawn.mockClear();
    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      killed: false,
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockProcess);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes -c developer_instructions when provided", () => {
    spawnWith(new TestCodexProvider("Always prefer sub-agents for complex tasks."));

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    const flagIndex = args.indexOf("-c");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toContain("developer_instructions=");
    expect(args[flagIndex + 1]).toContain("Always prefer sub-agents");
  });

  it("does not include -c developer_instructions when not provided", () => {
    spawnWith(new TestCodexProvider(undefined));

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    const hasDevInstructions = args.some(
      (a) => typeof a === "string" && a.includes("developer_instructions=")
    );
    expect(hasDevInstructions).toBe(false);
  });

  it("does not include -c developer_instructions when empty string", () => {
    spawnWith(new TestCodexProvider(""));

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    const hasDevInstructions = args.some(
      (a) => typeof a === "string" && a.includes("developer_instructions=")
    );
    expect(hasDevInstructions).toBe(false);
  });

  it("properly formats developer instructions as TOML string via JSON.stringify", () => {
    spawnWith(new TestCodexProvider('Use "Task" tool for delegation.'));

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    const flagIndex = args.indexOf("-c");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    // JSON.stringify produces a valid TOML string with escaped quotes
    expect(args[flagIndex + 1]).toBe(
      `developer_instructions=${JSON.stringify('Use "Task" tool for delegation.')}`
    );
  });

  it("includes developer instructions in resume mode too", () => {
    spawnWith(new TestCodexProvider("Prefer sub-agents."), {
      prompt: "continue",
      cliSessionId: "abc-123",
      resumeSession: true,
    });

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    const flagIndex = args.indexOf("-c");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toContain("developer_instructions=");
  });
});
