import { NextResponse } from "next/server";
import { getProvider, type ProviderType } from "@/lib/providers";

const ALL_PROVIDERS: ProviderType[] = [
  "claude-code",
  "codex",
  "gemini-cli",
  "mistral-vibe",
  "qwen-code",
  "opencode",
  "deepseek",
  "kimi",
  "zai",
];

export async function GET() {
  const results: Record<string, boolean> = {};

  // Check all providers in parallel
  const checks = await Promise.all(
    ALL_PROVIDERS.map(async (type) => {
      const provider = getProvider(type);
      try {
        const available = await provider.isAvailable();
        return { type, available };
      } catch {
        return { type, available: false };
      }
    }),
  );

  for (const { type, available } of checks) {
    results[type] = available;
  }

  // Backwards compat: codexInstalled and geminiInstalled
  // codexInstalled = binary is on PATH even if not logged in
  let codexInstalled = false;
  try {
    const { execSync } = await import("child_process");
    execSync("which codex", { stdio: "ignore" });
    codexInstalled = true;
  } catch {
    // not installed
  }

  let geminiInstalled = false;
  try {
    const { execSync } = await import("child_process");
    execSync("which gemini", { stdio: "ignore" });
    geminiInstalled = true;
  } catch {
    // not installed
  }

  return NextResponse.json({
    data: {
      ...results,
      codexInstalled,
      geminiInstalled,
    },
  });
}
