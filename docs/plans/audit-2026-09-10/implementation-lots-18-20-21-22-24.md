# Réalisation des lots 18, 20, 21, 22 et 24 — 16 septembre 2026

Les modifications sont présentes dans l'arbre de travail, sans commit automatique, aux côtés des autres lots menés sur le dépôt. Le lot 23 (helpers dupliqués) avait été complété le 11 septembre 2026.

---

## Lot 18 — Réglages et cohérence de l'UI partagée

- **#26 (Sélecteurs d'agents)** : Clarification architecturale et documentation des responsabilités respectives de `AgentSelectPill` (barres d'outils, compositeurs chat et desk) et `NamedAgentSelect` (modales et dialogues avec badge de fiabilité par rôle via `useDispatchReliability`).
- **#29 (Sélecteur de langue)** : Intégration du sélecteur bilingue (en/fr) dans `AppearanceBand.tsx` via `SegmentedControl`. La sélection persiste immédiatement `ui_locale` via `PATCH /api/settings` et recharge l'interface avec `router.refresh()`.
- **#30 (Clés sans UI)** : Documentation dans `lib/settings/writable-keys.ts` des 6 clés écrivables dépourvues de surface graphique (`codex_sandbox_mode`, `budget_limit_usd`, `night_mode_default_hour`, `night_mode_default_duration_hours`, `ticket_stalled_threshold_hours`, `agent_output_max_kb`) en tant que paramètres d'automatisation headless / CLI.
- **#31 (WebhooksBand)** : Distinction explicite entre l'absence de projets configurés, l'état de chargement (`loaded`) et l'échec réseau (`fetchFailed`). Unification du type `NotificationWebhook` importé.
- **#33 (Constantes de clés de réglages)** : Centralisation des clés dans `lib/settings/keys.ts`, rompant le couplage direct vers la couche base de données.
- **#34 (Navigation réglages)** : Ajout de la correspondance stricte `exact: true` sur `/settings` et déclaration des sous-onglets `pipeline` et `appearance` dans `lib/piscine/nav.ts`.

---

## Lot 20 — App shell, distribution, docs et CI

- **#137 (Frontières d'erreur & Not Found)** : Mise en place des frontières d'erreur Next.js (`app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `app/projects/[projectId]/error.tsx`). Invocation de `notFound()` sur projet inexistant dans `app/projects/[projectId]/layout.tsx`.
- **#140 (Distribution git-clone)** : Abandon de la promesse `npx arij` au profit exclusif du clone git. `package.json` marqué `"private": true`, champ `files` obsolète retiré, spécifications (`docs/specs.md`) et tests de convention (`proxy-file-convention`, `loopback-binding`) mis à niveau pour honorer le mode package privé.
- **#112 (Structure des composants sessions)** : Suppression du dossier déprécié `components/sessions/`, relocalisation de `SessionOutputStream.tsx` sous `components/session-live/`, extraction des types partagés dans `lib/types/session-files.ts` et `lib/types/prompt-anatomy.ts`.
- **#141 (Documentation & CLAUDE_PATH)** : Nettoyage de la référence obsolète `CLAUDE_PATH` dans `README.md` et alignement des catégories de navigation Piscine.
- **#142 (Pipeline CI)** : Suppression de l'étape morte et des commentaires trompeurs de suppression dans `.github/workflows/ci.yml`.
- **#145 (Barre d'onglets Usage)** : Création de `app/usage/layout.tsx` pour maintenir la continuité visuelle de la barre d'onglets de deuxième niveau.
- **#205 (Architecture & Plans)** : Actualisation de `docs/architecture/ticket-state-machine.md` et `docs/architecture/full-auto-mode.md` ; archivage du plan obsolète du 14 août 2026 sous `docs/plans/archive/`.

---

## Lot 21 — Usage et base de données

