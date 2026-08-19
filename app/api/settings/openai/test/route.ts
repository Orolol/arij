import { NextResponse } from "next/server";

import { getOpenAiConfigFromSettings, testOpenAiConnection } from "@/lib/openai/client";

/**
 * Test the saved OpenAI-compatible connection (Settings "Test connection"
 * button). The config is read server-side from the settings table, so the
 * API key never round-trips through the browser.
 *
 * - 200 `{ data: { valid: true, model } }` on success
 * - 400 `{ error }` with a readable message (invalid URL, 401, timeout,
 *   connection refused, not configured, …)
 */
export async function POST() {
  const config = getOpenAiConfigFromSettings();
  const result = await testOpenAiConnection(config);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 }
    );
  }
  return NextResponse.json({ data: { valid: true, model: result.model } });
}
