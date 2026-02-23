# Arij — Product Requirements Document

**Version:** 1.1
**Date:** 11 février 2026
**Auteur:** Gaétan (Tech Lead AI — Lefebvre Dalloz)
**Statut:** Draft
**Licence:** MIT

---

## 1. Vision

Arij est un orchestrateur de projets AI-first, local, open source. Il fournit une interface web de gestion de projets multi-projet, centrée sur les épics et user stories, avec Claude Code comme moteur d'exécution intégré. L'utilisateur brainstorme, spécifie, planifie et construit ses projets depuis une seule interface, en déléguant l'exécution du code à Claude Code.

**Pitch en une phrase :** Un Kanban multiprojet qui transforme vos idées en specs structurées et lance Claude Code pour les implémenter.

---

## 2. Problème

Les développeurs utilisant Claude Code font face à un workflow fragmenté :

- Les idées et specs vivent dans des docs séparés (Notion, Google Docs, fichiers markdown)
- Le suivi des épics et US est géré dans un outil tiers (Jira, Linear, GitHub Issues) déconnecté de l'exécution
- Le lancement de Claude Code est manuel, ticket par ticket, en ligne de commande
- Il n'y a aucune vue unifiée de l'avancement de plusieurs projets en parallèle
- Le contexte projet (docs, specs, historique) doit être réinjecté manuellement à chaque session Claude Code

Les outils existants (CCPM, CloudCLI, Claudia) adressent des morceaux du problème mais aucun ne propose le pipeline complet idéation → spec → kanban → build → monitoring dans une seule interface.

---

## 3. Solution

Arij est une web app locale (localhost) qui orchestre le cycle de vie complet d'un projet logiciel :

```
💡 Idéation          📋 Spécification        🔨 Construction        ✅ Livraison
───────────────────────────────────────────────────────────────────────────────
Chat brainstorm  →  Generate Spec & Plan  →  Lancer Claude Code  →  Review & merge
avec Claude         (épics + US auto)        par épic                releases
(mode plan)         Édition manuelle         Monitoring live         Changelogs
```

---

## 4. Utilisateurs cibles

- **Développeurs solo** qui utilisent Claude Code quotidiennement et veulent structurer leur workflow
- **Tech leads** qui gèrent plusieurs projets AI-assisted en parallèle
- **Contributeurs open source** qui veulent un outil léger de PM intégré avec Claude Code

**Prérequis utilisateur :** Claude Code installé et authentifié (souscription Pro ou Max).

---

## 5. Principes de design

1. **Local-first** — Tout tourne en localhost. Pas de cloud, pas de compte, pas de télémétrie. Les données restent sur la machine de l'utilisateur.
2. **Claude Code natif** — L'app n'utilise pas l'API Anthropic directement. Tout passe par le CLI `claude` pour exploiter la souscription de l'utilisateur.
3. **Convention over configuration** — Des choix par défaut sensés, un setup minimal. `npx arij` et c'est parti.
4. **Spec-driven** — Chaque ligne de code produite est traçable jusqu'à une spec. L'épic est l'unité de travail de Claude Code.
5. **Progressive disclosure** — L'interface est simple par défaut (brainstorm → kanban → build), avec de la profondeur accessible au besoin (logs, git, settings).

---

## 6. Stack technique

| Couche | Technologie | Justification |
|--------|-------------|---------------|
| **Framework** | Next.js 16 (App Router, Turbopack) | Fullstack, React 19.2, Cache Components, proxy.ts |
| **UI** | Tailwind CSS + shadcn/ui | Composants accessibles, thème sombre natif, ecosystem riche |
| **Kanban DnD** | dnd-kit | Performant, accessible, bien maintenu |
| **Base de données** | SQLite (via better-sqlite3 ou Drizzle + libsql) | Local-first, zero config, portable |
| **ORM** | Drizzle ORM | Type-safe, léger, support SQLite natif |
| **Temps réel** | Polling API + SSE léger (statut only) | JSON output = pas de stream, polling pour les mises à jour de statut |
| **Claude Code** | CLI `claude` (spawn child process) | Utilise la souscription, mode plan + mode code, output JSON |
| **Git** | simple-git (Node.js) | Gestion des worktrees, branches, commits |
| **Conversion docs** | mammoth (docx→md), pdf-parse (pdf→text) | Léger, sans dépendance lourde |
| **Markdown** | unified / remark / rehype | Parsing et rendu markdown |
| **Tests** | Vitest + Playwright | Unit + E2E |
| **Package** | npm (publié comme CLI) | `npx arij` pour lancer |

