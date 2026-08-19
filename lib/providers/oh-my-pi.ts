/**
 * Oh My Pi provider — the `pi` CLI running the `oh-my-pi` orchestrator
 * extension (npm: oh-my-pi).
 *
 * oh-my-pi is not an agent CLI of its own: its `oh-my-pi` binary only does
 * doctor/init diagnostics. The agent is `pi` with the extension loaded, which
 * swaps pi's default system prompt for a multi-agent orchestrator prompt with
 * specialist sub-agents and skills.
 *
 * CLI: pi --mode json [… pi options] -e oh-my-pi -p <PROMPT>
 *
 * `-e` loads the extension explicitly, so the provider works whether or not
 * the user ran `pi install oh-my-pi` — pi resolves npm extension sources on
 * demand (network needed the first time). Availability therefore reduces to
 * "is `pi` on PATH", the same check as the Pi provider.
 *
 * Everything else — argument shape, JSON event parsing, resume, failure
 * detection — is inherited from PiProvider.
 */

import { PiProvider } from "./pi";
import type { ProviderType } from "./types";

/** npm source pi resolves the orchestrator extension from. */
export const OH_MY_PI_EXTENSION_SOURCE = "oh-my-pi";

export class OhMyPiProvider extends PiProvider {
  readonly type: ProviderType = "oh-my-pi";

  protected extraArgs(): string[] {
    return ["-e", OH_MY_PI_EXTENSION_SOURCE];
  }

  protected buildSpawnErrorMessage(err: Error): string {
    return err.message.includes("ENOENT")
      ? "Pi CLI not found — Oh My Pi runs on top of pi. Install it with: npm i -g @earendil-works/pi-coding-agent"
      : `Failed to spawn Pi CLI: ${err.message}`;
  }
}
