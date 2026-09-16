/**
 * Central client-safe definitions of settings keys that are shared across
 * server routes, background services, and settings UI components.
 *
 * Kept strictly free of database imports so client components can import them
 * without dragging sqlite / server modules into the client bundle.
 */

export const GITHUB_PAT_SETTING_KEY = "github_pat";
export const GLOBAL_PROMPT_SETTING_KEY = "global_prompt";
export const MEMORY_AUTO_DISTILL_SETTING_KEY = "memory_auto_distill";
export const SPEC_AUTO_REWRITE_SETTING_KEY = "spec_auto_rewrite";
export const MCP_TOOLS_ENABLED_SETTING_KEY = "mcp_tools_enabled";
