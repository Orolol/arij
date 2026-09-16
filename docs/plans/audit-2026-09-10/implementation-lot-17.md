# Réalisation du Lot 17 — Portage Piscine des îlots restants — 16 septembre 2026

Toutes les modifications ont été effectuées dans l'arbre de travail sans commit automatique.

---

## Synthèse par phase et constat d'audit

### Phase 1 — Suppression de la page story et intégration dans l'overlay (#128, #129, #130)
- **#128 (Suppression page story autonome)** : Suppression de la route `app/projects/[projectId]/stories/[storyId]/page.tsx`, des composants `components/story/StoryDetailPanel.tsx`, `components/story/CommentThread.tsx`, du hook `hooks/useStoryDetail.ts` et du reliquat `components/kanban/InlineEdit.tsx`.
- Intégration complète de la gestion des user stories au sein de `components/ticket/UserStoriesBand.tsx` dans le `TicketOverlay` :
  - Lignes dépliables avec mode édition inline (titre, critères d'acceptation, statut).
  - Suppression sécurisée avec confirmation inline.
  - Composition stricte sur les primitives Piscine (`CheckMark`, `Mono`, `PillButton`, `SelectPill`, `GhostInputPill`).
- **#129 (Remontée des erreurs de transition)** : Les erreurs de validation ou de refus serveur (zod, transitions invalides) sur `PATCH /api/projects/[projectId]/stories/[storyId]` sont désormais affichées directement dans l'interface de la ligne.
- **#130 (Retrait code mort CommentThread)** : Suppression du bouton mort `send-to-dev-button` et retrait du test `__tests__/one-click-send-to-dev.test.tsx`.

### Phase 2 — Portage de la surface Review (#101)
- **#101 (`components/review/*`)** :
  - Remplacement des primitives shadcn (`Button`, `Badge`, `Card`) et des 20 classes de couleurs d'état brutes (`text-green-500`, `bg-green-600`, etc.) par les composants et tokens Piscine (`Stamp`, `PillButton`, `SurfaceCard`, `IdentityChip`).
  - Suppression des props mortes `projectId` et `epicId` dans `components/review/ReviewActions.tsx`.
  - Création de la route `POST /api/projects/[projectId]/epics/[epicId]/review-comments/resolve-all` branchée sur `resolveOpenReviewComments` (`lib/workflow/merge-approval.ts`) et mise à jour de `useReviewComments.resolveAll` pour exécuter la résolution en une seule requête atomique.

### Phase 3 — Refonte de McpServersSection et suppression de SettingsLegacy (#27)
- **#27 (`components/settings/McpServersSection.tsx`)** :
  - Refonte complète de la section en grammaire Piscine (`SurfaceCard`, `BandHeader`, `PillButton`, `SelectPill`, `GhostInputPill`, `Mono`).
  - Migration intégrale du namespace i18n `SettingsLegacy` vers `Settings.mcp.*` dans `lib/i18n/messages/en/Settings.json` et `lib/i18n/messages/fr/Settings.json`.
  - Suppression définitive du fichier et namespace `SettingsLegacy.json`.

### Phase 4 — Refonte de RoutinesSettings et Settings Projet (#73, #204)
- **#73 (`components/routines/RoutinesSettings.tsx`)** :
  - Suppression du `Tabs` à onglet unique et du titre `<h2>` en milieu de page.
  - Remplacement de la saisie JSON brute par des contrôles typés (`NamedAgentSelect`, champs numériques) et suppression de l'exigence de `timeOfDay` pour le type `ci_watch`.
  - Affichage de l'état sans couleur directe (`BreathingDot`, `Mono`, `SurfaceCard`).
- **#204 (`app/projects/[projectId]/settings/page.tsx`)** :
  - Recomposition en grammaire Piscine (`SurfaceCard`, `BandHeader`, `PillButton`, `GhostInputPill`, `Mono`) sans en-tête h2 superflu.
  - Optimisation de `GET /api/settings` acceptant `?keys=...` pour éviter le chargement sans projection de toute la table des réglages.

### Phase 5 — Refonte QA Projet et Transcription Chat (#100, #118)
- **#100 (`app/projects/[projectId]/qa/page.tsx`)** :
  - Projection stricte de `GET /api/projects/[projectId]/qa/reports` : exclusion des gros blobs `reportContent` et `promptUsed`, jointure `agentSessions` pour dériver `sessionStatus`, tri optimisé via `liveCheckSql()` (`lib/qa/check-liveness-sql.ts`), limitation à 50 rapports récents.
  - Gating du polling sur `isCheckLive(report)`.
  - Suppression de l'en-tête propre et recomposition avec les composants Piscine (`PillButton`, `SegmentedControl`, `SurfaceCard`, `BreathingDot`, `Mono`).
  - Ajout de la prop `live` sur `ReportDetail` pour conditionner le polling de détail.
- **#118 (`app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx`)** :
  - Portage en primitives Piscine (`Stamp`, `IdentityChip`, `Mono`, `PillButton`, `SurfaceCard`), suppression de l'usage des couleurs brutes comme état.
  - Traduction des enums `type` et `status` via des tables de clés i18n dédiées.
  - Ajout du lien direct vers `/chat?conversation=${conversationId}`.

### Phase 6 — Portage Git / Import et nettoyage du backlog shadcn (#68, #37)
- **#68 (Surfaces Git et Import)** :
  - `components/github/GitHubConnectBanner.tsx` : `Button` remplacé par `PillButton`.
  - `components/import/FolderSelector.tsx` & `GitHubUrlSelector.tsx` : `Button` remplacé par `PillButton`.
  - `components/import/ImportPreview.tsx` : `Button`, `Badge`, `Card` et couleurs Tailwind brutes remplacés par `PillButton`, `Stamp`, `SurfaceCard`.
  - `app/projects/import/page.tsx` : `Button` et alertes bleu brut remplacés par `PillButton` et encarts sémantiques.
  - `app/projects/[projectId]/git-sync/page.tsx` : Remplacement intégral des instances de `Button` par `PillButton`.
  - `app/projects/[projectId]/github-issues/page.tsx` : Remplacement intégral des instances de `Button` par `PillButton`.
- **#37 (Vérification et décrémentation des importateurs shadcn)** :
  - `ui/button` réduit de 43 fichiers à 20 (strictement cantonné aux dialogues restants, panels chat et formulaires isolés).
  - `ui/badge` réduit de 13 fichiers à 4.
  - 0 import shadcn résiduel sur l'ensemble des écrans et composants dans le périmètre du Lot 17.

---

## Validation et assurance qualité
- `npm run i18n:check` : **0 clé manquante, 0 orpheline** (2259 clés en miroir et référencées).
- `npm run lint` : **0 erreur** (75 warnings tolérés React Compiler / ESLint).
- React Compiler : 346 fichiers / 511 fonctions analysées, **0 bailed**.
- Suite complète de tests unitaires et d'intégration validée.
