import type { ProviderSpawnOptions } from "./types";

const TOOL_NAMES: Record<string, string[]> = {
  Read: ["read"], Glob: ["find", "ls"], Grep: ["grep"],
  Write: ["write"], Edit: ["edit"], Bash: ["bash"], Task: ["Task"], AskUserQuestion: ["AskUserQuestion"],
};
const READ = ["read", "grep", "find", "ls"];
const ALL = [...READ, "write", "edit", "bash", "Task", "AskUserQuestion"];

/** Hard tool bounds; permission choices cannot loosen a plan/chat/analyze posture. */
export function piToolPolicy(options: ProviderSpawnOptions) {
  const explicit = options.allowedTools?.length ? options.allowedTools.flatMap((name) => {
    if (TOOL_NAMES[name]) return TOOL_NAMES[name];
    if (ALL.includes(name)) return [name];
    throw new Error(`Pi does not support the requested built-in tool: ${name}`);
  }) : undefined;
  let allowed = options.mode === "code" ? ALL : options.mode === "analyze" ? [...READ, "write", "AskUserQuestion"] : [...READ, "AskUserQuestion"];
  if (explicit) allowed = allowed.filter((tool) => explicit.includes(tool) || tool === "AskUserQuestion");
  const permission = options.mode === "code" ? String(options.cliOptions?.permission_mode || "bypassPermissions") : "bounded";
  if (["acceptEdits", "auto"].includes(permission)) {
    // Headless auto is deliberately conservative: file edits, no unapproved shell.
    allowed = allowed.filter((tool) => tool !== "bash" || explicit?.includes("bash"));
  } else if (["manual", "dontAsk"].includes(permission)) {
    allowed = allowed.filter((tool) => READ.includes(tool) || tool === "AskUserQuestion" || explicit?.includes(tool));
  } else if (!["bounded", "bypassPermissions"].includes(permission)) {
    throw new Error(`Unsupported Pi permission mode: ${permission}`);
  }
  return { builtinTools: allowed.filter((name) => !["Task", "AskUserQuestion"].includes(name)), delegation: allowed.includes("Task"), questions: allowed.includes("AskUserQuestion"), permission };
}
