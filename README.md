# Arij

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A local, AI-first project orchestrator with a web interface for managing multi-project workflows with Claude Code as the execution engine.

---

## Design Philosophy

1. **Local-first** -- Everything runs on localhost. No cloud, no account, no telemetry. Your data stays on your machine.
2. **Claude Code native** -- The app does not call the Anthropic API directly. All AI interactions go through the `claude` CLI, leveraging the user's existing Pro/Max subscription.
3. **Convention over configuration** -- Sensible defaults, minimal setup. Install and go.
4. **Spec-driven development** -- Every line of generated code traces back to a spec. The epic is the unit of work for Claude Code.
5. **Progressive disclosure** -- The interface is simple by default (brainstorm, kanban, build), with depth available on demand (logs, git, settings).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser                               │
│                                                          │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ Dashboard   │ │  Kanban      │ │  Chat Panel      │  │
│  │ Multi-proj  │ │  per project │ │  (CC plan mode)  │  │
│  └─────────────┘ └──────────────┘ └──────────────────┘  │
│  ┌──────────────────┐ ┌────────────────────────────┐    │
│  │ Agent Monitor   │ │  Document Viewer / Upload   │    │
│  │ (polling)       │ │  (PDF, DOCX → Markdown)    │    │
│  └──────────────────┘ └────────────────────────────┘    │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────┐
│              Next.js 16 Backend (API Routes)             │
│                                                          │
│  ┌────────────┐ ┌───────────────┐ ┌──────────────────┐  │
│  │ Projects   │ │ Claude Code   │ │ Prompt Builder   │  │
│  │ CRUD       │ │ Process Mgr   │ │ (spec → prompt)  │  │
│  └─────┬──────┘ └───────┬───────┘ └──────────────────┘  │
│        │                │                                │
│  ┌─────▼──────┐ ┌───────▼───────┐ ┌──────────────────┐  │
│  │  SQLite    │ │ Git Manager   │ │ File Converter   │  │
│  │  (Drizzle) │ │ (worktrees)   │ │ (docx/pdf → md)  │  │
│  └────────────┘ └───────────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 16 (App Router, Turbopack) | Fullstack React |
| UI | Tailwind CSS v4 + shadcn/ui | Dark mode, accessible components |
| Database | SQLite via better-sqlite3 + Drizzle ORM | Local-first, zero config |
| Kanban DnD | dnd-kit | Drag and drop |
| AI Engine | Claude Code CLI (`claude`) | Plan mode + code mode |
| AI Engine | OpenAI Codex CLI (`codex`) | Alternative provider |
| AI Engine | Gemini CLI (`gemini`) | Alternative provider |
| Git | simple-git | Worktrees, branches |
| Doc Conversion | mammoth, pdf-parse | DOCX/PDF to Markdown |
| Markdown | unified / remark / rehype | Parsing and rendering |
| Tests | Vitest + Playwright | Unit + E2E |

---

## Key Patterns

### Provider Pattern (Prompt Resolution)

Each agent type (build, review, chat, spec generation, etc.) has its own system prompt resolved via a 3-level fallback chain:

```
Project Custom Prompt  →  Global Custom Prompt  →  Built-in Default
       (highest)              (fallback)              (empty string)
```

Custom prompts are stored in the `agent_prompts` table with a `scope` field (`"global"` or a project ID). At resolution time, the system checks for a project-scoped override first, then a global override, and finally falls back to the built-in default. This pattern is implemented in `lib/agent-config/prompts.ts`.

Available agent types: `build`, `review_security`, `review_code`, `review_compliance`, `review_feature`, `chat`, `spec_generation`, `team_build`, `ticket_build`, `merge`, `tech_check`.

### State Machine Pattern (Agent Sessions)

Agent sessions follow a linear state machine tracking the lifecycle of a Claude Code (or Codex/Gemini) execution:

```
queued → running → completed
                 → failed
                 → cancelled
```

Each session record (`agent_sessions` table) tracks:
- Which project and epic/user story is being built
- The provider used (`claude-code`, `codex`, or `gemini-cli`)
- The CLI session ID (for resume capabilities)
- The worktree path and branch name
- The orchestration mode (`solo` or `team`)
- Timestamps for start, end, and completion
- The full prompt sent and any error output

### Multi-Provider Support

Arij supports three AI CLI providers as execution engines:
- **Claude Code** (`claude`) -- the primary provider, using plan and code modes
- **OpenAI Codex** (`codex`) -- alternative provider via the Codex SDK
- **Gemini CLI** (`gemini`) -- alternative provider via Google's CLI

Each agent type can have a different default provider configured at both the global and project level, stored in the `agent_provider_defaults` table.

---

## Local Development

### Prerequisites

- Node.js >= 20.9
- Claude Code CLI (`claude`) installed and authenticated
- Git

### Setup

```bash
# Install dependencies
npm install

# Start dev server (Turbopack)
npm run dev

# Database (SQLite, auto-created at data/arij.db)
npx drizzle-kit generate   # Generate migrations
npx drizzle-kit push        # Push schema to DB
```

### Tests

```bash
npm test                    # Run unit tests (Vitest)
npm run test:watch          # Run tests in watch mode
npm run test:coverage       # Coverage report
npm run test:e2e            # Run E2E tests (Playwright)
npm run test:e2e:ui         # Run E2E tests with UI
```

### Other Commands

```bash
npm run build               # Production build
npm run start               # Start production server
npm run lint                # Run ESLint
```

---

## File Structure

```
app/          → Next.js App Router routes and layouts
components/   → React components (kanban, chat, dashboard, etc.)
lib/          → Server-side utilities (db, claude, git, converters)
hooks/        → Client-side React hooks
data/         → Local data (SQLite DB, session logs) — gitignored
__tests__/    → Unit tests
e2e/          → End-to-end tests (Playwright)
```

---

## License

[MIT](LICENSE) main
