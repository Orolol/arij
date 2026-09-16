import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionPath = fileURLToPath(import.meta.url);
const launcher = resolve(dirname(extensionPath), "arij-pi.mjs");

/** Shipped with Arij; explicitly loaded even when discovered extensions are disabled. */
export default function arijRuntime(pi) {
  pi.registerFlag("arij-config", { description: "Private Arij runtime configuration", type: "string" });
  const position = process.argv.indexOf("--arij-config");
  if (position < 0 || !process.argv[position + 1]) throw new Error("Missing Arij runtime configuration");
  const configPath = process.argv[position + 1];
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const policy = config.arij;
  if (!policy || !Array.isArray(policy.builtinTools)) throw new Error("Invalid Arij runtime policy");
  const depth = Number(process.env.ARIJ_PI_CHILD_DEPTH || 0);
  const canDelegate = policy.delegation && depth === 0;
  let activeChildren = 0;
  const children = new Set();
  const approved = new Set(policy.builtinTools);
  if (policy.questions) approved.add("AskUserQuestion");
  if (canDelegate) approved.add("Task");

  pi.on("session_start", () => {
    pi.setActiveTools([...approved, ...pi.getActiveTools().filter((name) => name.startsWith("mcp__"))]);
  });
  pi.on("tool_call", (event) => {
    if (!approved.has(event.toolName) && !event.toolName.startsWith("mcp__")) {
      return { block: true, reason: "Tool denied by this Arij session's permission policy" };
    }
  });
  pi.on("tool_result", (event) => {
    if (event.toolName === "Task" && event.details?.failed) return { isError: true };
  });
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nArij runtime: AskUserQuestion presents structured questions to the user. After calling it, end your turn and wait for the user's next message; never invent their answer. Task delegates work to a separate Pi process and returns its final result. Child agents cannot delegate further. Tool restrictions also apply to children.`,
  }));
  pi.on("session_shutdown", () => {
    for (const child of children) child.kill("SIGTERM");
  });

  if (policy.questions) pi.registerTool({
    name: "AskUserQuestion",
    label: "Ask the user",
    description: "Present one to four structured questions to the user. End your turn after this call and wait for their answer in the next message.",
    parameters: {
      type: "object", additionalProperties: false, required: ["questions"],
      properties: { questions: { type: "array", minItems: 1, maxItems: 4, items: {
        type: "object", additionalProperties: false, required: ["question", "header", "options", "multiSelect"],
        properties: {
          question: { type: "string" }, header: { type: "string" }, multiSelect: { type: "boolean" },
          options: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["label", "description"], properties: { label: { type: "string" }, description: { type: "string" } } } },
        },
      } } },
    },
    async execute() {
      return { content: [{ type: "text", text: "Questions presented. The user has not answered yet. End this turn and wait for their next message." }], details: { awaitingAnswer: true } };
    },
  });

  if (canDelegate) pi.registerTool({
    name: "Task",
    label: "Delegate to Pi",
    description: "Delegate a self-contained task to a Pi sub-agent. Supply cwd for a ticket worktree. Returns the final result; errors are tool failures. Maximum four simultaneous children, no recursive delegation.",
    executionMode: "parallel",
    parameters: { type: "object", additionalProperties: false, required: ["prompt", "description"], properties: {
      prompt: { type: "string", minLength: 1 }, description: { type: "string" },
      cwd: { type: "string" }, subagent_type: { type: "string" },
    } },
    async execute(_id, params, signal, onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Delegation cancelled");
      if (activeChildren >= 4) throw new Error("Four Pi sub-agents are already running; wait for one to finish");
      const cwd = realpathSync(resolve(ctx.cwd, params.cwd || "."));
      const args = [launcher, "--mode", "json", "--no-extensions", "--no-builtin-tools",
        "--extension", extensionPath, "--arij-config", configPath, "--mcp-config", configPath];
      if (ctx.model) args.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
      const thinking = pi.getThinkingLevel();
      if (thinking) args.push("--thinking", thinking);
      args.push("-p");
      activeChildren++;
      try {
        return await new Promise((resolveResult, reject) => {
          // Inherit the root's process group so Arij's cancellation also kills grandchildren.
          const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ARIJ_PI_CHILD_DEPTH: String(depth + 1) }, stdio: ["pipe", "pipe", "pipe"] });
          children.add(child);
          let pending = "";
          let stderr = "";
          let finalText = "";
          let errorMessage;
          let cancelled = false;
          const usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
          const number = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
          let forceTimer;
          const abort = () => {
            cancelled = true;
            child.kill("SIGTERM");
            forceTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
            forceTimer.unref?.();
          };
          const timeout = setTimeout(abort, 30 * 60 * 1000);
          timeout.unref?.();
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
          const cleanup = () => {
            clearTimeout(timeout);
            clearTimeout(forceTimer);
            signal?.removeEventListener("abort", abort);
            children.delete(child);
          };
          const consume = (line) => {
            let event;
            try { event = JSON.parse(line); } catch { return; }
            if (event.type !== "message_end" || event.message?.role !== "assistant") return;
            const message = event.message;
            const calls = (message.content || []).filter((block) => block.type === "toolCall").map((block) => ({ ...block, id: `${child.pid}:${block.id}` }));
            if (calls.length) onUpdate?.({ content: [{ type: "text", text: `Pi sub-agent: ${params.description}` }], details: { childToolCalls: calls } });
            finalText = (message.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
            errorMessage = ["error", "aborted"].includes(message.stopReason) ? message.errorMessage || "Pi sub-agent failed" : undefined;
            if (message.usage) {
              usage.inputTokens += number(message.usage.input) + number(message.usage.cacheRead) + number(message.usage.cacheWrite);
              usage.outputTokens += number(message.usage.output);
              usage.totalCostUsd += number(message.usage.cost?.total);
            }
          };
          child.stdout.setEncoding("utf8");
          child.stdout.on("data", (chunk) => {
            pending += chunk;
            const lines = pending.split("\n");
            pending = lines.pop() || "";
            for (const line of lines) consume(line);
            if (pending.length > 8 * 1024 * 1024) abort();
          });
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
          child.stdin.on("error", () => {});
          child.once("error", (error) => { cleanup(); reject(error); });
          child.once("close", (code) => {
            cleanup();
            if (pending) consume(pending);
            const failure = cancelled ? "Pi sub-agent cancelled or timed out" : errorMessage || (code !== 0 ? stderr || `Pi sub-agent exited ${code}` : undefined);
            // Preserve billed child usage even on failure; isError tells the agent the task failed.
            resolveResult({ content: [{ type: "text", text: failure ? `Task failed: ${failure}` : finalText || "Task completed without textual output" }], details: { usage, failed: Boolean(failure) }, isError: Boolean(failure) });
          });
          onUpdate?.({ content: [{ type: "text", text: `Pi sub-agent started: ${params.description}` }], details: {} });
          child.stdin.end(params.prompt);
        });
      } finally {
        activeChildren--;
      }
    },
  });
}
