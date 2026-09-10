#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLaunchPlan } from "./launch-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);

function getNextBin() {
  return resolve(projectRoot, "node_modules", ".bin", "next");
}

function printHelp() {
  console.log(`
arij - AI-first project orchestrator

Usage:
  arij              Start the production server (on 127.0.0.1)
  arij dev          Start the development server (on 127.0.0.1)
  arij build        Build for production
  arij --help       Show this help message
  arij --version    Show version

Options (dev and start):
  -H, --host <host>  Interface to bind. Defaults to 127.0.0.1, and anything
                     else is remote mode: Arij mints a per-boot credential
                     and requires it on /api/*. See README, "Remote access".
  -p, --port <port>  Port to listen on. Defaults to 3000.

Any other option is passed straight through to Next.
`);
}

function printVersion() {
  const pkg = JSON.parse(
    readFileSync(resolve(projectRoot, "package.json"), "utf-8")
  );
  console.log(pkg.version);
}

try {
  const plan = resolveLaunchPlan(args, process.env);

  if (plan.command === "help") {
    printHelp();
    process.exit(0);
  }

  if (plan.command === "version") {
    printVersion();
    process.exit(0);
  }

  if (plan.command === "unknown") {
    console.error(`Unknown command: ${plan.unknownCommand}`);
    printHelp();
    process.exit(1);
  }

  for (const line of plan.notices) console.log(line);

  execFileSync(getNextBin(), plan.nextArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, ...plan.childEnv },
  });
} catch (error) {
  if (error.status != null) {
    process.exit(error.status);
  }
  console.error(error.message);
  process.exit(1);
}
