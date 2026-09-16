const BLOCKED_ENV_KEYS: Record<string, true> = {
  editor: true,
  git_editor: true,
  git_sequence_editor: true,
  git_pager: true,
  git_ssh: true,
  git_ssh_command: true,
  git_config: true,
  git_config_global: true,
  git_config_system: true,
  git_config_count: true,
  git_exec_path: true,
  git_external_diff: true,
  git_proxy_command: true,
  git_template_dir: true,
  pager: true,
  prefix: true,
};

/**
 * Git must never block on a credential prompt: without a terminal it would
 * hang until the timeout instead of failing with a usable message.
 */
export function nonInteractiveEnv(): Record<string, string> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GCM_INTERACTIVE: "never",
  };

  // Inherit environment variables from process.env, filtering out dangerous
  // editor/pager/ssh/config keys case-insensitively so lowercase ambient variables
  // (e.g. `editor`, `pager`, `prefix`) do not trigger simple-git's safety plugin.
  // GIT_ASKPASS and SSH_ASKPASS are retained as empty strings above (with
  // allowUnsafeAskPass enabled on simpleGit) so git prompts are short-circuited.
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const normalized = key.toLowerCase().trim();
    if (
      BLOCKED_ENV_KEYS[normalized] ||
      normalized.startsWith("git_config_key_") ||
      normalized.startsWith("git_config_value_")
    ) {
      continue;
    }
    if (
      normalized === "git_terminal_prompt" ||
      normalized === "git_askpass" ||
      normalized === "ssh_askpass" ||
      normalized === "gcm_interactive"
    ) {
      continue;
    }
    env[key] = value;
  }

  return env;
}