---

## 7. Architecture

### 7.1 Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│                    Navigateur                            │
│                                                         │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ Dashboard   │ │  Kanban      │ │  Chat Panel      │  │
│  │ Multi-proj  │ │  par projet  │ │  (CC plan mode)  │  │
│  └─────────────┘ └──────────────┘ └──────────────────┘  │
│  ┌──────────────────┐ ┌────────────────────────────┐    │
│  │ Agent Monitor   │ │  Document Viewer / Upload   │    │
│  │ (polling)       │ │  (PDF, DOCX → Markdown)    │    │
│  └──────────────────┘ └────────────────────────────┘    │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────┐
│              Next.js 16 Backend (API Routes)            │
│                                                         │
│  ┌────────────┐ ┌───────────────┐ ┌──────────────────┐  │
│  │ Projects   │ │ Claude Code   │ │ Spec Generator   │  │
│  │ CRUD       │ │ Process Mgr   │ │ (CC plan mode)   │  │
│  └─────┬──────┘ └───────┬───────┘ └──────────────────┘  │
│        │                │                                │
│  ┌─────▼──────┐ ┌───────▼───────┐ ┌──────────────────┐  │
│  │  SQLite    │ │ Git Manager   │ │ File Converter   │  │
│  │  (Drizzle) │ │ (worktrees)   │ │ (docx/pdf → md)  │  │
│  └────────────┘ └───────────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Intégration Claude Code

L'app communique avec Claude Code **exclusivement via le CLI `claude`** (pas l'Agent SDK), ce qui permet d'utiliser la souscription Pro/Max de l'utilisateur.

**Deux modes d'utilisation :**

| Mode | Usage dans Arij | Commande CLI |
|------|---------------------|--------------|
| **Plan** | Brainstorm, génération de specs, chat contextuel | `claude --mode plan --output-format json -p "..."` |
| **Code** | Implémentation des épics | `claude --mode code --output-format json -p "..."` |

**Mécanique de lancement :**

1. L'utilisateur sélectionne un ou plusieurs épics dans le kanban
2. Le backend compose un prompt structuré contenant : la spec du projet, les docs uploadés (en markdown), les specs des épics sélectionnées avec leurs US et critères d'acceptation, le CLAUDE.md du repo
3. Pour chaque épic, le backend :
   - Crée un git worktree + branche dédiée (`feature/epic-{id}-{slug}`)
   - Spawne un process `claude` avec le prompt et le cwd pointant sur le worktree
   - Streame la sortie JSON via SSE vers le frontend
4. Le frontend affiche l'avancement en temps réel

**Gestion de la communication :**

```
claude --mode code \
  --output-format json \
  --allowedTools "Edit,Write,Bash,Read,Glob,Grep" \
  --print \
  --cwd /path/to/worktree \
  -p "Implement epic: ..."
```

Le format JSON retourne la réponse complète à la fin de l'exécution. Le backend poll le process et détecte la complétion. Les logs bruts sont écrits sur le filesystem (`data/sessions/{sessionId}/logs.json`). Le frontend interroge l'API périodiquement pour mettre à jour le statut (polling court ou SSE sur le statut uniquement).

### 7.3 Data Model