- **#2 (Optimisation Usage)** : Élagage de `getUsageReport` dans `lib/usage/aggregate.ts` pour ne retourner que `subscriptions`, `dashboard` et `generatedAt`. Optimisation de `hasCodexSessions` via `EXISTS(SELECT 1 ...)`.
- **#3 (readable_agent_name)** : Remplacement de `readable_agent_name` par `namedAgents.name` pour l'historique de chat, suppression de la colonne et de son index unique dans la migration `0058_lot21_usage_and_db_cleanup.sql`.
- **#4 (Colonnes mortes)** : Suppression des colonnes écrites jamais lues (`epics.github_issue_url`/`state`, `github_issues.imported_at`, `desk_dismissals.dismissed_at`, `provider_usage_snapshots.source_file`, `claude_session_id`) dans le schéma `lib/db/schema.ts` et la migration `0058`. Ajustement de `__tests__/sessions-list-route.test.ts`.
- **#5 (Snapshot Codex)** : Déplacement de `refreshCodexUsageSnapshot` en repli uniquement lors des erreurs dans `app/api/usage/route.ts`.
- **#6 (Index & tickets expédiés)** : Borne temporelle ajoutée sur `getTicketsShipped(since)` et index composite `ticket_activity_log_to_status_created_at_idx` créé.
- **#7 & #8 (Édition budget & index couleur)** : Élimination des éditeurs concurrents de budget et suppression de `projectsHaveColorIndex`.

---

## Lot 22 — i18n : libellés serveur

- **#85 (Clés de statut de merge & refinement)** : Implémentation de `describeMergeBlockerKey` dans `lib/kanban/merge-readiness.ts`, de `titleKey` dans `lib/control-desk/aggregate.ts`, et de `ACTION_COPY_KEYS` dans `components/kanban/RefinementDialog.tsx`.
- **#115 (Formatage d'horodatage)** : Utilisation de `formatDateTime` pour `sampledAt` dans `components/spec/PromptBarRow.tsx`.
- **#182 (Sections du prompt)** : Correspondance `SECTION_KEY_MAP` vers `Shared.promptEstimate.sections.*` dans `components/shared/PromptTokenEstimateView.tsx`.
- **Contrôle i18n** : `npm run i18n:check` passe avec **2 266 clés définies, 2 266 référencées — 0 manquante, 0 orpheline**.

---

## Lot 24 — Configuration d'agents et workshop

- **#149 (Filtrage stats bounce)** : Paramètre de requête `?include=reviewBounce` ajouté dans `app/api/agent-config/stats/route.ts` pour éviter le scan global de `agent_sessions` lorsque seul le taux de rebond est réclamé par `LimitsView.tsx`.
- **#150 (Prompt release_notes)** : Câblage de `resolveAgentPrompt("release_notes", projectId)` dans la génération de changelog (`app/api/projects/[projectId]/releases/route.ts`).
- **#151 & #154 (Handlers partagés & validation stricte)** :
  - Création de `lib/agent-config/provider-routes.ts` et `lib/agent-config/prompt-routes.ts`.
  - Exigence stricte de `namedAgentId` sur `PUT` des providers (rejet 400 si absent).
  - Possibilité de `DELETE` (réinitialisation au builtin) sur le prompt global et projet.
  - Refactorisation des routes API associées sous `app/api/agent-config/` et `app/api/projects/[projectId]/agent-config/`.
- **#155 (Conservation du contexte projet)** : Maintien du paramètre `?project=` lors des changements d'onglets dans `WorkshopHeader.tsx`, prise en charge de `forProject` sur `named-agents` dans `lib/piscine/nav.ts`, et transmission de `projectId` dans `RubricBand.tsx` et `QaScreen.tsx`.

---

## Vérification et conformité

- **i18n** : `npm run i18n:check` validé (2 266 clés, zéro orpheline, zéro manquante).
- **Tests unitaires ciblés** :
  - Suites cibles des lots 18, 20-24 : 11 fichiers, **408 tests passés, 0 échec**.
  - Suites réglages & UI partagée : 23 fichiers, **250 tests passés, 0 échec**.
- **Linting** : `npx eslint` sans erreur sur l'ensemble des fichiers touchés.
