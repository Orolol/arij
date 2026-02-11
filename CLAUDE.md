# Arij — Development Guidelines

## Project Overview
Arij is a local, AI-first project orchestrator. It provides a web interface for managing multi-project workflows with Claude Code as the execution engine.

## Stack
- **Framework**: Next.js 16 (App Router, Turbopack)
- **UI**: Tailwind CSS v4 + shadcn/ui
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **Kanban DnD**: dnd-kit
- **Claude Code**: CLI `claude` spawned as child process

## Conventions
- Use `@/` import alias for project root
- Use `nanoid` for all IDs (`lib/utils/nanoid.ts`)
- API routes return JSON with consistent `{ data }` or `{ error }` shape
- Database schema in `lib/db/schema.ts`, connection in `lib/db/index.ts`
- Dark mode is default (class-based via Tailwind)
- Components use shadcn/ui primitives from `components/ui/`

## File Structure
- `app/` — Next.js routes and layouts
- `components/` — React components (kanban, chat, dashboard, etc.)
- `lib/` — Server-side utilities (db, claude, converters)
- `hooks/` — Client-side React hooks
- `data/` — Local data (SQLite DB, session logs) — gitignored

## Commands
- `npm run dev` — Start dev server with Turbopack
- `npx drizzle-kit generate` — Generate migrations
- `npx drizzle-kit push` — Push schema to DB
