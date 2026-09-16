# Lot 04 — Code mort mécanique : fichiers, exports, routes, tokens, restes du board

**Difficulté** 1/4 — Simple — agent peu coûteux
**Findings** 26 (0 fort · 0 moyen · 26 faible ; effort 26 S · 0 M · 0 L)
**Dépendances** Après le lot 01 (notifications) pour ne pas travailler deux fois.

**Statut** fait le 11/09/2026 — 26/26 findings traités, un seul volet reporté
(les champs de `PipelineReviewAssessment`, voir les écarts en bas de ce bloc).
Détail :

- **Fichiers entiers** : `lib/workflow/story-transition.ts` (#18, contournement
  dormant du moteur de transitions), `lib/kanban/filters.ts` +
  `__tests__/kanban-filters.test.tsx`, `lib/kanban/reorder.ts` +
  `__tests__/kanban-review-reorder.test.ts` (#80), `lib/projects/workspace-path.ts`
  + son test (déjà fait au lot 23), `app/piscine-preview/page.tsx` (#38, #138),
  `components/piscine/DeskHeader.tsx`, `components/settings-piscine/SettingsTabSync.tsx`
  (#25), `components/ui/progress.tsx`, `components/ui/separator.tsx`.
- **Exports sans consommateur** : `pipelineReasonTone` + `PipelineReasonTone`,
  `POSITIVE_STRUCTURED_VERDICTS`, `getRoutineScheduler` et le kind de routine
  `dreaming` (#76) ; `appendPromptSections`, `streamOpenAiChatCompletion`,
  `estimatePromptTokens` (#179) ; `readMemberCliOptions`, `ResolvedAgentConfig`,
  `setCompositeMembers` (#157) ; le ré-export de verdict de `findings.ts`,
  `readStructuredReviewVerdict` et `parseLocation` (#224) ; les ré-exports morts de la façade
  `prompt-builder` et les constantes internes de `prompt-sections` /
  `untrusted` (#215) ; l'alias `collectFailureEvidence`, les constantes
  `TELESCOPE_*` orphelines et les deux normaliseurs internes de telescope
  (#203) ; `ResolvedAgentConfig` et les sur-exports MCP `mcpServerSecrets` /
  `McpServerSecrets` (#157, #203 — `validateMcpServerShape` et
  `McpServerShape` passent en privés) ; le logger NDJSON (#176, écriture disque
  non bornée sans lecteur ni rétention — la redaction `redactMcpToken` part avec
  lui, et `data/logs/` a été purgé).
- **Routes orphelines** : `app/api/dashboard/summary/route.ts` (#87, avec son
  test), `app/api/projects/[projectId]/dependencies/route.ts` +
  `getProjectDependencies` (#83). La route sœur
  `dependencies/transitive` **reste** (consommée par
  `useBatchSelection` / `NightRunDialog`) — elle a d'ailleurs été restaurée par
  erreur pendant le lot, vérifiée, et son test repasse.
- **Résidus du board** (#80) : `buildDependencyAdjacency`,
  `buildDependencyFocus`, `dependencyFocusRole`, `computeReadiness` (`queue.ts`),
  `isMergeReady`, `isMergeReadyEpic`, `MergeReadinessCarrier`, `sortMergeColumn`
  (`merge-readiness.ts`), les filtres d'`activity-feed.ts`,
  `isTicketTransitionSelectable`, et les types `DRAGGABLE_COLUMNS`,
  `PRIORITY_COLORS`, `KanbanEpic`, `KanbanAgentActionType`,
  `KanbanEpicAgentActivity`, `ReleaseGroup`, `BoardState`, `ReorderItem`,
  `BuildableStatus`, `DeliveredStatus`. `compareExecutionOrder`,
  `computeBlockedBy`, `computeQueueRanks`, `evaluateMergeReadiness`,
  `buildActivityFeed`, `isLongComment`, `commentPreview`, `ticketStatusOptions`
  et `isDeliveredStatus` sont vivants et conservés.
- **Tokens et primitives** (#32, #36) : `--sidebar-*` et `--chart-1..5` retirés
  d'`app/globals.css` (`--chart-fail` conservé), `STRATUM`,
  `STRATUM_MOTION_CLASS`, `MONO_TONE` retirés, `SETTINGS_INVENTORY`,
  `SETTING_FIELD_KEYS`, `SettingsTab`, `SettingsInventoryEntry` retirés avec le
  commentaire qui promettait un test inexistant.
- **Config fantôme** (#38, #138) : `eslint.config.mjs`,
  `scripts/i18n/check-keys.mjs`, `lib/i18n/catalogue.ts` et `docs/specs.md` ne
  référencent plus `app/_piscine-preview/` ni le harnais.
- **Divers** : `session:progress` retiré du bus et du handler (#20, #116, #143),
  les émetteurs `epicId: ""` passent par `emitProjectSessionStarted` ;
  `arijActionsUnavailable` est désormais **lu** (bandeau dans la vue live) au
  lieu d'être un champ mort ; `GET /api/projects` ne calcule plus que
  `activeAgents` et `DashboardProject` perd les cinq compteurs + `lastSessionAt`
  (#64) ; les champs jamais lus de `NightRunDetail` disparaissent (#23) ainsi
  que `resolveDreamingAfterNightRunDefault` ; la couture `renderPanel` de
  `TicketOverlayProvider` est supprimée (#123) ; les branches OpenCode/Gemini de
  `json-parser` et les défauts « pi » de `PiProvider` (base rendue abstraite)
  partent (#178, #177, #183) ; `lib/chat/epic-proposals.ts` documente qu'il n'est
  qu'un dédoublonnage serveur (#196).

**Écarts assumés** (à ne pas re-lister comme oubli) :

- Routes et lib des **artefacts de session** conservés : le lot 03 les rétablit.
- `countAgentReviewCommentsSince`, `readReviewChannelState`,
  `isNegativeProseVerdict`, `NEGATIVE_VERDICT_SUBSTRINGS` conservés : coutures de
  test de contrats de parsing, coût bundle nul. En revanche
  `readStructuredReviewVerdict` (test-only) et le ré-export du vocabulaire de
  verdict sont bien retirés — tout le monde importe `lib/review/verdict`
  directement.
- **#224, volet « champs de `PipelineReviewAssessment` » : reporté.** Les quatre
  champs que le runner ne lit pas (`agentCommentCount`, `usedProseFallback`,
  `verdictSource`, `structuredVerdict`) ne sont pas retirés ici : le type est la
  frontière entre `stage-review` et le runner, et c'est exactement la règle de
  poids des findings que les lots 13 et 16 doivent trancher (le README le note
  déjà). Les retirer maintenant reviendrait à figer une décision qui leur
  appartient.
- `requireChatToolsetToken` et `lib/mcp/user-global-sync.ts` sont **intacts** :
  l'annexe les classait « tests seuls » à tort, le premier est la garde de
  sécurité du canal chat. De même `CollectFailureEvidenceOptions` garde ses
  neuf options : seule la sur-exportation a été traitée, pas le câblage d'un
  réglage de budget de prompt (piste distincte).
- `ProviderType` / `AgentProvider` non fusionnés : le second nomme aussi
  l'interface du contrat provider (`lib/providers/index.ts`), un alias
  changerait le sens de cet import. Seuls les commentaires périmés sont
  corrigés.
- `breakerThreshold` / `costCapUsd` restent sur `NightRunSnapshot` (état du
  registre, lu par le moteur) ; seul le **détail servi** les perd.
- Le fix SIGKILL (#171) n'est pas touché : il appartient au lot 14.
- Les contrôles « fichiers de config/CI » et les deux configs qui n'existaient
  pas (`next.config.ts`, `proxy.ts`) sont hors périmètre.

## Décision

Supprimer sans discussion tout ce qui est prouvé sans consommateur. Exception : tout ce qui touche aux artefacts de session (lot 03) reste.

## Objectif

Retirer les fichiers entiers morts, les exports runtime sans importeur, les routes orphelines (dashboard/summary, dependencies, git/connect et detect-remote sont dans le lot 12), les tokens CSS, le harnais piscine-preview, les restes OpenCode/Gemini/pi, l'événement session:progress. Retirer aussi le mot-clé `export` des types morts listés par l'inventaire (annexe) sans supprimer les déclarations utilisées en interne.

## Démarche suggérée

1. Utiliser la liste des exports morts de l'inventaire (annexe en bas de ce fichier) comme check-list, vérifier chaque symbole par rg avant suppression (l'inventaire est conservateur : « 0 occurrence dans 1 585 fichiers » est une preuve forte, « importé seulement par des tests » demande un arbitrage).
2. Supprimer d'abord les fichiers entiers, puis les exports, puis relancer tsc pour attraper les importeurs de tests.
3. Retirer devDependencies `vite` et `shadcn` (package.json + package-lock via npm install --package-lock-only) et vérifier __tests__/lockfile-install-consistency.test.ts.
4. Retirer le réglage orphelin clone_timeout_ms (constantes + parseCloneTimeoutSetting) ou le brancher dans clone.ts.
5. npm test ; npm run lint.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #18 — lib/workflow/story-transition.ts : toujours orphelin, et c'est un contournement dormant du moteur de transitions

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `lib/workflow/story-transition.ts:1-126`
- `lib/workflow/story-transition.ts:86`
- `lib/workflow/story-transition.ts:120`
- `lib/workflow/transition-service.ts:247`
- `docs/architecture/ticket-state-machine.md:3-9`

**Constat**

Confirmé « toujours ouvert » : le fichier (126 lignes) n'a aucun importeur dans le dépôt hors docs. L'implémentation vivante d'`applyStoryTransition` est celle de transition-service.ts, utilisée par automatic-transitions.ts, les routes user-stories/approve et lib/sync/import.ts. Le doublon est plus qu'inutile : il écrit `userStories.status` et `epics.status` directement (l.86, l.120) sans passer par `validateTransition`, sans log d'activité ni événement, ce que ticket-state-machine.md interdit explicitement (« transition-service.ts is the only module that writes an existing epic/story status »). S'il est un jour réimporté par un outil MCP (son commentaire d'en-tête le destine à update_ticket_status), il réintroduira le bypass que l'audit B-arij-104 a fermé.

**Précision du vérificateur**

lib/workflow/story-transition.ts (126 l., dernier commit a26454ee) est présent dans l'arbre de travail et n'a strictement aucun référent dans le dépôt — ni code, ni test, ni documentation (le grep « story-transition » ne renvoie rien du tout, contrairement à « hors docs » annoncé). L'`applyStoryTransition` vivant est celui de lib/workflow/transition-service.ts:247, utilisé par automatic-transitions.ts, app/api/projects/[projectId]/user-stories/route.ts:103 et lib/sync/import.ts:162. Le doublon mort écrit `userStories.status` (l.84-88) et `epics.status` (l.118-122) en direct, sans validateTransition, sans log d'activité ni événement board, alors que docs/architecture/ticket-state-machine.md:3-9 pose transition-service.ts comme unique écrivain de statut : réimporté par un outil MCP (son en-tête le destine à `update_ticket_status`), il rouvrirait le bypass. Correction de la recommandation : il n'existe aujourd'hui aucun test de couverture des « écrivains de statut » pinnant transition-service.ts:139,217 (`grep -rln "transition-service.ts" __tests__` → rien ; automatic-transition-invariants.test.ts ne fait que des écritures de fixtures) — l'invariant « aucun autre module de lib/workflow ne fait update(userStories|epics).set({ status » serait à créer, pas à étendre.

**Recommandation**

Supprimer le fichier et ajouter au test de couverture des écrivains de statut (celui qui pin `transition-service.ts:139,217`) une assertion qu'aucun autre module de lib/workflow ne fait `update(userStories).set({ status` / `update(epics).set({ status`.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'story-transition' --glob '!node_modules' --glob '!docs/**' .` → aucun résultat. story-transition.ts:84-88 `database.update(userStories).set({ status: toStatus }).where(eq(userStories.id, storyId)).run();` et l.118-122 `database.update(epics).set({ status: "review", … })` sans appel à validateTransition/applyTransition. ticket-state-machine.md:3-5 : « lib/workflow/transition-service.ts is the only module that writes an existing epic/story status ».

</details>

### #20 — `session:progress` est déclaré et abonné mais jamais émis ; des `session:started` partent avec epicId vide

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `lib/events/bus.ts:16`
- `app/projects/[projectId]/page.tsx:76`
- `components/desk/LiveSessionCard.tsx:25`
- `components/qa/QaRunCard.tsx:26-27`
- `lib/workflow/dreaming.ts:1000`
- `lib/workflow/memory-distill.ts:597-602`

**Constat**

Le type d'événement `session:progress` existe dans le bus et la page projet s'y abonne pour déclencher un refresh, mais aucun émetteur n'existe — deux composants du desk le constatent dans leurs commentaires et rendent une barre indéterminée à la place. Par ailleurs dreaming.ts et memory-distill.ts émettent `session:started` avec `epicId: ""` (chaîne vide au lieu d'omettre le champ optionnel), ce que le type `TicketEvent.epicId?: string` ne prévoit pas ; le consommateur actuel ne fait que bump un compteur, donc c'est bénin aujourd'hui, mais tout futur consommateur qui filtre sur epicId truthy/défini se comportera différemment selon l'émetteur.

**Précision du vérificateur**

`session:progress` est déclaré dans `TicketEventType` (lib/events/bus.ts:16) et abonné par la page projet (app/projects/[projectId]/page.tsx:76), mais aucun émetteur n'existe dans app/, components/, hooks/, lib/, ni dans les tests : les seuls `eventBus.emit` sont le helper lib/events/emit.ts:14 (9 types nommés, sans progress), dreaming.ts:1007/1089, memory-distill.ts:609/667 et les routes memory (completed/failed/memory:changed). Le handler de page.tsx:76 est donc mort ; LiveSessionCard.tsx:24-26 et QaRunCard.tsx:26-28 le documentent et rendent une barre indéterminée à dessein. Par ailleurs `emitSessionStarted` (emit.ts:78, `epicId: string` non optionnel) est appelé avec `""` par dreaming.ts:1000 et memory-distill.ts:597-602, alors que `TicketEvent.epicId` est optionnel et que les autres helpers project-level passent `undefined` ; via `JSON.stringify` (events/route.ts:47) la chaîne vide est sérialisée là où `undefined` serait omis. Sans effet aujourd'hui : le seul consommateur de `session:started` (page.tsx:73) bump un compteur, et les seuls handlers lisant `event.epicId` (useTicketOverlayData.ts:251, useEpicDetail.ts:123) portent sur `ticket:updated`.

`session:progress` est déclaré dans l'union `TicketEventType` (lib/events/bus.ts:16) et abonné par la page projet (app/projects/[projectId]/page.tsx:76) mais aucun émetteur n'existe : les 7 `eventBus.emit` directs ont tous un type littéral (`session:completed`/`session:failed`/`memory:changed`) et aucun helper de lib/events/emit.ts ne l'émet ; LiveSessionCard.tsx:25 et QaRunCard.tsx:26 le documentent et rendent une barre indéterminée. Par ailleurs dreaming.ts:1000 et memory-distill.ts:599 émettent `session:started` avec `epicId: ""` — imposé par la signature `emitSessionStarted(…, epicId: string, …)` (emit.ts:80) alors que `TicketEvent.epicId?: string` et le `emit()` interne acceptent `undefined` — tandis que les `session:completed`/`session:failed` des mêmes émetteurs (dreaming.ts:1007-1015, memory-distill.ts:609-617) omettent `epicId`. Bénin aujourd'hui : les deux abonnés à `session:started` (page.tsx:73 bump de compteur ; MemoryPanel.tsx:236 lit `data.agentType`) ne lisent pas `epicId`, et les seuls filtres `event.epicId ===` du code (useEpicDetail.ts:123, useTicketOverlayData.ts:251) portent sur `ticket:updated`. Correctif : retirer `session:progress` du type et de l'abonnement (ou l'émettre réellement), et élargir le paramètre `epicId` de `emitSessionStarted` à `string | undefined` pour passer `undefined` dans les deux émetteurs project-level.

**Recommandation**

Retirer `session:progress` du type et de l'abonnement (ou l'émettre depuis le process-manager si une progression existe). Passer `undefined` plutôt que `""` dans les deux émetteurs project-level, ou ajouter une surcharge `emitProjectSessionStarted(projectId, sessionId, agentType)`.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'session:progress' app components hooks lib` → bus.ts:16 (déclaration), page.tsx:76 (abonnement), LiveSessionCard.tsx:25 « `session:progress` is declared in lib/events/bus.ts and NOTHING … », QaRunCard.tsx:26 — aucun `emit("session:progress"`. dreaming.ts:1000 `emitSessionStarted(input.projectId, "", sid, DREAMING_AGENT_TYPE)` ; memory-distill.ts:598 `sourceContext?.epicId ?? ""`.

</details>

### #23 — Champs de NightRunDetail jamais rendus et helper `resolveDreamingAfterNightRunDefault` orphelin

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `lib/night/constants.ts:127-172`
- `lib/night/summary.ts:118-145`
- `components/night/NightRunSummaryDialog.tsx:96-123`
- `components/night/NightRunSummaryDialog.tsx:274-320`
- `lib/workflow/dreaming-constants.ts:125-140`
- `lib/workflow/dreaming.ts:718-730`

**Constat**

GET /build/night-runs/[runId] calcule pour chaque epic `pipelineRunId`, `sessionIds` (avec un GROUP BY côté summary.ts) et pour le run `breakerThreshold` / `costCapUsd` ; NightRunSummaryDialog ne lit que counts, totalWaves, currentWave, failurePolicy, costIsPartial, abortReason/abortedAtWave, interrupted, stopRequested, et par epic readableId/title/status/reason/costUsd. Les quatre champs sont donc transportés pour rien (le morning summary ne dit pas quel breaker/cap était en vigueur ni ne lie vers les sessions du run). Par ailleurs `resolveDreamingAfterNightRunDefault` (dreaming-constants.ts:125) n'a aucun appelant dans tout le dépôt — la version serveur `isDreamingAfterNightRunEnabled` (dreaming.ts) fait le même travail, et le NightRunsBand n'affiche que la clé globale.

**Précision du vérificateur**

Le fond est confirmé : `pipelineRunId`, `sessionIds`, `breakerThreshold` et `costCapUsd` sont calculés et transportés par GET /build/night-runs/[runId] sans aucun lecteur (NightRunSummaryDialog, seul consommateur du detail, ne les touche pas), et `resolveDreamingAfterNightRunDefault` (lib/workflow/dreaming-constants.ts:125-140) n'a aucun appelant dans le dépôt. Deux corrections de détail : (a) il n'y a PAS de « GROUP BY côté summary.ts » pour les epics — le regroupement est un Map JS, `groupSessionsByEpic` (lib/night/summary.ts:107-130) ; le seul `.groupBy()` SQL du fichier est ligne 310, dans `listNightRuns`, et n'a rien à voir. De plus ce helper reste nécessaire même si l'on retire `sessionIds` : il calcule aussi `costUsd` et `last` (statut) — seul le `entry.sessionIds.push(row.id)` de la ligne 123 disparaîtrait. (b) La référence « lib/workflow/dreaming.ts:718-730 » est périmée dans l'arbre de travail : `isDreamingAfterNightRunEnabled` vit désormais dans le fichier non suivi lib/workflow/dreaming-settings.ts:82 et est simplement ré-exporté par dreaming.ts:77.

**Recommandation**

Soit afficher breaker/cap dans la ligne de méta du dialogue et faire de chaque epic un lien vers sa dernière session (sessionIds.at(-1)), soit retirer ces champs du contrat et le GROUP BY correspondant. Supprimer resolveDreamingAfterNightRunDefault.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'breakerThreshold|costCapUsd|pipelineRunId|sessionIds' app components hooks` : seuls hits hors route build = hooks/usePipelineRuns.ts (autre objet) et NightRunDialog (envoi). NightRunSummaryDialog.tsx lit `detail.counts`, `detail.totalWaves`, `detail.currentWave`, `detail.failurePolicy`, `detail.costIsPartial`, `detail.abortReason`, `detail.interrupted`, `epic.readableId|title|status|reason|costUsd` uniquement. `rg -n resolveDreamingAfterNightRunDefault .` → uniquement sa déclaration dreaming-constants.ts:125.

</details>

### #25 — SettingsTabSync est mort : plus aucun lien `/settings?tab=` n'existe, la nav utilise des ancres `#`

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `components/settings-piscine/SettingsTabSync.tsx:7-42`
- `app/settings/layout.tsx:53-57`
- `lib/piscine/nav.ts:176-198`
- `components/settings-piscine/SettingsSection.tsx:9-20`
- `__tests__/top-bar.test.tsx:305-311`

**Constat**

`components/settings-piscine/SettingsTabSync.tsx` est monté par `app/settings/layout.tsx:56` pour traduire `?tab=night|notifications|integrations` en scroll/redirect. Or `lib/piscine/nav.ts:189-198` émet `/settings#night-runs`, `/settings#notifications` et `/settings/integrations` (hash et route, jamais de query), et `__tests__/top-bar.test.tsx:308-310` épingle exactement ces chaînes. Aucun producteur de `?tab=` n'existe dans app/, components/, lib/, hooks/, __tests__/ ni e2e/ (seuls hits : des URLs GitHub `?tab=readme-ov-file`). L'effet du composant ne se déclenche donc jamais hors URL tapée à la main ; aucun test ne le couvre. Les commentaires qui le justifient sont périmés : SettingsTabSync.tsx:7-12 (« nav.ts ships /settings?tab=night… »), SettingsSection.tsx:9 et :20 (« Anchor target for /settings?tab=… »), nav.ts:178-181 (« 11c is ONE page with sections; ?tab= names the section »).

**Précision du vérificateur**

`components/settings-piscine/SettingsTabSync.tsx` est bien du code mort en pratique : plus aucun producteur d'URL `/settings?tab=` n'existe dans le produit. Deux imprécisions de numérotation seulement : le montage dans `app/settings/layout.tsx` est ligne 61 (pas 56, l'import étant ligne 5), et l'ancre notifications est `components/settings-piscine/NotificationsBand.tsx:44` (pas 47). Nuance de fond : le composant reste fonctionnel pour une URL `?tab=` tapée à la main ou en favori (héritée de l'ancienne page unique) — la redirection `?tab=integrations` → `/settings/integrations` est le seul comportement non couvert par une ancre native ; supprimer le composant casse ces anciens favoris, sauf à le remplacer par un `redirect()` serveur comme le recommande l'auditeur.

**Recommandation**

Supprimer SettingsTabSync.tsx, son export dans settings-piscine/index.ts:38, le `<Suspense>` du layout, et réécrire les trois commentaires (`?tab=` → `#ancre`). Si l'on tient à garder la redirection `?tab=integrations` pour d'anciens favoris, la remplacer par un `redirect()` dans le layout serveur plutôt qu'un effet client.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '\?tab=' app components lib hooks __tests__ e2e` → seuls hits produit : les commentaires de SettingsTabSync.tsx, SettingsSection.tsx, nav.ts:178/229 et lib/git/github-url.ts (URL GitHub). `rg -l SettingsTabSync __tests__ e2e` → vide. nav.ts:189 `href: "/settings#night-runs"`, :194 `href: "/settings#notifications"`. L'ancre native fonctionne déjà : NightRunsBand.tsx:42 `<SettingsSection id="night-runs">`, NotificationsBand.tsx:47 `id="notifications"`.

</details>

### #32 — SETTINGS_INVENTORY (37 entrées) et sa garde annoncée n'existent que sur le papier ; STRATUM, STRATUM_MOTION_CLASS, MONO_TONE, SETTING_FIELD_KEYS, ui/progress et ui/separator sont morts

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `components/settings-piscine/settings-fields.ts:434`
- `components/settings-piscine/settings-fields.ts:447-503`
- `components/settings-piscine/index.ts:44-56`
- `lib/piscine/tokens.ts:45-98`
- `components/piscine/Mono.tsx:44`
- `components/piscine/index.ts:54`
- `components/piscine/index.ts:152-153`
- `components/ui/progress.tsx`
- `components/ui/separator.tsx`

**Constat**

Vérifié un par un sur l'arbre de travail : `SETTINGS_INVENTORY` (settings-fields.ts:467-503) et `SETTING_FIELD_KEYS` (:434) n'ont que leur déclaration et leur re-export dans index.ts:46-47 ; le commentaire :459-466 promet `__tests__/settings-inventory.test.tsx`, fichier absent et sans historique git. J'ai contrôlé que les 32 `testId` de la table existent bien dans les bandes (chaque id a ≥2 occurrences dans settings-piscine/ + app/settings/) : la table est exacte aujourd'hui mais rien ne l'exerce, donc la disparition silencieuse d'un réglage — le risque qu'elle prétend couvrir — n'est pas détectée. `STRATUM` (lib/piscine/tokens.ts:45, ~44 l.), `STRATUM_MOTION_CLASS` (:90) et `MONO_TONE` (Mono.tsx:44) n'ont aucun usage hors déclaration + barrel. `components/ui/progress.tsx` et `components/ui/separator.tsx` ont 0 importeur produit et test.

**Précision du vérificateur**

La table `SETTINGS_INVENTORY` compte **32** entrées (pas 37) et `SETTING_FIELD_KEYS` en dérive 26 depuis `SPECS`. À cette correction près le finding tient : `SETTINGS_INVENTORY` (settings-fields.ts:467-503) et `SETTING_FIELD_KEYS` (:434) n'ont que leur déclaration et leur re-export (settings-piscine/index.ts:46-47) ; le commentaire :458-466 promet `__tests__/settings-inventory.test.tsx`, fichier absent de l'arbre et de tout l'historique git. Les 32 testId correspondent bien à des contrôles réels des bandes, mais rien ne les vérifie. `STRATUM` (lib/piscine/tokens.ts:45), `STRATUM_MOTION_CLASS` (:90) et `MONO_TONE` (components/piscine/Mono.tsx:44) n'ont aucun consommateur hors déclaration + barrel (piscine/index.ts:54 et :152-153) — `MONO_TONE_CLASS`, lui, reste vivant. `components/ui/progress.tsx` et `components/ui/separator.tsx` ont zéro importeur produit ou test, et il n'existe pas de barrel `components/ui/index.ts`. Aucun de ces fichiers n'est déjà supprimé par la rationalisation UI en cours (`git status --porcelain` vide sur eux).

**Recommandation**

Écrire le test promis (rendre les 3 pages avec un fetch stubé, `getByTestId` sur chaque entrée) — c'est une vingtaine de lignes et la table existe déjà ; sinon supprimer table, types `SettingsTab`/`SettingsInventoryEntry` et le commentaire. Supprimer STRATUM/STRATUM_MOTION_CLASS/MONO_TONE (ou les consommer dans BreathingDot/ProgressTrack à la place des classes en dur), et les deux fichiers ui/.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -nw 'STRATUM|STRATUM_MOTION_CLASS|MONO_TONE|SETTING_FIELD_KEYS|SETTINGS_INVENTORY' app components hooks lib __tests__ e2e` (hors commentaires) → uniquement les déclarations et les lignes de barrel. `ls __tests__/settings-inventory*` → absent. Boucle `rg -c "\"<testId>\"" components/settings-piscine app/settings` sur les 32 ids → tous ≥ 2. `rg -l 'ui/progress"|ui/separator"' app components hooks lib __tests__ e2e` → 0.

</details>

### #36 — Tokens `--sidebar-*` (rail retiré) et `--chart-1..5` déclarés dans globals.css sans aucun consommateur

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `app/globals.css:22-33`
- `app/globals.css:235`
- `app/globals.css:247-258`
- `app/globals.css:356`

**Constat**

`app/globals.css` déclare 7 entrées `--color-sidebar*` dans `@theme inline` (l.22-28), `--sidebar` en jour et nuit (l.235, 356) plus 6 alias `--sidebar-*` (l.253-258), et 5 `--color-chart-1..5` (l.29-33) avec 5 alias (l.247-251). Le rail gauche a été retiré (« There is no left rail », CLAUDE.md ; TopBar.tsx:55-57). Aucune utilité `bg-sidebar`/`text-sidebar-*`/`chart-N` n'est émise nulle part : le seul hit « sidebar » hors CSS est un commentaire (RepoStrataBand.tsx:17) ; `--chart-fail` est utilisé, `--chart-1..5` non. 34 lignes de palette maintenues en double thème pour rien.

**Précision du vérificateur**

`app/globals.css` (seul fichier CSS du dépôt, non touché par la rationalisation UI) porte deux palettes sans consommateur. Sidebar — vestige du rail gauche retiré (« There is no left rail », CLAUDE.md ; `components/piscine/TopBar.tsx:58`) : 8 entrées `--color-sidebar*` dans `@theme inline` (l.23-30), `--sidebar: #f4efe0` en jour (l.225) et `--sidebar: #26251f` en nuit (l.349), plus 7 alias `--sidebar-*` (l.243-249). Chart : 5 entrées `--color-chart-1..5` (l.31-35) et leurs 5 alias (l.238-242). Aucune utilité `bg-sidebar`/`text-sidebar-*`/`chart-N` n'est émise : les 4 hits « sidebar » hors CSS sont des commentaires (`RepoStrataBand.tsx:18`, `usePanelLayout.ts:98`, `agent-initials.ts:10`, `TopBar.tsx:58`), et le seul test qui cite `.bg-sidebar` (`__tests__/project-layout-chat-cutover.test.tsx:251`) en assert l'absence. `--chart-fail` (l.93, 222, 346), lui, est vivant (`FilesTouchedCard.tsx:64`, `CappedBarChart.tsx:98`, `piscine-preview/page.tsx:951`) et doit rester — attention, `--chart-2: var(--chart-fail)` est le seul lien entre les deux blocs. ~25 lignes mortes, pas 34. À noter : les 13 entrées `@theme inline` ne coûtent rien à la sortie (inline = substituées dans les utilitaires, jamais émises telles quelles) ; le poids réel est les 14 déclarations de `:root`/`.dark`. Purement de l'hygiène, aucun risque fonctionnel.

**Recommandation**

Supprimer les blocs sidebar et chart-1..5 (garder `--chart-fail`). Les rôles hérités `--band/--meta/--agent/--priority-*` restent vivants (24/18/19 fichiers, PRIORITY_COLORS dans lib/types/kanban.ts) — ne pas les toucher.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '\b(bg|text|border|ring)-sidebar' app components hooks lib` → 1 hit, un commentaire. `rg -l 'chart-[1-5]' app components hooks lib --glob '!lib/i18n/messages/**'` → app/globals.css seulement ; `rg -n 'chart-1|--chart' components app lib --glob '!app/globals.css'` → uniquement `var(--chart-fail)`. `rg -c sidebar app/globals.css` → 17.

</details>

### #38 — app/piscine-preview (1 074 l.) reste une route de production et est le seul consommateur restant de DeskHeader

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `app/piscine-preview/page.tsx:1-60`
- `app/piscine-preview/page.tsx:851-867`
- `components/piscine/DeskHeader.tsx`
- `components/piscine/index.ts:96-101`
- `docs/specs.md:798`
- `lib/i18n/catalogue.ts:89-90`

**Constat**

Toujours présent dans l'arbre, vérifié : `app/piscine-preview/page.tsx:12-17` prétend re-exporter `app/_piscine-preview/` (dossier inexistant) et demande sa suppression « when the redesign lands » ; `docs/specs.md:798` le documente comme route ; `lib/i18n/catalogue.ts:90` l'exempte du catalogue (copie française en dur). Fait nouveau par rapport à l'inventaire : `components/piscine/DeskHeader.tsx` n'a AUCUN consommateur produit hors ce harnais (`rg DeskHeader app components` → piscine-preview/page.tsx:33/857 et deux commentaires), alors que le barrel le décrit comme « on its way out » (index.ts:98-100). Supprimer le harnais rend DeskHeader mort ; le garder maintient une page 404-prone (nav vers 4 sous-routes absentes, l.879-883) accessible à tout utilisateur.

**Précision du vérificateur**

`app/piscine-preview/page.tsx` (1 074 l., suivi et intact dans l'arbre) est livré comme route de production : pas de middleware.ts, pas de `notFound()`, aucune exclusion dans next.config.ts. Son en-tête (l.12-17) est PÉRIMÉ : il prétend re-exporter `app/_piscine-preview/`, dossier qui n'existe pas — le harnais entier est inline dans ce fichier. Trois configs pointent encore ce dossier fantôme (eslint.config.mjs:51, scripts/i18n/check-keys.mjs:79, le commentaire l.12). La route est documentée (docs/specs.md:539, :798) et exemptée du catalogue i18n (lib/i18n/catalogue.ts:89-90, copie française en dur). Elle expose un `UnderlineTabNav` (l.878-885) vers 4 sous-routes inexistantes (/piscine-preview/spec|agents|releases|usage). `components/piscine/DeskHeader.tsx` n'a aucun consommateur produit hors ce harnais (index.ts:91-92 l'exporte et :97 le dit « on its way out » ; WorkshopHeader.tsx:15 n'est qu'un commentaire) — son seul autre consommateur est un test, __tests__/piscine-testid-forwarding.test.tsx:20,286-305, à supprimer avec lui.

**Recommandation**

Supprimer app/piscine-preview/page.tsx, DeskHeader.tsx et ses exports (index.ts:96-101), la ligne docs/specs.md:798 et l'exemption catalogue.ts:90 ; si un harnais reste utile, le mettre sous `app/_dev/` (dossier privé) ou derrière `process.env.NODE_ENV !== "production"` via `notFound()`.

<details><summary>Preuve relevée par l'auditeur</summary>

`ls app/ | grep piscine` → seulement `piscine-preview`. `rg -n 'DeskHeader' app components --glob '*.tsx' | grep -v components/piscine/` → app/piscine-preview/page.tsx:33, :195, :198, :851-867 et le commentaire WorkshopHeader.tsx:15. `rg -l 'shared/../DeskHeader|DeskHeader' components/desk` → 0.

</details>

### #64 — GET /api/projects calcule cinq agrégats par projet (epicCount, epicsDone/InProgress/Review/Released, lastSessionAt) que personne ne lit

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `app/api/projects/route.ts:14-93`
- `lib/types/dashboard.ts:11-22`
- `hooks/useProjects.ts:18-20`
- `components/piscine/TopBar.tsx:268`

**Constat**

La route construit trois sous-requêtes groupées (epic_counts avec quatre SUM(CASE), active_agent_counts, last_session_times avec normalisation ISO) et les joint à chaque projet. Sur les sept champs dérivés, seul activeAgents est consommé (TopBar.tsx:268,745). Les autres sont déclarés dans DashboardProject (lib/types/dashboard.ts) avec des commentaires « column » hérités du board, mais aucun composant ne les affiche depuis la disparition du dashboard. Coût : trois GROUP BY sur epics/agent_sessions à chaque lecture (TopBar au montage, ScopeSwitcher, NewTicketView, settings).

**Précision du vérificateur**

GET /api/projects (app/api/projects/route.ts:14-91) construit trois sous-requêtes agrégées (epic_counts : COUNT + quatre SUM(CASE) ; active_agent_counts ; last_session_times avec normalisation ISO) et les joint par trois leftJoin à chaque projet. Sur les sept champs dérivés, un seul est lu : activeAgents (components/piscine/TopBar.tsx:268 et 745). Les SIX autres — epicCount, epicsDone, epicsInProgress, epicsReview, epicsReleased, lastSessionAt — n'ont aucun consommateur : ils ne vivent que dans lib/types/dashboard.ts:11-21 (commentaires « column » hérités du board) et dans la route ; aucune carte projet ne subsiste (rg ProjectCard → 0, hooks/useDashboardSummary.ts supprimé dans l'arbre). Coût : deux GROUP BY superflus (epics, agent_sessions) à chaque lecture — une lecture au montage, pas un poll (useProjects passe intervalMs=null à usePolledResource) — via TopBar/TopBarMenu/ScopeSwitcher/NewTicketView et app/settings/page.tsx:70 (qui ne lit que list.length). À noter pour la remédiation : __tests__/projects-route.test.ts:103-105 et 116-153 épingle mécaniquement les trois leftJoin/groupBy et la présence des sept clés, justifiés par « the redesigned project card renders » — un test-garde à retirer en même temps que les champs.

**Recommandation**

Réduire la projection à activeAgents (une seule sous-requête) et retirer les cinq champs de DashboardProject, ou déplacer ces compteurs vers /api/control-desk qui a déjà ses propres agrégats.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'epicsDone|epicsInProgress|epicsReview|epicsReleased|lastSessionAt|epicCount' components hooks app hors app/api → uniquement TopBar activeAgents (l.268, 745) et FullAutoProjectRow (activeAgents, autre source) ; aucune occurrence des cinq autres champs. rg '"/api/projects"' → useProjects.ts:19, settings/page.tsx:70, new/page.tsx, import/page.tsx.

</details>

### #76 — Exports morts vérifiés dans le périmètre : pipelineReasonTone, POSITIVE_STRUCTURED_VERDICTS, getRoutineScheduler, et le kind de routine `dreaming` qui ne peut jamais exister

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** pipeline-routines

**Fichiers**
- `lib/pipeline/constants.ts:279-287`
- `lib/pipeline/findings.ts:272`
- `lib/routines/scheduler.ts:334-336`
- `lib/routines/constants.ts:8-14`
- `lib/routines/actions.ts:260-261`
- `lib/db/schema.ts:52`

**Constat**

lib/pipeline/constants.ts:279-287 `PipelineReasonTone`/`pipelineReasonTone` : zéro occurrence hors du fichier ; l'overlay rend les lignes pipeline sans tonalité (components/ticket/derive.ts:375-379). lib/pipeline/findings.ts:272 `POSITIVE_STRUCTURED_VERDICTS` : zéro occurrence hors du fichier, même pas en interne. lib/routines/scheduler.ts:334 `getRoutineScheduler` : jamais appelé (instrumentation.ts:71-74 n'utilise que startRoutineScheduler ; les tests instancient RoutineScheduler). Le kind `dreaming` est dans ROUTINE_KINDS (constants.ts:8-14) et dans le type de colonne (schema.ts:52) mais absent de AVAILABLE_ROUTINE_KINDS, refusé par crud.ts (isAvailableRoutineKind) et `executeRoutineAction` lève « not available yet » (actions.ts:260-261) ; Dreaming tourne en réalité via le réglage `dreaming_after_night_run` (lib/workflow/dreaming-constants.ts:76), pas via une routine — la branche est une promesse de 2 mois sans chemin.

**Précision du vérificateur**

Trois exports réellement morts, vérifiés à zéro occurrence hors déclaration : lib/pipeline/constants.ts:279-287 (`PipelineReasonTone`/`pipelineReasonTone`, alors que components/ticket/derive.ts:375-381 rend la ligne pipeline en « summary » sans tonalité), lib/pipeline/findings.ts:272 (`POSITIVE_STRUCTURED_VERDICTS`, pas même utilisée dans son propre fichier, présente déjà à HEAD donc pas un résidu de la rationalisation), lib/routines/scheduler.ts:334 (`getRoutineScheduler`, instrumentation.ts:72-75 n'importe que `startRoutineScheduler`, les tests instancient `RoutineScheduler`). Le kind de routine `dreaming` est bien inatteignable (ROUTINE_KINDS constants.ts:8-14, absent d'AVAILABLE_ROUTINE_KINDS, filtré par isAvailableRoutineKind en crud.ts:96/201/353, actions.ts:260-261 lève « not available yet ») et Dreaming passe en réalité par le réglage `dreaming_after_night_run` (dreaming-constants.ts:76) — mais, contrairement au finding, c'est un état déjà documenté en tête de lib/routines/constants.ts:3-7 (« a kind may be durable before its dispatcher is actually shipped ») et la branche d'actions.ts est un garde d'exhaustivité, pas du code mort en soi : le seul vrai résidu est le kind non atteignable dans l'union et le type de colonne (schema.ts:52).

**Recommandation**

Supprimer les trois exports (ou brancher pipelineReasonTone dans derive.ts si la tonalité est voulue) ; retirer `dreaming` de ROUTINE_KINDS et du type de colonne, ou documenter dans constants.ts que Dreaming est piloté par réglage et ne deviendra pas une routine.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "pipelineReasonTone|POSITIVE_STRUCTURED_VERDICTS|getRoutineScheduler" app components hooks lib instrumentation.ts __tests__ e2e` → uniquement les lignes de déclaration ; `rg -n '"dreaming"' lib app` → aucun site ne crée ni ne dispatch une routine de ce kind.

</details>

### #80 — Résidus du board disparu dans lib/kanban et lib/types/kanban : deux fichiers entiers et une vingtaine d'exports sans appelant produit

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `lib/kanban/filters.ts`
- `lib/kanban/reorder.ts`
- `lib/kanban/queue.ts:141-252`
- `lib/kanban/merge-readiness.ts:243-301`
- `lib/kanban/activity-feed.ts:109-136`
- `lib/kanban/status-transitions.ts:145-152`
- `lib/types/kanban.ts:28-30`
- `lib/types/kanban.ts:91-96`
- `lib/types/kanban.ts:98-203`
- `__tests__/kanban-filters.test.tsx`
- `__tests__/kanban-review-reorder.test.ts`
- `__tests__/kanban-queue.test.ts`

**Constat**

Malgré la rationalisation non commitée, il reste dans l'arbre : lib/kanban/filters.ts (104 l., prédicats de l'ancienne FilterBar, seul importeur __tests__/kanban-filters.test.tsx), lib/kanban/reorder.ts (76 l., persistedColumnOrder pour le drag, seul importeur __tests__/kanban-review-reorder.test.ts), lib/kanban/queue.ts:141-252 (buildDependencyAdjacency, buildDependencyFocus, dependencyFocusRole, computeReadiness : hover-highlight et score de readiness des cartes Backlog), lib/kanban/merge-readiness.ts sortMergeColumn/isMergeReadyEpic/MergeReadinessCarrier/isMergeReady (sortMergeColumn n'est importé que par reorder.ts mort et cité en commentaire aggregate.ts:553), lib/kanban/activity-feed.ts filterActivityFeed/matchesActivityFilter/feedItemKind/ActivityFilter, lib/kanban/status-transitions.ts isTicketTransitionSelectable, et dans lib/types/kanban.ts DRAGGABLE_COLUMNS, PRIORITY_COLORS, KanbanAgentActionType, KanbanEpicAgentActivity, ReleaseGroup, BoardState, ReorderItem, plus KanbanEpic lui-même dont les seuls consommateurs sont filters.ts et computeReadiness. 872 lignes de tests (kanban-filters, kanban-review-reorder, 36 références dans kanban-queue.test.ts) n'épinglent que ce code.

**Précision du vérificateur**

Résidus du board disparu dans lib/kanban et lib/types/kanban : deux fichiers entiers (lib/kanban/filters.ts, 103 l. ; lib/kanban/reorder.ts, 75 l., importés uniquement par leurs deux tests) et une vingtaine d'exports sans aucun appelant produit — queue.ts:140-252 (buildDependencyAdjacency, buildDependencyFocus, dependencyFocusRole, computeReadiness), merge-readiness.ts isMergeReady (l.244), MergeReadinessCarrier (274), isMergeReadyEpic (279), sortMergeColumn (293, seul importeur = reorder.ts mort + un commentaire aggregate.ts:553), activity-feed.ts:109-136 (ActivityFilter, feedItemKind, matchesActivityFilter, filterActivityFeed), status-transitions.ts:145-152 (isTicketTransitionSelectable), et dans lib/types/kanban.ts DRAGGABLE_COLUMNS (28), PRIORITY_COLORS (91), KanbanEpic (98), KanbanAgentActionType/KanbanEpicAgentActivity (169), ReleaseGroup, BoardState (185), ReorderItem (199). Deux corrections aux plages citées : `describeMergeBlocker` (merge-readiness.ts:256-271) et `TicketDependencyEdge` (lib/types/kanban.ts:194-197) tombent dans les plages données mais sont VIVANTS (tickets-registry, control-desk, releases/derive, app/api/tickets) — à conserver. Le volume de tests concerné est de ~511 lignes (kanban-filters 104 + kanban-review-reorder 73 + une partie des 334 de kanban-queue.test.ts), pas 872.

**Recommandation**

Supprimer filters.ts, reorder.ts, les quatre fonctions de hover/readiness de queue.ts, les quatre exports de tri de merge-readiness.ts, les filtres d'activity-feed.ts et les sept résidus de lib/types/kanban.ts (KanbanEpic compris une fois le finding 1 appliqué), avec leurs tests. Garder compareExecutionOrder/computeBlockedBy/computeQueueRanks, evaluateMergeReadiness et ses prédicats, buildActivityFeed/isLongComment/commentPreview, ticketStatusOptions, qui sont vivants.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -l sur app components lib hooks bin --glob '!lib/kanban/*' : buildDependencyAdjacency, buildDependencyFocus, dependencyFocusRole, computeReadiness, isMergeReady, isMergeReadyEpic, isTicketTransitionSelectable, filterActivityFeed, matchesActivityFilter → 0 fichier ; sortMergeColumn → lib/kanban/reorder.ts (mort) + commentaire lib/control-desk/aggregate.ts:553 ; KanbanEpic → lib/kanban/filters.ts, lib/kanban/queue.ts seulement ; DRAGGABLE_COLUMNS, PRIORITY_COLORS, KanbanAgentActionType, KanbanEpicAgentActivity, ReleaseGroup, BoardState, ReorderItem → 0 fichier. Aucun composant ne réordonne ni ne filtre par priorité (`rg -i 'reorder|position' components/ticket components/desk components/tickets-registry` → aucun handler).

</details>

### #83 — GET/POST /api/projects/:id/dependencies et getProjectDependencies sont orphelins depuis la suppression de DependencyEditor

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `app/api/projects/[projectId]/dependencies/route.ts`
- `lib/dependencies/crud.ts:166-175`
- `app/api/projects/[projectId]/epics/[epicId]/dependencies/route.ts:373-397`

**Constat**

app/api/projects/[projectId]/dependencies/route.ts (89 l.) liste et crée des arêtes au niveau projet avec une validation manuelle du body (pas de zod) et un bloc CycleError/CrossProjectError recopié de epics/[epicId]/dependencies/route.ts (l.376-397). Son unique client UI était components/dependencies/DependencyEditor.tsx, supprimé (D) dans l'arbre. Le seul consommateur de lib/dependencies/crud.ts getProjectDependencies est cette route. La route sœur dependencies/transitive reste vivante (useBatchSelection.ts:52, NightRunDialog.tsx:243) et l'édition par ticket passe par PUT epics/[epicId]/dependencies (useEpicDependencies.ts:61) ; l'agent passe par les routes MCP add/remove-dependency qui appellent createDependencies/deleteDependencyEdge directement.

**Précision du vérificateur**

`app/api/projects/[projectId]/dependencies/route.ts` (89 l., GET + POST, validation du body à la main sans zod, bloc catch CycleError/CrossProjectError dupliqué de la route sœur `epics/[epicId]/dependencies/route.ts` l.75-92) n'a aucun consommateur dans le code produit, et `getProjectDependencies` (lib/dependencies/crud.ts:169-175) n'est appelé que par elle. Contrairement à ce qu'affirme le finding initial, ce n'est PAS une conséquence de la suppression de `components/dependencies/DependencyEditor.tsx` : ce composant n'appelait pas cette route (il passait par `useEpicDependencies` → `PUT /api/projects/:id/epics/:epicId/dependencies`) et était lui-même déjà sans point de montage à HEAD. La route est donc morte-née (introduite en 9ae7709a, jamais câblée à une UI). Seul consommateur restant : `__tests__/dependencies-api.test.ts` (l.52-186), à supprimer avec elle. Les routes voisines restent vivantes : `dependencies/transitive` (hooks/useBatchSelection.ts:52, components/night/NightRunDialog.tsx:183 — et non 243) et `epics/[epicId]/dependencies` (hooks/useEpicDependencies.ts:34,42). `createDependencies` reste utilisé (epics/route.ts:18, mcp/add-dependency:25, mcp/merge-tickets:57) ; seul `getProjectDependencies` part avec la route.

**Recommandation**

Supprimer dependencies/route.ts et getProjectDependencies. Si une lecture projet des arêtes redevient nécessaire, la servir depuis /api/control-desk ou /api/tickets qui lisent déjà ticketDependencies scope projet.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '/dependencies[\`"'?]|dependencies/transitive' app components hooks lib bin --glob '!app/api/**'` → uniquement useBatchSelection.ts:52 et NightRunDialog.tsx:243 (transitive) et useEpicDependencies.ts:37,61 (epics/${epicId}/dependencies). `rg -l getProjectDependencies app lib --glob '!lib/dependencies/*'` → app/api/projects/[projectId]/dependencies/route.ts seulement. git status : D components/dependencies/DependencyEditor.tsx, D __tests__/dependency-editor.test.tsx.

</details>

### #87 — GET /api/dashboard/summary et GET /epics/[epicId]/artifacts n'ont aucun appelant (toujours ouvert après la rationalisation)

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `app/api/dashboard/summary/route.ts`
- `app/api/projects/[projectId]/epics/[epicId]/artifacts/route.ts`
- `lib/agent-sessions/artifact-view.ts`

**Constat**

app/api/dashboard/summary/route.ts (107 l.) servait la bande dashboard via hooks/useDashboardSummary.ts, supprimé (D) dans l'arbre ; il ne reste que deux commentaires qui s'en démarquent (TodayTile.tsx:14, control-desk/route.ts:502). app/api/projects/[projectId]/epics/[epicId]/artifacts/route.ts (29 l., liste des sessionArtifacts d'un ticket) n'a aucun fetch client ; le seul constructeur d'URL vers la route de service des artefacts, lib/agent-sessions/artifact-view.ts, n'a lui-même aucun importeur, ni prod ni test. Les preuves visuelles attachées par attach_artifact sont donc écrites en base sans qu'aucune surface ne les liste.

**Précision du vérificateur**

Confirmé, avec deux précisions. (1) `app/api/dashboard/summary/route.ts` (107 l.) existe ; son seul consommateur `hooks/useDashboardSummary.ts` est bien supprimé (`git status` → ` D hooks/useDashboardSummary.ts`), et les seules autres mentions du chemin sont deux commentaires qui s'en démarquent explicitement (`components/desk/TodayTile.tsx:14`, `app/api/control-desk/route.ts:502`) — aucun `fetch` ni construction d'URL dynamique. (2) `app/api/projects/[projectId]/epics/[epicId]/artifacts/route.ts` (29 l.) n'a aucun appelant client ; `lib/agent-sessions/artifact-view.ts` (16 l., `sessionArtifactUrl` + `SessionArtifactSummary`) a zéro importeur, prod comme test. Précision manquante : la route de SERVICE du fichier, `app/api/projects/[projectId]/artifacts/[artifactId]/route.ts` (57 l.), est elle aussi orpheline côté UI — elle appartient au même bloc mort et devrait figurer dans le finding. Seconde précision : les trois routes conservent des suites vitest vivantes (`__tests__/dashboard-summary-route.test.ts`, `__tests__/session-artifact-routes.test.ts`, `__tests__/servable-session-artifacts.test.ts`) qu'il faudra retirer avec elles — ce ne sont pas des appelants de production, mais la recommandation « supprimer » n'est pas un simple `rm` de la route.

**Recommandation**

Supprimer dashboard/summary et artifact-view.ts ; pour artifacts, soit brancher une galerie dans l'overlay ticket (les données existent), soit retirer la route et documenter que attach_artifact n'est visible que dans les logs de session.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '/artifacts[\`"'?]|dashboard/summary' app components hooks lib bin --glob '!app/api/**'` → components/desk/TodayTile.tsx:14 (commentaire) seulement. `rg -l artifact-view app components hooks lib bin __tests__ e2e` → 0. git status : D hooks/useDashboardSummary.ts.

</details>

### #116 — Type d'événement `session:progress` déclaré et écouté mais jamais émis ; flag `arijActionsUnavailable` renvoyé mais jamais lu

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `lib/events/bus.ts:8-25`
- `lib/events/emit.ts`
- `app/projects/[projectId]/page.tsx:76`
- `app/api/projects/[projectId]/sessions/[sessionId]/route.ts:290-300,380-390`
- `components/session-live/types.ts:19-66`
- `lib/agent-sessions/session-detail.ts:152`

**Constat**

`TicketEventType` (lib/events/bus.ts:16) contient `"session:progress"` et la page projet s'y abonne (app/projects/[projectId]/page.tsx:76) ; `lib/events/emit.ts` n'a aucun `emitSessionProgress` et aucun `eventBus.emit({ type: "session:progress" })` n'existe dans le dépôt. Côté détail de session, la route renvoie `arijActionsUnavailable: true` (sessions/[sessionId]/route.ts:296 et :387) quand le scan échoue ; aucun composant ne lit ce champ (absent aussi de `SessionDetail` dans session-live/types.ts) — l'échec du scan est silencieux, l'UI montre la moitié durable comme si elle était complète.

**Précision du vérificateur**

Deux résidus distincts, tous deux réels mais mineurs. (a) `session:progress` est déclaré dans `TicketEventType` (lib/events/bus.ts:16) et abonné dans `app/projects/[projectId]/page.tsx:76` alors que rien ne l'émet — mais ce n'est pas un oubli : `components/desk/LiveSessionCard.tsx:24-26` et `components/qa/QaRunCard.tsx:26-28` s'appuient explicitement dessus pour justifier une barre de progression indéterminée. Le seul résidu est le handler no-op de l'abonnement. (b) `arijActionsUnavailable` est renvoyé par la route sessions (app/api/projects/[projectId]/sessions/[sessionId]/route.ts:342 et :434 dans l'arbre, pas 296/387) et typé côté client dans `SessionArijActionsResponse` (lib/agent-sessions/session-detail.ts:140), mais aucun consommateur ne le lit : `app/projects/[projectId]/sessions/[sessionId]/page.tsx:90` ne retient que `page.actions`, et le champ manque à `SessionDetail` (components/session-live/types.ts:19-66). Un échec de scan reste donc invisible — la liste durable s'affiche comme complète, voire la section disparaît (LiveSessionScreen.tsx:191) — sur une liste que la route et le client traitent par ailleurs comme explicitement best-effort.

**Recommandation**

Retirer `session:progress` du type et de l'abonnement (ou l'émettre depuis le process-manager si c'est l'intention) ; faire remonter `arijActionsUnavailable` dans `SessionDetail` et l'afficher dans `LiveSessionScreen` à côté de la liste d'actions.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '"session:progress"' lib app components hooks` → bus.ts:16 (type) et page.tsx:76 (abonné) seulement ; `rg -n "arijActionsUnavailable" components app --glob '!app/api/**'` → 0 résultat.

</details>

### #123 — La couture `renderPanel` de TicketOverlayProvider n'a aucun consommateur : deuxième scrim et deuxième gestion d'Escape mortes

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `components/ticket/TicketOverlayProvider.tsx:73-84,107-118,134-157`

**Constat**

Le provider garde un render-prop `renderPanel` avec son propre scrim, son propre `role=dialog` et son propre listener Escape (`escapeHandledByPanel`), documenté comme la couture par laquelle la frame 6a a atterri. Depuis, aucun appelant ne le passe : les cinq pages montent `<TicketOverlayProvider>` nu. Une cinquantaine de lignes (types, effet Escape, branche JSX) ne sont plus atteignables.

**Précision du vérificateur**

Le render-prop `renderPanel` de `components/ticket/TicketOverlayProvider.tsx` n'a aucun consommateur dans l'arbre de travail : la prop du type (l.73-84), l'effet Escape gardé par `escapeHandledByPanel = renderPanel === undefined` (l.107-118) et la branche JSX scrim + `role="dialog"` (l.134-157) sont inatteignables. Correction : ce sont QUATRE pages, pas cinq, qui montent `<TicketOverlayProvider>` nu (app/page.tsx:15, app/tickets/page.tsx:35, app/chat/page.tsx:28, app/qa/page.tsx:17) ; app/projects/[projectId]/page.tsx ne monte pas le provider. Les autres fichiers n'importent que le hook `useTicketOverlay` (NowDesk, QaScreen, ChatPageView, TicketsRegistryView), qui ne peut pas passer la prop, et les `renderPanel` trouvés dans __tests__/spec-update-progress.test.tsx et __tests__/story-detail-panel-labels.test.tsx sont des helpers locaux homonymes. Seul le chemin `!renderPanel` s'exécute, qui rend `TicketOverlay` (celui-ci peint son propre scrim et gère la précédence d'Escape).

**Recommandation**

Supprimer `renderPanel`, `escapeHandledByPanel` et la branche JSX associée ; le provider ne rend plus que `TicketOverlay`.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n renderPanel app components hooks lib __tests__ e2e` hors du provider → uniquement des fonctions locales de tests homonymes (__tests__/spec-update-progress.test.tsx, __tests__/story-detail-panel-labels.test.tsx) qui n'appellent pas le provider. Pages : app/page.tsx:15, app/tickets/page.tsx:35, app/qa/page.tsx:17, app/chat/page.tsx:28.

</details>

### #138 — Harnais de dev /piscine-preview livré comme route de production, et trois configs référencent un dossier app/_piscine-preview qui n'existe pas

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `app/piscine-preview/page.tsx:12`
- `eslint.config.mjs:51`
- `scripts/i18n/check-keys.mjs:79`
- `lib/i18n/catalogue.ts:90`

**Constat**

app/piscine-preview/page.tsx (1 074 lignes, `"use client"`) s'auto-décrit « DEV HARNESS — NOT A PRODUCT SCREEN » (L5) et affirme (L12-15) n'être qu'un re-export de app/_piscine-preview/ à supprimer « when the redesign lands » (L17). `ls app` ne contient pas _piscine-preview : ce fichier EST la route, atteignable en prod (rien dans next.config.ts ne l'exclut). Trois fichiers de config portent encore l'exclusion du dossier fantôme : eslint.config.mjs:51 (`ignores: ["app/piscine-preview/**", "app/_piscine-preview/**"]`), scripts/i18n/check-keys.mjs:79 (EXCLUDED) et lib/i18n/catalogue.ts:90. La refonte Piscine est livrée (docs/specs.md:864 « livrée »), la condition de suppression est remplie.

**Précision du vérificateur**

`app/piscine-preview/page.tsx` (1 074 lignes, `"use client"`, `export default` L166) est une vraie route de production atteignable, pas le ré-export qu'annonce son en-tête : le dossier privé `app/_piscine-preview/` qu'il prétend ré-exporter n'existe pas et n'a jamais existé dans l'historique git, et rien dans `next.config.ts` n'exclut la route du build. Deux configs — et non trois — portent encore l'exclusion du dossier fantôme : `eslint.config.mjs:51` et `scripts/i18n/check-keys.mjs:79` ; `lib/i18n/catalogue.ts:90` ne mentionne que `app/piscine-preview/` (qui existe) et reste donc exact tant que le harnais est là. La condition de suppression annoncée en L17 est remplie (`docs/specs.md:864` : refonte Piscine « livrée ») et aucun consommateur n'existe dans app/, components/, hooks/, lib/. Une suppression doit aussi toucher `__tests__/react-compiler-namespaced-hooks.test.ts` (L20, L71, L176, L181, qui épingle ce fichier dans CONVERTED et dans les mutations KNOWN_BAILED) et `docs/specs.md:539`/`:798`. À noter aussi : les onglets L879-883 pointent vers `/piscine-preview/spec|agents|releases|usage`, sous-routes inexistantes.

**Recommandation**

Supprimer app/piscine-preview/ et les trois exclusions ; si un catalogue visuel des primitives reste utile, le déplacer sous e2e/ ou un Storybook-like hors du bundle Next.

<details><summary>Preuve relevée par l'auditeur</summary>

sed -n 1,20p app/piscine-preview/page.tsx ; ls app (pas de _piscine-preview) ; rg -n "_piscine-preview" → eslint.config.mjs:51, scripts/i18n/check-keys.mjs:79, app/piscine-preview/page.tsx:12 ; rg -n piscine-preview lib/i18n/catalogue.ts:90 ; find app -name page.tsx liste /piscine-preview parmi les routes.

</details>

### #143 — `session:progress` est déclaré dans le bus SSE et écouté par la page projet, mais rien ne l'émet jamais

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `lib/events/bus.ts:16`
- `app/projects/[projectId]/page.tsx:76`
- `lib/events/emit.ts`
- `components/desk/LiveSessionCard.tsx:25`

**Constat**

lib/events/bus.ts:16 inclut "session:progress" dans TicketEventType ; app/projects/[projectId]/page.tsx:76 enregistre un handler `"session:progress": () => setRefreshTrigger(...)` via useProjectEvents. L'inventaire des émissions (`rg -o 'type: "[a-z_.:]+"'` sur lib/app hors tests + lib/events/emit.ts) donne ticket:moved/created/updated/deleted, session:started/completed/failed, artifact:created, release:created, memory:changed — jamais session:progress. Deux composants le savent et le documentent (components/desk/LiveSessionCard.tsx:25-27 « NOTHING emits it », components/qa/QaRunCard.tsx:26). Handler mort + type mort qui promet une progression que le produit ne calcule pas.

**Précision du vérificateur**

`session:progress` figure dans `TicketEventType` (lib/events/bus.ts:16) et un handler l'attend dans app/projects/[projectId]/page.tsx:76, mais aucun chemin ne l'émet : ni les helpers de lib/events/emit.ts (9 types), ni les 6 appels directs à `eventBus.emit` (memory:changed, session:completed/failed), ni la route SSE (qui ne synthétise que `connected`). Les deux cartes de session (LiveSessionCard.tsx:25, QaRunCard.tsx:26) le savent et rendent une progression indéterminée à dessein, donc aucune promesse trompeuse à l'écran ; il s'agit de code mort documenté (un membre de type + une ligne de handler), à retirer ou à câbler.

`session:progress` est déclaré dans TicketEventType (lib/events/bus.ts:16) et écouté par app/projects/[projectId]/page.tsx:76, mais plus rien ne l'émet : le seul émetteur, `emitSessionProgress` dans lib/events/emit.ts, a été supprimé comme code mort par f0242187 (2026-08-14) sans retirer le type ni le handler. Toutes les émissions actuelles (helper `emit()` de emit.ts + six `eventBus.emit` directs dans memory routes, memory-distill.ts, dreaming.ts) couvrent 10 types (les 9 listés plus memory:changed), jamais session:progress ; aucun type n'est construit dynamiquement ni reçu d'un body. Résidu supplémentaire : quatre tests (`agent-mentions-do-not-block-runs`, `epic-lifecycle-status`, `epic-build-concurrency`, `agent-launch-concurrency-routes`) mockent encore `emitSessionProgress: vi.fn()`, une fonction qui n'existe plus. LiveSessionCard.tsx:24-26 et QaRunCard.tsx:26-27 documentent explicitement cet état.

**Recommandation**

Retirer "session:progress" du type et du handler (le desk se rafraîchit déjà sur session:started/completed/failed et par polling), ou l'émettre réellement depuis lib/agent-sessions à chaque chunk si une progression est voulue.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n "session:progress" lib app hooks components --glob '!__tests__' → bus.ts:16 (type), page.tsx:76 (handler), deux commentaires ; aucune ligne d'émission ; liste des types émis obtenue par rg sur emit(…type: "…") → 9 types, sans session:progress.

</details>

### #157 — Exports morts vérifiés dans le périmètre (et faux positifs de l'inventaire à ne pas reprendre)

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `lib/agent-sessions/artifact-view.ts`
- `lib/agent-config/composite-agents.ts:82`
- `lib/agent-config/composite-agents.ts:192`
- `lib/agent-config/agent-resolution.ts:53`
- `lib/chat/conversation-agent.ts:6`
- `lib/mcp/user-global-sync.ts:563-606`
- `lib/mcp/servers.ts:520`
- `lib/mcp/token-store.ts:74`
- `lib/mcp/board-tool-route.ts:116`

**Constat**

Vérifié un par un : lib/agent-sessions/artifact-view.ts (16 lignes, 0 importeur, voir finding artefacts) ; composite-agents.ts readMemberCliOptions (orphelin total) et setCompositeMembers (seul __tests__/composite-agents-crud.test.ts, les 3 mentions en prod sont des commentaires de named-agents.ts) ; agent-resolution.ts ResolvedAgentConfig (0 occurrence hors déclaration) ; conversation-agent.ts CUSTOM_REVIEW_AGENT_PREFIX (0 usage). À l'inverse, trois entrées de l'inventaire « tests seuls » sont bien branchées en prod et ne doivent pas être retirées : lib/mcp/user-global-sync.ts (syncUserGlobalMcpServers appelé par servers.ts:520/580/597, whenUserGlobalMcpSyncSettles par server-routes.ts:85, le scheduler est instancié en interne l.563), purgeExpiredMcpTokens (appelé à chaque mint, token-store.ts:74), requireChatToolsetToken (appelé board-tool-route.ts:116).

**Précision du vérificateur**

Finding exact tel quel. Seule nuance de rédaction : dans agent-resolution.ts, c'est bien `ResolvedAgentConfig` (l.53) qui est morte, à distinguer de `ResolvedAgentProvider` (l.44) et de `ResolvedAgent`, qui restent utilisées — la suppression doit viser la seule interface l.53-60.

**Recommandation**

Supprimer artifact-view.ts (avec le finding artefacts), readMemberCliOptions, ResolvedAgentConfig, CUSTOM_REVIEW_AGENT_PREFIX ; rendre setCompositeMembers non exporté ou le supprimer avec son test si updateCompositeAgent reste le seul chemin d'écriture. Ne pas toucher à user-global-sync, purgeExpiredMcpTokens ni requireChatToolsetToken.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'setCompositeMembers|readMemberCliOptions' hors tests → déclarations + 3 commentaires (named-agents.ts:306/336/372) ; rg -l setCompositeMembers __tests__ → composite-agents-crud.test.ts. rg 'ResolvedAgentConfig' → 1 occurrence. rg 'CUSTOM_REVIEW_AGENT_PREFIX' → 1 occurrence. rg 'syncUserGlobalMcpServers|whenUserGlobalMcpSyncSettles' hors tests → servers.ts:64/520/580/597, server-routes.ts:24/85. token-store.ts:74 « purgeExpiredMcpTokens(); » dans mintMcpToken.

</details>

### #176 — Les logs NDJSON de lib/claude/logger.ts sont écrits mais jamais lus, jamais purgés, et seulement pour les spawns éphémères

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/claude/logger.ts:34-40`
- `lib/claude/logger.ts:49-121`
- `lib/providers/base-provider.ts:496-508`
- `lib/claude/spawn.ts:254-261`
- `lib/routines/retention.ts:5`
- `lib/usage/codex-snapshot.ts:16`

**Constat**

createStreamLog/appendStreamEvent/endStreamLog écrivent data/logs/<ts>-<id>.ndjson (logger.ts:49-121) avec une passe de masquage du token (34-40) présentée comme « the single logging boundary every provider funnels through ». Aucun code ne lit ces fichiers : rg `ndjson|data/logs|LOGS_DIR` dans lib/app/components/hooks/bin/scripts ne trouve qu'un commentaire dans lib/usage/codex-snapshot.ts:16 ; la routine de rétention ne les touche pas (lib/routines/retention.ts:5 le note). Et seuls les spawns sans ligne agent_sessions passent un `logIdentifier` (import/route.ts:76, chat/stream/route.ts:961-1156, generate-spec:110, title-generation.ts:35) ; les sessions agent via processManager.start n'en passent jamais (ex. stage-session.ts:152-162). Sur disque : 29 fichiers, 13 Mo, les trois derniers sont des titrages. Le flux raw en base fait déjà ce travail pour les vrais agents.

**Précision du vérificateur**

Le fond est confirmé : le logger NDJSON écrit sans lecteur ni rétention, et seulement pour les spawns éphémères. Corrections de détail :

1) Vérifié dans l'arbre de travail (aucun de ces fichiers n'est supprimé/D) :
- lib/claude/logger.ts:4 `const LOGS_DIR = join(process.cwd(), "data", "logs")` ; :34-40 `redactMcpToken` ; :49-121 `createStreamLog` (:58 `${ts}-${safe}.ndjson`), `appendStreamEvent`, `appendStderrEvent`, `endStreamLog`. Le commentaire « single logging boundary every provider funnels through » est bien aux lignes 44-47.
- lib/providers/base-provider.ts:495-508 : `if (logIdentifier) { logCtx = createStreamLog(\`${this.logPrefix}-${logIdentifier}\`, …) }` ; lib/claude/spawn.ts:254-261 (et un second site :453-459, non cité par l'auditeur).
- Aucun lecteur : `rg "ndjson|data/logs|LOGS_DIR"` sur lib app components hooks bin scripts instrumentation/proxy ne renvoie que logger.ts lui-même, une variable locale sans rapport (lib/claude/json-parser.ts:222) et un commentaire (lib/usage/codex-snapshot.ts:16). Aucun `readdir`/`readFile` sur data/logs nulle part, aucun ré-export, aucune route de service de fichiers. Les seuls autres importeurs de logger.ts sont des `import type { StreamLogContext }` (codex.ts:22, agy.ts:59, pi.ts:55) et les tests (mcp-log-redaction, claude-spawn-logging, codex-*-developer-instructions, named-agent-options-spawn).
- Sites `logIdentifier` réels : app/api/projects/import/route.ts:76, app/api/projects/[projectId]/generate-spec/route.ts:110, lib/chat/title-generation.ts:35, et app/api/projects/[projectId]/chat/stream/route.ts:961, 1010, 1086, 1102, 1156 (5 sites, pas 2) ; claude-code.ts:49/62 n'est qu'un passe-plat. `lib/claude/process-manager.ts` ne mentionne jamais `logIdentifier` (start() ligne 106, spawnClaude ligne 426), donc lib/pipeline/stage-session.ts:151-163 (chemin correct : lib/pipeline/, pas lib/agent-sessions/) n'en produit aucun. Confirmé sur disque : 29 fichiers, 13 Mo, les 3 plus récents sont des `title-*`.

2) Imprécision : lib/routines/retention.ts:5 ne « note » pas que les NDJSON échappent à la purge — c'est une citation générique de la spec (« Unbounded table growth (reports, logs, artifacts) is not pruned automatically »). Le vrai constat est que retention.ts ne contient aucun readdir/unlink et ne traite que agent_session_chunks + prompt-backfill : les fichiers ne sont effectivement jamais purgés, mais par absence, pas par mention.

3) Nuance qui atténue « aucun consommateur » : pour les tours de chat, il n'existe pas de ligne agent_sessions (commentaire explicite à chat/stream/route.ts:965), donc le flux brut CLI n'est PAS en base pour eux — le NDJSON est la seule trace durable de ces runs. « Le flux raw en base fait déjà ce travail » n'est vrai que pour les sessions agent, qui justement n'écrivent pas de NDJSON.

4) La recommandation « supprimer aussi la redaction » est à nuancer : `redactMcpToken` est la seule protection contre l'écriture durable du token MCP dans l'argv codex (`-c mcp_servers.arij.env=…`) ; elle ne disparaît que si le logger disparaît entièrement.

**Recommandation**

Soit supprimer le logger NDJSON et sa redaction (et les tests mcp-log-redaction), soit lui donner un lecteur (page session pour les spawns éphémères) et une rétention. En l'état c'est de l'écriture disque non bornée sans consommateur.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n `ndjson|data/logs|LOGS_DIR` lib app components hooks bin scripts (hors logger.ts) → json-parser.ts (variable locale sans rapport) et codex-snapshot.ts:16 (commentaire) ; rg `logIdentifier:` app lib → 8 sites, tous chat/spec/import/titre ; `ls data/logs | wc -l` = 29, `du -sh` = 13M.

</details>

### #177 — La branche `codex exec resume` de CodexProvider est inatteignable : codex est exclu de la reprise partout

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/providers/codex.ts:239-267`
- `lib/providers/codex.ts:348-350`
- `lib/providers/options-registry.ts:222-224`
- `lib/agent-sessions/resume-capability.ts:20-32`
- `lib/agent-sessions/validate-resume.ts:54-60`
- `lib/pipeline/stage-resume.ts:48-63`
- `app/api/projects/[projectId]/chat/stream/route.ts:732-737`

**Constat**

codex.ts:239-267 construit `exec resume <ID>` (et options-registry.ts:222-224 marque `profile` resumeSupported:false pour ce cas) mais toutes les entrées de reprise passent par isResumableProvider, qui exclut codex (lib/agent-sessions/resume-capability.ts:20-32, commentaire explicite : codex ne rapporte jamais son thread id, cf. codex.ts:348-350) : validate-resume.ts:57, stage-resume.ts:50, chat/stream/route.ts:732-737, qa create-epics:251-252, releases/route.ts:221, stories/build:145. __tests__/codex-resume-sessions.test.ts:30-40 pin même que l'endpoint resumable ne liste plus codex. `resumeSession: true` ne peut donc jamais atteindre CodexProvider en production.

**Recommandation**

Supprimer la branche resume de CodexProvider et l'attribut resumeSupported (ou, si l'on veut la garder pour le jour où codex rapportera son id, la placer derrière un commentaire « unreachable until parseSessionId returns an id » et retirer les tests qui la couvrent comme un comportement vivant).

<details><summary>Preuve relevée par l'auditeur</summary>

resume-capability.ts:28-32 `RESUMABLE_PROVIDERS = new Set(["claude-code","oh-my-pi","agy"])` ; rg `resumeSession: (true|[a-zA-Z])` app lib → chaque site dérive de validateResumeSession/isResumableProvider ; codex.ts:227-233 et 239 branchent sur `isResume`.

</details>

### #178 — Restes des providers retirés en 2026-08 : formats OpenCode/Gemini dans json-parser.ts, défauts « pi » dans PiProvider

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/claude/json-parser.ts:457-460`
- `lib/claude/json-parser.ts:644-653`
- `lib/claude/json-parser.ts:697-714`
- `lib/providers/pi.ts:77`
- `lib/providers/pi.ts:207-231`
- `lib/providers/pi.ts:341-345`
- `lib/providers/types.ts:13-18`

**Constat**

lib/providers/types.ts:13-18 rappelle que gemini-cli, opencode, pi et cinq autres ont été retirés. json-parser.ts continue pourtant de chercher `sessionID` « OpenCode uses sessionID » (457-460), `part.text` « OpenCode event format » (644-653) et `candidates[].content.parts` (format Gemini, 697-714) ; aucun test ne les exerce (rg `sessionID|candidates|part` dans les tests important json-parser → 0). PiProvider (pi.ts) est déclaré base abstraite gardée pour omp (en-tête 11-17), mais ses valeurs par défaut propres à pi — binaryName "pi" (210-212), `--session` (225-227), messages « Pi is not authenticated » / « npm i -g @earendil-works/pi-coding-agent » (229-231, 341-345), PI_READONLY_TOOLS (77), cliDisplayName "Pi" (215-217), `findPiRunFailure(…, "Pi")` — sont toutes surchargées par OhMyPiProvider (oh-my-pi.ts:114-178) et ne sont atteintes que par __tests__/pi-providers.test.ts. La base de données porte encore 1 session `provider='pi'`.

**Précision du vérificateur**

Le finding est exact sur les faits, avec trois précisions :

1) json-parser.ts — les trois branches existent bien et ne sont exercées par aucun test : `lib/claude/json-parser.ts:456-460` (`// OpenCode uses sessionID (capital D)`), `:644-653` (`// OpenCode event format: text content nested in part.text`), `:697-714` (`if (Array.isArray(block.candidates))`, forme `candidates[].content.parts[].text`, propre à Gemini). `rg -n "sessionID|candidates|\bpart\b" __tests__/json-parser.test.ts` → 0 résultat. Aucun provider enregistré (claude-code, codex, oh-my-pi, agy) n'émet ces formes. À noter : la docstring de `extractCliSessionIdFromOutput` (:42-50) n'énumère que session_id / sessionId / session.id — `sessionID` n'y est même plus documenté.

2) PiProvider — les surcharges sont bien intégrales : `oh-my-pi.ts:114 binaryName`, `:118 cliDisplayName`, `:122 readonlyTools`, `:166 resumeArgs`, `:170 notAuthenticatedMessage`, `:174 buildSpawnErrorMessage` couvrent exactement les six défauts pi de `pi.ts:210-231` et `:341-345`. Les seuls autres héritiers sont des classes de test (`__tests__/pi-providers.test.ts`, `__tests__/oversized-prompt-transport.test.ts`). Précision : `PI_READONLY_TOOLS` (pi.ts:77) n'est référencé nulle part hors de pi.ts:221 — pas même par un test ; son `export` est donc superflu.

3) La recommandation, elle, doit être atténuée : `pi.ts:11-17` enregistre une décision explicite (epic H3WaoKFiwd8j « delete or register? » → NEITHER), épinglée par `__tests__/provider-registry-single-source.test.ts` et rappelée dans `lib/providers/index.ts:12-14`. « Fusionner PiProvider dans OhMyPiProvider » contredit cette décision documentée ; ce qui est mort, ce n'est pas la classe (vivante par héritage), ce sont uniquement ses valeurs par défaut pi. La seconde branche de la recommandation (réduire la base à l'abstrait pur) est la bonne.

DB confirmée : `select provider,count(*) from agent_sessions group by provider` → agy 118, claude-code 1288, codex 177, oh-my-pi 230, pi 1. Cette ligne est inoffensive : `getProvider` (lib/providers/index.ts:34) retombe sur claude-code pour toute clé inconnue.

**Recommandation**

Retirer les trois branches de json-parser.ts (et le `sessionID` de findSessionIdInValue). Fusionner PiProvider dans OhMyPiProvider ou réduire la base à l'abstrait pur (pas de binaryName/messages pi), en gardant les fonctions de parsing du flux `--mode json` qui sont, elles, vivantes.

<details><summary>Preuve relevée par l'auditeur</summary>

json-parser.ts:457 `// OpenCode uses sessionID (capital D)` ; :644 `// OpenCode event format: text content nested in part.text` ; :697 `if (Array.isArray(block.candidates))` ; rg -l json-parser __tests__ | xargs rg `candidates|sessionID|part:` → aucun résultat ; pi.ts:210 `get binaryName() { return "pi"; }` surchargé oh-my-pi.ts:114-116.

</details>

### #179 — Exports runtime sans consommateur en production : appendPromptSections, streamOpenAiChatCompletion, estimatePromptTokens

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/tokens/dispatch-prompt.ts:99-118`
- `lib/openai/client.ts:647-658`
- `lib/tokens/estimator.ts:133-170`

**Constat**

Vérifié par scan AST + recherche par mot entier sur app/lib/components/hooks/bin/scripts (app/api/projects inclus) : `appendPromptSections` (lib/tokens/dispatch-prompt.ts:99-118) est un orphelin total (0 occurrence hors sa déclaration, tests compris) ; `streamOpenAiChatCompletion` (lib/openai/client.ts:647-658) n'est appelé que par __tests__/openai-client.test.ts et openai-tool-streaming.test.ts, la production utilisant streamOpenAiChatEvents (chat/stream/route.ts:546) ; `estimatePromptTokens` (lib/tokens/estimator.ts:133-170) n'est appelé que par __tests__/token-estimator.test.ts, la production passant par estimatePromptTokensBySections. Le reste de lib/openai est bien vivant (chat stream fast mode, settings test route, default-chat-mode) — la piste « lib/openai encore utilisé ? » est fermée.

**Recommandation**

Supprimer les trois fonctions et leurs tests dédiés ; le commentaire de streamOpenAiChatCompletion (« Kept for callers that never advertise tools ») décrit des appelants qui n'existent pas.

<details><summary>Preuve relevée par l'auditeur</summary>

Script scratchpad/prov/exports.mjs (AST typescript + \bNAME\b) : appendPromptSections prod=0 tests=0 ; streamOpenAiChatCompletion prod=0 tests=2 ; estimatePromptTokens prod=0 tests=1. rg `lib/openai` app lib components hooks → 8 fichiers vivants.

</details>

### #183 — Commentaires et docs qui décrivent encore l'ancien parc de providers ; deux unions de type pour la même liste

**Nature** refacto · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/providers/types.ts:4`
- `lib/providers/types.ts:20`
- `lib/providers/types.ts:160-164`
- `lib/claude/mcp-injection.ts:18-20`
- `lib/claude/process-manager.ts:242`
- `lib/providers/prompt-transport.ts:64`
- `docs/architecture/named-agent-cli-options.md:17-18`
- `lib/agent-config/constants.ts:193`

**Constat**

Après le nettoyage MCP-only (types.ts:13-18), plusieurs commentaires de contrat sont faux : lib/providers/types.ts:4 (« Claude Code, Codex, and Gemini CLI implement this interface »), :160 (« resume support (Claude/Gemini only) » alors que omp/agy reprennent et codex non), :164 (« claude-code, codex, oh-my-pi » sans agy) ; lib/claude/mcp-injection.ts:18-20 (« gemini-cli is out for v1 ») ; lib/claude/process-manager.ts:242 (idem sans agy) ; lib/providers/prompt-transport.ts:64 propose « run the ticket on … Pi » qui n'est plus sélectionnable ; docs/architecture/named-agent-cli-options.md:17-18 documente `label`/`hint` alors que le registre porte `labelKey`/`hintKey` (options-registry.ts:69-73). Par ailleurs `ProviderType` (types.ts:20) et `AgentProvider` (lib/agent-config/constants.ts:193) sont la même union littérale déclarée deux fois — l'égalité n'est garantie que par __tests__/provider-registry-single-source.test.ts:24-25, pas par le typage.

**Précision du vérificateur**

Le finding est exact sur tous les chemins et le fond ; deux points à rectifier et un à compléter.

1) Motif faux pour types.ts:160. L'auditeur écrit « omp/agy reprennent et codex non » : c'est l'inverse de ce que fait le code. Les quatre providers consomment `cliSessionId` pour reprendre — codex.ts:225 et :240 (`args.push("resume", cliSessionId!)`), oh-my-pi.ts:166-167 (`--resume`), agy.ts:133-134 (`--conversation`), claude-code.ts:47/60. Le commentaire « (Claude/Gemini only) » est donc périmé pour les quatre, pas seulement pour omp/agy.

2) La recommandation `export type AgentProvider = ProviderType` se heurte à une collision de noms non signalée : `AgentProvider` désigne DEUX choses distinctes dans le code — l'union littérale (constants.ts:193) et l'interface du contrat provider (lib/providers/types.ts:198), cette dernière étant celle qu'importe lib/providers/index.ts:17 et que ré-exporte index.ts:37. Un alias doit donc être posé en sachant lequel des deux on aliase, sinon l'import de index.ts change de sens.

3) La liste est restatée trois fois, pas deux : s'ajoute `PROVIDER_OPTIONS` (constants.ts:236-241), un tableau `AgentProvider[]` dont le typage n'empêche pas d'omettre un membre — d'où l'invariant §2 du test. Le dériver via `as const` (`PROVIDER_OPTIONS` source, `type AgentProvider = typeof PROVIDER_OPTIONS[number]`) supprimerait effectivement les trois copies.

Point mineur : le test cité est à provider-registry-single-source.test.ts:23-24, pas 24-25.

**Recommandation**

Corriger les commentaires en une passe ; faire dériver `AgentProvider` de `ProviderType` (`export type AgentProvider = ProviderType`) ou l'inverse, et dériver PROVIDER_OPTIONS/MCP_CAPABLE_PROVIDERS d'une seule constante `as const` pour que le test de cohérence devienne inutile.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n `Gemini|oh-my-pi\)|Claude/Gemini` lib/providers/types.ts → lignes 4, 160, 164 ; rg `gemini-cli` lib/claude/mcp-injection.ts → 18 ; rg `claude-code/codex/oh-my-pi` process-manager.ts → 242 ; provider-registry-single-source.test.ts:24-25 « the registry, PROVIDER_OPTIONS, `ProviderType` and `AgentProvider` name the same set ».

</details>

### #196 — chat_epic_proposals est une couche d'idempotence ajoutée sous POST /epics, pas un remplacement de epic-parsing.ts, dont trois exports sont morts

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:in-flight-extractions-adoption

**Fichiers**
- `lib/chat/epic-proposals.ts:27-61`
- `app/api/projects/[projectId]/epics/route.ts:617-620,713-716`
- `lib/epic-parsing.ts:6,18,27`
- `hooks/useEpicCreate.ts:84,138-147`
- `components/chat-page/DraftedEpicCard.tsx:99-110`
- `components/chat-page/message-epics.ts:27-36`

**Constat**

Réponse à (c) : lib/chat/epic-proposals.ts + la table chat_epic_proposals (migration 0057) ne créent aucun epic ; ils sont appelés uniquement dans la transaction de POST /api/projects/:id/epics (route.ts:32, :617-620, :713-716) pour hacher la proposition et renvoyer l'epic existant. Le parsing reste entièrement côté client, dans lib/epic-parsing.ts, par les deux chemins déjà connus : hooks/useEpicCreate.ts:84,138-147 (via useChatWorkspace) et components/chat-page/DraftedEpicCard.tsx:99-110 (via message-epics.ts:epicInMessage). La table n'a que deux lecteurs (epic-proposals.ts:52 et l'insert de la route). Le hash normalise `type` (route absent → "feature") et ignore `status`, donc les deux chemins convergent bien vers le même epic. epic-parsing.ts garde trois exports sans consommateur produit : `extractJsonCandidates` (:27, seul __tests__/epic-json-parsing.test.ts l'importe), `ConversationMessage` (:18) et `ParsedUserStory` (:6), aucun usage hors du fichier.

**Précision du vérificateur**

Fond exact, deux imprécisions de forme et une nuance sur la reco. (1) Les lignes du préflight ne sont pas 617-620 : `identifyChatEpicProposal` est appelé à app/api/projects/[projectId]/epics/route.ts:473 et `findChatEpicProposal` à :476 (raccourci hors transaction) puis à :624 (dans la transaction `behavior: "immediate"`), l'insert du registre étant à :713. (2) « deux lecteurs » : il n'y a en réalité qu'un seul lecteur de la table (lib/chat/epic-proposals.ts:52) ; route.ts:713 est un écrivain. (3) `ParsedUserStory` (lib/epic-parsing.ts:6) n'est pas un export gratuit : c'est le type d'élément de `ParsedEpic.userStories` (:15), donc un membre structurel du type public réellement consommé (components/chat-page/message-epics.ts:1,72 → ChatThread.tsx:17,56, DraftedEpicCard.tsx:19). Le supprimer casserait la nommabilité de la forme ; seuls `extractJsonCandidates` (:27, importé uniquement par __tests__/epic-json-parsing.test.ts) et `ConversationMessage` (:18, aucun usage hors du fichier) sont des exports sans consommateur.

**Recommandation**

Rendre `extractJsonCandidates` interne (le test peut passer par parseEpicFromConversation), supprimer `ConversationMessage`/`ParsedUserStory` ou les exporter depuis le type ParsedEpic. Documenter dans epic-proposals.ts qu'il n'est qu'un dédoublonnage serveur et que le parsing reste client — sinon la prochaine passe cherchera un « troisième chemin » qui n'existe pas.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'chatEpicProposals|chat_epic_proposals|epic-proposals'` (hors tests) → schema.ts:186, epic-proposals.ts:5,52-54, epics/route.ts:5,32,713 seulement. Pour chaque export de epic-parsing.ts : `extractJsonCandidates -> prod:[] tests:1`, `ConversationMessage -> prod:[] tests:0`, `ParsedUserStory -> prod:[] tests:0` ; `parseEpicFromConversation -> message-epics.ts, useEpicCreate.ts`. identifyChatEpicProposal:30 `type: body.frictionId ? "feature" : body.type || "feature"` et aucun champ `status` dans le payload haché.

</details>

### #203 — Sur-exportation vérifiée dans lib/mcp/servers.ts et lib/telescope/collect.ts

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:orphan-small-domains-and-docs

**Fichiers**
- `lib/mcp/servers.ts:163-180`
- `lib/mcp/servers.ts:686-700`
- `__tests__/mcp-servers-crud.test.ts:34`
- `lib/telescope/collect.ts:88-98`
- `lib/telescope/collect.ts:938-939`
- `lib/telescope/collect.ts:400-440`
- `app/api/projects/[projectId]/qa/check/route.ts:113-117`
- `components/qa/StartQaCheckDialog.tsx:109`
- `lib/claude/prompts/qa.ts:181-220`

**Constat**

Dans servers.ts, `mcpServerSecrets` et `McpServerSecrets` n'ont aucun appelant produit (le probe passe par `mcpServerSpecById`, le spawn par `resolveExtraMcpServers`) — seul __tests__/mcp-servers-crud.test.ts les importe. `validateMcpServerShape` et `McpServerShape` sont exportés « so the update path can re-validate after merging », mais ce chemin (`assertShape`) est dans le même fichier : aucun importeur externe. Les 12 autres exports à un seul importeur sont une API de module légitime (server-routes.ts, probe-route.ts, routes settings/projet, spawn) — pas de sur-exportation. Dans telescope : l'alias `collectFailureEvidence` (« for callers that already live under lib/telescope ») n'a aucun appelant ; `CollectFailureEvidenceOptions` expose 9 boutons dont un seul (`windowDays`) est câblé par la route ; le dialogue duplique le défaut `"14"` au lieu de TELESCOPE_WINDOW_DAYS. La collecte ne lit pas de chunks entiers en masse : une seule ligne (le dernier `sequence`) par session échouée, mais la colonne `content` est lue en entier puis tronquée en JS (trimTail) plutôt que via substr SQL. Tous les champs du résultat sont consommés : le prompt sérialise `collection.groups` en JSON.

**Précision du vérificateur**

Le finding tient sur tous ses points vérifiables (mcpServerSecrets/McpServerSecrets et validateMcpServerShape/McpServerShape sans appelant hors lib/mcp/servers.ts et __tests__/mcp-servers-crud.test.ts, commentaires justificatifs périmés ; alias collectFailureEvidence sans appelant ; 9 des 10 options de collecte non câblées, seul windowDays l'est ; défaut "14" dupliqué dans StartQaCheckDialog.tsx:109 au lieu de TELESCOPE_WINDOW_DAYS ; dernier chunk lu en entier puis tronqué en JS par trimTail plutôt qu'en SQL). Une seule inexactitude, dans le sens d'une sous-estimation : « tous les champs du résultat sont consommés » est faux — `payloadChars` de TelescopeCollectionResult (collect.ts:117, 921) n'a aucun consommateur produit (ni la route qa/check, ni lib/claude/prompts/qa.ts:206-217), uniquement des assertions de tests.

**Recommandation**

Retirer `mcpServerSecrets`/`McpServerSecrets` (adapter le test pour lire via `mcpServerSpecById`), passer `validateMcpServerShape`/`McpServerShape` en privé, supprimer l'alias telescope et réduire les options à celles réellement exposées (ou câbler `maxPayloadChars` depuis le réglage de budget de prompt). Lire `substr(content, -N)` en SQL pour le dernier chunk.

<details><summary>Preuve relevée par l'auditeur</summary>

`grep -rnw "mcpServerSecrets\|validateMcpServerShape\|McpServerSecrets\|McpServerShape"` hors servers.ts → uniquement __tests__/mcp-servers-crud.test.ts ; `grep -rnw collectFailureEvidence` hors collect.ts → vide ; qa/check/route.ts:115-117 `collectFailureDigestEvidence(projectId, { windowDays })` ; collect.ts:427-435 select `content: agentSessionChunks.content` puis `trimTail(row.content, maxChars)`.

</details>

### #215 — Exports de la façade prompt-builder et de prompt-sections sans consommateur produit après l'éclatement (pas de doublon façade/prompts, vérifié)

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/prompt-builder.ts:15-23`
- `lib/claude/prompt-builder.ts:41-48`
- `lib/claude/prompt-builder.ts:64-66`
- `lib/claude/prompt-builder.ts:81-83`
- `lib/claude/prompt-sections.ts:67`
- `lib/claude/prompt-sections.ts:155`
- `lib/claude/prompt-sections.ts:173`
- `lib/claude/prompt-sections.ts:386`
- `lib/claude/prompt-sections.ts:510`
- `lib/claude/untrusted.ts:53`
- `lib/claude/untrusted.ts:96`
- `lib/claude/untrusted.ts:143`

**Constat**

prompt-builder.ts ne fait qu'envelopper prompts/* dans withStoredProjectMemory : aucune fonction n'y est dupliquée. En revanche il ré-exporte des symboles que plus aucun module produit n'importe par la façade : userStoriesSection, BUG_RED_GREEN_SECTION, VISUAL_PROOF_SECTION, BUG_REVIEW_CHECKLIST, SPEC_UPDATE_MAX_EPICS / _STORIES_PER_EPIC / _RELEASES / _CHANGELOG_CHARS, CI_FIX_MAX_SPEC_BYTES, renderRefinementSnapshot (test-only, déjà connu). Dans prompt-sections.ts, PERSONA_HEADING, PROJECT_MEMORY_HEADING, TICKET_IMAGES_HEADING, EXTRA_MCP_SERVERS_SECTION_MAX_CHARS et PROMPT_AGENT_COMMENTS_KEPT ne sont lus que par des tests ; dans untrusted.ts, IMPERSONATING_TAG_NAMES, fenceLength et AGENT_OUTPUT_NOTICE ne sont utilisés que dans le module lui-même et deux tests.

**Précision du vérificateur**

Exact sur le fond : prompt-builder.ts (91 lignes) ne duplique aucune fonction de prompts/*, mais il ré-exporte des symboles qu'aucun module produit n'importe par la façade — userStoriesSection, BUG_RED_GREEN_SECTION, VISUAL_PROOF_SECTION, BUG_REVIEW_CHECKLIST, SPEC_UPDATE_MAX_EPICS/_STORIES_PER_EPIC/_RELEASES/_CHANGELOG_CHARS, CI_FIX_MAX_SPEC_BYTES, renderRefinementSnapshot. Confirmé a contrario : les sections encore vivantes (REVIEW_CHECKLISTS, personaSection, REVIEW_BOUNDARY_SECTION, PromptContextSectionKey) sont importées en prod directement depuis prompt-sections, jamais via la façade. Trois corrections : (a) PROMPT_AGENT_COMMENTS_KEPT n'est lu par aucun test — il est purement interne (prompt-sections.ts:550), c'est d'ailleurs le seul des noms cités qui puisse passer en const non exportée sans casser de test ; (b) prompt-builder compte 28 importeurs produit, pas 18 ; (c) la recommandation doit tenir compte de __tests__/prompt-builder-fencing.test.ts, qui énumère au runtime les fonctions exportées par la façade et exige leur classification — retirer les ré-exports de fonctions oblige à toucher ce test. BUG_RED_GREEN_SECTION, BUG_REVIEW_CHECKLIST, les quatre SPEC_UPDATE_MAX_* et CI_FIX_MAX_SPEC_BYTES sont les seuls réellement sans aucun lecteur (ni prod ni test) hors module d'origine. Portée : hygiène de surface d'API, aucun impact fonctionnel.

**Recommandation**

Retirer les ré-exports morts de la façade (les tests peuvent importer prompt-sections / prompts/* directement) et passer en `const` non exportées les constantes internes.

<details><summary>Preuve relevée par l'auditeur</summary>

Pour chaque nom : `grep -rlw <nom> app lib components hooks bin | grep -v "lib/claude/prompts/|prompt-builder.ts|prompt-sections.ts"` → vide pour userStoriesSection, BUG_RED_GREEN_SECTION, VISUAL_PROOF_SECTION, BUG_REVIEW_CHECKLIST, SPEC_UPDATE_MAX_* (×4), CI_FIX_MAX_SPEC_BYTES, renderRefinementSnapshot, PERSONA_HEADING, PROJECT_MEMORY_HEADING, TICKET_IMAGES_HEADING, EXTRA_MCP_SERVERS_SECTION_MAX_CHARS, PROMPT_AGENT_COMMENTS_KEPT, IMPERSONATING_TAG_NAMES, fenceLength, AGENT_OUTPUT_NOTICE. Les 18 importeurs produit de prompt-builder (grep `from "@/lib/claude/prompt-builder"`) n'importent que des build*Prompt, buildProjectStateSection, buildDeterministicVerification* et des types.

</details>

### #224 — Exports de findings.ts, parse-review-report.ts, merge-readiness.ts et champs de PipelineReviewAssessment sans consommateur produit (au-delà de POSITIVE_STRUCTURED_VERDICTS déjà signalé)

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/pipeline/findings.ts:159`
- `lib/pipeline/findings.ts:203-207`
- `lib/pipeline/findings.ts:223`
- `lib/pipeline/findings.ts:374`
- `lib/pipeline/findings.ts:743-756`
- `lib/pipeline/parse-review-report.ts:95`
- `lib/kanban/merge-readiness.ts:244`
- `lib/kanban/merge-readiness.ts:274-301`
- `lib/pipeline/runner.ts:154-175`
- `lib/pipeline/runner-stage-review.ts:36-44`

**Constat**

Réponse à (b). findings.ts : readStructuredReviewVerdict (:223) n'a plus qu'un test (pipeline-findings.test.ts) — remplacé par readReviewChannelState ; countAgentReviewCommentsSince (:159), NEGATIVE_VERDICT_SUBSTRINGS (:743), isNegativeProseVerdict (:749), readReviewChannelState (:374) ne sont importés que par des tests (usage interne au module sinon) ; les types ReviewChannelState, ReviewChannelRow, ReviewAssessment, ReviewVerdictDecision, BlockingFinding ne sont importés nulle part ; le bloc de ré-export de STRUCTURED_REVIEW_VERDICTS / NEGATIVE_STRUCTURED_VERDICT / StructuredReviewVerdict (:203-207) n'a aucun importeur via findings — tout le monde importe lib/review/verdict directement. parse-review-report.ts : parseLocation exporté, test-only. merge-readiness.ts : isMergeReady (:244, test-only), sortMergeColumn / isMergeReadyEpic / MergeReadinessCarrier (:274-301) ne sont cités que dans des commentaires (reorder.ts:6, control-desk/aggregate.ts:553). runner.ts:154-170 : PipelineReviewAssessment.agentCommentCount / usedProseFallback / structuredVerdict / verdictSource sont remplis par assessPipelineReview mais le runner ne lit que blocking, unverifiable et blockingCount (runner-stage-review.ts:36,44).

**Précision du vérificateur**

Confirmé, avec trois corrections. (1) Le bloc de ré-export de verdict.ts est aux lignes 202-206, pas 203-207. (2) parse-review-report.ts : `parseLocation` est exporté à la ligne 108 (pas 95) et il est appelé en interne au :257 — seul son `export` est test-only ; le retirer de l'API publique, pas le supprimer. (3) Les types ReviewChannelState / ReviewChannelRow / ReviewAssessment / ReviewVerdictDecision / BlockingFinding ne sont effectivement importés nulle part, mais ils typent le retour de fonctions consommées en production (assessReviewOutcome, collectBlockingFindings, resolveReviewVerdict dans lib/pipeline/stage-review.ts) : surface d'API légitime, à ne pas compter comme mort. Le noyau dur tient : `readStructuredReviewVerdict` (findings.ts:223) n'a aucun appelant, même pas interne ; countAgentReviewCommentsSince / isNegativeProseVerdict / NEGATIVE_VERDICT_SUBSTRINGS / readReviewChannelState sont utilisés en interne mais exportés pour les seuls tests ; le ré-export verdict.ts n'a aucun importeur ; isMergeReady / isMergeReadyEpic / sortMergeColumn / MergeReadinessCarrier n'ont aucun consommateur produit (deux commentaires seulement) ; agentCommentCount / usedProseFallback / verdictSource / structuredVerdict de PipelineReviewAssessment sont remplis et jamais lus. Nuance sur la recommandation : verdictSource est DÉJÀ tracé dans l'activity log par une autre voie (stage-review.ts:289/322/342 → automatic-transitions.ts:465/577, via decision.source), donc le champ du type est redondant plutôt qu'un chantier à finir.

**Recommandation**

Retirer readStructuredReviewVerdict et le ré-export de verdict.ts ; passer countAgentReviewCommentsSince, isNegativeProseVerdict, NEGATIVE_VERDICT_SUBSTRINGS, readReviewChannelState en non exportés (adapter les tests via assessReviewOutcome/resolveReviewVerdict) ; supprimer isMergeReady/sortMergeColumn/isMergeReadyEpic/MergeReadinessCarrier ; réduire PipelineReviewAssessment à ce que le runner lit (ou tracer verdictSource dans l'activity log, ce que le commentaire du type promet).

<details><summary>Preuve relevée par l'auditeur</summary>

Pour chaque symbole : grep -rlw <sym> app lib components hooks bin (hors findings.ts) → vide ; grep -rlw <sym> __tests__ → pipeline-findings.test.ts (readStructuredReviewVerdict, countAgentReviewCommentsSince, NEGATIVE_VERDICT_SUBSTRINGS, isNegativeProseVerdict), review-*.test.ts (readReviewChannelState), merge-readiness.test.ts (isMergeReady), parse-review-report.test.ts (parseLocation). grep sortMergeColumn → seulement deux commentaires. grep 'assessment\.' lib/pipeline/runner*.ts → .blocking, .unverifiable, .blockingCount uniquement.

</details>


## Annexe — relevés mécaniques à utiliser comme check-list

> Vérifier chaque symbole par `rg` avant suppression. Les entrées « importé seulement par des tests » demandent un arbitrage (hook de test assumé ou contrat jamais branché).

### Exports morts — lib/ cœur (422 entrées)

- `lib/agent-sessions/artifact-view.ts` · `(fichier entier)` — FICHIER SANS AUCUN IMPORTEUR — 16 lignes, aucune occurrence de 'artifact-view' nulle part dans le dépôt ; ses 2 exports sont des orphelins totaux. Candidat à la suppression pure.
- `lib/workflow/story-transition.ts` · `(fichier entier)` — FICHIER SANS AUCUN IMPORTEUR — 126 lignes, aucune occurrence de 'story-transition' hors docs/architecture/ticket-state-machine.md. Doublon mort d'applyStoryTransition : l'implémentation vivante est lib/workflow/transition-service.ts:247 (importée par app/api/.../user-stories/route.ts, .../stories/[storyId]/approve/route.ts, lib/sync/import.ts, lib/workflow/automatic-transitions.ts). Confirme « toujours ouvert » le finding du 06/09.
- `lib/tokens/dispatch-prompt.ts` · `appendPromptSections` — a — ORPHELIN TOTAL (ligne 99) : le nom n'apparaît nulle part hors de sa déclaration.
- `lib/agent-sessions/artifact-view.ts` · `SessionArtifactSummary` — a — ORPHELIN TOTAL (ligne 2), dans un fichier lui-même sans importeur.
- `lib/agent-sessions/artifact-view.ts` · `sessionArtifactUrl` — a — ORPHELIN TOTAL (ligne 11), dans un fichier lui-même sans importeur.
- `lib/agent-config/agent-resolution.ts` · `ResolvedAgentConfig` — a — ORPHELIN TOTAL (ligne 53) : interface exportée jamais référencée, même pas dans son fichier.
- `lib/agent-config/composite-agents.ts` · `readMemberCliOptions` — a — ORPHELIN TOTAL (ligne 82).
- `lib/pipeline/constants.ts` · `pipelineReasonTone` — a — ORPHELIN TOTAL (ligne 281) ; son type de retour PipelineReasonTone (ligne 279) n'existe que pour elle.
- `lib/pipeline/findings.ts` · `POSITIVE_STRUCTURED_VERDICTS` — a — ORPHELIN TOTAL (ligne 272).
- `lib/workflow/dreaming-constants.ts` · `resolveDreamingAfterNightRunDefault` — a — ORPHELIN TOTAL (ligne 125).
- `lib/workflow/merge-failure.ts` · `GitRefusalMergeReason` — a — ORPHELIN TOTAL (ligne 96) ; le garde isGitRefusalMergeReason (ligne 103) qui la borde est, lui, bien utilisé en prod.
- `lib/routines/scheduler.ts` · `getRoutineScheduler` — a — ORPHELIN TOTAL (ligne 334) : accesseur du singleton jamais appelé (instrumentation.ts n'utilise que startRoutineScheduler ; les tests instancient RoutineScheduler directement).
- `lib/claude/json-parser.ts` · `ClaudeJsonBlock` — a — interface, 0 importeur, usage interne x9 (ligne 9)
- `lib/claude/json-parser.ts` · `ParsedClaudeOutput` — a — interface, 0 importeur, usage interne x4 (ligne 20)
- `lib/claude/json-parser.ts` · `ParsedOutputUsage` — a — interface, 0 importeur, usage interne x4 (ligne 81)
- `lib/claude/mcp-injection.ts` · `arijMcpShimPath` — a — function, 0 importeur, usage interne x1 (ligne 68)
- `lib/claude/mcp-injection.ts` · `ARIJ_MCP_AGENT_TOOLS` — a — const, 0 importeur, usage interne x3 (ligne 73)
- `lib/claude/mcp-injection.ts` · `ARIJ_MCP_CHAT_TOOLS` — a — const, 0 importeur, usage interne x2 (ligne 109)
- `lib/claude/mcp-injection.ts` · `ArijMcpToolset` — a — type, 0 importeur, usage interne x1 (ligne 199)
- `lib/claude/mcp-injection.ts` · `McpChannelRecord` — a — type, 0 importeur, usage interne x1 (ligne 336)
- `lib/claude/mcp-injection.ts` · `MCP_CONFIG_DIR_PREFIX` — a — const, 0 importeur, usage interne x2 (ligne 448)
- `lib/claude/mcp-injection.ts` · `MCP_CONFIG_FILE_NAME` — a — const, 0 importeur, usage interne x1 (ligne 451)
- `lib/claude/process-manager.ts` · `TrackedSession` — a — interface, 0 importeur, usage interne x3 (ligne 45)
- `lib/claude/prompt-builder.ts` · `PromptCiFailure` — a — interface, 0 importeur, usage interne x1 (ligne 134)
- `lib/claude/prompt-builder.ts` · `BuildPromptOptions` — a — interface, 0 importeur, usage interne x2 (ligne 226)
- `lib/claude/prompt-builder.ts` · `PromptEpicStatus` — a — interface, 0 importeur, usage interne x1 (ligne 233)
- `lib/claude/prompt-builder.ts` · `PromptUserStoryStatus` — a — interface, 0 importeur, usage interne x2 (ligne 239)
- `lib/claude/prompt-builder.ts` · `PromptReleaseSummary` — a — interface, 0 importeur, usage interne x1 (ligne 245)
- `lib/claude/prompt-builder.ts` · `SPEC_UPDATE_MAX_EPICS` — a — const, 0 importeur, usage interne x3 (ligne 387)
- `lib/claude/prompt-builder.ts` · `SPEC_UPDATE_MAX_STORIES_PER_EPIC` — a — const, 0 importeur, usage interne x3 (ligne 388)
- `lib/claude/prompt-builder.ts` · `SPEC_UPDATE_MAX_RELEASES` — a — const, 0 importeur, usage interne x3 (ligne 389)
- `lib/claude/prompt-builder.ts` · `SPEC_UPDATE_MAX_CHANGELOG_CHARS` — a — const, 0 importeur, usage interne x2 (ligne 390)
- `lib/claude/prompt-builder.ts` · `CI_FIX_MAX_SPEC_BYTES` — a — const, 0 importeur, usage interne x2 (ligne 1160)
- `lib/claude/prompt-builder.ts` · `MemoryDistillSessionContext` — a — interface, 0 importeur, usage interne x1 (ligne 1804)
- `lib/claude/prompt-builder.ts` · `SpecRewriteReleaseContext` — a — interface, 0 importeur, usage interne x1 (ligne 2057)
- `lib/claude/prompt-comments.ts` · `PromptCommentScope` — a — type, 0 importeur, usage interne x1 (ligne 15)
- `lib/claude/prompt-sections.ts` · `PROMPT_AGENT_COMMENTS_KEPT` — a — const, 0 importeur, usage interne x1 (ligne 510)
- `lib/claude/spawn.ts` · `SpawnedClaude` — a — interface, 0 importeur, usage interne x1 (ligne 64)
- `lib/claude/spawn.ts` · `QuestionOption` — a — interface, 0 importeur, usage interne x1 (ligne 76)
- `lib/claude/spawn.ts` · `SpawnedClaudeStream` — a — interface, 0 importeur, usage interne x1 (ligne 93)
- `lib/claude/spawn.ts` · `PreparedClaudeSpawn` — a — interface, 0 importeur, usage interne x1 (ligne 208)
- `lib/claude/visual-proof.ts` · `VISUAL_PROOF_ENABLED_SETTING_KEY` — a — const, 0 importeur, usage interne x1 (ligne 6) : clé de réglage 'visual_proof_enabled' lue seulement ici
- `lib/providers/agy.ts` · `AgyJsonEnvelope` — a — interface, 0 importeur, usage interne x1 (ligne 67)
- `lib/providers/omp-version.ts` · `OmpVersionProbe` — a — type, 0 importeur, usage interne x1 (ligne 50)
- `lib/providers/options-registry.ts` · `ProviderOptionType` — a — type, 0 importeur, usage interne x1 (ligne 53)
- `lib/providers/options-registry.ts` · `ProviderOptionValue` — a — type, 0 importeur, usage interne x6 (ligne 56)
- `lib/providers/options-registry.ts` · `ProviderOptionChoice` — a — interface, 0 importeur, usage interne x4 (ligne 61)
- `lib/providers/options-registry.ts` · `isProviderOptionDefault` — a — function, 0 importeur, usage interne x2 (ligne 316)
- `lib/providers/options-registry.ts` · `ProviderOptionValidation` — a — interface, 0 importeur, usage interne x1 (ligne 324)
- `lib/providers/options-registry.ts` · `ProviderOptionArgsContext` — a — interface, 0 importeur, usage interne x1 (ligne 506)
- `lib/providers/pi.ts` · `PI_READONLY_TOOLS` — a — const, 0 importeur, usage interne x1 (ligne 77)
- `lib/providers/pi.ts` · `PiAssistantMessage` — a — interface, 0 importeur, usage interne x2 (ligne 81)
- `lib/providers/types.ts` · `ProviderChunkStreamType` — a — type, 0 importeur, usage interne x1 (ligne 22)
- `lib/providers/types.ts` · `McpHttpServerSpec` — a — interface, 0 importeur, usage interne x1 (ligne 67)
- `lib/openai/client.ts` · `OpenAiTestResult` — a — type, 0 importeur, usage interne x1 (ligne 258)
- `lib/openai/client.ts` · `OpenAiStreamOptions` — a — interface, 0 importeur, usage interne x1 (ligne 485)
- `lib/tokens/budget.ts` · `PromptBudgetCheckResult` — a — interface, 0 importeur, usage interne x1 (ligne 51)
- `lib/tokens/dispatch-prompt.ts` · `AssembledDispatchPrompt` — a — interface, 0 importeur, usage interne x8 (ligne 40)
- `lib/tokens/dispatch-prompt.ts` · `AdditionalPromptSection` — a — interface, 0 importeur, usage interne x1 (ligne 47)
- `lib/tokens/dispatch-prompt.ts` · `AssembleEpicBuildPromptOptions` — a — interface, 0 importeur, usage interne x1 (ligne 143)
- `lib/tokens/dispatch-prompt.ts` · `AssembleStoryBuildPromptOptions` — a — interface, 0 importeur, usage interne x1 (ligne 269)
- `lib/tokens/dispatch-prompt.ts` · `AssembleEpicReviewPromptOptions` — a — interface, 0 importeur, usage interne x1 (ligne 330)
- `lib/tokens/dispatch-prompt.ts` · `AssembleStoryReviewPromptOptions` — a — interface, 0 importeur, usage interne x1 (ligne 384)
- `lib/tokens/dispatch-prompt.ts` · `AssembleGradingPromptOptions` — a — interface, 0 importeur, usage interne x1 (ligne 433)
- `lib/tokens/estimator.ts` · `SECTION_LABELS` — a — const, 0 importeur, usage interne x1 (ligne 66)
- `lib/agent-sessions/arij-action-scan.ts` · `ARIJ_ACTION_SCAN_MAX_CHUNKS` — a — const, 0 importeur, usage interne x1 (ligne 45)
- `lib/agent-sessions/arij-action-scan.ts` · `ArijToolCallScanResult` — a — interface, 0 importeur, usage interne x1 (ligne 65)
- `lib/agent-sessions/arij-actions.ts` · `ARIJ_MCP_TOOL_PREFIX` — a — const, 0 importeur, usage interne x4 (ligne 38)
- `lib/agent-sessions/arij-actions.ts` · `ArijActionKind` — a — type, 0 importeur, usage interne x3 (ligne 48)
- `lib/agent-sessions/arij-actions.ts` · `CollectArijActionsOptions` — a — interface, 0 importeur, usage interne x2 (ligne 367)
- `lib/agent-sessions/artifacts.ts` · `MAX_SESSION_ARTIFACTS` — a — const, 0 importeur, usage interne x2 (ligne 14)
- `lib/agent-sessions/artifacts.ts` · `ArtifactImageType` — a — type, 0 importeur, usage interne x2 (ligne 17)
- `lib/agent-sessions/artifacts.ts` · `SessionArtifactErrorCode` — a — type, 0 importeur, usage interne x1 (ligne 19)
- `lib/agent-sessions/artifacts.ts` · `AttachSessionArtifactInput` — a — interface, 0 importeur, usage interne x1 (ligne 42)
- `lib/agent-sessions/artifacts.ts` · `AttachSessionArtifactOptions` — a — interface, 0 importeur, usage interne x1 (ligne 49)
- `lib/agent-sessions/backfill.ts` · `BackfillRecentSessionsInput` — a — interface, 0 importeur, usage interne x1 (ligne 7)
- `lib/agent-sessions/backfill.ts` · `BackfillRecentSessionsResult` — a — interface, 0 importeur, usage interne x2 (ligne 12)
- `lib/agent-sessions/chunk-prune.ts` · `PRUNABLE_SESSION_STATUSES` — a — const, 0 importeur, usage interne x2 (ligne 47)
- `lib/agent-sessions/chunk-prune.ts` · `SessionChunkPruneOptions` — a — interface, 0 importeur, usage interne x3 (ligne 71)
- `lib/agent-sessions/chunk-prune.ts` · `SessionChunkPruner` — a — interface, 0 importeur, usage interne x1 (ligne 147)
- `lib/agent-sessions/chunks.ts` · `SessionChunk` — a — interface, 0 importeur, usage interne x7 (ligne 26)
- `lib/agent-sessions/chunks.ts` · `SESSION_CHUNK_PAGE_DEFAULT_LIMIT` — a — const, 0 importeur, usage interne x1 (ligne 40)
- `lib/agent-sessions/chunks.ts` · `SessionChunkPageOptions` — a — interface, 0 importeur, usage interne x4 (ligne 106)
- `lib/agent-sessions/chunks.ts` · `AppendSessionChunkInput` — a — interface, 0 importeur, usage interne x4 (ligne 232)
- `lib/agent-sessions/chunks.ts` · `AppendSessionChunkResult` — a — interface, 0 importeur, usage interne x4 (ligne 240)
- `lib/agent-sessions/dispatch-background-session.ts` · `BackgroundSessionRun` — a — interface, 0 importeur, usage interne x3 (ligne 81)
- `lib/agent-sessions/dispatch-background-session.ts` · `BackgroundSessionVerdict` — a — interface, 0 importeur, usage interne x3 (ligne 92)
- `lib/agent-sessions/dispatch-background-session.ts` · `BackgroundSessionTerminal` — a — interface, 0 importeur, usage interne x2 (ligne 98)
- `lib/agent-sessions/dispatch-background-session.ts` · `BackgroundSessionSettled` — a — interface, 0 importeur, usage interne x5 (ligne 114)
- `lib/agent-sessions/dispatch-background-session.ts` · `DispatchBackgroundSessionInput` — a — interface, 0 importeur, usage interne x1 (ligne 123)
- `lib/agent-sessions/dispatch-background-session.ts` · `DispatchedBackgroundSession` — a — interface, 0 importeur, usage interne x2 (ligne 219)
- `lib/agent-sessions/failure-message.ts` · `SessionResultLike` — a — interface, 0 importeur, usage interne x2 (ligne 26)
- `lib/agent-sessions/failure-message.ts` · `SessionFailureMessageInput` — a — interface, 0 importeur, usage interne x1 (ligne 36)
- `lib/agent-sessions/head-tail-cap.ts` · `HeadTailCapOptions` — a — interface, 0 importeur, usage interne x1 (ligne 16)
- `lib/agent-sessions/lifecycle.ts` · `SESSION_NOT_FOUND_CODE` — a — const, 0 importeur, usage interne x1 (ligne 83)
- `lib/agent-sessions/lifecycle.ts` · `SessionLifecycleSnapshot` — a — interface, 0 importeur, usage interne x2 (ligne 96)
- `lib/agent-sessions/lifecycle.ts` · `SessionLifecycleConflictDetails` — a — interface, 0 importeur, usage interne x2 (ligne 112)
- `lib/agent-sessions/lifecycle.ts` · `SessionNotFoundError` — a — class, 0 importeur, usage interne x4 (ligne 131) : levée en interne, jamais attrapée par nom ailleurs (contrairement à SessionLifecycleConflictError, utilisée par les tests)
- `lib/agent-sessions/lifecycle.ts` · `SessionTransitionPatch` — a — interface, 0 importeur, usage interne x6 (ligne 213)
- `lib/agent-sessions/lifecycle.ts` · `TransitionSessionStatusInput` — a — interface, 0 importeur, usage interne x1 (ligne 295)
- `lib/agent-sessions/lifecycle.ts` · `backfillMissingSessionLog` — a — function, 0 importeur, usage interne x1 (ligne 521, appelée ligne 353)
- `lib/agent-sessions/prompt-backfill.ts` · `SessionPromptBackfillOptions` — a — interface, 0 importeur, usage interne x2 (ligne 54)
- `lib/agent-sessions/prompt-backfill.ts` · `SessionPromptBackfiller` — a — interface, 0 importeur, usage interne x1 (ligne 71)
- `lib/agent-sessions/retry-dispatch.ts` · `RetryDispatch` — a — interface, 0 importeur, usage interne x2 (ligne 33)
- `lib/agent-sessions/servable-artifacts.ts` · `ServableSessionArtifact` — a — interface, 0 importeur, usage interne x1 (ligne 22)
- `lib/agent-sessions/servable-artifacts.ts` · `SessionArtifactLookup` — a — type, 0 importeur, usage interne x1 (ligne 28)
- `lib/agent-sessions/session-detail.ts` · `SESSION_CHUNK_MAX_PAGES` — a — const, 0 importeur, usage interne x2 (ligne 104)
- `lib/agent-sessions/session-detail.ts` · `SESSION_ARIJ_ACTIONS_MAX_PAGES` — a — const, 0 importeur, usage interne x2 (ligne 118)
- `lib/agent-sessions/session-detail.ts` · `SessionArijAction` — a — interface, 0 importeur, usage interne x3 (ligne 121)
- `lib/agent-sessions/session-detail.ts` · `SessionArijActionsResponse` — a — interface, 0 importeur, usage interne x2 (ligne 134)
- `lib/agent-sessions/session-detail.ts` · `SessionChunkPageResponse` — a — interface, 0 importeur, usage interne x3 (ligne 189)
- `lib/agent-sessions/session-list.ts` · `UnifiedSessionListPage` — a — interface, 0 importeur, usage interne x1 (ligne 43)
- `lib/agent-sessions/session-list.ts` · `UnifiedSessionPagingOptions` — a — interface, 0 importeur, usage interne x3 (ligne 49)
- `lib/agent-sessions/session-list.ts` · `FetchUnifiedSessionsOptions` — a — interface, 0 importeur, usage interne x1 (ligne 61)
- `lib/agent-sessions/terminal-hooks.ts` · `SessionTerminalHook` — a — type, 0 importeur, usage interne x2 (ligne 22)
- `lib/agent-config/agent-resolution.ts` · `ProviderSource` — a — type, 0 importeur, usage interne x2 (ligne 26)
- `lib/agent-config/agent-resolution.ts` · `AgentResolveSource` — a — type, 0 importeur, usage interne x1 (ligne 27)
- `lib/agent-config/agent-resolution.ts` · `ResolvedAgentProvider` — a — interface, 0 importeur, usage interne x2 (ligne 44)
- `lib/agent-config/agent-resolution.ts` · `CompositeRankResolution` — a — interface, 0 importeur, usage interne x1 (ligne 313)
- `lib/agent-config/agent-resolution.ts` · `AgentResolutionContext` — a — interface, 0 importeur, usage interne x1 (ligne 326)
- `lib/agent-config/agent-stats.ts` · `AgentRoleSplitRow` — a — interface, 0 importeur, usage interne x1 (ligne 58)
- `lib/agent-config/agent-stats.ts` · `AGENT_STATS_WINDOW_DAYS` — a — const, 0 importeur, usage interne x2 (ligne 78)
- `lib/agent-config/agent-stats.ts` · `NamedAgentStatsQuery` — a — interface, 0 importeur, usage interne x1 (ligne 158)
- `lib/agent-config/constants.ts` · `BUILTIN_REVIEW_TYPES` — a — const, 0 importeur, usage interne x1 (ligne 114)
- `lib/agent-config/constants.ts` · `CLAUDE_CODE_PERSISTENT_PROVIDER` — a — const, 0 importeur, usage interne x2 (ligne 210)
- `lib/agent-config/constants.ts` · `OH_MY_PI_PERSISTENT_PROVIDER` — a — const, 0 importeur, usage interne x1 (ligne 212)
- `lib/agent-config/dispatch-reliability-constants.ts` · `RELIABILITY_EM_DASH` — a — const, 0 importeur, usage interne x3 (ligne 129)
- `lib/agent-config/named-agents.ts` · `NamedAgentRuntimeConfig` — a — interface, 0 importeur, usage interne x2 (ligne 526)
- `lib/agent-config/review-agents.ts` · `CustomReviewAgentRecord` — a — interface, 0 importeur, usage interne x4 (ligne 5)
- `lib/agent-config/review-segregation.ts` · `ReviewSegregationTarget` — a — interface, 0 importeur, usage interne x2 (ligne 38)
- `lib/agent-config/smart-dispatch.ts` · `SmartDispatchQuery` — a — interface, 0 importeur, usage interne x1 (ligne 98)
- `lib/agent-config/stats.ts` · `AgentReliabilityRow` — a — interface, 0 importeur, usage interne x1 (ligne 28)
- `lib/agent-config/stats.ts` · `DispatchReliabilityQuery` — a — interface, 0 importeur, usage interne x1 (ligne 187)
- `lib/agents/concurrency.ts` · `AgentTaskTarget` — a — type, 0 importeur, usage interne x3 (ligne 17)
- `lib/agents/dag-batch-registry.ts` · `DagBatchCounts` — a — type, 0 importeur, usage interne x3 (ligne 19)
- `lib/agents/scheduler.ts` · `SchedulerProjectCounts` — a — interface, 0 importeur, usage interne x1 (ligne 68)
- `lib/agents/scheduler.ts` · `SubmitResult` — a — interface, 0 importeur, usage interne x1 (ligne 74)
- `lib/agents/scheduler.ts` · `AgentSchedulerOptions` — a — interface, 0 importeur, usage interne x1 (ligne 103)
- `lib/agents/watchdog.ts` · `StalledSessionNotice` — a — interface, 0 importeur, usage interne x2 (ligne 143)
- `lib/mcp/board-tool-route.ts` · `BOARD_TOOL_ALLOWED_AGENT_TYPES` — a — const, 0 importeur, usage interne x2 (ligne 78)
- `lib/mcp/board-tool-route.ts` · `requireChatToolsetToken` — a — function, 0 importeur, usage interne x1 (ligne 85, appelée ligne 116) : garde de sécurité exportée mais consommée uniquement sur place
- `lib/mcp/create-bug.ts` · `CreateBugFromMcpResult` — a — type, 0 importeur, usage interne x1 (ligne 58)
- `lib/mcp/probe.ts` · `MCP_PROBE_TIMEOUT_MS` — a — const, 0 importeur, usage interne x1 (ligne 43)
- `lib/mcp/probe.ts` · `MCP_PROBE_MAX_TOOL_NAMES` — a — const, 0 importeur, usage interne x1 (ligne 46)
- `lib/mcp/probe.ts` · `McpProbeResult` — a — interface, 0 importeur, usage interne x2 (ligne 64)
- `lib/mcp/refinement.ts` · `isRefinementStatus` — a — function, 0 importeur, usage interne x1 (ligne 41)
- `lib/mcp/refinement.ts` · `refinementStatusGuard` — a — function, 0 importeur, usage interne x1 (ligne 76, appelée ligne 158)
- `lib/mcp/review-channel-failure.ts` · `REVIEW_CHANNEL_FAILURE_REASON_PREFIX` — a — const, 0 importeur, usage interne x2 (ligne 74)
- `lib/mcp/servers.ts` · `McpServerShape` — a — interface, 0 importeur, usage interne x2 (ligne 169)
- `lib/mcp/servers.ts` · `validateMcpServerShape` — a — function, 0 importeur, usage interne x2 (ligne 180)
- `lib/mcp/servers.ts` · `CreateMcpServerInput` — a — type, 0 importeur, usage interne x1 (ligne 261)
- `lib/mcp/servers.ts` · `UpdateMcpServerInput` — a — type, 0 importeur, usage interne x2 (ligne 262)
- `lib/mcp/servers.ts` · `McpServerSecrets` — a — interface, 0 importeur, usage interne x1 (ligne 687)
- `lib/mcp/servers.ts` · `ProjectMcpServersView` — a — interface, 0 importeur, usage interne x1 (ligne 836)
- `lib/mcp/token-store.ts` · `MintMcpTokenContext` — a — interface, 0 importeur, usage interne x1 (ligne 43)
- `lib/mcp/user-global-sync.ts` · `MCP_USER_GLOBAL_SYNC_SETTING_KEY` — a — const, 0 importeur, usage interne x1 (ligne 120)
- `lib/mcp/user-global-sync.ts` · `userGlobalManifestPath` — a — function, 0 importeur, usage interne x1 (ligne 143)
- `lib/pipeline/constants.ts` · `PipelineReasonTone` — a — type, 0 importeur, usage interne x1 (ligne 279) : n'existe que pour pipelineReasonTone, elle-même orpheline totale
- `lib/pipeline/constants.ts` · `PIPELINE_TERMINAL_STATES` — a — const, 0 importeur, usage interne x1 (ligne 327)
- `lib/pipeline/findings.ts` · `BlockingFinding` — a — interface, 0 importeur, usage interne x4 (ligne 99)
- `lib/pipeline/findings.ts` · `ReviewChannelState` — a — interface, 0 importeur, usage interne x1 (ligne 336)
- `lib/pipeline/findings.ts` · `ReviewChannelRow` — a — interface, 0 importeur, usage interne x1 (ligne 432)
- `lib/pipeline/findings.ts` · `ReviewAssessment` — a — interface, 0 importeur, usage interne x1 (ligne 906)
- `lib/pipeline/findings.ts` · `ReviewVerdictDecision` — a — interface, 0 importeur, usage interne x1 (ligne 1041)
- `lib/pipeline/forensic.ts` · `ForensicStageResult` — a — type, 0 importeur, usage interne x1 (ligne 111)
- `lib/pipeline/forensic.ts` · `RunForensicInput` — a — interface, 0 importeur, usage interne x1 (ligne 113)
- `lib/pipeline/forensic.ts` · `RunForensicResult` — a — interface, 0 importeur, usage interne x2 (ligne 129)
- `lib/pipeline/index.ts` · `resolvePipelineMaxAttempts` — a — function, 0 importeur, usage interne x1 (ligne 130, appelée ligne 234) — export du barrel non consommé
- `lib/pipeline/index.ts` · `resolvePipelineMaxFixCycles` — a — function, 0 importeur, usage interne x1 (ligne 142, appelée ligne 242) — export du barrel non consommé
- `lib/pipeline/parse-review-report.ts` · `FindingSeverity` — a — type, 0 importeur, usage interne x4 (ligne 48)
- `lib/pipeline/registry.ts` · `PipelineRunPatch` — a — type, 0 importeur, usage interne x1 (ligne 30)
- `lib/pipeline/runner-context.ts` · `PipelineRunState` — a — interface, 0 importeur, usage interne x2 (ligne 25)
- `lib/pipeline/runner-deterministic-verification.ts` · `DeterministicVerificationStep` — a — type, 0 importeur, usage interne x1 (ligne 17)
- `lib/pipeline/runner.ts` · `PipelineForensicHandle` — a — interface, 0 importeur, usage interne x1 (ligne 202)
- `lib/pipeline/stage-resume.ts` · `StageResumeDecision` — a — interface, 0 importeur, usage interne x1 (ligne 26)
- `lib/pipeline/stage-session.ts` · `StageSessionLaunch` — a — interface, 0 importeur, usage interne x1 (ligne 44)
- `lib/pipeline/stages.ts` · `PipelineStageDriver` — a — interface, 0 importeur, usage interne x1 (ligne 75)
- `lib/pipeline/verify.ts` · `VerifyGateIdentity` — a — interface, 0 importeur, usage interne x2 (ligne 51)
- `lib/workflow/agent-question.ts` · `AskedQuestionOutcomeInput` — a — interface, 0 importeur, usage interne x1 (ligne 18)
- `lib/workflow/automatic-transitions.ts` · `BuildScope` — a — type, 0 importeur, usage interne x7 (ligne 22)
- `lib/workflow/automatic-transitions.ts` · `BuildCompletionResult` — a — type, 0 importeur, usage interne x2 (ligne 31)
- `lib/workflow/automatic-transitions.ts` · `TicketPullbackOpts` — a — interface, 0 importeur, usage interne x3 (ligne 659)
- `lib/workflow/automatic-transitions.ts` · `BuildSessionResult` — a — interface, 0 importeur, usage interne x2 (ligne 800)
- `lib/workflow/dreaming-constants.ts` · `DREAMING_LAST_CUTOFF_SETTING_KEY` — a — const, 0 importeur, usage interne x1 (ligne 154)
- `lib/workflow/dreaming-digest.ts` · `DreamWindow` — a — interface, 0 importeur, usage interne x1 (ligne 50)
- `lib/workflow/dreaming-digest.ts` · `DreamedMemoryValidation` — a — interface, 0 importeur, usage interne x1 (ligne 245)
- `lib/workflow/dreaming.ts` · `CollectDreamDigestOptions` — a — interface, 0 importeur, usage interne x2 (ligne 109)
- `lib/workflow/dreaming.ts` · `DreamDigestResult` — a — interface, 0 importeur, usage interne x1 (ligne 117)
- `lib/workflow/dreaming.ts` · `DreamDecision` — a — interface, 0 importeur, usage interne x3 (ligne 690)
- `lib/workflow/dreaming.ts` · `NightRunDreamContext` — a — interface, 0 importeur, usage interne x1 (ligne 793)
- `lib/workflow/dreaming.ts` · `DispatchDreamingInput` — a — interface, 0 importeur, usage interne x1 (ligne 862)
- `lib/workflow/dreaming.ts` · `DispatchDreamingResult` — a — interface, 0 importeur, usage interne x1 (ligne 874)
- `lib/workflow/engine.ts` · `TransitionValidationResult` — a — interface, 0 importeur, usage interne x1 (ligne 266)
- `lib/workflow/memory-distill.ts` · `MEMORY_DISTILL_SUMMARY_MAX_CHARS` — a — const, 0 importeur, usage interne x2 (ligne 70)
- `lib/workflow/memory-distill.ts` · `isMemoryAutoDistillEnabled` — a — function, 0 importeur, usage interne x1 (ligne 87, appelée ligne 321)
- `lib/workflow/memory-distill.ts` · `AutoDistillDecision` — a — interface, 0 importeur, usage interne x2 (ligne 114)
- `lib/workflow/memory-distill.ts` · `MemoryDistillSourceError` — a — class, 0 importeur, usage interne x3 (ligne 199)
- `lib/workflow/memory-distill.ts` · `DistillSourceCandidate` — a — interface, 0 importeur, usage interne x2 (ligne 210)
- `lib/workflow/memory-distill.ts` · `DistillSourceEligibility` — a — interface, 0 importeur, usage interne x1 (ligne 217)
- `lib/workflow/memory-distill.ts` · `nightRunDreamWillFollow` — a — function, 0 importeur, usage interne x2 (ligne 290, appelée ligne 346)
- `lib/workflow/memory-distill.ts` · `DispatchMemoryDistillInput` — a — interface, 0 importeur, usage interne x1 (ligne 371)
- `lib/workflow/memory-distill.ts` · `DispatchMemoryDistillResult` — a — interface, 0 importeur, usage interne x1 (ligne 379)
- `lib/workflow/merge-failure.ts` · `MERGE_BLOCKED_PREFIX` — a — const, 0 importeur, usage interne x2 (ligne 63)
- `lib/workflow/merge-failure.ts` · `MERGE_CONFLICT_MARKERS_BLOCKED_PREFIX` — a — const, 0 importeur, usage interne x2 (ligne 74)
- `lib/workflow/reorder.ts` · `ReorderContext` — a — interface, 0 importeur, usage interne x1 (ligne 26)
- `lib/workflow/reorder.ts` · `ReorderTicketsResult` — a — type, 0 importeur, usage interne x1 (ligne 60)
- `lib/workflow/review-freshness.ts` · `EpicSessionFacts` — a — interface, 0 importeur, usage interne x1 (ligne 323)
- `lib/workflow/spec-auto-rewrite.ts` · `isSpecAutoRewriteEnabled` — a — function, 0 importeur, usage interne x1 (ligne 57, appelée ligne 135)
- `lib/workflow/spec-auto-rewrite.ts` · `SpecAutoRewriteDecision` — a — interface, 0 importeur, usage interne x2 (ligne 93)
- `lib/workflow/spec-auto-rewrite.ts` · `DispatchSpecAutoRewriteInput` — a — interface, 0 importeur, usage interne x1 (ligne 171)
- `lib/workflow/spec-auto-rewrite.ts` · `DispatchSpecAutoRewriteResult` — a — interface, 0 importeur, usage interne x1 (ligne 177)
- `lib/workflow/spec-update.ts` · `DispatchSpecUpdateInput` — a — interface, 0 importeur, usage interne x1 (ligne 46)
- `lib/workflow/spec-update.ts` · `DispatchSpecUpdateResult` — a — interface, 0 importeur, usage interne x1 (ligne 54)
- `lib/workflow/story-transition.ts` · `StoryTransitionResult` — a — interface, 0 importeur, usage interne x1 (ligne 32) — dans le fichier entièrement orphelin
- `lib/workflow/transition-service.ts` · `ApplyTransitionOpts` — a — interface, 0 importeur, usage interne x3 (ligne 18)
- `lib/workflow/transition-service.ts` · `SkippedStory` — a — interface, 0 importeur, usage interne x2 (ligne 46)
- `lib/workflow/transition-service.ts` · `CompleteReviewedStoriesOpts` — a — interface, 0 importeur, usage interne x1 (ligne 88)
- `lib/auto-mode/engine.ts` · `AutoModeDispatchResult` — a — interface, 0 importeur, usage interne x2 (ligne 126)
- `lib/auto-mode/engine.ts` · `AutoModeSweepResult` — a — interface, 0 importeur, usage interne x9 (ligne 450)
- `lib/auto-mode/engine.ts` · `AUTO_MODE_KICK_DELAY_MS` — a — const, 0 importeur, usage interne x1 (ligne 1855)
- `lib/auto-mode/merge.ts` · `TryAutoMergeOptions` — a — interface, 0 importeur, usage interne x2 (ligne 107)
- `lib/auto-mode/registry.ts` · `AUTO_MODE_RECENT_LIMIT` — a — const, 0 importeur, usage interne x2 (ligne 23)
- `lib/auto-mode/registry.ts` · `AutoModeDispatchKind` — a — type, 0 importeur, usage interne x1 (ligne 25)
- `lib/auto-mode/registry.ts` · `AutoModeSnapshot` — a — interface, 0 importeur, usage interne x1 (ligne 52)
- `lib/auto-mode/registry.ts` · `AutoModeRegistry` — a — class, 0 importeur, usage interne x3 (ligne 171) : instanciée seulement par getAutoModeRegistry (non exportée) dans le même fichier
- `lib/auto-mode/select.ts` · `AutoBuildCandidate` — a — interface, 0 importeur, usage interne x2 (ligne 134)
- `lib/auto-mode/select.ts` · `AutoReviewCandidate` — a — interface, 0 importeur, usage interne x1 (ligne 144)
- `lib/auto-mode/select.ts` · `AutoMergeCandidate` — a — interface, 0 importeur, usage interne x1 (ligne 151)
- `lib/night/registry.ts` · `NIGHT_RECENT_RUNS_LIMIT` — a — const, 0 importeur, usage interne x2 (ligne 17)
- `lib/night/registry.ts` · `NightRunEpicState` — a — interface, 0 importeur, usage interne x2 (ligne 20)
- `lib/night/registry.ts` · `NightRunPatch` — a — type, 0 importeur, usage interne x1 (ligne 65)
- `lib/night/run.ts` · `StartNightRunInput` — a — interface, 0 importeur, usage interne x1 (ligne 71)
- `lib/night/run.ts` · `StartNightRunHandle` — a — interface, 0 importeur, usage interne x1 (ligne 91)
- `lib/night/run.ts` · `NightBreakerObservation` — a — type, 0 importeur, usage interne x2 (ligne 191)
- `lib/night/summary.ts` · `NIGHT_DB_DERIVED_RUNS_LIMIT` — a — const, 0 importeur, usage interne x1 (ligne 30)
- `lib/routines/ci-autofix-limits.ts` · `CiAutofixEvidenceLike` — a — interface, 0 importeur, usage interne x2 (ligne 7)
- `lib/routines/ci-autofix.ts` · `CiAutofixRequest` — a — interface, 0 importeur, usage interne x1 (ligne 9)
- `lib/routines/ci-watch.ts` · `StoredCiObservation` — a — interface, 0 importeur, usage interne x5 (ligne 42)
- `lib/routines/ci-watch.ts` · `defaultCiWatchDeps` — a — const, 0 importeur, usage interne x1 (ligne 103) : point d'injection jamais consommé, même par les tests
- `lib/routines/crud.ts` · `RoutineDto` — a — interface, 0 importeur, usage interne x7 (ligne 34)
- `lib/routines/crud.ts` · `RoutineWriteInput` — a — interface, 0 importeur, usage interne x6 (ligne 45)
- `lib/routines/crud.ts` · `RoutinePatchInput` — a — type, 0 importeur, usage interne x1 (ligne 52)
- `lib/routines/retention.ts` · `DEFAULT_MAX_DELETED_CHUNKS_PER_RUN` — a — const, 0 importeur, usage interne x1 (ligne 135)
- `lib/routines/retention.ts` · `RETAINED_RESPONSE_TAIL_CHARS` — a — const, 0 importeur, usage interne x1 (ligne 165)
- `lib/routines/retention.ts` · `RetentionDeps` — a — interface, 0 importeur, usage interne x2 (ligne 239)
- `lib/routines/retention.ts` · `defaultRetentionDeps` — a — const, 0 importeur, usage interne x1 (ligne 266) : point d'injection jamais consommé
- `lib/routines/scheduler.ts` · `defaultRoutineSchedulerDeps` — a — const, 0 importeur, usage interne x1 (ligne 82) : point d'injection jamais consommé
- `lib/routines/scheduler.ts` · `InterruptedRoutineRecoveryDeps` — a — interface, 0 importeur, usage interne x2 (ligne 101)
- `lib/routines/scheduler.ts` · `RoutineSweepResult` — a — interface, 0 importeur, usage interne x2 (ligne 167)
- `lib/claude/logger.ts` · `MCP_TOKEN_MASK` — b — tests seuls : __tests__/mcp-log-redaction.test.ts (ligne 13)
- `lib/claude/mcp-injection.ts` · `extraMcpAllowlistEntries` — b — tests seuls : mcp-extra-servers-injection.test.ts (ligne 160)
- `lib/claude/mcp-injection.ts` · `ARIJ_MCP_ALLOWED_TOOL_NAMES` — b — tests seuls : mcp-e2e.test.ts, mcp-injection.test.ts (ligne 189)
- `lib/claude/mcp-injection.ts` · `ARIJ_MCP_CHAT_ALLOWED_TOOL_NAMES` — b — tests seuls : cli-tool-channel.test.ts, mcp-injection.test.ts (ligne 194)
- `lib/claude/mcp-injection.ts` · `parseMcpToolsEnabledSetting` — b — tests seuls : mcp-injection.test.ts (ligne 272)
- `lib/claude/mcp-injection.ts` · `buildClaudeMcpConfigJson` — b — tests seuls : cli-tool-channel.test.ts, mcp-extra-servers-injection.test.ts (ligne 462)
- `lib/claude/prompt-builder.ts` · `PromptVerificationCommand` — b — tests seuls : prompt-builder-fencing.test.ts (ligne 148)
- `lib/claude/prompt-builder.ts` · `CustomReviewAgentPrompt` — b — tests seuls : prompt-builder-fencing.test.ts (ligne 1343)
- `lib/claude/prompt-builder.ts` · `DreamingDigestContext` — b — tests seuls : dreaming-prompt.test.ts (ligne 1915)
- `lib/claude/prompt-builder.ts` · `renderRefinementSnapshot` — b — tests seuls : prompt-builder-fencing.test.ts (ligne 2367)
- `lib/claude/prompt-sections.ts` · `PERSONA_HEADING` — b — tests seuls : named-agent-persona-dispatch.test.ts (ligne 67)
- `lib/claude/prompt-sections.ts` · `PROJECT_MEMORY_HEADING` — b — tests seuls : memory-distill-prompt.test.ts, prompt-sections.test.ts (ligne 155)
- `lib/claude/prompt-sections.ts` · `TICKET_IMAGES_HEADING` — b — tests seuls : bug-image-pipeline-dispatch.test.ts, ticket-image-prompt.test.ts (ligne 173)
- `lib/claude/prompt-sections.ts` · `EXTRA_MCP_SERVERS_SECTION_MAX_CHARS` — b — tests seuls : mcp-extra-servers-prompt.test.ts (ligne 386)
- `lib/claude/resolve-session-output.ts` · `PROMPT_ECHO_MARKER` — b — tests seuls : resolve-session-output.test.ts (ligne 75)
- `lib/claude/untrusted.ts` · `IMPERSONATING_TAG_NAMES` — b — tests seuls : prompt-builder-fencing.test.ts (ligne 53)
- `lib/claude/untrusted.ts` · `fenceLength` — b — tests seuls : prompt-builder-fencing.test.ts, prompt-untrusted-content.test.ts (ligne 96)
- `lib/claude/untrusted.ts` · `AGENT_OUTPUT_NOTICE` — b — tests seuls : prompt-builder-fencing.test.ts (ligne 143)
- `lib/claude/visual-proof.ts` · `parseVisualProofEnabledSetting` — b — tests seuls : prompt-visual-proof.test.ts (ligne 12)
- `lib/providers/agy.ts` · `parseAgyEnvelope` — b — tests seuls : agy-provider.test.ts (ligne 77)
- `lib/providers/extra-mcp-scope.ts` · `EXTRA_MCP_SCOPE_BY_PROVIDER` — b — tests seuls : mcp-extra-servers-injection.test.ts (ligne 41)
- `lib/providers/omp-version.ts` · `OMP_MIN_ALLOWLIST_VERSION` — b — tests seuls : omp-version-gate.test.ts (ligne 47)
- `lib/providers/omp-version.ts` · `parseOmpVersion` — b — tests seuls : omp-version-gate.test.ts (ligne 69)
- `lib/providers/omp-version.ts` · `ompAllowlistIsEnforced` — b — tests seuls : omp-version-gate.test.ts (ligne 88)
- `lib/providers/omp-version.ts` · `probeOmpVersion` — b — tests seuls : omp-version-gate.test.ts (ligne 111)
- `lib/providers/omp-version.ts` · `resetOmpVersionProbeForTests` — b — tests seuls : omp-version-gate.test.ts (ligne 178) — accroche de test assumée
- `lib/providers/pi.ts` · `PI_PROMPT_FILE_FRAMING` — b — tests seuls : oversized-prompt-transport.test.ts (ligne 68)
- `lib/providers/pi.ts` · `collectPiAssistantMessages` — b — tests seuls : pi-providers.test.ts (ligne 120)
- `lib/providers/pi.ts` · `extractPiResult` — b — tests seuls : pi-providers.test.ts (ligne 155)
- `lib/providers/pi.ts` · `extractPiSessionId` — b — tests seuls : pi-providers.test.ts (ligne 176)
- `lib/providers/pi.ts` · `findPiRunFailure` — b — tests seuls : pi-providers.test.ts (ligne 192)
- `lib/providers/prompt-transport.ts` · `MAX_ARG_STRLEN_BYTES` — b — tests seuls : oversized-prompt-transport.test.ts (ligne 30)
- `lib/providers/prompt-transport.ts` · `ARGV_PROMPT_LIMIT_BYTES` — b — tests seuls : oversized-prompt-transport.test.ts (ligne 38)
- `lib/openai/client.ts` · `OpenAiConfig` — b — tests seuls : openai-client.test.ts, openai-tool-streaming.test.ts (ligne 24)
- `lib/openai/client.ts` · `OpenAiStreamEvent` — b — tests seuls : openai-tool-streaming.test.ts (ligne 58)
- `lib/openai/client.ts` · `buildChatCompletionsUrl` — b — tests seuls : openai-client.test.ts (ligne 102)
- `lib/openai/client.ts` · `buildOpenAiHeaders` — b — tests seuls : openai-client.test.ts (ligne 110)
- `lib/openai/client.ts` · `buildChatCompletionsBody` — b — tests seuls : openai-client.test.ts, openai-tool-streaming.test.ts (ligne 122)
- `lib/openai/client.ts` · `describeNetworkError` — b — tests seuls : openai-client.test.ts (ligne 234)
- `lib/openai/client.ts` · `streamOpenAiChatCompletion` — b — tests seuls : openai-client.test.ts, openai-tool-streaming.test.ts (ligne 647) — API de streaming couverte mais non branchée en prod
- `lib/openai/constants.ts` · `OPENAI_REASONING_EFFORTS` — b — tests seuls : openai-constants.test.ts (ligne 33)
- `lib/tokens/estimator.ts` · `estimatePromptTokens` — b — tests seuls : token-estimator.test.ts (ligne 133)
- `lib/agent-sessions/arij-action-scan.ts` · `resetArijToolCallScans` — b — tests seuls : session-detail-arij-actions.test.ts (ligne 126)
- `lib/agent-sessions/arij-actions.ts` · `extractArijToolCalls` — b — tests seuls : arij-actions.test.ts (ligne 289)
- `lib/agent-sessions/arij-actions.ts` · `collectArijActions` — b — tests seuls : arij-actions.test.ts (ligne 403)
- `lib/agent-sessions/artifacts.ts` · `MAX_SESSION_ARTIFACT_BYTES` — b — tests seuls : session-artifacts.test.ts (ligne 13)
- `lib/agent-sessions/backfill.ts` · `backfillRecentSessionLastNonEmptyText` — b — tests seuls : session-backfill.test.ts (ligne 49)
- `lib/agent-sessions/boot-cleanup.ts` · `ORPHANED_BY_RESTART_REASON` — b — tests seuls : boot-cleanup.test.ts (ligne 16)
- `lib/agent-sessions/boot-cleanup.ts` · `resetBootCleanupGuard` — b — tests seuls : auto-mode-e2e, boot-cleanup, qa-boot-cleanup (ligne 47) — accroche de test assumée
- `lib/agent-sessions/chunk-cap.ts` · `SESSION_CHUNK_ELISION_LABEL` — b — tests seuls : session-chunk-write-cap.test.ts, session-detail-page.test.tsx (ligne 48)
- `lib/agent-sessions/chunk-prune.ts` · `PRUNE_MIN_TRUNCATION_CHARS` — b — tests seuls : session-chunk-retention.test.ts (ligne 69)
- `lib/agent-sessions/chunk-retention.ts` · `SESSION_CHUNK_PRUNE_LABEL` — b — tests seuls : session-detail-page.test.tsx (ligne 18)
- `lib/agent-sessions/chunks.ts` · `capChunkContent` — b — tests seuls : session-chunk-write-cap.test.ts (ligne 174)
- `lib/agent-sessions/chunks.ts` · `DERIVED_CHUNK_KEY_PREFIX` — b — tests seuls : session-chunk-dedupe.test.ts (ligne 193)
- `lib/agent-sessions/chunks.ts` · `deriveChunkKey` — b — tests seuls : session-chunk-dedupe.test.ts (ligne 225)
- `lib/agent-sessions/chunks.ts` · `SessionChunkStore` — b — tests seuls : 4 fichiers de test chunks (ligne 245)
- `lib/agent-sessions/chunks.ts` · `createSessionChunkStore` — b — tests seuls : session-chunk-dedupe, -pagination, -write-cap, session-chunks (ligne 292) — la prod passe par une autre voie
- `lib/agent-sessions/dispatch-background-session.ts` · `BackgroundSessionQueued` — b — tests seuls : dispatch-background-session.test.ts (ligne 106)
- `lib/agent-sessions/lifecycle.ts` · `SESSION_OUTCOMES` — b — tests seuls : session-lifecycle.test.ts (ligne 53)
- `lib/agent-sessions/lifecycle.ts` · `isSessionOutcome` — b — tests seuls : session-lifecycle.test.ts (ligne 63)
- `lib/agent-sessions/lifecycle.ts` · `SESSION_LIFECYCLE_CONFLICT_CODE` — b — tests seuls : session-lifecycle.test.ts (ligne 82)
- `lib/agent-sessions/lifecycle.ts` · `SessionLifecycleConflictError` — b — tests seuls : agent-scheduler, session-lifecycle, session-status-machine (ligne 118)
- `lib/agent-sessions/lifecycle.ts` · `normalizeSessionLifecycleStatus` — b — tests seuls : session-lifecycle.test.ts (ligne 154)
- `lib/agent-sessions/lifecycle.ts` · `assertValidSessionTransition` — b — tests seuls : session-status-machine.test.ts (ligne 188)
- `lib/agent-sessions/lifecycle.ts` · `buildSessionTransitionPatch` — b — tests seuls : session-failure-lifecycle, session-lifecycle, session-usage-persistence (ligne 225)
- `lib/agent-sessions/prompt-cap.ts` · `SESSION_PROMPT_ELISION_LABEL` — b — tests seuls : session-detail-page.test.tsx, session-prompt-write-cap.test.ts (ligne 65)
- `lib/agent-sessions/session-list.ts` · `SESSION_LIST_MAX_PAGES` — b — tests seuls : sessions-list-fetch-contract.test.ts (ligne 40)
- `lib/agent-sessions/wait-for-completion.ts` · `DEFAULT_COMPLETION_POLL_INTERVAL_MS` — b — tests seuls : wait-for-completion.test.ts (ligne 11)
- `lib/agent-config/agent-resolution.ts` · `GLOBAL_DEFAULT_AGENT_NAME` — b — tests seuls : composite-agents-crud.test.ts, legacy-fallback-named-agents.test.ts (ligne 63)
- `lib/agent-config/dispatch-reliability-constants.ts` · `AGENT_TYPE_TO_DISPATCH_ROLE` — b — tests seuls : dispatch-reliability.test.ts (ligne 86)
- `lib/agent-config/dispatch-reliability-constants.ts` · `dispatchRoleForAgentType` — b — tests seuls : dispatch-reliability.test.ts (ligne 106)
- `lib/agent-config/smart-dispatch.ts` · `pickBestByReliability` — b — tests seuls : smart-dispatch.test.ts (ligne 48)
- `lib/agents/client-error.ts` · `AgentRequestError` — b — tests seuls : ticket-overlay-git.test.tsx (ligne 6)
- `lib/agents/scheduler-constants.ts` · `UNLIMITED_MAX_CONCURRENT_AGENTS` — b — tests seuls : agent-scheduler.test.ts (ligne 28)
- `lib/agents/scheduler.ts` · `AgentScheduler` — b — tests seuls : agent-scheduler.test.ts, wave-runner.test.ts (ligne 108) — la prod consomme la const agentScheduler (ligne 364), pas la classe
- `lib/agents/scheduler.ts` · `getAgentScheduler` — b — tests seuls : agent-scheduler.test.ts (ligne 352) ; appelée une fois en interne ligne 364
- `lib/agents/watchdog.ts` · `WATCHDOG_SWEEP_INTERVAL_MS` — b — tests seuls : session-watchdog.test.ts (ligne 51)
- `lib/agents/watchdog.ts` · `buildStalledReason` — b — tests seuls : session-watchdog.test.ts (ligne 54)
- `lib/agents/watchdog.ts` · `resolveWatchdogThresholdMinutes` — b — tests seuls : session-watchdog.test.ts (ligne 62)
- `lib/agents/watchdog.ts` · `SessionWatchdog` — b — tests seuls : session-watchdog.test.ts (ligne 150)
- `lib/agents/watchdog.ts` · `getSessionWatchdog` — b — tests seuls : boot-cleanup, qa-boot-cleanup, session-watchdog (ligne 276) — instrumentation.ts n'appelle que startSessionWatchdog
- `lib/mcp/probe.ts` · `MCP_PROBE_STDERR_MAX_CHARS` — b — tests seuls : mcp-server-probe.test.ts (ligne 53)
- `lib/mcp/probe.ts` · `scrubSecrets` — b — tests seuls : mcp-server-probe.test.ts (ligne 104)
- `lib/mcp/servers.ts` · `mcpServerSecrets` — b — tests seuls : mcp-servers-crud.test.ts (ligne 692)
- `lib/mcp/token-store.ts` · `REVOKED_TOKEN_GRACE_MS` — b — tests seuls : mcp-token-store.test.ts (ligne 57)
- `lib/mcp/token-store.ts` · `purgeExpiredMcpTokens` — b — tests seuls : mcp-token-store.test.ts (ligne 166) — purge jamais appelée en production
- `lib/mcp/token-store.ts` · `_resetMcpTokenStoreForTests` — b — tests seuls : 12 fichiers de test (ligne 180) — accroche de test assumée
- `lib/mcp/user-global-sync.ts` · `isUserGlobalMcpSyncEnabled` — b — tests seuls : mcp-user-global-sync.test.ts (ligne 122)
- `lib/mcp/user-global-sync.ts` · `ompMcpConfigPath` — b — tests seuls : mcp-user-global-sync.test.ts (ligne 148)
- `lib/mcp/user-global-sync.ts` · `SyncableServer` — b — tests seuls : mcp-user-global-sync.test.ts (ligne 194)
- `lib/mcp/user-global-sync.ts` · `syncableGlobalServers` — b — tests seuls : mcp-user-global-sync.test.ts (ligne 234)
- `lib/mcp/user-global-sync.ts` · `AgyRunner` — b — tests seuls : mcp-user-global-sync.test.ts (ligne 417)
- `lib/mcp/user-global-sync.ts` · `UserGlobalSyncTargets` — b — tests seuls : mcp-user-global-sync.test.ts (ligne 456)
- `lib/mcp/user-global-sync.ts` · `reconcileUserGlobalMcpServers` — b — tests seuls : mcp-user-global-sync.test.ts (ligne 471) — module entier testé mais jamais branché en prod
- `lib/mcp/user-global-sync.ts` · `createUserGlobalSyncScheduler` — b — tests seuls : mcp-user-global-sync.test.ts (ligne 512) — scheduler jamais démarré (absent d'instrumentation.ts)
- `lib/pipeline/constants.ts` · `resolvePipelineGraderEnabledDefault` — b — tests seuls : pipeline-settings-section.test.tsx (ligne 119)
- `lib/pipeline/findings.ts` · `countAgentReviewCommentsSince` — b — tests seuls : pipeline-findings.test.ts (ligne 159)
- `lib/pipeline/findings.ts` · `readStructuredReviewVerdict` — b — tests seuls : pipeline-findings.test.ts (ligne 223)
- `lib/pipeline/findings.ts` · `readReviewChannelState` — b — tests seuls : review-channel-wiring, review-gate-consistency, review-unverifiable-gate (ligne 374)
- `lib/pipeline/findings.ts` · `NEGATIVE_VERDICT_SUBSTRINGS` — b — tests seuls : pipeline-findings.test.ts (ligne 743)
- `lib/pipeline/findings.ts` · `isNegativeProseVerdict` — b — tests seuls : pipeline-findings.test.ts (ligne 749)
- `lib/pipeline/forensic-prompt.ts` · `FORENSIC_MAX_WORDS` — b — tests seuls : pipeline-forensic-prompt.test.ts (ligne 28)
- `lib/pipeline/forensic-prompt.ts` · `ForensicPromptInput` — b — tests seuls : pipeline-forensic-prompt.test.ts (ligne 30)
- `lib/pipeline/forensic.ts` · `FORENSIC_POSTED_REASON` — b — tests seuls : pipeline-forensic-dispatch.test.ts (ligne 104)
- `lib/pipeline/forensic.ts` · `postForensicDiagnostic` — b — tests seuls : pipeline-forensic-dispatch.test.ts (ligne 349)
- `lib/pipeline/index.ts` · `StartPipelineRunInput` — b — tests seuls : pipeline-build-route-flag.test.ts (ligne 50)
- `lib/pipeline/index.ts` · `resolvePipelineGraderEnabled` — b — tests seuls : pipeline-start-run.test.ts (ligne 104)
- `lib/pipeline/parse-review-report.ts` · `parseLocation` — b — tests seuls : parse-review-report.test.ts (ligne 108)
- `lib/pipeline/registry.ts` · `PIPELINE_RECENT_RUNS_LIMIT` — b — tests seuls : pipeline-registry.test.ts (ligne 24)
- `lib/workflow/agent-question.ts` · `AGENT_ASKED_QUESTION_REASON` — b — tests seuls : agent-question-workflow, night-run-e2e, pipeline-e2e (ligne 16)
- `lib/workflow/dreaming-digest.ts` · `truncateText` — b — tests seuls : dreaming-digest.test.ts (ligne 131)
- `lib/workflow/dreaming-digest.ts` · `tailText` — b — tests seuls : dreaming-digest.test.ts (ligne 142)
- `lib/workflow/dreaming-digest.ts` · `renderSessionDigest` — b — tests seuls : dreaming-digest.test.ts (ligne 177)
- `lib/workflow/dreaming.ts` · `findLastDreamCutoff` — b — tests seuls : dreaming-collector.test.ts, dreaming-dispatch.test.ts (ligne 148)
- `lib/workflow/dreaming.ts` · `recordDreamCutoff` — b — tests seuls : dreaming-collector.test.ts, dreaming-dispatch.test.ts (ligne 167)
- `lib/workflow/dreaming.ts` · `selectDreamCandidates` — b — tests seuls : dreaming-collector.test.ts (ligne 240)
- `lib/workflow/dreaming.ts` · `collectDreamDigest` — b — tests seuls : dreaming-collector.test.ts (ligne 581)
- `lib/workflow/dreaming.ts` · `evaluateDreamGuards` — b — tests seuls : dreaming-dispatch.test.ts (ligne 705)
- `lib/workflow/dreaming.ts` · `evaluateNightRunDreamGuards` — b — tests seuls : dreaming-dispatch.test.ts (ligne 738)
- `lib/workflow/dreaming.ts` · `sanitizeDreamedMemory` — b — tests seuls : dreaming-dispatch.test.ts (ligne 887)
- `lib/workflow/memory-distill.ts` · `MEMORY_UPDATED_REASON` — b — tests seuls : memory-distill-dispatch.test.ts (ligne 73)
- `lib/workflow/memory-distill.ts` · `AutoDistillCandidateSession` — b — tests seuls : memory-auto-distill.test.ts (ligne 104)
- `lib/workflow/memory-distill.ts` · `evaluateAutoDistillGuards` — b — tests seuls : memory-auto-distill.test.ts, pipeline-forensic-dispatch.test.ts (ligne 138)
- `lib/workflow/memory-distill.ts` · `sanitizeDistilledMemory` — b — tests seuls : memory-distill-dispatch.test.ts (ligne 498)
- `lib/workflow/merge-failure.ts` · `APPROVAL_MERGE_BLOCKED_PREFIX` — b — tests seuls : board-merge-readiness-route.test.ts, merge-failure-reasons.test.ts (ligne 56)
- `lib/workflow/merge-failure.ts` · `APPROVAL_CONFLICT_MARKERS_BLOCKED_PREFIX` — b — tests seuls : board-merge-readiness-route.test.ts, merge-failure-reasons.test.ts (ligne 59)
- `lib/workflow/merge-failure.ts` · `GIT_REFUSAL_MERGE_REASONS` — b — tests seuls : merge-failure-reasons.test.ts (ligne 94)
- `lib/workflow/merge-failure.ts` · `MERGE_CONFLICT_REASON_PREFIXES` — b — tests seuls : merge-failure-reasons.test.ts (ligne 131)
- `lib/workflow/merge-failure.ts` · `CONFLICT_MARKERS_REASON_PREFIXES` — b — tests seuls : merge-failure-reasons.test.ts (ligne 142)
- `lib/workflow/merge-failure.ts` · `MERGE_FAILURE_REASON_PREFIXES` — b — tests seuls : merge-failure-reasons.test.ts (ligne 149)
- `lib/workflow/merge-failure.ts` · `isMergeConflictReason` — b — tests seuls : merge-failure-reasons.test.ts (ligne 155)
- `lib/workflow/merge-failure.ts` · `isConflictMarkersReason` — b — tests seuls : merge-failure-reasons.test.ts (ligne 165)
- `lib/workflow/merge-failure.ts` · `isMergeFailureReason` — b — tests seuls : merge-failure-reasons.test.ts (ligne 175)
- `lib/workflow/merge-failure.ts` · `__testables` — b — tests seuls : merge-failure-reasons.test.ts (ligne 198) — accroche de test assumée
- `lib/workflow/spec-auto-rewrite.ts` · `SPEC_REWRITE_AGENT_TYPE` — b — tests seuls : spec-auto-rewrite-guards.test.ts (ligne 54)
- `lib/workflow/spec-auto-rewrite.ts` · `hasPendingSpecGeneration` — b — tests seuls : spec-auto-rewrite-dispatch.test.ts (ligne 74)
- `lib/workflow/spec-auto-rewrite.ts` · `evaluateSpecAutoRewriteGuards` — b — tests seuls : spec-auto-rewrite-guards.test.ts (ligne 103)
- `lib/workflow/spec-auto-rewrite.ts` · `sanitizeRewrittenSpec` — b — tests seuls : spec-auto-rewrite-dispatch.test.ts (ligne 185)
- `lib/workflow/spec-auto-rewrite.ts` · `dispatchSpecAutoRewriteSession` — b — tests seuls : spec-auto-rewrite-dispatch.test.ts (ligne 238)
- `lib/workflow/spec-update.ts` · `sanitizeUpdatedSpec` — b — tests seuls : spec-update-dispatch.test.ts (ligne 85)
- `lib/auto-mode/constants.ts` · `AUTO_RUN_ID_PREFIX` — b — tests seuls : auto-mode-constants.test.ts (ligne 27)
- `lib/auto-mode/constants.ts` · `isAutoRunId` — b — tests seuls : auto-mode-constants.test.ts (ligne 38)
- `lib/auto-mode/constants.ts` · `AUTO_MODE_REASON_PREFIX` — b — tests seuls : auto-mode-constants.test.ts, auto-mode-engine.test.ts (ligne 322)
- `lib/auto-mode/constants.ts` · `isAutoModeActivityReason` — b — tests seuls : auto-mode-constants.test.ts, auto-mode-engine.test.ts (ligne 448)
- `lib/auto-mode/engine.ts` · `AutoModeDispatchInput` — b — tests seuls : auto-mode-engine.test.ts (ligne 106)
- `lib/auto-mode/engine.ts` · `AutoModeEngineDeps` — b — tests seuls : auto-mode-engine.test.ts (ligne 155)
- `lib/auto-mode/engine.ts` · `defaultAutoModeDeps` — b — tests seuls : auto-mode-dispatch-guard, auto-mode-e2e, auto-mode-review-evidence, full-auto-dispatch-agent (ligne 393)
- `lib/auto-mode/engine.ts` · `sweepProject` — b — tests seuls : auto-mode-e2e, auto-mode-engine, full-auto-dispatch-agent (ligne 1174)
- `lib/auto-mode/engine.ts` · `stopAutoMode` — b — tests seuls : auto-mode-engine.test.ts (ligne 1802)
- `lib/auto-mode/engine.ts` · `isAutoModeRunning` — b — tests seuls : auto-mode-engine.test.ts (ligne 1811)
- `lib/auto-mode/engine.ts` · `cancelPendingKicks` — b — tests seuls : auto-mode-e2e.test.ts, auto-mode-engine.test.ts (ligne 1876)
- `lib/auto-mode/second-opinion.ts` · `pickSecondOpinionProvider` — b — tests seuls : auto-mode-second-opinion.test.ts (ligne 279)
- `lib/night/run.ts` · `resolveNightCircuitBreaker` — b — tests seuls : night-run-engine.test.ts (ligne 111)
- `lib/night/run.ts` · `resolveNightCostCap` — b — tests seuls : night-run-engine.test.ts (ligne 131)
- `lib/night/run.ts` · `NightCircuitBreaker` — b — tests seuls : night-run-engine.test.ts (ligne 200)
- `lib/routines/actions.ts` · `RoutineActionDeps` — b — tests seuls : routine-actions.test.ts (ligne 35)
- `lib/routines/actions.ts` · `defaultRoutineActionDeps` — b — tests seuls : routine-actions.test.ts (ligne 99)
- `lib/routines/ci-watch.ts` · `CiWatchEpic` — b — tests seuls : ci-watch.test.ts (ligne 34)
- `lib/routines/ci-watch.ts` · `CiWatchDeps` — b — tests seuls : ci-watch.test.ts (ligne 55)
- `lib/routines/ci-watch.ts` · `nextCiObservation` — b — tests seuls : ci-watch.test.ts (ligne 240)
- `lib/routines/constants.ts` · `ROUTINE_KINDS` — b — tests seuls : routines-migration.test.ts (ligne 8)
- `lib/routines/retention.ts` · `SESSION_CHUNK_RETENTION_DAYS_SETTING_KEY` — b — tests seuls : session-chunk-retention.test.ts (ligne 105)
- `lib/routines/retention.ts` · `DEFAULT_SESSION_CHUNK_RETENTION_DAYS` — b — tests seuls : session-chunk-retention.test.ts (ligne 132)
- `lib/routines/retention.ts` · `sessionChunkRetentionDaysSettingKey` — b — tests seuls : session-chunk-retention.test.ts (ligne 185)
- `lib/routines/retention.ts` · `resolveSessionChunkRetentionDays` — b — tests seuls : session-chunk-retention.test.ts (ligne 214)
- `lib/routines/retention.ts` · `retentionCutoff` — b — tests seuls : session-chunk-retention.test.ts (ligne 366)
- `lib/routines/scheduler.ts` · `ROUTINE_SWEEP_INTERVAL_MS` — b — tests seuls : routine-scheduler.test.ts (ligne 16)
- `lib/routines/scheduler.ts` · `isRoutineDue` — b — tests seuls : routine-scheduler.test.ts, session-chunk-retention.test.ts (ligne 23)
- `lib/routines/scheduler.ts` · `RoutineSchedulerDeps` — b — tests seuls : routine-scheduler.test.ts (ligne 68)
- `lib/routines/scheduler.ts` · `recoverInterruptedRoutineRuns` — b — tests seuls : routine-scheduler.test.ts (ligne 130)
- `lib/routines/scheduler.ts` · `RoutineScheduler` — b — tests seuls : routine-scheduler.test.ts (ligne 182) ; instanciée en interne ligne 326
- `lib/routines/scheduler.ts` · `stopRoutineScheduler` — b — tests seuls : routine-scheduler.test.ts (ligne 361)
- `lib/routines/scheduler.ts` · `isRoutineSchedulerRunning` — b — tests seuls : routine-scheduler.test.ts (ligne 368)

### Exports morts — lib/ reste (197 entrées)

- `lib/projects/workspace-path.ts` · `(fichier entier)` — FICHIER MORT EN PROD (48 l). Seul importeur : __tests__/workspace-path-guard.test.ts. Ses deux exports (WorkspacePathError:9, assertInsideRoot:25) n'apparaissent nulle part ailleurs (rg sur app components lib hooks scripts bin instrumentation.ts proxy.ts). C'est une duplication de la logique de confinement déjà vivante dans lib/projects/workspace.ts (isInsideProjectsRoot:66, containsPathOnDisk:83) — le commentaire annonce une « défense en profondeur derrière parseGitHubRepoInput() » qui n'est branchée sur rien.
- `lib/kanban/filters.ts` · `(fichier entier)` — FICHIER MORT EN PROD (104 l). Seul importeur : __tests__/kanban-filters.test.tsx. Exports : KanbanFilters:18, EMPTY_FILTERS:31, countActiveFilters:39, EpicFilterSignals:50, epicMatchesFilters:57, parseStoredFilters:78, filtersStorageKey:101. filtersStorageKey n'est même pas référencé par le test (0 référence totale).
- `lib/kanban/reorder.ts` · `(fichier entier)` — FICHIER MORT EN PROD (76 l). Seul importeur : __tests__/kanban-review-reorder.test.ts (persistedColumnOrder:48). PositionedCard:23 a 0 référence. Deux commentaires ailleurs (components/desk/ReadyToLandBand.tsx:28, lib/control-desk/aggregate.ts:547) citent « lib/kanban/reorder.ts » comme contrat de référence, mais aucun import.
- `lib/db/test-utils.ts` · `(fichier entier)` — Aucun importeur de production, mais c'est un helper de test assumé : importé par ~140 fichiers de __tests__/. À NE PAS supprimer — listé pour l'exhaustivité de la méthode.
- `lib/chat/conversation-agent.ts` · `UNSELECTED_AGENT_TYPE` — const ligne 1 — 0 référence hors du fichier.
- `lib/chat/conversation-agent.ts` · `LEGACY_EPIC_AGENT_TYPE` — const ligne 4 — 0 référence hors du fichier.
- `lib/chat/conversation-agent.ts` · `CUSTOM_REVIEW_AGENT_PREFIX` — const ligne 6 — 0 référence hors du fichier.
- `lib/chat/conversation-agent.ts` · `BUILTIN_CONVERSATION_AGENT_TYPES` — const ligne 14 — 0 référence hors du fichier.
- `lib/chat/parity-contract.ts` · `compareConversationsByLegacyOrder` — function ligne 58 — 0 référence hors du fichier (le module lui-même est vivant : hooks/useConversations.ts, ChatPageView, UnifiedChatPanel, route conversations).
- `lib/chat/persistent-runner.ts` · `isPersistentChatSessionWarm` — function ligne 1018 — 0 référence hors du fichier.
- `lib/control-desk/aggregate.ts` · `isDeskDismissalKind` — function ligne 448 — 0 référence hors du fichier.
- `lib/control-desk/aggregate.ts` · `UP_NEXT_STATUSES` — const ligne 609 — 0 référence hors du fichier.
- `lib/control-desk/aggregate.ts` · `deriveUpNextForProject` — function ligne 621 — 0 référence hors du fichier, ni prod ni test. La bande Up Next du desk ne passe pas par cette fonction.
- `lib/documents/document-paths.ts` · `documentsRoot` — function ligne 17 — 0 référence hors du fichier.
- `lib/documents/memory-constants.ts` · `MEMORY_INTERNAL_DOC_KINDS` — const ligne 96 — 0 référence hors du fichier.
- `lib/documents/mention-placement.ts` · `MENTION_MENU_GAP` — const ligne 19 — 0 référence hors du fichier.
- `lib/documents/mention-placement.ts` · `MENTION_MENU_MAX_HEIGHT` — const ligne 22 — 0 référence hors du fichier.
- `lib/documents/mentions.ts` · `collectMentionedFilenames` — function ligne 63 — 0 référence hors du fichier (module vivant par ailleurs : lib/pipeline/stage-prompt.ts, lib/tokens/dispatch-prompt.ts, routes chat/comments/generate-spec).
- `lib/documents/mentions.ts` · `resolveMentionedDocuments` — function ligne 77 — 0 référence hors du fichier.
- `lib/documents/mentions.ts` · `enrichPromptWithResolvedMentions` — function ligne 134 — 0 référence hors du fichier.
- `lib/git/clone-constants.ts` · `CLONE_TIMEOUT_SETTING_KEY` — const ligne 13 — 0 référence hors du fichier.
- `lib/git/clone-constants.ts` · `MIN_CLONE_TIMEOUT_MS` — const ligne 23 — 0 référence hors du fichier.
- `lib/git/clone-constants.ts` · `parseCloneTimeoutSetting` — function ligne 31 — 0 référence hors du fichier : le réglage de timeout de clone n'est parsé nulle part.
- `lib/git/clone-marker.ts` · `CLONE_MARKER_RELATIVE_PATH` — const ligne 26 — 0 référence hors du fichier.
- `lib/git/clone-marker.ts` · `cloneMarkerPath` — function ligne 38 — 0 référence hors du fichier.
- `lib/git/manager.ts` · `epicBranchName` — function ligne 21 — 0 référence hors du fichier.
- `lib/github/device-flow-store.ts` · `DEVICE_FLOW_MAX_LIFETIME_MS` — const ligne 36 — 0 référence hors du fichier.
- `lib/github/device-flow.ts` · `DEVICE_FLOW_REQUEST_TIMEOUT_MS` — const ligne 88 — 0 référence hors du fichier.
- `lib/github/issues.ts` · `fetchOpenGitHubIssues` — function ligne 40 — 0 référence hors du fichier.
- `lib/github/issues.ts` · `GITHUB_REPO_NOT_CONFIGURED_MESSAGE` — const ligne 68 — 0 référence hors du fichier.
- `lib/github/oauth-meta.ts` · `GITHUB_TOKEN_SOURCES` — const ligne 24 — 0 référence hors du fichier.
- `lib/github/pull-requests.ts` · `CI_JOB_LOG_TAIL_CHARS` — const ligne 137 — 0 référence hors du fichier.
- `lib/grading/dispatch.ts` · `GRADING_NO_STORIES_REASON` — const ligne 37 — 0 référence hors du fichier.
- `lib/grading/dispatch.ts` · `GRADING_NO_CRITERIA_REASON` — const ligne 39 — 0 référence hors du fichier.
- `lib/grading/report.ts` · `GRADING_STATUSES` — const ligne 9 — 0 référence hors du fichier.
- `lib/grading/report.ts` · `normalizeCriterion` — function ligne 91 — 0 référence hors du fichier.
- `lib/kanban/filters.ts` · `filtersStorageKey` — function ligne 101 — 0 référence totale (même pas dans le test du fichier).
- `lib/navigation/deep-link.ts` · `urlWithoutQueryParam` — function ligne 27 — 0 référence hors du fichier (module vivant : app/projects/[projectId]/page.tsx, qa/page.tsx, useRegistryUrlState.ts).
- `lib/notifications/create.ts` · `buildMemoryDreamedTitle` — function ligne 887 — 0 référence hors du fichier.
- `lib/projects/clone-cleanup.ts` · `CLONE_REMOVAL_SKIP_MESSAGES` — const ligne 52 — 0 référence hors du fichier.
- `lib/projects/workspace-constants.ts` · `GITHUB_NAME_PATTERN` — const ligne 25 — 0 référence hors du fichier.
- `lib/qa/report-lifecycle.ts` · `QA_CHECK_CANCELLED_SUMMARY` — const ligne 48 — 0 référence hors du fichier.
- `lib/qa/report-lifecycle.ts` · `QA_CHECK_LAUNCH_FAILED_SUMMARY` — const ligne 52 — 0 référence hors du fichier.
- `lib/refinement/registry.ts` · `MAX_RECORDED_CHANGES` — const ligne 67 — 0 référence hors du fichier.
- `lib/refinement/report.ts` · `REFINEMENT_NOTIFICATION_MESSAGE_MAX_CHARS` — const ligne 293 — 0 référence hors du fichier.
- `lib/refinement/report.ts` · `formatDiscardedTombstones` — function ligne 300 — 0 référence hors du fichier.
- `lib/refinement/report.ts` · `fallbackCommentHost` — function ligne 344 — 0 référence hors du fichier.
- `lib/refinement/retire.ts` · `ticketHasAgentSessions` — function ligne 84 — 0 référence hors du fichier.
- `lib/security/remote-access.ts` · `isRemoteModeEnabled` — function ligne 95 — 0 référence hors du fichier. À rapprocher du finding ouvert « bind 0.0.0.0 » de l'audit du 06/09 : le drapeau de mode distant existe mais personne ne l'interroge.
- `lib/telescope/collect.ts` · `TELESCOPE_MAX_GROUPS` — const ligne 31 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `TELESCOPE_MAX_EXAMPLES_PER_GROUP` — const ligne 32 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `TELESCOPE_MAX_TICKET_IDS_PER_GROUP` — const ligne 33 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `TELESCOPE_EVIDENCE_TEXT_MAX_CHARS` — const ligne 34 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `TELESCOPE_LAST_CHUNK_MAX_CHARS` — const ligne 35 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `TELESCOPE_MOTIF_MAX_CHARS` — const ligne 36 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `TELESCOPE_FINDING_PREFIX_WORDS` — const ligne 38 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `TELESCOPE_FINDING_MIN_OCCURRENCES` — const ligne 39 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `normalizeFailureDimension` — function ligne 275 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `normalizeFailureMotif` — function ligne 289 — 0 référence hors du fichier.
- `lib/telescope/collect.ts` · `collectFailureEvidence` — const ligne 939 — 0 référence, y compris dans les tests. C'est l'alias déclaré « Short alias for callers that already live under lib/telescope » de collectFailureDigestEvidence ; aucun appelant n'existe.
- `lib/tickets-registry/url-state.ts` · `REGISTRY_STATE_FILTERS` — const ligne 46 — 0 référence hors du fichier.
- `lib/tickets-registry/url-state.ts` · `REGISTRY_URL_KEYS` — const ligne 67 — 0 référence hors du fichier.
- `lib/types/kanban.ts` · `DRAGGABLE_COLUMNS` — const ligne 28 — 0 référence. Résidu du board disparu (le DnD a été retiré, cf. CLAUDE.md et la rationalisation).
- `lib/types/kanban.ts` · `DELIVERED_STATUSES` — const ligne 67 — 0 référence hors du fichier.
- `lib/types/kanban.ts` · `PRIORITY_COLORS` — const ligne 91 — 0 référence. Résidu des badges priorité supprimés par la rationalisation ; contredit aussi la règle Piscine « la couleur n'est jamais l'état ».
- `lib/usage/codex-snapshot.ts` · `defaultCodexSessionsRoot` — function ligne 35 — 0 référence hors du fichier.
- `lib/verify/regression-check.ts` · `defaultRunCommand` — function ligne 165 — 0 référence hors du fichier.
- `lib/activity-registry.ts` · `ActivityType (type)` — Type exporté sans aucun consommateur externe : ActivityType@8.
- `lib/chat/cli-tool-channel.ts` · `types sans consommateur` — ChatCliToolChannel@57.
- `lib/chat/conversation-agent.ts` · `types sans consommateur` — BuiltinConversationAgentType@8.
- `lib/chat/parity-contract.ts` · `types sans consommateur` — LegacyConversationStatus@3.
- `lib/chat/persistent-runner.ts` · `types sans consommateur` — PersistentSessionState@41, PersistentChatTurnOptions@43, PersistentChatTurnHandle@61.
- `lib/chat/unified-cutover-migration.ts` · `types sans consommateur` — UnifiedChatCutoverMigrationReport@77.
- `lib/control-desk/aggregate.ts` · `types sans consommateur` — TodayCounts@265, YourTurnRows@463, ReadyToLand@537, UpNextInput@611.
- `lib/db/schema.ts` · `types Drizzle sans consommateur (25)` — NewGitSyncLog@808, GitHubIssue@809, NewGitHubIssue@810, NewQaReport@813, NewVerifyReport@816, NewQaPrompt@819, NewAgentPrompt@822, NewCustomReviewAgent@825, NewAgentProviderDefault@828, NewNamedAgent@831, NewPullRequest@834, NewRelease@837, TicketDependency@839, NewTicketDependency@840, GradingReport@845, NewGradingReport@846, NewSessionArtifact@852, NewTicketActivityLog@878, NewNotification@917, NewTicketReadCursor@936, DeskDismissal@972, NewDeskDismissal@973, ProviderUsageSnapshot@997, NewProviderUsageSnapshot@998, NewMcpServer@1072. Ce sont des alias $inferSelect/$inferInsert générés par convention — coût nul mais jamais utilisés.
- `lib/dependencies/scheduler.ts` · `types sans consommateur` — LayerResult@21.
- `lib/dependencies/wave-runner.ts` · `types sans consommateur` — WaveBlockKind@37, WaveSkipKind@43, WaveExecutionSummary@97, RunExecutionWavesOptions@116.
- `lib/documents/import.ts` · `types sans consommateur` — ScannedDocumentImportResult@36.
- `lib/documents/memory.ts` · `types sans consommateur` — MemoryDocRecord@24, SaveProjectMemoryResult@76, ReplaceProjectMemoryResult@139, ReplaceProjectMemoryOptions@160.
- `lib/documents/mention-placement.ts` · `types sans consommateur` — MentionMenuPlacement@24, MentionMenuGeometry@31.
- `lib/documents/mentions.ts` · `types sans consommateur` — DocumentMentionEnrichment@144.
- `lib/documents/scan.ts` · `types sans consommateur` — ScannedDocumentFile@9, DocumentScanResult@17.
- `lib/epic-parsing.ts` · `types sans consommateur` — ParsedUserStory@6, ConversationMessage@18.
- `lib/epics/manual-epic-form.ts` · `types sans consommateur` — ManualEpicValidation@25, ManualEpicPayload@35, ManualEpicRequestContext@48.
- `lib/git/base-branch.ts` · `types sans consommateur` — ResolveBaseBranchOptions@38.
- `lib/git/clone-marker.ts` · `types sans consommateur` — CloneMarker@28, WriteCloneMarkerInput@42.
- `lib/git/clone.ts` · `types sans consommateur` — CloneDestinationState@52, CloneRepoResult@62, CloneGitHubRepositoryOptions@369, CloneRepositoryOptions@546, CloneRepositoryResult@564.
- `lib/git/diff.ts` · `types sans consommateur` — DiffHunk@7.
- `lib/git/manager.ts` · `types sans consommateur` — BaseBranchOptions@31, MergeFailureReason@164.
- `lib/git/remote.ts` · `types sans consommateur` — ParsedGitHubRemote@11, DetectedGitHubRemote@17, BranchSyncStatus@30, PullWithConflictResult@39, GitRemoteOperation@62, GitRepositoryUnavailableCode@107.
- `lib/github/device-flow-store.ts` · `types sans consommateur` — DeviceFlowRecord@39, ClientDeviceFlow@70, DeviceFlowLookup@80.
- `lib/github/device-flow.ts` · `types sans consommateur` — DeviceFlowErrorCode@109, DeviceFlowPollResult@143.
- `lib/github/issues.ts` · `types sans consommateur` — RemoteIssue@16.
- `lib/github/label-mapping.ts` · `types sans consommateur` — LabelMapping@5.
- `lib/github/oauth-meta.ts` · `types sans consommateur` — GitHubTokenSource@22.
- `lib/github/pull-requests.ts` · `types sans consommateur` — PullRequestFailedCheckRun@71, PullRequestCiClassification@418.
- `lib/github/releases.ts` · `types sans consommateur` — GitHubReleaseResult@11.
- `lib/github/sync-log.ts` · `types sans consommateur` — GitSyncOperation@6, GitSyncStatus@20.
- `lib/grading/dispatch.ts` · `types sans consommateur` — GradingSessionResult@49, DispatchGradingResult@57, DispatchGradingInput@84.
- `lib/kanban/activity-feed.ts` · `types sans consommateur` — ActivityFilter@109.
- `lib/kanban/awaiting-reply.ts` · `types sans consommateur` — AwaitingReplySignal@13.
- `lib/kanban/filters.ts` · `types sans consommateur` — EpicFilterSignals@50 (fichier déjà mort en prod, cf. plus haut).
- `lib/kanban/merge-readiness.ts` · `types sans consommateur` — MergeBlocker@41, MergeReadinessCarrier@274.
- `lib/kanban/queue.ts` · `types sans consommateur` — ExecutionOrderEpic@55, DependencyAdjacency@145, DependencyFocus@170, DependencyFocusRole@212, ReadinessScore@230.
- `lib/kanban/reorder.ts` · `types sans consommateur` — PositionedCard@23 (fichier déjà mort en prod).
- `lib/kanban/status-transitions.ts` · `types sans consommateur` — TicketStatusOption@33, TicketStatusContext@48.
- `lib/kanban/unread-ai.ts` · `types sans consommateur` — UnreadAiSignal@13.
- `lib/notifications/create.ts` · `types sans consommateur` — MemoryDreamedNotificationInput@867, DagWaveOutcomeInput@1015, NightRunSummaryNotificationInput@1108, RefinementReportNotificationInput@1210.
- `lib/piscine/nav.ts` · `types sans consommateur` — ScopeProjectInput@407.
- `lib/projects/cancel-sessions.ts` · `types sans consommateur` — CancelProjectSessionsResult@12.
- `lib/projects/clone-cleanup.ts` · `types sans consommateur` — CloneRemovalSkipReason@40, ProjectClonePointer@63, RemovableCloneCheck@68.
- `lib/projects/clone-provenance.ts` · `types sans consommateur` — DerivedCloneProvenance@21.
- `lib/qa/aggregate.ts` · `types sans consommateur` — QaSeverity@41.
- `lib/qa/types.ts` · `types sans consommateur` — QaCheckType@133.
- `lib/refinement/dispatch.ts` · `types sans consommateur` — RefinementSessionResult@42, DispatchRefinementResult@51, DispatchRefinementInput@97.
- `lib/refinement/registry.ts` · `types sans consommateur` — RefinementChangeKind@24.
- `lib/refinement/report.ts` · `types sans consommateur` — PublishRefinementReportInput@367, PublishedRefinementReport@378.
- `lib/refinement/retire.ts` · `types sans consommateur` — RetiredStorySnapshot@48.
- `lib/refinement/snapshot.ts` · `types sans consommateur` — RefinementDependency@30, RefinementStory@38, RefinementTicket@45.
- `lib/review/finding-severity.ts` · `types sans consommateur` — FindingSeverityLabel@35.
- `lib/sync/arji-json.ts` · `types sans consommateur` — ArjiJsonUserStory@15, ArjiJsonProject@38.
- `lib/sync/import.ts` · `types sans consommateur` — ImportResult@15.
- `lib/telescope/collect.ts` · `types sans consommateur` — TelescopeEvidenceSource@45, TelescopeChunkExcerpt@51, TelescopeEvidence@57, TelescopeFailureGroup@82, CollectFailureEvidenceOptions@99.
- `lib/tickets-registry/aggregate.ts` · `types sans consommateur` — RegistryDeriveInput@135, ActivityInput@163, RegistryTotalsInput@445, RegistryTotals@451.
- `lib/types/kanban.ts` · `types sans consommateur` — BuildableStatus@47, DeliveredStatus@69, KanbanAgentActionType@167, KanbanEpicAgentActivity@169, ReleaseGroup@177, BoardState@185, ReorderItem@199. BoardState et ReorderItem sont du vocabulaire de l'ancien board.
- `lib/types/usage.ts` · `types sans consommateur` — SubscriptionSourceDetail@135.
- `lib/uploads/attachment-ownership.ts` · `types sans consommateur` — DiscardStagedUploadResult@142, ProjectUploadCleanup@187.
- `lib/uploads/image-attachments.ts` · `types sans consommateur` — ImageFileLike@50, RejectedImageFile@56, PartitionedImageFiles@61, ImageUploadRejectionCode@78, ImageUploadRejection@80.
- `lib/uploads/servable-uploads.ts` · `types sans consommateur` — UnservableUploadReason@38, ServableUploadLookup@40.
- `lib/usage/codex-rate-limits.ts` · `types sans consommateur` — ParsedRateLimitWindow@25.
- `lib/utils/stable-list-keys.ts` · `types sans consommateur` — KeyedItem@20.
- `lib/validation/chat-schemas.ts` · `types sans consommateur` — ChatMessageInput@13.
- `lib/validation/webhook-schemas.ts` · `types sans consommateur` — UpdateProjectWebhookInput@21.
- `lib/verify/freshness.ts` · `types sans consommateur` — VerificationProblemKind@25, VerificationProblem@27, VerificationAssessment@33.
- `lib/verify/regression-check.ts` · `types sans consommateur` — RegressionCheckDeps@110, RunRegressionCheckInput@118.
- `lib/verify/regression-report.ts` · `types sans consommateur` — LocatedRegressionReport@87.
- `lib/verify/runner.ts` · `types sans consommateur` — RunVerificationInput@50.
- `lib/webhooks/send.ts` · `types sans consommateur` — WebhookEventName@26, WebhookEventInput@33, WebhookPayload@48.
- `lib/chat/default-chat-mode.ts` · `(b) test-only` — ResolvedChatMode@48, ChatModeProbes@65, DEFAULT_CHAT_MODE_PROBES@83 — importés seulement par __tests__/conversations-route.test.ts et __tests__/default-chat-mode.test.ts.
- `lib/chat/parity-contract.ts` · `(b) test-only` — LEGACY_CONVERSATION_STATUSES@9 — __tests__/chat-parity-contract.test.ts.
- `lib/chat/persistent-runner.ts` · `(b) test-only` — resetPersistentChatRunnerForTests@1037 — hook de reset assumé (3 tests).
- `lib/chat/unified-cutover-migration.ts` · `(b) test-only` — runUnifiedChatCutoverMigration@217, resetUnifiedChatCutoverMigrationStateForTests@392 — __tests__/chat-cutover-migration.test.ts. La prod n'appelle que runUnifiedChatCutoverMigrationOnce (app/api/projects/[projectId]/conversations/route.ts:14,49).
- `lib/control-desk/aggregate.ts` · `(b) test-only` — countUnreadAi@359 — __tests__/control-desk-aggregate.test.ts.
- `lib/db/init.ts` · `(b) test-only` — DEFAULT_NAMED_AGENT_NAME@15, DEFAULT_NAMED_AGENT_PROVIDER@16, DEFAULT_NAMED_AGENT_MODEL@17, LEGACY_BASELINE_MS@35 — __tests__/db-init.test.ts.
- `lib/db/schema.ts` · `(b) test-only` — NewRoutine@70, GitSyncLog@807, VerifyReport@815, AgentPrompt@821, AgentProviderDefault@827, PullRequest@833, NewReviewComment@843, NewFriction@849, NotificationReadCursor@918, TicketReadCursor@935 — seul __tests__/db-schema.test.ts les cite (test de forme du schéma).
- `lib/dependencies/validation.ts` · `(b) test-only` — detectCycle@58 — __tests__/dependencies-validation.test.ts. La détection de cycle n'est appelée par aucune route ni service.
- `lib/documents/memory.ts` · `(b) test-only` — ProjectMemoryChangedError@149, archiveProjectMemory@289 — __tests__/memory-doc.test.ts, __tests__/memory-route.test.ts.
- `lib/documents/mentions.ts` · `(b) test-only` — parseDocumentMentions@48 — __tests__/documents-mentions.test.ts.
- `lib/epic-parsing.ts` · `(b) test-only` — extractJsonCandidates@27 — __tests__/epic-json-parsing.test.ts.
- `lib/epics/manual-epic-form.ts` · `(b) test-only` — EPIC_TITLE_REQUIRED@65, EPIC_TITLE_TOO_LONG@66, EPIC_DESCRIPTION_TOO_LONG@67, STORY_TITLE_REQUIRED@68 — __tests__/manual-epic-form.test.ts.
- `lib/git/clone.ts` · `(b) test-only` — buildAuthHeaderConfig@120, classifyCloneDestination@183, detectDefaultBranch@236, CloneErrorCode@519, CloneError@530, redactGitError@596, cloneRepository@695, nonInteractiveEnv@1020 — uniquement dans __tests__/clone-lifecycle-*, git-clone-*, git-option-injection, github-import-docs. Notable : cloneRepository (l'entrée « générique » de clone) n'a aucun appelant produit ; la prod passe par cloneGitHubRepository.
- `lib/git/diff.ts` · `(b) test-only` — parseUnifiedDiff@143 — __tests__/diff-parser.test.ts.
- `lib/git/github-url.ts` · `(b) test-only` — REMOTE_URL_PATTERNS@35 — __tests__/github-url-client-parser.test.ts.
- `lib/git/worktrees.ts` · `(b) test-only` — parseWorktreeList@44 — __tests__/project-worktrees-route.test.ts.
- `lib/github/device-flow-store.ts` · `(b) test-only` — _resetDeviceFlowStoreForTests@259 — hook de reset assumé (3 tests).
- `lib/github/device-flow.ts` · `(b) test-only` — GITHUB_DEVICE_CODE_URL@38, GITHUB_ACCESS_TOKEN_URL@41, GITHUB_DEVICE_VERIFICATION_URL@45, GITHUB_DEVICE_FLOW_SCOPES@53, ARIJ_GITHUB_OAUTH_CLIENT_ID@70, GITHUB_OAUTH_CLIENT_ID_ENV_VAR@73, DEVICE_FLOW_SLOW_DOWN_INCREMENT_SECONDS@82, DEVICE_FLOW_DEFAULT_EXPIRES_IN_SECONDS@85, resolveGitHubOAuthClientId@156, parseScopeList@194 — tests github-device-flow* et e2e/github-device-flow.spec.ts.
- `lib/github/pull-requests.ts` · `(b) test-only` — tailCiJobLog@160, classifyPullRequestCi@175 — __tests__/github-pr-ci.test.ts. La classification CI des PR n'est consommée par aucun code produit.
- `lib/github/sync-log.ts` · `(b) test-only` — getRecentSyncLogs@120 — __tests__/github-sync-log.test.ts.
- `lib/grading/report.ts` · `(b) test-only` — parseAcceptanceCriteria@76, findCriterionGrading@97 — __tests__/grading-report.test.ts.
- `lib/i18n/resolve-request-locale.ts` · `(b) test-only` — readStoredUiLocale@16 — __tests__/i18n-request-locale.test.ts.
- `lib/kanban/activity-feed.ts` · `(b) test-only` — SYSTEM_GROUP_WINDOW_MS@25, feedItemKind@112, matchesActivityFilter@116, filterActivityFeed@131 — __tests__/epic-activity-feed.test.tsx. Le module reste vivant par ailleurs (buildActivityFeed, isLongComment, commentPreview).
- `lib/kanban/filters.ts` · `(b) test-only` — KanbanFilters@18, EMPTY_FILTERS@31, countActiveFilters@39, epicMatchesFilters@57, parseStoredFilters@78 — __tests__/kanban-filters.test.tsx (fichier entier mort en prod).
- `lib/kanban/merge-readiness.ts` · `(b) test-only` — hasCurrentMergeConflict@143, hasCurrentConflictMarkers@156, isMergeReady@244, isMergeReadyEpic@279 — __tests__/merge-readiness.test.ts. À vérifier avant suppression : CLAUDE.md déclare lib/kanban/merge-readiness comme logique vivante ; ce sont bien ces 4 entrées précises qui n'ont plus d'appelant produit.
- `lib/kanban/queue.ts` · `(b) test-only` — buildDependencyAdjacency@152, buildDependencyFocus@188, dependencyFocusRole@218, computeReadiness@249 — __tests__/kanban-queue.test.ts.
- `lib/kanban/reorder.ts` · `(b) test-only` — persistedColumnOrder@48 — __tests__/kanban-review-reorder.test.ts (fichier entier mort en prod).
- `lib/kanban/status-transitions.ts` · `(b) test-only` — REASON_MERGE_REQUIRED_KEY@56, REASON_RELEASED_SYSTEM_ONLY_KEY@58, REASON_SESSION_RUNNING_KEY@60, isTicketTransitionSelectable@145 — __tests__/status-transitions.test.ts, __tests__/ticket-overlay.test.tsx.
- `lib/kanban/unread-ai.ts` · `(b) test-only` — isAiCommentAuthor@25 — __tests__/unread-ai.test.ts.
- `lib/notifications/create.ts` · `(b) test-only` — buildTitle@36, buildTargetUrl@63, buildAskedQuestionTitle@86, buildStalledTitle@257, buildUnresolvedMentionsTitle@280, buildDagWaveOutcomeTitle@1036 — __tests__/notifications-create.test.ts.
- `lib/piscine/nav.ts` · `(b) test-only` — LAST_PROJECT_STORAGE_KEY@308, resetLastVisitedProjectId@362 — __tests__/top-bar.test.tsx, e2e/top-bar-project-scope.spec.ts.
- `lib/projects/clone-cleanup.ts` · `(b) test-only` — resolveRemovableClonePath@80 — __tests__/clone-lifecycle-cleanup.test.ts.
- `lib/projects/workspace-path.ts` · `(b) test-only` — WorkspacePathError@9, assertInsideRoot@25 — __tests__/workspace-path-guard.test.ts (fichier entier mort en prod).
- `lib/qa/aggregate.ts` · `(b) test-only` — QA_CHECK_INTERRUPTED_STATUS@285 (__tests__/qa-boot-cleanup.test.ts), outcomeArrow@448 (__tests__/qa-findings-aggregate.test.ts, e2e/qa-findings-responsive.spec.ts).
- `lib/qa/boot-cleanup.ts` · `(b) test-only` — QA_CHECK_INTERRUPTED_SUMMARY@48 — __tests__/qa-boot-cleanup.test.ts.
- `lib/refinement/dispatch.ts` · `(b) test-only` — REFINEMENT_EMPTY_BOARD_REASON@39 — __tests__/refinement-dispatch.test.ts.
- `lib/refinement/registry.ts` · `(b) test-only` — _resetRefinementRegistryForTests@116 — hook de reset assumé (3 tests).
- `lib/refinement/report.ts` · `(b) test-only` — buildRefinementReport@71, formatRefinementSummary@100, formatRefinementComment@208 — __tests__/refinement-report.test.ts.
- `lib/refinement/snapshot.ts` · `(b) test-only` — RefinementSnapshotInput@73, assembleRefinementSnapshot@119 — __tests__/refinement-prompt.test.ts, __tests__/refinement-snapshot.test.ts.
- `lib/security/remote-access.ts` · `(b) test-only` — REMOTE_TOKEN_HEADER@32 — __tests__/remote-access-credential.test.ts.
- `lib/settings/writable-keys.ts` · `(b) test-only` — WRITABLE_SETTING_KEYS@32, WRITABLE_SCOPED_SETTING_KEYS@90, SERVER_MANAGED_SETTING_KEYS@119 — seulement __tests__/settings-key-allowlist.test.ts et settings-writable-keys-coverage.test.ts. À rapprocher du finding ouvert de l'audit du 06/09 : PATCH /api/settings accepte toute clé — l'allowlist existe et n'est appliquée nulle part en production.
- `lib/telescope/collect.ts` · `(b) test-only` — TELESCOPE_MAX_PAYLOAD_CHARS@37, buildFailureSignature@313, normalizeFindingMessagePrefix@339 — __tests__/telescope-collector.test.ts.
- `lib/tickets-registry/aggregate.ts` · `(b) test-only` — composeActivity@226 — __tests__/tickets-registry-aggregate.test.ts.
- `lib/tickets-registry/url-state.ts` · `(b) test-only` — REGISTRY_URL_DEFAULTS@75 — __tests__/tickets-registry-url-params.test.ts.
- `lib/uploads/image-attachments.ts` · `(b) test-only` — ALLOWED_IMAGE_MIME_TYPES@11, MAX_IMAGE_UPLOAD_LABEL@34, imageUploadRejectionReason@109 — tests chat-upload-*, image-attachment-rules.
- `lib/uploads/ticket-images.ts` · `(b) test-only` — ticketImageUrl@47 — __tests__/ticket-images.test.ts.
- `lib/usage/aggregate.ts` · `(b) test-only` — LiveQuotaInputs@350 — __tests__/usage-report.test.ts.
- `lib/usage/claude-quota.ts` · `(b) test-only` — CLAUDE_USAGE_ARGV@43, PROBE_TIMEOUT_MS@53, buildGetUsageRequestLine@56, parseClaudeQuota@126, ClaudeProbeRunner@189, runClaudeProbe@199 — __tests__/usage-claude-quota.test.ts et __tests__/fixtures/quota-fixtures.ts.
- `lib/usage/codex-appserver.ts` · `(b) test-only` — CODEX_APPSERVER_ARGV@38, buildInitializeFrame@43, INITIALIZED_FRAME@54, buildRateLimitsFrame@56, buildUsageFrame@65, findResponseFrame@92, parseCodexLiveQuota@183, AppServerRunner@244, APPSERVER_TIMEOUT_MS@249, runCodexAppServerProbe@260 — __tests__/usage-codex-appserver.test.ts et fixtures. Aucun appelant produit du probe app-server Codex.
- `lib/usage/codex-rate-limits.ts` · `(b) test-only` — parseRateLimitLine@72 — __tests__/usage-codex-rate-limits.test.ts.
- `lib/usage/codex-snapshot.ts` · `(b) test-only` — findRecentRolloutFiles@59 — __tests__/usage-codex-rate-limits.test.ts.
- `lib/usage/quota-cache.ts` · `(b) test-only` — __resetQuotaCacheForTests@136 — hook de reset assumé.
- `lib/verify/execution-lock.ts` · `(b) test-only` — VerificationAlreadyRunningError@14 — __tests__/verify-execution-lock.test.ts.
- `lib/verify/regression-check.ts` · `(b) test-only` — globToRegExp@44, fileMatchesAnyPattern@72, RegressionCommandOutcome@97, buildRegressionCommand@156, looksLikeStartupFailure@205 — __tests__/regression-check.test.ts.
- `lib/verify/regression-report.ts` · `(b) test-only` — REGRESSION_REPORT_MARKER@20, parseRegressionReportComment@127 — __tests__/regression-report.test.ts, ticket-comment-content.test.tsx, verify-gate.test.ts.
- `lib/verify/runner.ts` · `(b) test-only` — VERIFY_OUTPUT_LIMIT_BYTES@15, VERIFY_KILL_GRACE_MS@18, VERIFY_CLOSE_GRACE_MS@26 — __tests__/verify-runner.test.ts.
- `lib/verify/verify-constants.ts` · `(b) test-only` — DEFAULT_VERIFY_TIMEOUT_MS@17, DEFAULT_VERIFY_COMMANDS@88 — __tests__/pipeline-settings-section.test.tsx, __tests__/verify-settings.test.ts.
- `lib/webhooks/send.ts` · `(b) test-only` — WEBHOOK_URL_SETTING_PREFIX@19, WEBHOOK_TIMEOUT_MS@22, DEFAULT_APP_BASE_URL@24, getProjectWebhookUrl@114, buildWebhookPayload@138 — __tests__/webhooks-send.test.ts, __tests__/night-summary.test.ts.
- `lib/i18n/request.ts` · `(faux positif — ne pas supprimer)` — Aucun import statique (21 l), mais chargé par next.config.ts:136 via createNextIntlPlugin("./lib/i18n/request.ts"). Signalé ici pour que personne ne le retire sur la foi d'un scan d'imports.

### Composants, hooks et barrels (22 entrées)

- `/home/orosius/workspace/arij/components/ui/progress.tsx` · `Progress` — 0 importeur produit, 0 importeur test. Aucune occurrence de `ui/progress` ni de `<Progress` dans app/ components/ hooks/ lib/ e2e/ __tests__/. Fichier de 31 lignes inchangé depuis le commit initial (29d47ac3). Non supprimé par la rationalisation en cours.
- `/home/orosius/workspace/arij/components/ui/separator.tsx` · `Separator` — 0 importeur produit, 0 importeur test. Aucune occurrence de `ui/separator` ni de `<Separator` (les hits `DropdownMenuSeparator`/`SelectSeparator` viennent d'autres fichiers). 28 lignes, inchangé depuis le commit initial. Non supprimé par la rationalisation en cours.
- `/home/orosius/workspace/arij/lib/piscine/tokens.ts` · `STRATUM (ligne 45)` — MORT TOTAL. Re-exporté par components/piscine/index.ts:152. grep sur app/ components/ hooks/ lib/ __tests__/ e2e/ scripts/ : deux occurrences seulement, la déclaration et la ligne du barrel (les autres hits — QaRunsBand.tsx:21, VerdictRow.tsx:15, StrataBand.tsx:19 — sont des commentaires en majuscules, vérifiés un par un). Table Record d'environ 44 lignes.
- `/home/orosius/workspace/arij/lib/piscine/tokens.ts` · `STRATUM_MOTION_CLASS (ligne 90)` — MORT TOTAL. Deux occurrences dans tout le dépôt : la déclaration et le re-export components/piscine/index.ts:153. 0 importeur produit, 0 test.
- `/home/orosius/workspace/arij/components/piscine/Mono.tsx` · `MONO_TONE (ligne 44)` — MORT TOTAL. Une seule occurrence dans son propre fichier (la déclaration) plus le re-export components/piscine/index.ts:54. C'est `MONO_TONE_CLASS` (ligne 60) qui est réellement consommé — mais uniquement en interne, ligne 117 : lui aussi a 0 importeur externe. Table de 14 entrées `var(--…)`.
- `/home/orosius/workspace/arij/components/settings-piscine/settings-fields.ts` · `SETTINGS_INVENTORY (lignes 467-503)` — MORT TOTAL, et sa garde annoncée n'existe pas. 0 importeur produit, 0 test ; deux occurrences en tout (la déclaration et le re-export index.ts:47). Le commentaire lignes 459-466 affirme que `__tests__/settings-inventory.test.tsx` rend les trois onglets et vérifie chaque entrée : `ls __tests__/settings-inventory*` → absent, `git log -- __tests__/settings-inventory.test.tsx` → vide. Le type `SettingsInventoryEntry` (ligne 449) et le type `SettingsTab` (ligne 447) ne servent qu'à cette table : morts en cascade.
- `/home/orosius/workspace/arij/components/settings-piscine/settings-fields.ts` · `SETTING_FIELD_KEYS (ligne 434)` — MORT TOTAL. Une occurrence (la déclaration) plus le re-export index.ts:46. 0 importeur produit, 0 test.
- `/home/orosius/workspace/arij/components/piscine/index.ts` · `50 exports sur 103 à 0 importeur produit` — Décompte hors le barrel lui-même. Types Props/variantes jamais importés (usage interne uniquement) : StrataBandProps, BandDensity, BandHeaderProps, BandHeaderStratum, PillButtonProps, PillButtonSize, identityChipVariants, IdentityChipProps, stampVariants, StampProps, BreathingDotProps, ProgressTrackProps, ChronoProps, MonoProps, FieldKickerProps, KickerSize, SegmentedControlProps, SelectPillProps, GhostInputPillProps, CheckMarkProps, PipelineChainProps, TimelineLineProps, DiffDeltaProps, AvatarSquareProps, AvatarTone, AvatarSize, DeskHeaderProps, TopBarProps, TopBarMenuProps, UnderlineTabNavProps, UnderlineTabNavItem, StatNumeralProps, RatioBarProps, CappedBarChartProps, CappedBar, SurfaceCardProps, SurfaceRadius, KbdHintProps, QuietLinkProps, QuietLinkTone, QuietDangerActionProps, STRATA, PROJECT_TONES. Fonctions à 0 produit mais importées par un test : projectIdFromPath, categoryIsLive, deriveStatuses (les trois par __tests__/top-bar.test.tsx ; elles servent aussi en interne à TopBar.tsx / TopBarMenu.tsx). Vraiment morts partout : STRATUM, STRATUM_MOTION_CLASS, MONO_TONE, MONO_TONE_CLASS (0 importeur externe, usage interne seul).
- `/home/orosius/workspace/arij/components/settings-piscine/index.ts` · `16 exports sur 50 à 0 importeur produit` — Hors le barrel lui-même : SettingToggleProps, SettingRowProps, SETTING_INPUT_BASE (SettingField.tsx:75, utilisé en interne ligne 92), SettingFieldProps, SettingInputProps, SettingTextareaProps, BandDimProps, SettingsSectionProps, SettingsFooterProps, SETTING_FIELD_KEYS, SETTINGS_INVENTORY, ParseResult, SettingFieldSpec, SettingsInventoryEntry, SettingsTab, WebhookRow (WebhooksBand.tsx:20, utilisé en interne lignes 28 et 40).
- `/home/orosius/workspace/arij/components/ui/card.tsx` · `CardHeader:18, CardTitle:31, CardDescription:41, CardAction:51, CardFooter:74` — 5 des 7 exports du fichier à 0 importeur produit et 0 test, et sans usage interne : seuls Card et CardContent sont consommés (card.tsx a 4 importeurs produit : app/projects/[projectId]/frictions/page.tsx, app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx, components/import/ImportPreview.tsx, components/shared/ArijActionsList.tsx).
- `/home/orosius/workspace/arij/components/ui/dropdown-menu.tsx` · `DropdownMenuPortal:15, DropdownMenuGroup:54, DropdownMenuCheckboxItem:85, DropdownMenuShortcut:179, DropdownMenuSub:195, DropdownMenuSubTrigger:201, DropdownMenuSubContent:225` — 7 des 15 exports à 0 importeur produit, 0 test, et 2 occurrences chacun dans le fichier (déclaration + liste d'export) donc aucun usage interne non plus. Le fichier lui-même a 24 importeurs produit.
- `/home/orosius/workspace/arij/components/ui/sheet.tsx` · `SheetTrigger:14, SheetClose:20, SheetHeader:90, SheetFooter:100, SheetTitle:110, SheetDescription:123` — 6 des 8 exports à 0 importeur produit et sans usage interne. Le fichier n'a qu'un seul importeur produit, components/chat/UnifiedChatPanel.tsx, qui n'utilise que Sheet et SheetContent — cohérent avec la note du doc de rationalisation qui conserve délibérément UnifiedChatPanel.
- `/home/orosius/workspace/arij/components/ui/select.tsx` · `SelectGroup:15, SelectLabel:90, SelectSeparator:130 (morts) ; SelectScrollUpButton:143, SelectScrollDownButton:161 (export inutile)` — 5 des 10 exports à 0 importeur produit. SelectScrollUpButton/DownButton sont réellement rendus en interne (lignes 74 et 84) : seul leur export est superflu. Les trois autres n'ont aucun usage. Fichier : 9 importeurs produit.
- `/home/orosius/workspace/arij/components/ui/popover.tsx` · `PopoverHeader:48, PopoverTitle:58, PopoverDescription:68` — 3 des 7 exports à 0 importeur produit, 0 test, aucun usage interne. Le fichier a 3 importeurs produit (components/desk/NowDesk.tsx, components/qa/PickerPopover.tsx, components/releases/ChangelogAgentPopover.tsx).
- `/home/orosius/workspace/arij/components/ui/dialog.tsx` · `DialogTrigger:17 (mort) ; DialogOverlay:35, DialogPortal:23 (export inutile)` — 3 des 10 exports à 0 importeur produit. DialogOverlay et DialogPortal sont utilisés en interne par DialogContent (lignes 61-62, 82) : seul l'export est superflu. DialogTrigger n'a aucun usage. Fichier : 12 importeurs produit.
- `/home/orosius/workspace/arij/components/ui/badge.tsx` · `badgeVariants (ligne 7, export ligne 48)` — 0 importeur produit, 0 test ; utilisé en interne ligne 42. Export superflu. badge.tsx a 13 importeurs produit.
- `/home/orosius/workspace/arij/components/ui/button.tsx` · `buttonVariants (ligne 7, export ligne 64)` — 0 importeur produit, 1 usage interne ligne 58. Export superflu. button.tsx a 43 importeurs produit — le fichier ui le plus consommé.
- `/home/orosius/workspace/arij/components/ui/tabs.tsx` · `tabsListVariants (ligne 28, export ligne 91)` — 0 importeur produit, usage interne ligne 53. Export superflu. tabs.tsx n'a qu'un importeur produit : components/routines/RoutinesSettings.tsx.
- `/home/orosius/workspace/arij/components/ui/scroll-area.tsx` · `ScrollBar (ligne 31, export ligne 58)` — 0 importeur produit, rendu en interne ligne 25. Export superflu. scroll-area.tsx a 4 importeurs produit.
- `/home/orosius/workspace/arij/hooks` · `45 hooks, aucun mort` — Tous les hooks de hooks/*.ts encore présents ont au moins un importeur produit. Les plus fragiles (un seul consommateur) : useAutoModeArmed ← components/piscine/TopBar.tsx ; useStoredValue ← hooks/usePanelLayout.ts ; useEpicDependencies / useEpicDetail / useEpicMutations / useEpicPr / useProjectEpicsList ← hooks/useTicketOverlayData.ts ; useGitHubDeviceFlow ← components/settings-piscine/GitHubCard.tsx ; useQaReports ← app/projects/[projectId]/qa/page.tsx ; useStoryDetail ← app/projects/[projectId]/stories/[storyId]/page.tsx ; useDiff ← components/review/DiffViewer.tsx ; usePipelineDispatchDefault ← components/shared/SendToDevDialog.tsx. Les hooks retirés par la rationalisation (useKanban, useBoardMerge, useDashboardSummary, useNotifications) ne sont pas comptés : ils sont marqués D dans git status.
- `/home/orosius/workspace/arij/components/piscine` · `21 composants dont l'unique importeur est le barrel` — BandHeader, CappedBarChart, CheckMark, Chrono, DeskHeader, DiffDelta, GhostInputPill, KbdHint, PipelineChain, ProgressTrack, QuietDangerAction, QuietLink, RatioBar, SegmentedControl, SelectPill, Stamp, StatNumeral, StrataBand, TimelineLine, TopBar, UnderlineTabNav. Ce n'est PAS du code mort : chaque export a des consommateurs finaux via `@/components/piscine` (StrataBand 64, BandHeader 60, PillButton 47, Mono 91, SurfaceCard 32, IdentityChip 22, QuietLink 22, FieldKicker 20, SelectPill 18, BreathingDot 15, Stamp 11, CheckMark 10, GhostInputPill 8, ProgressTrack 7, Chrono 7, SegmentedControl 11, DiffDelta 4, AvatarSquare 4, StatNumeral 4, RatioBar 4, CappedBarChart 3, PipelineChain 3, TimelineLine 3, UnderlineTabNav 3, KbdHint 2, DeskHeader 1, TopBar 1, TopBarMenu 1). Le plus faible est DeskHeader (1 consommateur produit) — le commentaire du barrel le dit lui-même « on its way out ».
- `/home/orosius/workspace/arij/components/settings-piscine` · `15 bandes dont l'unique importeur est le barrel` — AgentsMemoryBand, AppearanceBand, BudgetBand, FullAutoBand, GitHubCard, GlobalPromptBand, NightRunsBand, NotificationsBand, OpenAiCard, PipelineBand, SettingsFooter, SettingsTabSync, VerificationBand, WebhooksBand, WorkspaceBand. Chacune a exactement 1 consommateur final via le barrel (la page réglages) : pas de code mort, mais aucune marge — la suppression d'un seul appelant les rendrait toutes orphelines d'un coup.

### Routes et pages orphelines

- `app/api/notifications/route.ts` · `GET` — ORPHELINE. Aucun appelant : `rg "api/notifications"` sur app/components/hooks/lib (hors __tests__/e2e) ne rend que la route elle-même, des commentaires et arji.json. hooks/useNotifications.ts et __tests__/use-notifications.test.ts sont supprimés (D) dans l'arbre. Le commentaire lib/refinement/report.ts:446 le dit déjà : « `notifications` has no consumer in the app ». La table `notifications` continue d'être écrite (lib/notifications/create.ts, appelée par lib/events/emit.ts:6) mais /api/inbox ne la lit pas (app/api/inbox/route.ts:4-10 ne sélectionne que agentSessions, epics, projects, ticketComments, ticketReadCursors).
- `app/api/notifications/read/route.ts` · `POST` — ORPHELINE. Zéro occurrence de "notifications/read" hors de la route. C'était l'upsert du curseur de lecture de la cloche de notifications, retirée avec hooks/useNotifications.ts.
- `app/api/dashboard/summary/route.ts` · `GET` — ORPHELINE. Les 2 seules mentions de "/api/dashboard/summary" hors de la route sont des COMMENTAIRES : components/desk/TodayTile.tsx:14 et app/api/control-desk/route.ts:500, tous deux disant explicitement que leur comptage est « deliberately not /api/dashboard/summary's `yesterday` ». hooks/useDashboardSummary.ts est supprimé (D) dans l'arbre. Aucun `fetch` ne vise cette URL.
- `app/api/projects/[projectId]/dependencies/route.ts` · `GET (l.16), POST (l.30)` — ORPHELINE (les deux méthodes). Le seul consommateur de graphe de dépendances côté client est hooks/useEpicDependencies.ts:37 et :61, qui vise `/api/projects/${projectId}/epics/${epicId}/dependencies` — une AUTRE route (niveau ticket). hooks/useBatchSelection.ts:52 vise `.../dependencies/transitive`, encore une autre. components/dependencies/DependencyEditor.tsx et __tests__/dependency-editor.test.tsx sont supprimés (D) dans l'arbre : c'était l'appelant de cette route projet.
- `app/api/projects/[projectId]/epics/[epicId]/artifacts/route.ts` · `GET` — ORPHELINE. Route qui liste les `sessionArtifacts` d'un ticket (« durable visual proofs », commentaire l.9). Aucun fetch vers `.../epics/*/artifacts` : `rg '/artifacts'` sur components/hooks/lib hors app/api ne rend que lib/agent-sessions/artifact-view.ts (voir entrée suivante) et des commentaires sur des chemins disque. La galerie d'artefacts n'existe pas côté UI.
- `lib/agent-sessions/artifact-view.ts` · `sessionArtifactUrl / SessionArtifactSummary` — ORPHELINE, et avec elle la route app/api/projects/[projectId]/artifacts/[artifactId]/route.ts (GET). Ce module de 16 lignes est le SEUL constructeur d'URL vers cette route (l.15) et il n'a aucun importateur : `rg "artifact-view"` sur tout le dépôt (hors node_modules) ne rend AUCUN résultat, pas même dans __tests__. La route de service du fichier d'artefact n'est donc jamais atteinte depuis l'app.
- `app/api/projects/[projectId]/git/connect/route.ts` · `POST` — ORPHELINE. `rg "git/connect"` et `rg '"/connect"|/connect`'` sur app/components/hooks/lib : zéro appelant. La page git-sync (app/projects/[projectId]/git-sync/page.tsx) n'appelle que `/git/status` (l.188), `/git/pull` (l.276) et `/git/push` (l.331) ; hooks/useGitStatus.ts n'appelle que `/git/status` (l.47) et `/git/push` (l.75). La liaison owner/repo passe désormais par /api/projects/[projectId]/github/detect.
- `app/api/projects/[projectId]/git/detect-remote/route.ts` · `POST` — ORPHELINE. La seule mention de "detect-remote" hors de la route est un commentaire, lib/github/client.ts:21 (« `git/detect-remote` already use for the same class of condition »). Aucun fetch. Doublon fonctionnel de app/api/projects/[projectId]/github/detect/route.ts, qui, lui, est appelé.
- `app/api/projects/[projectId]/route.ts` · `DELETE (l.117)` — MÉTHODE SANS APPELANT (GET l.19 et PATCH l.31 sont bien appelés). J'ai listé les 15 sites `method: "DELETE"` de app/components/hooks (hors __tests__/app/api) : aucun ne vise `/api/projects/${projectId}` nu — ils visent epics/${epicId}, stories/${storyId}, conversations, documents, routines, mcp-servers, qa reports, chat/uploads, sessions. Il n'existe donc aucun moyen de supprimer un projet depuis l'UI.
- `app/api/projects/[projectId]/user-stories/route.ts` · `PATCH (l.88), DELETE (l.131)` — MÉTHODES SANS APPELANT. "user-stories" n'apparaît que 3 fois hors app/api : hooks/useEpicDetail.ts:72 (GET, `?epicId=`), app/projects/import/page.tsx:192 (POST) et un commentaire lib/validation/schemas.ts:59. L'édition/suppression d'une story passe par /api/projects/[projectId]/stories/[storyId] (hooks/useStoryDetail.ts:34 et :80, app/projects/[projectId]/stories/[storyId]/page.tsx:82).
- `app/projects/import/page.tsx` · `ImportProjectPage` — PAGE SANS LIEN ENTRANT. 619 lignes. `rg 'projects/import'` sur app/components/hooks/lib hors app/api : le seul résultat est un COMMENTAIRE, components/piscine/TopBar.tsx:849 (« `/projects/new` and `/projects/import` are routes, not projects »). Le « + » de la TopBar (TopBar.tsx:443) pointe sur /projects/new, et app/projects/new/page.tsx (151 l.) est un simple formulaire nom/description/chemin qui POST /api/projects puis `router.push('/projects/${id}')` (l.46) — il ne propose aucun lien vers l'import.
- `app/api/projects/clone/route.ts` · `POST` — JOIGNABLE UNIQUEMENT DEPUIS UNE PAGE ORPHELINE. Unique appelant : app/projects/import/page.tsx:354. Même situation pour app/api/projects/import/route.ts (POST, unique appelant app/projects/import/page.tsx:293) et pour le POST de app/api/projects/[projectId]/user-stories/route.ts (unique appelant app/projects/import/page.tsx:192). Corollaire : tout components/import/ (FolderSelector, GitHubUrlSelector, ImportPreview, ImportProgress, types) n'est importé que par cette page (`rg -l 'components/import/'` → app/projects/import/page.tsx et ImportPreview.tsx).
- `app/piscine-preview/page.tsx` · `PiscinePreviewPage` — PAGE SANS LIEN ENTRANT — mais ORPHELINE PAR CONCEPTION, à ne pas supprimer. Harnais de dev du design system ; les seuls href vers /piscine-preview sont internes à la page (l.879-881). Explicitement exempté par eslint.config.mjs:51 et scripts/i18n/check-keys.mjs:78-79, et documenté docs/specs.md:798 (« Harnais de développement […] Pas un écran produit »).
- `bin/arij-mcp.mjs` · `22 outils MCP` — AUCUN ÉCART. Script de vérification : extraction des `name: "…"` du fichier (moins l'entrée serveur `arij`), kebab-case, diff contre `ls app/api/mcp` → 22 vs 22, `tools sans route: []`, `routes sans tool: []`. Les 22 routes app/api/mcp/* n'ont donc aucun appelant HTTP interne (normal : elles sont appelées par le bridge stdio, bin/arij-mcp.mjs:874, via le factory partagé lib/mcp/board-tool-route.ts).

### Marqueurs et instrumentation oubliée

- `/home/orosius/workspace/arij/components/session-live/SessionHeaderBar.tsx` · `IdentityChip tone` — L116 — SEUL vrai TODO de code produit du périmètre : `hex. TODO(foundation): swap the fixed tone for` — la couleur d'identité projet est figée à tone={1} (L122) en attendant `lib/projects/color.ts`, qui n'existe pas ; vérifié : aucun fichier lib/projects/color.ts et aucune colonne couleur côté projets.
- `/home/orosius/workspace/arij/lib/git/clone-constants.ts` · `CLONE_TIMEOUT_SETTING_KEY / MIN_CLONE_TIMEOUT_MS / parseCloneTimeoutSetting` — L13 `export const CLONE_TIMEOUT_SETTING_KEY = "clone_timeout_ms";` — FEATURE FLAG MORT. Preuve : `rg 'CLONE_TIMEOUT|clone_timeout_ms'` sur tout le dépôt (hors node_modules/json) ne rend que ce fichier, `lib/settings/writable-keys.ts:50` (allowlist d'écriture) et `lib/git/clone.ts:20/732` qui n'importe que DEFAULT_CLONE_TIMEOUT_MS. `parseCloneTimeoutSetting` (L31) et `MIN_CLONE_TIMEOUT_MS` (L23) n'ont aucun appelant, ni produit ni test. La clé est donc écrivable par PATCH /api/settings et sans effet : un utilisateur qui règle le timeout de clone ne change rien.
- `/home/orosius/workspace/arij/app/piscine-preview/page.tsx` · `page (dev harness)` — 1 074 lignes livrées comme route de production. L4-5 `DEV HARNESS — NOT A PRODUCT SCREEN.` ; L12-15 l'en-tête affirme que `app/_piscine-preview/` est le vrai fichier et que celui-ci « re-exports it » : FAUX, `ls app/` ne contient pas `_piscine-preview`, ce fichier est le composant complet. L17 `Delete both files (and nothing else) when the redesign lands.` — la refonte Piscine est en place. Contient 12 contrôles inertes : L416 `<IdentityChip label="arij" tone={1} size="md" onClick={() => {}} />`, L696 `onChange={() => {}}`, L699 `disabled` nu, L743 `<CheckMark checked onToggle={() => {}} disabled />`, L1046, L1057, L1060, L1063, L1066. Copie française en dur hors catalogue (`note="…"`, `label="Aperçu"`).
- `/home/orosius/workspace/arij/app/piscine-preview/page.tsx` · `UnderlineTabNav items` — L879-883 — nav pointant vers 4 routes qui n'existent pas : `/piscine-preview/spec`, `/piscine-preview/agents`, `/piscine-preview/releases`, `/piscine-preview/usage`. Vérifié : `ls -R app/piscine-preview` ne contient que `page.tsx`. Cliquer donne un 404.
- `/home/orosius/workspace/arij/app/api/control-desk/route.ts` · `GET` — L606 `console.debug("[control-desk/GET] query profile", {` — instrumentation de perf non conditionnée (pas de garde NODE_ENV ni de flag), sur la route que le desk interroge en polling. Un des 5 sites identiques.
- `/home/orosius/workspace/arij/app/api/tickets/route.ts` · `GET` — L689 `console.debug("[tickets/GET] query profile", {` — même instrumentation non conditionnée, route du registre exhaustif.
- `/home/orosius/workspace/arij/app/api/qa/findings/route.ts` · `GET` — L664 `console.debug("[qa/findings/GET] query profile", {` — même instrumentation non conditionnée.
- `/home/orosius/workspace/arij/app/api/projects/route.ts` · `GET` — L95 `console.debug("[projects/GET] query profile", {` — même instrumentation non conditionnée.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/epics/route.ts` · `GET` — L375 `console.debug("[epics/GET] query profile", {` — même instrumentation non conditionnée.
- `/home/orosius/workspace/arij/app/api/projects/import/route.ts` · `POST` — L66-67 `console.log("[import] Spawning analysis agent with cwd:", safePath);` puis `console.log("[import] Prompt length:", prompt.length);` et L81 `console.log("[import] Analysis agent result:", {` — traces de mise au point (chemin absolu, taille de prompt) restées en clair dans les logs serveur.
- `/home/orosius/workspace/arij/components/review/ReviewActions.tsx` · `ReviewActionsProps.projectId / .epicId` — L21-22 déclarées obligatoires, L35-36 destructurées, jamais lues dans le corps (eslint no-unused-vars confirme les deux). Le composant est vivant (DiffViewer.tsx:12/191 → TicketOverlay.tsx:30/442), donc l'appelant est forcé de fournir deux valeurs inutiles.
- `/home/orosius/workspace/arij/components/review/DiffViewer.tsx` · `commentsLoading` — L41 `loading: commentsLoading,` — état de chargement de useReviewComments extrait puis jamais consommé : le panneau de commentaires n'a aucun rendu de chargement (seul `diffLoading`, L38, est utilisé).
- `/home/orosius/workspace/arij/components/releases/ReleaseHistory.tsx` · `RELEASE_STATE_KEYS / all` — L15 `RELEASE_STATE_KEYS,` importé et L44 `const all = useTranslations();` — les deux inutilisés. C'est exactement la paire que components/releases/NextReleaseBand.tsx:25/128 utilise (`all(RELEASE_STATE_KEYS[releaseState(inspectRelease)])`) pour rendre le mot d'état ; ici le rendu passe par trois clés distinctes (L115/118/120). Reliquat de refactor, pas une intention.
- `/home/orosius/workspace/arij/lib/claude/prompt-builder.ts` · `import { section }` — L19 `section,` — import mort dans le module de construction de prompts (eslint no-unused-vars).
- `/home/orosius/workspace/arij/lib/dependencies/validation.ts` · `import { and, or }` — L3 `import { eq, and, or } from "drizzle-orm";` — `and` et `or` jamais utilisés.
- `/home/orosius/workspace/arij/lib/git/clone.ts` · `import type SimpleGitOptions` — L5 `import simpleGit, { CheckRepoActions, type SimpleGit, type SimpleGitOptions } from "simple-git";` — `SimpleGitOptions` inutilisé. À noter parce que CLAUDE.md documente ce fichier comme le piège récurrent des installs périmées : ici ce n'est pas un faux positif de version, c'est un import réellement mort (eslint, pas tsc).
- `/home/orosius/workspace/arij/components/session-live/useSessionStreamPager.ts` · `seed effect` — L98 `// eslint-disable-next-line react-hooks/exhaustive-deps` — seule suppression du périmètre qui déclenche `react-hooks/rule-suppression` : « React Compiler has skipped optimizing this component because one or more React ESLint rules were disabled ». Tout le hook sort donc de l'optimisation, pas seulement l'effet.
- `/home/orosius/workspace/arij/hooks/useEpicDetail.ts` · `effet de chargement` — L109 `// eslint-disable-next-line react-hooks/set-state-in-effect` — suppression assumée et commentée (L108 « Initial navigation owns the spinner »).
- `/home/orosius/workspace/arij/components/desk/YourTurnBand.tsx` · `useLayoutEffect measure()` — L161 `// eslint-disable-next-line react-hooks/set-state-in-effect` — assumée, justifiée L152-153 (mesure post-layout impossible pendant le rendu). Garde-fou MAX_PASSES/SETTLE_MS en place.
- `/home/orosius/workspace/arij/components/chat-page/UserBubble.tsx` · `<img>` — L46 `{/* eslint-disable-next-line @next/next/no-img-element */}` — un des 3 sites où la règle est explicitement désactivée.
- `/home/orosius/workspace/arij/components/ticket/TicketScreenshots.tsx` · `<img>` — L81 `{/* eslint-disable-next-line @next/next/no-img-element */}`.
- `/home/orosius/workspace/arij/components/shared/ImageLightbox.tsx` · `<img>` — L58 `{/* eslint-disable-next-line @next/next/no-img-element */}`.
- `/home/orosius/workspace/arij/components/chat/MarkdownContent.tsx` · `<img>` — L118 — même construction que les trois ci-dessus mais SANS disable : produit un avertissement eslint actif. Idem components/chat/MessageList.tsx:83 et components/shared/ImageAttachmentStrip.tsx:36. Incohérence de traitement entre six sites identiques.
- `/home/orosius/workspace/arij/components/chat-page/ChatPageView.tsx` · `EmptyChatWorkspace` — L285-314 — 8 `={() => {}}` et un `disabled` nu (L304) : `onSelect`, `onCreate`, `onRestartPersistentSession`, `onSelectProject`, `onSelectAgent`, `onSend`, `onOpenTicket`, `onPropose`. INTENTIONNEL et documenté L260-267 (état vide « pas de faux projet, pas de spinner ») — listé pour l'exhaustivité, pas comme défaut.
- `/home/orosius/workspace/arij/components/routines/RoutinesSettings.tsx` · `RoutineEditor` — L793 `onDeleted={() => {}}` (éditeur d'une routine en création : rien à supprimer) et L827 `onCancelNew={() => {}}` (routine existante : pas de création à annuler). No-op structurels : le contrat de props mélange deux modes au lieu d'un type discriminé.
- `/home/orosius/workspace/arij/lib/chat/parity-contract.ts` · `LegacyConversationStatus & co.` — Module entier nommé « parité avec l'ancien » : L3 `export type LegacyConversationStatus`, L14 `normalizeLegacyConversationStatus`, L23 `isLegacyConversationGenerating`, L29 `resolveLegacyConversationLabel`, L58 `compareConversationsByLegacyOrder`, L69 `sortConversationsForLegacyParity`. 7 consommateurs vivants (hooks/useConversations.ts:4/48, components/chat-page/{ChatPageView,ConversationRosterCard}.tsx, components/chat/{UnifiedChatPanel,ChatWorkspaceHeader,ChatTabBar}.tsx, app/api/projects/[projectId]/conversations/route.ts). C'est le coût, mesurable, de la « deuxième interface de chat » que docs/architecture/ui-rationalisation-2026-09-10.md déclare volontairement conservée.
- `/home/orosius/workspace/arij/lib/i18n/messages/index.ts` · `ChatLegacy / SettingsLegacy` — L7 `import en_ChatLegacy from "./en/ChatLegacy.json";` et L38 `import en_SettingsLegacy from "./en/SettingsLegacy.json";` (enregistrés L73 et L104). Deux namespaces du catalogue explicitement marqués hérités : ChatLegacy est lu par 6 composants (components/chat/{UnifiedChatPanel:74,ChatWorkspaceHeader:40+129,QuestionCards:16,MessageList:25,ChatTabBar,MessageInput:34}), SettingsLegacy par un seul (components/settings/McpServersSection.tsx:190, dont le commentaire L46 assume le namespace).
- `/home/orosius/workspace/arij/lib/github/sync-log.ts` · `writeGitSyncLog` — L117-118 `/** Alias kept for backward compat with main's naming */ export const writeGitSyncLog = logSyncOperation;` — alias de compat toujours VIVANT : 2 routes l'appellent (app/api/projects/[projectId]/git/push/route.ts, 6 appels ; app/api/projects/[projectId]/git/pull/route.ts). Le plan docs/plans/2026-08-14-cleanup-refactor-plan.md:155 prévoyait déjà sa suppression ; deux noms coexistent pour la même fonction.
- `/home/orosius/workspace/arij/components/settings-piscine/useSettingsDraft.ts` · `commentaire de contournement` — L131-133 `// Not \`const { [key]: _, ...rest } = current\`: a computed key in a destructuring pattern is one of the constructs the React Compiler has not implemented, and it stops reading the hook there.` — contournement de bail du compilateur, documenté ; à revoir à chaque montée de version du React Compiler (le fichier reste par ailleurs sur la liste des bails, L199).
- `/home/orosius/workspace/arij/components/routines/RoutinesSettings.tsx` · `bails React Compiler` — Champion du périmètre : 10 avertissements react-hooks/todo (L226, 240, 267, 281, 298, 307, 574, 581, 651, 665), soit `finally` et `throw` dans try/catch. Les 100 avertissements se répartissent sur 68 fichiers et 3 causes seulement : 50× « Handle TryStatement with a finalizer ('finally') clause », 40× « Support value blocks … within a try/catch statement », 10× « Support ThrowStatement inside of try/catch ». Autres concentrations : app/projects/[projectId]/frictions/page.tsx (4 : L58,61,107,117), app/projects/[projectId]/github-issues/page.tsx (4 : L113,158,188,216), app/projects/[projectId]/git-sync/page.tsx (3 : L194,275,330), components/qa/StartQaCheckDialog.tsx (3 : L114,153,195), components/spec/MemoryPanel.tsx (3 : L288,323,354), hooks/useChat.ts (3 : L72,119,128). Puis 2 chacun : app/projects/[projectId]/layout.tsx (95,102), components/documents/ScanProjectDialog.tsx (95,208), components/github/GitHubConnectBanner.tsx (58,107), components/qa/ReportDetail.tsx (222,264), components/settings/McpServersSection.tsx (252,332), hooks/useEpicDependencies.ts (35,59), hooks/useEpicPr.ts (49,83), hooks/useGitStatus.ts (45,74), hooks/useWorktrees.ts (69,91). Et 1 chacun : app/inbox/page.tsx:127, app/projects/[projectId]/documents/page.tsx:49, app/projects/[projectId]/sessions/[sessionId]/page.tsx:128, app/projects/[projectId]/settings/page.tsx:75, app/projects/[projectId]/spec/page.tsx:131, app/projects/[projectId]/stories/[storyId]/page.tsx:86, app/projects/new/page.tsx:39, components/agents-workshop/AddAgentCard.tsx:106, components/agents-workshop/AgentsWorkshopView.tsx:221, components/agents-workshop/FrictionsPill.tsx:43, components/agents-workshop/LimitsView.tsx:180, components/auto-mode/AutoModeDialog.tsx:174, components/chat-page/ChatPageView.tsx:706, components/chat-page/DraftedEpicCard.tsx:109, components/desk/NowDesk.tsx:205, components/desk/ProjectBatchToolbar.tsx:77, components/desk/WaveRunChips.tsx:64, components/github/RepoStrataBand.tsx:89, components/kanban/BugCreateDialog.tsx:132, components/kanban/EpicCreateDialog.tsx:196, components/kanban/RefinementButton.tsx:152, components/night/NightRunDialog.tsx:272, components/qa/QaScreen.tsx:185, components/session-live/SessionInfoCard.tsx:125, components/settings-piscine/GitHubCard.tsx:135, components/settings-piscine/OpenAiCard.tsx:118, components/settings-piscine/WebhooksBand.tsx:69, components/settings-piscine/useSettingsDraft.ts:199, components/shared/AgentActionsBar.tsx:299, components/spec/SpecUpdateDialog.tsx:58, components/tickets-registry/NewTicketView.tsx:101, components/tickets-registry/useTicketsRegistry.ts:106, hooks/useAgentDispatch.ts:45, hooks/useAutoModeArmed.ts:49, hooks/useConversations.ts:70, hooks/useDiff.ts:19, hooks/useDocumentUploads.ts:33, hooks/useEpicCreate.ts:79, hooks/useGitHubConfig.ts:29, hooks/useGitHubDeviceFlow.ts:393, hooks/useImageAttachments.ts:94, hooks/useNightRuns.ts:42, hooks/usePipelineRuns.ts:78, hooks/usePolledResource.ts:47, hooks/useProjectEvents.ts:94, hooks/useProjects.ts:17, hooks/useQaReports.ts:30, hooks/useReleasePublish.ts:34, hooks/useReviewComments.ts:24, hooks/useSpecGeneration.ts:32, hooks/useTicketOverlayData.ts:364, hooks/useUsage.ts:44.
- `/home/orosius/workspace/arij/lib/claude/prompt-builder.ts` · `texte de prompt (faux positifs à ne pas traiter)` — L596 `- TODOs and FIXMEs in code`, L814, L839 : ce sont des INSTRUCTIONS envoyées aux agents, pas des marqueurs de dette. Idem lib/claude/prompt-sections.ts:683 `- No placeholder or TODO code left for critical paths`. Signalés pour que la prochaine passe ne les re-découvre pas.
- `/home/orosius/workspace/arij/hooks/useTicketOverlayData.ts` · `as unknown as` — L455 `for (const row of projectEpics as unknown as ProjectEpicRow[]) {` et L486 — les deux seuls `as unknown as` du périmètre qui contournent un vrai désaccord de types (les 5 autres, lib/sync/import.ts:55, lib/planning/permanent-delete.ts:25, lib/workflow/reorder.ts:163, lib/agent-config/named-agents.ts:100, lib/agent-config/agent-resolution.ts:130, sont l'accès `$client` de drizzle et une sentinelle de provider).
