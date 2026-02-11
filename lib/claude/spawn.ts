import { spawn as nodeSpawn, type ChildProcess } from "child_process";

export interface ClaudeOptions {
  mode: "plan" | "code" | "analyze";
  prompt: string;
  cwd?: string;
  allowedTools?: string[];
  model?: string;
}

export interface ClaudeResult {
  success: boolean;
  result?: string;
  error?: string;
  duration: number;
}

export interface SpawnedClaude {
  promise: Promise<ClaudeResult>;
  kill: () => void;
}

/**
 * Spawns the `claude` CLI as a child process and returns a promise that
 * resolves with the parsed JSON result once the process exits.
 *
 * The returned `kill` function can be called to abort the process early.
 */
export function spawnClaude(options: ClaudeOptions): SpawnedClaude {
  const { mode, prompt, cwd, allowedTools, model } = options;

  // --permission-mode: "plan" for read-only, "bypassPermissions" for code/analyze
  const permissionMode = mode === "plan" ? "plan" : "bypassPermissions";

  // "analyze" mode restricts tools to read + write (no Bash/Edit)
  const effectiveAllowedTools =
    mode === "analyze" && (!allowedTools || allowedTools.length === 0)
      ? ["Read", "Glob", "Grep", "Write"]
      : allowedTools;

  const args: string[] = [
    "--permission-mode",
    permissionMode,
    "--output-format",
    "json",
    "--print",
    "-p",
    prompt,
  ];

  if (model) {
    args.push("--model", model);
  }

  if (effectiveAllowedTools && effectiveAllowedTools.length > 0) {
    args.push("--allowedTools", ...effectiveAllowedTools);
  }

  const effectiveCwd = cwd || process.cwd();

  console.log("[spawn] claude", args.map(a => a.length > 100 ? a.slice(0, 100) + "..." : a).join(" "));
  console.log("[spawn] cwd:", effectiveCwd);

  let child: ChildProcess | null = null;
  let killed = false;

  const promise = new Promise<ClaudeResult>((resolve) => {
    const startTime = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child = nodeSpawn("claude", args, {
      cwd: effectiveCwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      const duration = Date.now() - startTime;

      if (err.message.includes("ENOENT")) {
        resolve({
          success: false,
          error:
            "Claude CLI not found. Ensure `claude` is installed and available in PATH.",
          duration,
        });
      } else {
        resolve({
          success: false,
          error: `Failed to spawn Claude CLI: ${err.message}`,
          duration,
        });
      }
    });

    child.on("close", (code) => {
      const duration = Date.now() - startTime;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      console.log("[spawn] Process exited, code:", code, "duration:", duration + "ms", "stdout:", stdout.length, "bytes, stderr:", stderr.length, "bytes");
      if (stderr.trim()) {
        console.log("[spawn] stderr:", stderr.slice(0, 500));
      }
      if (stdout.trim()) {
        console.log("[spawn] stdout preview:", stdout.slice(0, 300));
      }

      if (killed) {
        resolve({
          success: false,
          error: "Process was cancelled.",
          duration,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          success: false,
          error:
            stderr.trim() ||
            `Claude CLI exited with code ${code}`,
          result: stdout.trim() || undefined,
          duration,
        });
        return;
      }

      resolve({
        success: true,
        result: stdout.trim(),
        duration,
      });
    });
  });

  const kill = () => {
    if (child && !child.killed) {
      killed = true;
      child.kill("SIGTERM");

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (child && !child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }
  };

  return { promise, kill };
}