```sql
-- Workspace (implicite, un seul par installation)

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,  -- nanoid
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT DEFAULT 'ideation',  -- ideation | specifying | building | done | archived
  git_repo_path TEXT,             -- chemin vers le repo local
  spec          TEXT,             -- spec complète en markdown (générée par CC)
  imported      INTEGER DEFAULT 0, -- 1 si projet importé depuis un dossier existant
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,      -- nom du fichier original
  content_md  TEXT NOT NULL,      -- contenu converti en markdown
  mime_type   TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE epics (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  priority    INTEGER DEFAULT 0,  -- 0=low, 1=medium, 2=high, 3=critical
  status      TEXT DEFAULT 'backlog',  -- backlog | todo | in_progress | review | done
  position    INTEGER DEFAULT 0,  -- ordre dans la colonne (pour le drag & drop)
  branch_name TEXT,               -- branche git associée
  confidence  REAL,               -- 0.0-1.0, score de confiance lors de l'import
  evidence    TEXT,               -- justification du statut (import)
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_stories (
  id                  TEXT PRIMARY KEY,
  epic_id             TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  acceptance_criteria  TEXT,  -- markdown, liste de critères
  status              TEXT DEFAULT 'todo',  -- todo | in_progress | done
  position            INTEGER DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chat_messages (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,      -- user | assistant
  content     TEXT NOT NULL,
  metadata    TEXT,               -- JSON: model, tokens, mode, etc.
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_sessions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  epic_id     TEXT REFERENCES epics(id),
  status      TEXT DEFAULT 'pending',  -- pending | running | completed | failed | cancelled
  mode        TEXT DEFAULT 'code',     -- plan | code
  prompt      TEXT,               -- prompt envoyé à CC
  logs_path   TEXT,               -- chemin filesystem: data/sessions/{id}/logs.json
  branch_name TEXT,
  worktree_path TEXT,
  started_at  DATETIME,
  completed_at DATETIME,
  error       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,       -- JSON value
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Settings inclut notamment :
--   global_prompt : prompt système ajouté à toutes les sessions CC (tous projets)
```

---

## 8. Features détaillées

### Phase 1 — Brainstorm & Spec Generation (MVP)

#### F1.1 — Création de projet
- Formulaire minimal : nom + description (optionnelle)
- Configuration git optionnelle : chemin vers un repo local existant ou création d'un nouveau repo
- Le projet est créé en statut "ideation"

#### F1.2 — Import de projet existant
- Bouton "Import existing project" sur le dashboard
- L'utilisateur fournit le **chemin du dossier** du projet existant
- Arij lance Claude Code en mode plan pour analyser le projet :
  1. **Scan du codebase** : structure des fichiers, README, package.json / pyproject.toml / Cargo.toml, CLAUDE.md existant, docs, tests
  2. **Génération de la spec** : CC produit une description du projet, la stack détectée, l'architecture
  3. **Décomposition en épics et US** : CC identifie les modules/features existants et les traduit en épics + US
  4. **Assignation des statuts** : CC évalue pour chaque épic/US si c'est `done` (code existant + tests), `in_progress` (code partiel, TODO, WIP), ou `backlog` (mentionné dans les docs/README mais pas implémenté)
- L'import se fait en deux temps :
  1. CC analyse et produit un plan structuré (JSON)
  2. L'utilisateur **review et valide/ajuste** avant insertion en BDD (preview éditable)
- Le repo git existant est lié au projet (pas de clone, on pointe sur le dossier fourni)

**Prompt d'import (structure) :**

```markdown
# Global Instructions
{settings.global_prompt}

# Task: Analyze existing project

Analyze the codebase in the current directory and produce a structured assessment.

## Output format (JSON)
{
  "project": {
    "name": "detected project name",
    "description": "what this project does",
    "stack": "detected technologies",
    "architecture": "high-level architecture description"
  },
  "epics": [
    {
      "title": "Epic name",
      "description": "What this epic covers",
      "status": "done | in_progress | backlog",
      "confidence": 0.0-1.0,
      "evidence": "why this status (files, tests, TODOs found)",
      "user_stories": [
        {
          "title": "US title",
          "description": "As a... I want... so that...",
          "acceptance_criteria": "...",
          "status": "done | in_progress | todo",
          "evidence": "files/tests that support this status"
        }
      ]
    }
  ]
}

## Rules
- An epic is "done" if the code is functional AND has tests
- An epic is "in_progress" if code exists but is incomplete, has TODOs, or lacks tests
- An epic is "backlog" if mentioned in docs/README/issues but not yet implemented
- Include a confidence score for each status assessment
- Be conservative: prefer "in_progress" over "done" when uncertain
```

#### F1.3 — Upload de documents
- Drag & drop de fichiers dans la zone projet
- Types supportés : `.pdf`, `.docx`, `.md`, `.txt`, `.png`, `.jpg` (OCR basique)
- Conversion automatique en markdown
- Les documents sont stockés en BDD et injectés comme contexte dans les chats
- Visualisation du document converti (markdown rendu)

