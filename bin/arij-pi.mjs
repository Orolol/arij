#!/usr/bin/env node

import { existsSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  console.error("Arij's bundled Pi requires Node.js >=22.19.");
  process.exit(1);
}

let cli;
try {
  // npm may hoist the package; use Node's normal module lookup.
  cli = resolve(dirname(createRequire(import.meta.url).resolve("@arij/pi")), "cli.js");
} catch {
  // Report the same actionable error for a missing or incomplete installation.
}
if (!cli || !existsSync(cli)) {
  console.error("Arij's bundled Pi is missing. Run npm install in the Arij directory.");
  process.exit(1);
}

// Self-updates must go through Arij to preserve the tested fork revision.
if (process.argv[2] === "update" && (!process.argv[3] || ["self", "pi"].includes(process.argv[3]))) {
  console.error("Update Arij to update its bundled Pi. Extension updates may name an explicit source.");
  process.exit(1);
}
process.env.PI_SKIP_VERSION_CHECK = "1";

// Arij resumes across worktrees. Pi's UUID lookup otherwise prompts to fork
// sessions from a different cwd, which cannot be answered in a headless run.
// Resolve only exact UUIDs from this fork's session store, never legacy ~/.pi.
const sessionIndex = process.argv.indexOf("--session");
const sessionId = process.argv[sessionIndex + 1];
if (sessionIndex >= 0 && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sessionId || "") &&
    process.argv.includes("--arij-config")) {
  const root = resolve(process.env.PI_CODING_AGENT_DIR || resolve(homedir(), ".arij-pi", "agent"), "sessions");
  try {
    const matches = [];
    for (const directory of readdirSync(root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const base = resolve(root, directory.name);
      for (const file of readdirSync(base, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(`_${sessionId}.jsonl`)) continue;
        const candidate = resolve(base, file.name);
        const fd = openSync(candidate, "r");
        try {
          const buffer = Buffer.alloc(8192);
          const size = readSync(fd, buffer);
          const header = JSON.parse(buffer.subarray(0, size).toString("utf8").split("\n")[0]);
          if (header.type === "session" && header.id === sessionId) matches.push(candidate);
        } finally { closeSync(fd); }
      }
    }
    if (matches.length === 1) process.argv[sessionIndex + 1] = matches[0];
    if (matches.length > 1) {
      console.error("Ambiguous Pi session id; select an explicit session file.");
      process.exit(1);
    }
  } catch {
    // Let Pi report its normal missing-session error; Arij can start fresh.
  }
}
await import(pathToFileURL(cli).href);
