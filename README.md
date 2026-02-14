# Arij

Arij is an AI-first, local, open-source project orchestrator. It provides a multi-project web interface centered on epics and user stories, with Claude Code as the integrated execution engine.

Brainstorm, specify, plan, and build your projects from a single interface, delegating code execution to Claude Code.

## 💡 Vision

**"A multi-project Kanban that transforms your ideas into structured specs and launches Claude Code to implement them."**

Arij orchestrates the complete software project lifecycle:
- **Ideation:** Brainstorm with Claude in plan mode.
- **Specification:** Generate full specs and plans (epics + user stories) automatically.
- **Construction:** Launch Claude Code per epic with automatic git worktree isolation.
- **Delivery:** Review, merge, and generate changelogs.

## 🚀 Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **UI** | Tailwind CSS + shadcn/ui |
| **Database** | SQLite via Drizzle ORM |
| **Claude Code** | CLI `claude` (spawned child processes) |
| **Git** | simple-git (Worktrees & Branch management) |
| **Testing** | Vitest + Playwright |

## 🏗️ Architecture

Arij is a local-first web app (localhost). It communicates with Claude Code exclusively via the `claude` CLI, leveraging your existing Pro or Max subscription.

- **Plan Mode:** Used for brainstorming, spec generation, and contextual chat.
- **Code Mode:** Used for implementing epics.
- **Isolation:** Each epic implementation runs in a dedicated Git worktree and branch (`feature/epic-{id}-{slug}`).
- **Unified Chat:** A single workspace (`UnifiedChatPanel`) manages all conversations, including brainstorming and epic creation, with a robust cutover migration for legacy data.

### Execution Flow (High-Level)

1. Project context is assembled from spec, uploaded documents, and chat history.
2. The backend builds structured prompts and invokes the `claude` CLI in plan/code mode.
3. Build sessions run per epic in isolated worktrees; logs and status are persisted for monitoring.
4. Unified Chat reads canonical APIs for conversations/messages/sessions and handles cutover migration artifacts in `data/migrations/unified-chat-cutover/`.

## ✨ Key Features

- **Project Import:** Analyze existing codebases to generate specs and decompose them into epics/US.
- **Document Management:** Upload PDFs, DOCX, and images; Arij converts them to Markdown for Claude's context.
- **Kanban Board:** Manage project progress with a drag-and-drop interface for epics.
- **Unified Chat:** A central workspace for ideation and epic creation.
- **Agent Monitor:** Real-time tracking of Claude Code execution sessions.

## 🛠️ Getting Started

### Prerequisites

- **Claude Code CLI:** Installed and authenticated (`npm install -g @anthropic-ai/claude-code`).
- **Git:** Installed on your system.
- **Node.js:** Version 20.9 or higher.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/arij.git
   cd arij
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📄 License

MIT