#### F1.4 — Chat brainstorm
- Panel de chat latéral, toujours accessible dans un projet
- Utilise Claude Code en mode plan (`claude --mode plan`)
- Le contexte injecté automatiquement inclut : la description du projet, tous les documents uploadés (en markdown), la spec existante (si déjà générée), l'historique des messages récents
- Streaming des réponses en temps réel
- L'utilisateur peut poser des questions, affiner l'idée, demander des alternatives

#### F1.5 — Génération de Spec & Plan
- Bouton "Generate Spec & Plan" dans l'interface du projet
- Lance Claude Code en mode plan avec un prompt structuré qui demande de produire :
  - **Spec projet** : description détaillée, objectifs, contraintes, stack technique recommandée
  - **Épics** : liste ordonnée par priorité, chacune avec titre, description, estimation de complexité
  - **User Stories** : pour chaque épic, liste de US avec format "En tant que... je veux... afin de..." + critères d'acceptation
- La sortie est parsée (format JSON structuré demandé dans le prompt) et insérée en BDD
- L'utilisateur peut ensuite éditer manuellement chaque élément
- Possibilité de relancer la génération (écrase ou merge, au choix de l'utilisateur)

#### F1.6 — Édition de la spec
- Vue spec en markdown avec édition inline
- Chaque épic et US est éditable individuellement
- Ajout/suppression manuelle d'épics et US
- Réordonnancement par drag & drop

---

### Phase 2 — Kanban

#### F2.1 — Board Kanban par projet
- Colonnes par défaut : `Backlog` → `To Do` → `In Progress` → `Review` → `Done`
- Les cartes sont les **épics**
- Chaque carte affiche : titre, priorité (badge couleur), nombre de US (done/total), branche git associée
- Drag & drop entre colonnes (met à jour le statut)
- Drag & drop intra-colonne (réordonnancement)

#### F2.2 — Vue détaillée d'une épic
- Clic sur une carte → panneau latéral ou modal
- Affiche : description complète, liste des US avec statuts, logs de la dernière session Claude Code, branche git et diff (si applicable)
- Édition inline de tous les champs

#### F2.3 — Vue multi-projet (Dashboard)
- Page d'accueil de l'application
- Liste de tous les projets sous forme de cartes compactes
- Chaque carte affiche : nom du projet, statut global, progress bar (épics done / total), nombre d'agents actifs, dernière activité
- Clic sur un projet → vue kanban détaillée
- Filtres : par statut, par activité récente
- Possibilité d'archiver des projets

---

### Phase 3 — Claude Code Integration

#### F3.1 — Lancement de Claude Code par épic
- Dans le kanban, sélection d'une ou plusieurs épics (checkboxes)
- Bouton "Build with Claude Code"
- Pour chaque épic sélectionnée :
  1. Vérifie que le repo git est configuré
  2. Crée un worktree + branche (`feature/epic-{id}-{slug}`)
  3. Compose le prompt avec les specs
  4. Spawne le process `claude` en mode code
  5. L'épic passe automatiquement en "In Progress"
- Possibilité de lancer en séquentiel (1 par 1) ou parallèle (N en même temps)

#### F3.2 — Composition du prompt
Le prompt envoyé à Claude Code est structuré ainsi :

```markdown
# Global Instructions
{settings.global_prompt}   <!-- prompt global configurable par l'utilisateur -->

# Project: {project.name}

## Project Specification
{project.spec}

## Reference Documents
{documents.map(d => d.content_md).join('\n---\n')}

## Epic to Implement
### {epic.title}
{epic.description}

### User Stories
{epic.user_stories.map(us => `
- [ ] ${us.title}
  ${us.description}
  Acceptance criteria:
  ${us.acceptance_criteria}
`)}

## Instructions
Implement this epic following the spec above. Create necessary files,
write tests for each user story, and ensure all acceptance criteria are met.
Commit your changes with clear, descriptive commit messages referencing
the epic and user story titles.
```

#### F3.3 — Gestion des sessions
- Chaque lancement crée une `agent_session` en BDD
- Les sessions peuvent être : `pending`, `running`, `completed`, `failed`, `cancelled`
- Bouton "Cancel" pour tuer un process en cours
- Possibilité de relancer une session échouée
- Historique complet des sessions par épic

---

### Phase 4 — Monitoring & Releases

#### F4.1 — Monitoring temps réel
- Vue dédiée ou panneau dans le kanban
- Pour chaque agent actif : indicateur de statut (spinner), temps écoulé, fichiers modifiés (détecté au retour)
- Polling API côté frontend (toutes les 2-5s) pour rafraîchir les statuts des sessions
- Le backend vérifie l'état des process enfants et met à jour la BDD
- Alertes visuelles : notification quand un agent termine (succès/échec), badge sur le projet dans le dashboard

#### F4.2 — Logs et détails de session
- Clic sur une session → vue détaillée
- Les logs sont lus depuis le filesystem (`data/sessions/{id}/logs.json`)
- Affichage structuré : prompt envoyé, réponse complète de CC, résultat final
- Export des logs

#### F4.3 — Releases (V2)
- Vue "Releases" par projet
- Création de release : sélectionner les épics terminées à inclure
- Génération automatique de changelog (via Claude Code en mode plan)
- Création de tag git
- Historique des releases

#### F4.4 — Tests et Preview (V2+)
- Détection automatique du framework (Next.js, Vite, etc.)
- Bouton "Run tests" → exécute la commande de test du projet
- Bouton "Preview" → lance le serveur de dev et affiche dans un iframe
- Rapport de tests intégré à la vue épic

---

## 9. Structure des routes (Next.js 16 App Router)

```
app/
├── layout.tsx                    # Layout racine, sidebar navigation
├── page.tsx                      # Dashboard multi-projet
├── projects/
│   ├── new/
│   │   └── page.tsx              # Création de projet
│   ├── import/
│   │   └── page.tsx              # Import projet existant (path selector → preview → validate)
│   └── [projectId]/
│       ├── layout.tsx            # Layout projet (sidebar chat)
│       ├── page.tsx              # Vue kanban du projet
│       ├── spec/
│       │   └── page.tsx          # Vue/édition de la spec
│       ├── documents/
│       │   └── page.tsx          # Gestion des documents
│       ├── sessions/
│       │   ├── page.tsx          # Liste des sessions CC
│       │   └── [sessionId]/
│       │       └── page.tsx      # Détail d'une session
│       └── releases/
│           └── page.tsx          # Gestion des releases (V2)
├── settings/
│   └── page.tsx                  # Settings globaux (prompt global, préférences)
├── api/
│   ├── projects/
│   │   ├── route.ts              # GET (list), POST (create)
│   │   ├── import/
│   │   │   └── route.ts          # POST (import existing project → lance CC plan mode)
│   │   └── [projectId]/
│   │       ├── route.ts          # GET, PATCH, DELETE
│   │       ├── documents/
│   │       │   └── route.ts      # GET, POST (upload)
│   │       ├── epics/
│   │       │   ├── route.ts      # GET, POST
│   │       │   └── [epicId]/
│   │       │       └── route.ts  # PATCH, DELETE
│   │       ├── user-stories/
│   │       │   └── route.ts      # CRUD
│   │       ├── chat/
│   │       │   └── route.ts      # GET history, POST message (lance CC plan mode, retourne JSON)
│   │       ├── generate-spec/
│   │       │   └── route.ts      # POST → lance CC plan mode
│   │       ├── build/
│   │       │   └── route.ts      # POST → lance CC code mode
│   │       └── sessions/
│   │           ├── route.ts      # GET list
│   │           ├── [sessionId]/
│   │           │   └── route.ts  # GET detail + logs, DELETE (cancel)
│   │           └── active/
│   │               └── route.ts  # GET sessions actives (polling)
│   └── health/
│       └── route.ts              # Health check
│   └── settings/
│       └── route.ts              # GET, PATCH settings (prompt global, etc.)
```

---

## 10. Structure du projet (fichiers)

```
arij/
├── app/                          # Next.js 16 App Router (voir section 9)
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── kanban/
│   │   ├── Board.tsx
│   │   ├── Column.tsx
│   │   ├── EpicCard.tsx
│   │   └── EpicDetail.tsx
│   ├── chat/
│   │   ├── ChatPanel.tsx
│   │   ├── MessageList.tsx
│   │   └── MessageInput.tsx
│   ├── dashboard/
│   │   ├── ProjectGrid.tsx
│   │   └── ProjectCard.tsx
│   ├── import/
│   │   ├── FolderSelector.tsx     # Sélection du dossier projet
│   │   ├── ImportPreview.tsx      # Preview des épics/US détectées (éditable)
│   │   └── ImportProgress.tsx     # Progression de l'analyse CC
│   ├── documents/
│   │   ├── UploadZone.tsx
│   │   └── DocumentViewer.tsx
│   ├── monitor/
│   │   ├── AgentStatus.tsx
│   │   ├── SessionLogs.tsx
│   │   └── SessionTimeline.tsx
│   └── spec/
│       ├── SpecEditor.tsx
│       └── SpecPreview.tsx
├── lib/
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema
│   │   ├── migrations/
│   │   └── index.ts              # DB connection
│   ├── claude/
│   │   ├── spawn.ts              # Spawn claude CLI process
│   │   ├── json-parser.ts        # Parse JSON output de CC
│   │   ├── prompt-builder.ts     # Compose prompts from specs + global prompt
│   │   └── process-manager.ts    # Manage running processes, polling statut
│   ├── git/
│   │   ├── manager.ts            # Git operations (worktrees, branches)
│   │   └── utils.ts
│   ├── converters/
│   │   ├── docx-to-md.ts
│   │   ├── pdf-to-md.ts
│   │   └── image-to-md.ts        # OCR basique
│   └── utils/
│       ├── nanoid.ts
│       └── markdown.ts
├── hooks/
│   ├── useChat.ts
│   ├── useKanban.ts
│   ├── useAgentPolling.ts        # Polling statut des sessions CC
│   └── useProjects.ts
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── tsconfig.json
├── data/                         # Données locales (gitignored)
│   ├── arij.db                   # SQLite database
│   └── sessions/                 # Logs des sessions CC
│       └── {sessionId}/
│           └── logs.json         # Sortie JSON complète de CC
├── CLAUDE.md                     # Instructions pour CC quand il travaille sur Arij lui-même
└── README.md
```

---

## 11. UX / Wireframes textuels

### 11.1 Dashboard (page d'accueil)

```
┌──────────────────────────────────────────────────────────────────┐
│  🔥 Arij                          [Import project] [+ New Project] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ 📁 E-commerce   │  │ 📁 CLI Tool     │  │ 📁 Blog Engine  │  │
│  │                 │  │                 │  │                 │  │
│  │ ▰▰▰▰▱▱▱  4/7   │  │ ▰▰▰▰▰▰▱  6/7   │  │ ▰▱▱▱▱▱▱  1/7   │  │
│  │ 🟢 2 agents     │  │ ⚪ idle          │  │ 💡 ideation     │  │
│  │ Updated 2m ago  │  │ Updated 1h ago  │  │ Updated 3h ago  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │ 📁 API Gateway  │  │ + New Project   │                       │
│  │                 │  │                 │                       │
│  │ ✅ done          │  │     ＋          │                       │
│  │ 5 releases      │  │                 │                       │
│  └─────────────────┘  └─────────────────┘                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 11.2 Vue projet — Kanban + Chat

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back    📁 E-commerce App    [Spec] [Docs] [Sessions]        │
├────────────────────────────────────────┬─────────────────────────┤
│                KANBAN                  │       CHAT              │
│                                        │                         │
│  Backlog    To Do    In Progress Done  │  🤖 Based on your docs, │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌───┐  │  I suggest 3 main       │
│  │Auth  │  │Cart  │  │🟢Pay │  │   │  │  epics for the MVP...   │
│  │system│  │& inv │  │ment  │  │   │  │                         │
│  │──────│  │──────│  │──────│  │   │  │  You: Can we split the  │
│  │ 3/5  │  │ 0/4  │  │ 2/3  │  │   │  │  auth into OAuth and    │
│  │ US   │  │ US   │  │ US   │  │   │  │  local auth?            │
│  └──────┘  └──────┘  └──────┘  │   │  │                         │
│  ┌──────┐  ┌──────┐            │   │  │  🤖 Absolutely, here's   │
│  │Admin │  │Search│            │   │  │  the revised plan...     │
│  │panel │  │& filt│            │   │  │                         │
│  │──────│  │──────│            │   │  │                         │
│  │ 0/6  │  │ 0/3  │            │   │  │  ┌─────────────────────┐│
│  └──────┘  └──────┘            └───┘  │  │ Type a message...   ││
│                                        │  └─────────────────────┘│
│  [☐ Select epics]  [▶ Build selected]  │  [Generate Spec & Plan] │
├────────────────────────────────────────┴─────────────────────────┤
│  🟢 Agent #1: Payment epic — writing stripe-service.ts (12s)     │
│  🟢 Agent #2: Auth epic — running tests... (45s)                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## 12. Contraintes et dépendances

| Contrainte | Détail |
|------------|--------|
| **Claude Code installé** | L'app nécessite `claude` dans le PATH, authentifié |
| **Git installé** | Requis pour la gestion des worktrees et branches |
| **Node.js ≥ 20.9** | Requis par Next.js 16 |
| **Espace disque** | Les worktrees Git multiplient l'espace utilisé par projet |
| **Limites souscription** | Le rate limiting de la souscription Claude Pro/Max s'applique |
| **Pas de multi-utilisateur** | V1 est mono-utilisateur, local uniquement |

---

## 13. Métriques de succès (pour l'open source)

- **Adoption** : 100+ stars GitHub dans les 3 premiers mois
- **Utilisabilité** : un nouveau user peut lancer son premier build Claude Code en < 10 minutes
- **Stabilité** : < 1% de sessions Claude Code qui échouent pour des raisons liées à Arij (pas à CC lui-même)
- **Performance** : interface réactive (< 100ms pour les interactions kanban), streaming sans lag perceptible

---

## 14. Risques et mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Claude Code CLI change son format de sortie | 🔴 Élevé | Abstraire le parsing dans un module isolé (`stream-parser.ts`), versionner la compatibilité |
| Rate limiting souscription trop restrictif pour le multi-agent | 🟡 Moyen | Permettre le lancement séquentiel, ajouter un système de file d'attente |
| Anthropic interdit l'usage du CLI par des apps tierces | 🔴 Élevé | Suivre les ToS, prévoir un fallback vers l'Agent SDK + API key |
| Conflits git entre worktrees | 🟡 Moyen | Stratégie de branches isolées par épic, merge conflict detection |
| Complexité du prompt pour la spec generation | 🟡 Moyen | Itérer sur le prompt engineering, permettre à l'utilisateur de customiser le prompt template |
| Import imprécis sur gros projets (mauvais statuts) | 🟡 Moyen | Preview éditable avant validation, score de confiance par épic, possibilité de relancer l'analyse sur un sous-ensemble |

---

## 15. Roadmap

| Phase | Scope | Durée estimée |
|-------|-------|---------------|
| **Phase 1** — MVP Brainstorm & Spec | Création projet, **import projet existant**, upload docs, chat CC plan mode, génération spec, édition manuelle | 3-4 semaines |
| **Phase 2** — Kanban | Board kanban, drag & drop, vue épic détaillée, dashboard multi-projet | 1-2 semaines |
| **Phase 3** — Build Integration | Lancement CC par épic, gestion worktrees/branches, streaming monitoring | 2-3 semaines |
| **Phase 4** — Polish & Release | Releases, changelogs, notifications, documentation, publication npm | 1-2 semaines |
| **V2** | Tests intégrés, preview deployments, templates de prompts, plugins | Futur |

---

## 16. Décisions prises

| Question | Décision |
|----------|----------|
| **Nom du projet** | **Arij** |
| **Format de sortie CC** | JSON (pas de streaming). Polling pour le suivi de statut. |
| **Worktrees vs branches** | **Worktrees** — isolation complète par épic |
| **Persistance des logs** | **Filesystem** (`data/sessions/{id}/logs.json`) — référence en BDD |
| **Templates de prompts** | Pas d'exposition par projet. Un **prompt global** configurable (settings) injecté dans toutes les sessions CC. |
| **Licence** | **MIT** |

---

*Ce document sert de base pour le développement de Arij. Il sera mis à jour au fur et à mesure de l'avancement.*