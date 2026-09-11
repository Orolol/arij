/**
 * Test double for `getProvider()` in suites that mock `@/lib/providers`.
 *
 * Every one-shot spawn — the process manager and the routes that spawn
 * directly — goes through `getProvider(provider).spawn(...)` for EVERY
 * provider, claude-code included (the real ClaudeCodeProvider delegates to
 * spawnClaude). A suite that mocks `@/lib/providers` wholesale would
 * otherwise route claude-code sessions to its generic fake and lose the
 * spawnClaude spy it asserts on. `mockProviderRegistry` keeps both spies
 * meaningful: claude-code reaches the (mocked) spawnClaude through the same
 * mapping the real provider applies; every other provider gets the generic
 * fake the suite supplies.
 *
 * Usage inside a hoisted factory:
 *
 *   vi.mock("@/lib/providers", async () => {
 *     const { spawnClaude } = await import("@/lib/claude/spawn");
 *     const { mockProviderRegistry } = await import("@/__tests__/helpers/provider-mock");
 *     return mockProviderRegistry(spawnClaude, (provider) => ({ ...generic fake... }));
 *   });
 */
import { vi } from "vitest";

/**
 * Accepts the real `spawnClaude` signature as well as a `vi.fn` typed on a
 * plain record: a parameter of type `never` is what both are assignable to.
 */
type SpawnClaudeLike = (options: never) => {
  promise: Promise<unknown>;
  kill: () => void;
  command?: string;
  mcpConfigPath?: string;
};

export interface FakeProvider {
  type: string;
  spawn: (options: Record<string, unknown>) => unknown;
  cancel: (session: unknown) => boolean;
  isAvailable: () => Promise<boolean>;
}

/** The claude-code provider as the real one behaves: a thin spawnClaude wrapper. */
export function claudeCodeProviderMock(spawnClaude: SpawnClaudeLike): FakeProvider {
  return {
    type: "claude-code",
    spawn: vi.fn((options: Record<string, unknown>) => {
      const { sessionId, ...claudeOptions } = options;
      const spawned = (spawnClaude as (o: Record<string, unknown>) => ReturnType<SpawnClaudeLike>)(
        claudeOptions,
      );
      return {
        handle: `cc-${String(sessionId)}`,
        kill: spawned.kill,
        promise: spawned.promise,
        command: spawned.command,
        mcpConfigPath: spawned.mcpConfigPath,
      };
    }),
    cancel: vi.fn(() => true),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

/**
 * A `@/lib/providers` module double: claude-code goes through spawnClaude,
 * everything else through `generic(provider)`.
 */
export function mockProviderRegistry(
  spawnClaude: SpawnClaudeLike,
  generic: (provider: string) => FakeProvider,
) {
  const claudeCode = claudeCodeProviderMock(spawnClaude);
  return {
    getProvider: vi.fn((provider: string = "claude-code") =>
      provider === "claude-code" ? claudeCode : generic(provider),
    ),
  };
}
