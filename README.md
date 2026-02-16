# Arij

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20.9](https://img.shields.io/badge/Node.js-%3E%3D20.9-green.svg)](https://nodejs.org)

A local-first, AI-powered project orchestrator that transforms your development workflow. Manage multiple projects through a Kanban interface while Claude Code (or Codex/Gemini) handles the implementation.

## Key Features

- **Multi-Project Dashboard** — Overview all projects at a glance
- **Kanban Board** — Drag-and-drop epic management per project
- **AI Chat Panel** — Brainstorm, plan, and iterate with Claude in plan mode
- **Spec-Driven Development** — Generate code from specifications, not prompts
- **Multi-Provider Support** — Claude Code, OpenAI Codex, or Gemini CLI
- **Git Integration** — Automatic worktrees, branches, and PR creation
- **Document Upload** — Convert PDF/DOCX to Markdown for AI context
- **Dependency Management** — Track epic dependencies with DAG scheduling
- **Team Orchestration** — Coordinate multiple agents for complex tasks

## Quick Start

```bash
# Clone and install
git clone https://github.com/yourorg/arij.git
cd arij && npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

First run auto-creates the SQLite database at `data/arij.db`.

---

## Design Philosophy

1. **Local-first** — Everything runs on localhost. No cloud, no account, no telemetry.
2. **Claude Code native** — All AI interactions go through the `claude` CLI, leveraging your existing Pro/Max subscription.
3. **Convention over configuration** — Sensible defaults, minimal setup.
4. **Spec-driven development** — Every line of generated code traces back to a spec.
5. **Progressive disclosure** — Simple by default, depth on demand.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser                               │
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

## Installation

### Prerequisites

- **Node.js** >= 20.9
- **Claude Code CLI** — Install via `npm install -g @anthropic-ai/claude-code` and authenticate with `claude auth`
- **Git** — For worktree and branch management

### Setup

```bash
# Install dependencies
npm install

# Start dev server (Turbopack)
npm run dev

# Database migrations
npx drizzle-kit generate   # Generate migrations
npx drizzle-kit push        # Push schema to DB
```

### Production

```bash
npm run build    # Production build
npm run start    # Start production server
```

---

## Project Structure

```
app/                    → Next.js App Router routes and layouts
  api/                  → REST API endpoints
    projects/           → Project CRUD, epics, stories, sessions
    agent-config/       → Prompts, providers, named agents
    qa/                 → QA reports and prompts
    settings/           → Global settings
components/             → React components
  kanban/               → Board, columns, cards
  chat/                 → Chat panel, messages
  dashboard/            → Project grid
  monitor/              → Agent session monitor
  agent-config/         → Prompt/provider configuration
  documents/            → Document upload and viewer
  github/               → GitHub integration UI
lib/                    → Server-side utilities
  db/                   → Database schema and connection
  claude/               → Claude Code process management
  git/                  → Git operations and worktrees
  agent-config/         → Prompt resolution and provider defaults
hooks/                  → Client-side React hooks
data/                   → Local data (SQLite DB, logs) — gitignored
__tests__/              → Unit tests (Vitest)
e2e/                    → End-to-end tests (Playwright)
```

---

## Core Concepts

### Projects

A project represents a codebase with its own spec, epics, and git repository. Import an existing folder or start fresh.

### Epics & User Stories

- **Epics** — High-level features or bugs (Kanban cards)
- **User Stories** — Granular tasks within an epic
- Both support: status tracking, comments, dependencies

### Agent Sessions

When you click "Build", Arij spawns an AI agent:

```
queued → running → completed
                  → failed
                  → cancelled
```

Sessions are tracked with full prompt history and logs for debugging.

### Dependencies

Epics can depend on other epics. Arij builds a DAG and schedules builds in topological order.

---

## Key Patterns

### Provider Pattern (Prompt Resolution)

Each agent type has its own system prompt with 3-level fallback:

```
Project Custom → Global Custom → Built-in Default
     (highest)      (fallback)      (empty string)
```

Agent types: `build`, `review_security`, `review_code`, `review_compliance`, `review_feature`, `chat`, `spec_generation`, `team_build`, `ticket_build`, `merge`, `tech_check`.

### State Machine (Agent Sessions)

```
queued → running → completed | failed | cancelled
```

### Multi-Provider Support

| Provider | CLI Command | Notes |
|----------|-------------|-------|
| Claude Code | `claude` | Primary, plan + code modes |
| OpenAI Codex | `codex` | Alternative via Codex SDK |
| Gemini CLI | `gemini` | Alternative via Google CLI |

Configure defaults per agent type at global or project level.

---

## API Reference

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PATCH | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| POST | `/api/projects/import` | Import from folder |

### Epics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/epics` | List epics |
| POST | `/api/projects/:id/epics` | Create epic |
| POST | `/api/projects/:id/epics/:epicId/build` | Start build |
| POST | `/api/projects/:id/epics/:epicId/review` | Start review |
| POST | `/api/projects/:id/epics/:epicId/merge` | Merge to main |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/sessions` | List sessions |
| GET | `/api/projects/:id/sessions/active` | Active sessions |
| GET | `/api/projects/:id/sessions/resumable` | Resumable sessions |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/conversations` | List conversations |
| POST | `/api/projects/:id/chat/stream` | Stream chat response |

---

## Testing

```bash
# Unit tests
npm test                    # Run once
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report

# E2E tests
npm run test:e2e            # Run Playwright
npm run test:e2e:ui         # Interactive UI
```

---

## Configuration

### Environment Variables

Create `.env.local` for optional settings:

```env
# GitHub integration (optional)
GITHUB_TOKEN=ghp_xxx

# Custom Claude path (optional)
CLAUDE_PATH=/usr/local/bin/claude
```

### Agent Prompts

Customize system prompts per agent type via the UI or `agent_prompts` table. Scope to global or project-specific.

### Named Agents

Create reusable agent profiles with specific provider/model combinations. Assign Greek names for easy identification.

---

## Database Schema

Key tables:

| Table | Purpose |
|-------|---------|
| `projects` | Projects with spec and git config |
| `epics` | Features/bugs with status and PR info |
| `user_stories` | Granular tasks within epics |
| `agent_sessions` | AI execution history |
| `chat_conversations` | Chat threads |
| `agent_prompts` | Custom system prompts |
| `named_agents` | Reusable agent profiles |
| `ticket_dependencies` | Epic dependency graph |
| `releases` | Version releases |
| `pull_requests` | PR tracking |
| `qa_reports` | QA check results |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit with conventional commits: `feat(scope): description`
4. Push and open a pull request

### Development Guidelines

- Use `@/` import alias for project root
- Use `nanoid` for all IDs
- API routes return `{ data }` or `{ error }`
- Dark mode is default
- Components use shadcn/ui primitives

---

## License

[MIT](LICENSE)
