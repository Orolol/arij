# Lot 15 — Full Auto, night runs, batch DAG, routines

**Réalisation du 11/09/2026** : changements implémentés ; [détail et état des vérifications](implementation-lots-06-08-09-15.md). Validation globale de l’arbre partagé encore non verte.

**Difficulté** 3/4 — Difficile
**Findings** 10 (0 fort · 6 moyen · 4 faible ; effort 8 S · 2 M · 0 L)
**Dépendances** Après le lot 06 (helper de lancement).

## Décision

Une seule orchestration de vagues (startWaveBatch) partagée par la route build DAG et le night run ; un GET /auto-mode léger sans calcul du board.

## Objectif

Mode sequential réellement séquentiel, gardes NIGHT_RUN_ACTIVE/BATCH_ACTIVE/PIPELINE_ACTIVE remontées sur tous les modes, worktree créé après la garde de concurrence, tickets parkés visibles (AutoModeDialog + YOUR TURN), route auto-mode scindée (config légère / candidats à l'ouverture), un seul écrivain des clés auto_mode_*, contrat night run validé une fois, paliers par projet exposés ou retirés, CI autofix qui relâche la réclamation sur refus transitoire.

## Démarche suggérée

1. Tests rouges : sequential attend settled ; DAG plain refuse un night run actif ; parked rendu.
2. Extraire startWaveBatch (skipReason/onSkip/onWaveBlocked/firstWave) dans lib/dependencies ou lib/night.
3. Scinder GET /auto-mode ; AutoModeToggle/NowDesk/TopBar consomment la version légère.
4. Un seul schéma zod pour la requête night run, importé par actions.ts et crud.ts.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #11 — Le mode « sequential » du build de lot n'est pas séquentiel : il ne fait qu'enfiler les sessions

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `app/api/projects/[projectId]/build/route.ts:983-989`
- `app/api/projects/[projectId]/build/route.ts:696-716`
- `lib/agents/scheduler.ts:128-153`
- `lib/agents/scheduler.ts:219-231`
- `components/desk/ProjectBatchToolbar.tsx:39-41`
- `components/desk/ProjectBatchToolbar.tsx:246-256`

**Constat**

ProjectBatchToolbar propose trois modes (parallel / sequential / dag). Côté serveur, la branche `sequential` fait `for … await launchEpic(epicId)`, mais `launchEpic` résout dès que la session est créée et soumise au scheduler, pas quand elle se termine : `agentScheduler.submit` appelle `start()` qui lance la closure en fire-and-forget (`void (async () => entry.launch())()`), et la promesse `settled` que `launchEpic` renvoie n'est jamais attendue dans cette branche. Résultat : « séquentiel » crée immédiatement N sessions queued et c'est `agent_max_concurrent` qui décide du parallélisme — avec un budget ≥ N les epics tournent en parallèle exactement comme le mode parallel. La seule différence observable est l'ordre de création des worktrees.

**Précision du vérificateur**

Le mode « sequential » du build de lot (app/api/projects/[projectId]/build/route.ts:983-986) ne fait qu'enfiler les sessions dans l'ordre : `launchEpic` (l.505-717) soumet la closure au scheduler et retourne `{ sessionId, settled }` sans que `settled` soit attendu ; `agentScheduler.submit` (lib/agents/scheduler.ts:128-153) démarre immédiatement via `start` (l.219-231, `void (async () => entry.launch())()`). Le parallélisme réel est dicté par `agent_max_concurrent`, dont la valeur par défaut est UNLIMITED (lib/agents/scheduler-constants.ts:36) — sans réglage, sequential et parallel sont strictement équivalents hors ordre de création des worktrees. Le mode est bien exposé dans l'UI (components/desk/ProjectBatchToolbar.tsx:39-41 et 237-239, libellé « Sequential » sans tooltip) et dans le schéma zod (route.ts:94). Aucun test ne vérifie la sérialisation ; le comportement date du premier commit (29d47ac3), ce n'est pas une régression du scheduler.

Le mode « sequential » du build de lot (ProjectBatchToolbar.tsx:237 → POST /api/projects/:id/build, route.ts:983-986) n'attend jamais la fin des sessions : `await launchEpic(epicId)` résout dès `agentScheduler.submit` (scheduler.ts:141-147, `start` l.229 lance la closure en fire-and-forget) et la promesse `settled` renvoyée par launchEpic (route.ts:716) n'est consommée que par la branche dag (l.802, l.868). N sessions sont donc créées d'un coup et seul agent_max_concurrent limite le parallélisme, contrairement à la sémantique documentée « 1 par 1 » (docs/specs.md:431). Seules différences réelles avec parallel : worktrees créés dans l'ordre, et arrêt de la boucle au premier AGENT_ALREADY_RUNNING (l.562) sans créer les sessions suivantes. Aucun test n'épingle l'ordonnancement (night-batch-route.test.ts:342 et pipeline-build-route-flag.test.ts:319 ne testent que batch_run_id et le flag pipeline).

**Recommandation**

Soit attendre réellement `(await launchEpic(id))?.settled` dans la branche sequential (en gardant la réponse HTTP non bloquante via le même patron firstWave/engineDone que le dag), soit retirer le mode de l'UI et du schéma zod. Ajouter un test qui vérifie qu'en mode sequential la 2e session n'est pas créée avant le terminal de la 1re.

<details><summary>Preuve relevée par l'auditeur</summary>

build/route.ts:983-986 `if (mode === "sequential") { for (const epicId of epicIds) { await launchEpic(epicId); } }` ; launchEpic se termine par `agentScheduler.submit(projectId, sessionId, async () => {...}); sessionsCreated.push(sessionId); return { sessionId, settled };` (l.696-716) — `settled` n'est pas consommé. scheduler.ts:144-149 : sous la limite, `submit` appelle `this.start(...)` et retourne `{ started: true }` ; start() l.229 lance `entry.launch()` sans await. Le SelectItem `sequential` est bien rendu (ProjectBatchToolbar.tsx:250).

</details>

### #13 — GET /auto-mode calcule `parked`, `recentDispatches`, `lastSweepAt`, `running` que plus aucune surface n'affiche — un ticket parké est invisible

**Nature** à moitié câblé · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `app/api/projects/[projectId]/auto-mode/route.ts:46-88`
- `lib/auto-mode/status.ts:14-50`
- `lib/auto-mode/registry.ts:19`
- `components/auto-mode/AutoModeDialog.tsx:112-121`
- `components/auto-mode/AutoModeToggle.tsx:63-70`
- `components/desk/NowDesk.tsx:561-575`

**Constat**

La route auto-mode renvoie un `AutoModeStatus` complet (candidats, en vol, tickets parkés, 20 derniers dispatches, dernier sweep, running). Le registre se décrit comme « the dialog's live feed ». Or AutoModeDialog ne lit que enabled/agents/concurrences/smartDispatch/secondOpinion/effectiveSchedulerBudget/candidates/inFlight, AutoModeToggle ne lit que enabled et inFlight, NowDesk ne lit que buildAgent/reviewAgent. Aucun composant ne consomme `parked`, `recentDispatches`, `lastSweepAt` ni `running`. Conséquence produit : quand Full Auto parke un ticket (3 échecs, conflit de merge non résolu, budget de rejets de review épuisé), la seule trace est une ligne du ticket_activity_log ; rien dans le desk, le dialogue ou le pill ne dit « ce ticket est parké, commentez-le pour le relancer », alors que c'est le geste documenté pour le déparker.

**Précision du vérificateur**

GET /auto-mode renvoie `parked`, `recentDispatches`, `lastSweepAt`, `running` (route.ts:82-87, status.ts:37-44) qu'aucun client ne lit : AutoModeDialog (applyStatus l.86-97, rendu l.201-207) ne consomme que 8 champs, AutoModeToggle (l.63-69) enabled+inFlight, NowDesk (l.558-585) buildAgent/reviewAgent ; le « dialog's live feed » promis par registry.ts:19 n'est rendu nulle part. En revanche un ticket parké N'EST PAS invisible : le desk le montre déjà comme hold `parked` dans la bande UP NEXT (« Paused after repeated failures » / « En pause après des échecs répétés »), via read-model.ts:137,176-177 → aggregate.ts:650 → UpNextBand.tsx:88-93,161,238, sans passer par la route auto-mode ; les parks sur conflit de merge (merge.ts:913-944) et sur second opinion (engine.ts:1118) créent en plus une notification. Ce qui manque réellement : la raison du park et l'indication « commentez pour relancer » sur le chip/dialogue, l'absence de notification pour les parks à 3 échecs et à rejets de review (engine.ts:1161), et le feed « recentDispatches » jamais rendu — soit à rendre dans le dialogue, soit à retirer du contrat GET et corriger le commentaire registry.ts:19.

GET /auto-mode renvoie `running`, `lastSweepAt`, `parked` (avec reason/failures) et `recentDispatches` qu'aucun consommateur (AutoModeDialog, AutoModeToggle, NowDesk, MCP, routines) ne lit ; le « dialog's live feed » promis par lib/auto-mode/registry.ts:19 n'existe pas et le dialogue ne montre ni les dispatches récents ni les tickets parkés. En revanche, un ticket parké n'est PAS invisible : le desk le rend via autoModeRegistry.parkedTicketIds → lib/control-desk/read-model.ts:137/177 → aggregate.ts:650 → UpNextBand.tsx:91/161/238 avec le libellé « Paused after repeated failures » / « En pause après des échecs répétés ». Ce qui manque réellement : la raison et le nombre d'échecs du parkage, le rappel du geste de déparkage (commenter le ticket, doc full-auto-mode.md:380), et le feed du dialogue — soit les rendre, soit retirer ces champs du contrat GET et corriger le commentaire du registre.

**Recommandation**

Soit rendre les tickets parkés (au minimum une ligne dans AutoModeDialog avec la raison et le lien ticket, et/ou un marqueur dans la bande YOUR TURN du desk), soit retirer ces champs du contrat GET et du registre si le produit n'en veut pas. Dans tous les cas, mettre à jour le commentaire du registre.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'recentDispatches|\.parked\b|lastSweepAt|status\.running' app components hooks lib` hors lib/auto-mode et la route : zéro résultat. applyStatus (AutoModeDialog.tsx:112-121) ne copie que 7 champs ; le rendu utilise status.candidates (l.225-231) et status.inFlight (l.233-239). Registry.ts:19 « 4. what did the mode do recently (the dialog's live feed) » — ce feed n'existe pas dans le dialogue.

</details>

### #14 — Trois lecteurs différents du même état « Full Auto armé », dont un qui recharge tout le board toutes les 5 s pour un badge

**Nature** refacto · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `components/auto-mode/AutoModeToggle.tsx:34-58`
- `app/api/projects/[projectId]/auto-mode/route.ts:46-88`
- `lib/auto-mode/select.ts:44-52`
- `hooks/useAutoModeArmed.ts:39-70`
- `components/desk/NowDesk.tsx:556-585`
- `components/session-live/NextChainCard.tsx:18-24`
- `components/desk/WaveRunChips.tsx:72`

**Constat**

L'état armé de Full Auto est lu par trois chemins non partagés : TopBar via `useAutoModeArmed` (scan complet de GET /api/settings), AutoModeToggle via GET /api/projects/:id/auto-mode polling 5 s, NowDesk via le payload control-desk plus un GET /auto-mode par projet à l'ouverture du popover. Le GET /auto-mode exécute `buildStatus` → `loadAutoModeBoard` (snapshot « nine queries » + CTE epic_session_facts) puis les trois sélecteurs, uniquement pour renvoyer des compteurs de candidats que le Toggle n'affiche pas (il ne rend que enabled + inFlight). NextChainCard.tsx documente lui-même ce coût comme « far too expensive for a screen that already polls twice » et s'en abstient. Sur la page projet on cumule ainsi AutoModeToggle 5 s + WaveRunChips 3 s + useAgentPolling 3 s + control-desk + SSE.

**Précision du vérificateur**

Trois lecteurs non partagés de l'état « Full Auto armé » : TopBar via useAutoModeArmed (scan de GET /api/settings, sans poll), AutoModeToggle via GET /api/projects/:id/auto-mode en poll 5 s, NowDesk via `project.autoModeEnabled` du payload control-desk. Le GET /auto-mode exécute à chaque appel buildStatus → loadAutoModeBoard (snapshot « nine queries » + CTE epic_session_facts) + les trois sélecteurs de candidats ; seul AutoModeDialog affiche ces compteurs (AutoModeDialog.tsx:189-198), le Toggle qui les paie 12 fois par minute ne rend que `enabled` et `inFlight`. Précision : le GET /auto-mode par projet de NowDesk (l.558-583, à l'ouverture du popover) sert à lire buildAgent/reviewAgent, pas l'état armé — mais il paie le même board. Cumul sur /projects/:id : Toggle 5 s + WaveRunChips 3 s + useAgentPolling 3 s + control-desk + SSE. (Le commentaire « nine queries » est à lib/auto-mode/select.ts:42, non 44-46.)

**Recommandation**

Scinder la route : GET léger (config + snapshot registre, sans board) consommé par le Toggle/NowDesk/TopBar, et calcul des candidats seulement à l'ouverture du dialogue (`?candidates=1`). Faire lire l'état armé au Toggle depuis le payload control-desk déjà pollé par le desk plutôt que par un poller dédié.

<details><summary>Preuve relevée par l'auditeur</summary>

AutoModeToggle.tsx:39-58 : setInterval(load, 5000) sur `/api/projects/${projectId}/auto-mode` ; rendu l.63-70 n'utilise que `status?.enabled` et `status.inFlight`. route.ts:52-65 : `loadAutoModeBoard(projectId)` + selectBuild/Review/MergeCandidates à chaque GET. select.ts:44-46 « one board snapshot built from a FIXED number of queries (nine …) ». NextChainCard.tsx:19-21 « GET /api/projects/:id/auto-mode, which loads the whole board and runs three candidate selectors. Far too expensive ». useAutoModeArmed.ts:47 fetch("/api/settings") puis filtre par préfixe.

</details>

### #15 — L'orchestration de vagues est dupliquée entre la branche DAG « plain » de la route build et lib/night/run.ts

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `app/api/projects/[projectId]/build/route.ts:838-960`
- `lib/night/run.ts:373-396`
- `lib/night/run.ts:497-556`
- `app/api/projects/[projectId]/build/route.ts:220-470`
- `lib/routines/actions.ts:56-90`

**Constat**

lib/night/run.ts a extrait la moitié « night » de l'orchestration des vagues (skipReason, onSkip → logTransition same-state, onWaveBlocked avec la même dédup « onlyUnblockingQuestions », firstWaveLaunched/settleFirstWave, engine crash → finish). La branche DAG sans pipeline de app/api/projects/[projectId]/build/route.ts (l.838-960) garde une copie inline de tout cela, quasiment ligne pour ligne, avec dagBatchRegistry en place de nightRunRegistry. La route fait 1013 lignes et porte trois orchestrations (team, solo/sequential/parallel, dag) plus la délégation night ; c'est le seul endroit du périmètre où la logique métier vit dans une route, et lib/routines/actions.ts l'appelle avec une NextRequest synthétique justement parce qu'elle n'est pas extraite (point déjà relevé le 06/09).

**Précision du vérificateur**

Vrai, avec deux corrections.

(a) Numéros de ligne décalés d'une vingtaine de lignes. Les vrais emplacements dans l'arbre de travail : route `skipReason` l.837-852, `onSkip` l.883-907, `onWaveBlocked` l.909-946, `firstWaveLaunched` l.858-862 + 874-879, crash-safety `engineRun.catch` l.948-952 ; `lib/night/run.ts` `skipReason` l.397-417, `settleFirstWave` l.419-428, `onSkip` l.539-565, `onWaveBlocked` l.566-590, crash → `finishRun` l.601-616.

(b) « avec dagBatchRegistry en place de nightRunRegistry » est faux : `lib/night/run.ts` alimente les DEUX registres (l.526 `dagBatchRegistry.setWave(runId, wave)` puis `nightRunRegistry.update(...)` + `syncRegistries()`). La branche DAG « plain » de la route n'utilise que `dagBatchRegistry` ; la moitié night ajoute nightRunRegistry, le breaker, le cost cap, la branche `aborted` de skipReason et le choke point `finishRun` — la duplication porte donc sur le socle commun, pas sur un simple échange de registre.

Le reste tient : duplication quasi ligne pour ligne de skipReason / onSkip / onWaveBlocked / firstWave / crash→finish, route de 1013 lignes portant trois orchestrations, et `lib/routines/actions.ts` l.59-96 appelant le `POST` de la route via une `NextRequest` synthétique faute d'extraction.

**Recommandation**

Extraire un `startWaveBatch({ registry: dag|night, launch, onTerminal })` dans lib/dependencies ou lib/night qui porte skipReason/onSkip/onWaveBlocked/firstWave, et faire de la route un simple parseur de requête qui délègue (team → lib/agents/team-build.ts, solo → lib/agents/batch-build.ts). Cela règle au passage l'appel de route synthétique des routines.

<details><summary>Preuve relevée par l'auditeur</summary>

Route l.838-853 `const skipReason = (skip: WaveSkippedTicket): string => { if (skip.kind === "stopped") … dependency ${ref} failed / asked a question }` ≡ run.ts:373-396 (même corps, plus la branche `aborted`). Route l.892-915 onSkip (select status → logTransition same-state, warn `[build/dag] Failed to log skip`) ≡ run.ts:507-530 (`[night] Failed to log skip`). Route l.916-946 onWaveBlocked avec `onlyUnblockingQuestions = blocked.every(b => b.success) && waveSkipped.length === 0` ≡ run.ts:531-556. Route l.858-865 + 874-879 firstWaveLaunched ≡ run.ts:398-408.

</details>

### #16 — Le batch DAG « plain » n'a aucune garde contre un night run ou un pipeline actif, alors que le night run refuse l'inverse

**Nature** risque · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `app/api/projects/[projectId]/build/route.ts:745-775`
- `app/api/projects/[projectId]/build/route.ts:154-171`
- `app/api/projects/[projectId]/build/route.ts:548-560`
- `lib/night/run.ts:326-334`
- `lib/auto-mode/select.ts:58-60`

**Constat**

Le night run refuse de démarrer si un night run, un batch de vagues ou un pipeline actif existe sur le projet (codes NIGHT_RUN_ACTIVE / BATCH_ACTIVE / PIPELINE_ACTIVE_ON_EPIC). La branche DAG sans pipeline n'a que la garde par session active du haut de route (`getRunningSessionForTarget` par epic), qui ne voit pas les epics `pending` des vagues suivantes d'un night run ni les runs de pipeline entre deux stages. Le commentaire l'assume (« Plain dag batches get none of these guards (behavior preserved) »). Concrètement : un utilisateur lance « Build all » en mode Waves depuis ProjectBatchToolbar pendant un night run ; ses sessions prennent les epics des vagues 2+ ; quand le night run atteint ces vagues, `launchEpic` lève AGENT_ALREADY_RUNNING, le ticket de vague settle en `failed`, et ces échecs alimentent le circuit breaker du night run (observationFor → "failed"). Full Auto, lui, exclut bien les epics possédés par un night run (select.ts « owned »).

**Précision du vérificateur**

Dans app/api/projects/[projectId]/build/route.ts, les gardes NIGHT_RUN_ACTIVE / BATCH_ACTIVE / PIPELINE_ACTIVE_ON_EPIC (l.751-780) ne s'exécutent que sous `if (pipeline)` (l.750-811) ; la branche dag sans pipeline (l.813+) et les modes parallel/sequential ne passent que par la garde par session active l.163-177 (`getRunningSessionForTarget`, lib/agents/concurrency.ts:36-62, qui ne voit que les sessions queued/running), et `filterBuildableTickets` (lib/dependencies/validation.ts:243-250) filtre uniquement par statut. Un night run actif n'empêche donc pas un batch « Build all » en mode Waves (ProjectBatchToolbar.tsx:65-72) de prendre les epics des vagues non encore lancées ; quand le night run les atteint, `launchEpic` lève AGENT_ALREADY_RUNNING (route l.548-560), wave-runner.ts:305-318 l'enregistre en échec, et run.ts:362-371 (`observationFor`, pas 326-334) le remonte au circuit breaker via l.531-535. Ce comportement est délibérément épinglé par __tests__/night-batch-route.test.ts:245-259 (« plain dag keeps today's behavior: no night guards consulted ») et le commentaire de lib/auto-mode/select.ts:55-57 affirme à tort que la route refuse ces trois conflits. Limite : si la sélection recouvre un epic déjà en session (vague en cours), la garde l.163-177 refuse tout le batch ; la collision n'arrive que sur les vagues futures, et elle est symétrique (le côté plain-dag arrivant second voit son ticket failed et ses dépendants skippés, sans breaker).

Confirmé, avec deux précisions. (a) Le trou concerne tous les modes de la ProjectBatchToolbar (parallel, sequential, dag — l.65-74 envoie `mode: buildMode` sans `pipeline`), pas seulement le dag : seule la garde par session active `getRunningSessionForTarget` (route l.163-178, concurrency.ts l.38-62, sessions queued|running uniquement) s'applique, et elle ne voit ni les epics `pending` des vagues suivantes d'un night run (pas de ligne agent_sessions avant `launchEpic`) ni les runs de pipeline entre stages. Les gardes NIGHT_RUN_ACTIVE / BATCH_ACTIVE / PIPELINE_ACTIVE_ON_EPIC (route l.751-778) ne s'exécutent que sous `if (pipeline)` (l.750). Le bouton « Build all » n'est bloqué que par l'état local `batchBusy` (l.201) et la sélection ⌘-clic (NowDesk.tsx l.175-183) n'est pas filtrée. Conséquence vérifiée : quand le night run atteint un epic déjà pris, `launchEpic` lève AGENT_ALREADY_RUNNING (l.573-579), wave-runner.ts l.305-316 le range en `immediateFailures` (success:false, statut "failed", dépendants bloqués), et run.ts l.533-536 + l.362-371 le compte comme "failed" pour le circuit breaker. (b) Ce comportement est délibérément figé : commentaire « behavior preserved » (l.745-748) et test __tests__/night-batch-route.test.ts l.245-259 (« plain dag keeps today's behavior: no night guards consulted ») qui attend un 200 avec un night run actif — corriger implique d'inverser ce test. Full Auto, lui, exclut bien les tickets « owned » (select.ts l.54-56).

**Recommandation**

Remonter les trois gardes au-dessus du `if (pipeline)` pour tout mode dag (et idéalement pour parallel/sequential : refuser un epic qui figure dans un night run actif ou un pipeline actif), ou au minimum exclure de `buildableEpicIds` les epics possédés par un night run actif, comme le fait Full Auto.

<details><summary>Preuve relevée par l'auditeur</summary>

Route l.745-748 commentaire : « Conflicting work is REFUSED, never queued. Plain dag batches get none of these guards (behavior preserved). » Les trois gardes (nightRunRegistry.getActiveByProject, dagBatchRegistry.listByProject, listPipelineRunsByProject) sont dans `if (pipeline) {…}` l.750-786 uniquement. La garde générale l.154-171 ne teste que `getRunningSessionForTarget`. run.ts:326-334 `observationFor` : `if (!result.success) return "failed"` pour un lancement refusé. select.ts:58-60 : « owned — the ticket belongs to a live pipeline run, DAG wave batch or night run ».

</details>

### #75 — CI autofix : toute erreur levée par la route build consomme définitivement la réclamation par (PR, SHA), sauf le seul cas « target_busy »

**Nature** risque · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** pipeline-routines

**Fichiers**
- `lib/routines/ci-watch.ts:396-403`
- `lib/routines/ci-watch.ts:432-455`
- `lib/routines/ci-watch.ts:466`
- `lib/routines/ci-autofix.ts:73-82`
- `app/api/projects/[projectId]/epics/[epicId]/build/route.ts:131-137`

**Constat**

ci-watch.ts:399-403 pose `autofixAttempted: true` et le persiste AVANT l'appel de la route ; seul `launch.status === "skipped" && reason === "target_busy"` (L432-441) relâche la réclamation. Si launchCiAutofixSession lève (ci-autofix.ts:80-82 : tout `!response.ok || payload.error` hors 409 AGENT_ALREADY_RUNNING — worktree impossible, 400 « not a git repository », erreur de résolution d'agent, WorkflowTransitionError 409 sans `code`), le catch L446-455 ne touche pas nextState[epic.id] et L466 persiste la réclamation : ce head SHA ne sera jamais retenté, et la seule trace est un console.error plus une notification dans la table que rien ne lit. Le commentaire L396-398 assume ce comportement pour un crash process, pas pour un refus applicatif. À noter aussi : le message d'erreur de la route (epics/[epicId]/build/route.ts:133-137) énumère « backlog, todo, in_progress, or review » alors que BUILDABLE_STATUSES (lib/types/kanban.ts:44) inclut to_merge.

**Précision du vérificateur**

ci-watch.ts:399-403 persiste `autofixAttempted: true` avant d'appeler la route build ; seul `skipped/target_busy` (L432-441) relâche la réclamation. Tout refus de la route survenant avant createQueuedSession (route.ts:294) — 400 payload invalide, 404, 400 statut non buildable, 400 branche absente, 400 « not a git repository », exception attachWorktree ou assembleEpicBuildPrompt, CompositeAgentUnusableError → 400, WorkflowTransitionError → 409 sans `code` — est converti en exception par ci-autofix.ts:80-82 ; le catch L446-455 n'affecte pas nextState[epic.id] et L466 persiste la réclamation. nextCiObservation (L255-258) la conserve tant que le head SHA est identique : ce SHA n'est plus jamais retenté, et la route ne répondrait pas already_attempted puisqu'aucune ligne agent_sessions n'existe. Trace : console.error + statut "failed" de la routine, transformé par scheduler.ts:244-249 en notification dans une table dont GET /api/notifications est le seul lecteur, sans aucun appelant client dans l'arbre (useNotifications retiré). Tests : seul target_busy est couvert côté relâchement. Cosmétique : route.ts:135 énumère quatre statuts alors que BUILDABLE_STATUSES (kanban.ts:39-45) inclut to_merge.

ci-watch.ts:399-403 persiste `autofixAttempted: true` avant d'appeler launchAutofix ; seul `skipped/target_busy` (L432-441) relâche la réclamation. Si launchCiAutofixSession lève (ci-autofix.ts:80-82 : tout `!ok || error` hors 409 code AGENT_ALREADY_RUNNING — 400 statut non buildable route L131-138, 400 branchName absent L143-149, 404/400 getProjectOr404, 400 « not a git repository » L164, WorkflowTransitionError 409 sans `code` L285-288), le catch L446-455 laisse nextState[epic.id] réclamé et L466 le persiste : ce head SHA ne sera plus retenté (un nouveau push réarme). Chemin réellement câblé : instrumentation.ts:72-75 → scheduler → actions.ts:257 → runCiWatchRoutine(defaultCiWatchDeps, launchAutofix = launchCiAutofixSession). La trace utilisateur existe (sweep "failed", message « N could not be processed (PR #x) », notification de run lue par /inbox via useInbox → /api/inbox, lastStatus dans RoutinesSettings) mais ne dit pas que la réclamation est consommée. Tests : seul target_busy couvre le relâchement (ci-watch.test.ts:396-419), aucun cas où launchAutofix rejette. Annexe : message de la route (L133-137) omet to_merge présent dans BUILDABLE_STATUSES (kanban.ts:44).

**Recommandation**

Distinguer refus transitoire (route 4xx/5xx, exception) et tentative réelle : relâcher la réclamation dans le catch quand aucun sessionId n'a été créé, ne la conserver que si la route a répondu avec un sessionId ou `already_attempted`. Aligner le message de la route sur BUILDABLE_STATUSES.

<details><summary>Preuve relevée par l'auditeur</summary>

Lecture du flux : claim persisté L403 ; catch L446 n'affecte que failedPullRequestNumbers/nextErrorState ; L466 `deps.persistState(routine.id, nextState, …)` avec nextState[epic.id].autofixAttempted === true. Tests : `rg -n "target_busy|already_attempted" __tests__/ci-watch.test.ts __tests__/ci-autofix.test.ts` → seul le cas target_busy est couvert côté relâchement.

</details>

### #17 — Paliers par projet `night_circuit_breaker:<id>` / `night_cost_cap_usd:<id>` : résolus, autorisés, nettoyés, mais jamais écrits et masqués par le dialogue

**Nature** à moitié câblé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `lib/night/run.ts:112-143`
- `components/night/NightRunDialog.tsx:164-181`
- `components/night/NightRunDialog.tsx:266-283`
- `components/settings-piscine/NightRunsBand.tsx:60-84`
- `lib/settings/writable-keys.ts:101-102`
- `lib/projects/project-settings-keys.ts:45-46`

**Constat**

lib/night/run.ts résout breaker et cost cap en chaîne override → clé projet → clé globale → défaut ; les clés projet sont dans WRITABLE_SCOPED_SETTING_KEYS et dans la liste de nettoyage perProjectSettingKeys. Mais aucune surface ne les écrit : NightRunsBand n'écrit que les clés globales, la page settings projet n'écrit que PROMPT_TOKEN_BUDGET. Pire, NightRunDialog pré-remplit le champ breaker avec la valeur globale ou le défaut 3 et l'envoie TOUJOURS en `circuitBreaker` (le parse est non-null), donc `resolveNightCircuitBreaker` retourne l'override avant même de lire la clé projet : même posée à la main via PATCH /api/settings, elle ne s'applique jamais à un run lancé depuis le dialogue. Idem pour le cost cap dès qu'une valeur globale existe. Le seul chemin qui atteindrait le palier projet est la routine nocturne sans override.

**Précision du vérificateur**

Paliers par projet `night_circuit_breaker:<id>` / `night_cost_cap_usd:<id>` : résolus (lib/night/run.ts:111-143), autorisés (lib/settings/writable-keys.ts:101-102), nettoyés (lib/projects/project-settings-keys.ts:45-46), mais aucune surface ne les écrit — NightRunsBand.tsx:60-84 n'écrit que les clés globales, app/projects/[projectId]/settings/page.tsx que prompt_token_budget ; seuls des tests moteur (__tests__/night-run-engine.test.ts:302,320) les posent par insertion SQL directe. NightRunDialog.tsx pré-remplit le breaker depuis la clé globale ou le défaut 3 (l.115-118, 154) alors que GET /api/settings renvoie aussi les clés scoped, et handleConfirm (l.200-208) envoie `circuitBreaker` dès que le champ parse — donc par défaut toujours, et `costCapUsd` dès qu'une globale existe ; `resolveNight*` retourne l'override avant de lire la clé projet. Le palier projet n'est atteint que (a) par la routine nocturne sans override (lib/routines/actions.ts:160-181) ou (b) si l'utilisateur efface le champ à la main, l'input (l.374-382) n'ayant ni placeholder ni indication que vide = valeur résolue côté serveur. Correctif : exposer les deux paliers dans la page settings projet et n'envoyer l'override que si l'utilisateur a modifié le champ (placeholder = valeur résolue projet → global), ou retirer le palier projet des trois listes.

lib/night/run.ts:111-143 résout breaker et cost cap en chaîne override → `night_circuit_breaker:<id>` / `night_cost_cap_usd:<id>` → clé globale → défaut ; ces clés projet sont acceptées par PATCH /api/settings (lib/settings/writable-keys.ts:101-102) et balayées à la suppression du projet (lib/projects/project-settings-keys.ts:45-46), mais aucune surface ne les écrit (NightRunsBand.tsx:60-84 n'écrit que les clés globales ; la page settings projet ne touche que prompt_token_budget ; aucun outil MCP). Pire, NightRunDialog.tsx:115-117 et :154 pré-remplissent le breaker avec la valeur globale ou le défaut 3 et :200/:207 l'envoient systématiquement en `circuitBreaker` (test night-run-dialog.test.tsx:279-303 fige ce comportement), si bien que `resolveNightCircuitBreaker` retourne l'override avant de lire la clé projet : posée à la main via PATCH, elle ne s'applique jamais à un run lancé depuis le dialogue. Le cost cap projet subit le même masquage dès qu'une valeur globale existe (:155-156, :208). Le seul chemin qui atteint le palier projet est la routine night_run (instrumentation.ts:72-75 → lib/routines/actions.ts:152-181), dont l'UI RoutinesSettings.tsx n'expose pas d'override.

**Recommandation**

Soit exposer les deux paliers projet dans la page settings projet et faire que le dialogue n'envoie l'override que si l'utilisateur a modifié le champ (placeholder = valeur résolue par le serveur, obtenue via un GET qui applique la chaîne projet → global), soit supprimer le palier projet des trois listes.

<details><summary>Preuve relevée par l'auditeur</summary>

run.ts:116-118 `const fromOverride = parseNightCircuitBreaker(override ?? null); if (fromOverride !== null) return fromOverride;` avant la boucle sur `nightCircuitBreakerSettingKey(projectId)`. NightRunDialog.tsx:168-170 `setCircuitBreaker(String(breaker ?? DEFAULT_NIGHT_CIRCUIT_BREAKER))` puis l.266 `const breaker = parseNightCircuitBreaker(circuitBreaker)` et l.282 `...(breaker == null ? {} : { circuitBreaker: breaker })` — jamais null. `rg 'nightCircuitBreakerSettingKey|night_circuit_breaker' app components hooks lib` : aucun écrivain hors la liste d'allowlist ; `rg -o '[A-Z_]+SETTING_KEY' app/projects/[projectId]/settings/page.tsx` → PROMPT_TOKEN_BUDGET_GLOBAL_SETTING_KEY seulement.

</details>

### #21 — Dans launchEpic, le worktree et la branche sont créés avant la garde de concurrence et avant transitionBuildStarted

**Nature** risque · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `app/api/projects/[projectId]/build/route.ts:507-585`
- `app/api/projects/[projectId]/build/route.ts:987-1012`
- `app/api/projects/[projectId]/epics/[epicId]/build/route.ts:188`
- `app/api/projects/[projectId]/epics/[epicId]/build/route.ts:259-276`

**Constat**

Pour chaque epic d'un lot, `launchEpic` fait createWorktree (branche git + répertoire) puis compose le prompt, puis seulement vérifie `getRunningSessionForTarget` et appelle `transitionBuildStarted` (qui peut lever WorkflowTransitionError : ticket released, story guard, etc.). Un refus à ce stade laisse la branche et le worktree créés, sans que `epics.branchName` soit renseigné (l'update vient après la transition) : worktree orphelin invisible pour le merge et pour le nettoyage par branchName. En mode parallel, `Promise.all(epicIds.map(launchEpic))` rejette au premier refus et la route répond 500/409, alors que les autres epics ont déjà leur session queued et leur worktree — la réponse ne liste pas ces sessions (`sessionsCreated` n'est pas renvoyé sur l'erreur). La route unitaire epics/[epicId]/build a le même ordre (createWorktree l.188 avant la garde l.259), donc le patron est systémique.

**Précision du vérificateur**

Dans launchEpic (build/route.ts l.505-717), le worktree et la branche sont créés (l.520-525) avant transitionBuildStarted (l.566-571), qui est le seul garde-fou de statut en mode solo : la route batch pré-vérifie la concurrence pour tous les epics (l.160-175) mais ne pré-valide pas les transitions (validateOnly n'existe qu'en team, l.259) ni les statuts buildables. Un refus WorkflowTransitionError laisse donc branche + worktree créés sans epics.branchName (update l.572-575 jamais atteinte) : le merge est impossible (merge/route.ts l.70) tant qu'un re-dispatch réussi ne réutilise pas le worktree (createWorktree idempotent, manager.ts l.80-82) ; le worktree reste toutefois visible dans le panneau /worktrees en état idle non attribué. En parallel (l.988 Promise.all) comme en sequential (l.984-986), un refus fait répondre la route 500 (409 seulement pour AGENT_ALREADY_RUNNING, catch l.999-1012) sans renvoyer les sessions déjà queued. La route unitaire epics/[epicId]/build a le même ordre (createWorktree l.185-189, garde l.259, transition l.276, 409 avec worktree laissé), mais elle pré-filtre le statut de l'epic (isBuildableStatus l.130-137) et, en cas de conflit, le worktree rendu est celui de la session déjà en cours, pas un orphelin.

Dans `launchEpic` (build/route.ts), `createWorktree` (l.520-525) précède la re-vérification de concurrence (l.556) et `transitionBuildStarted` (l.566-571) ; `epics.branchName` n'est écrit qu'après (l.572-575). Portée réelle, vérifiée : (a) une garde de concurrence en amont sur tous les epics existe déjà l.165-178, avant tout worktree ; la garde l.556 ne couvre qu'une course, et `createWorktree` étant idempotent (manager.ts l.80) un refus pour conflit ne crée aucun nouveau worktree ; (b) le seul refus de transition possible après le worktree est un epic `released` envoyé au chemin solo (sequential/parallel), le seul sans filtre de statut — la branche dag applique `filterBuildableTickets` (l.733) et la route epic vérifie `isBuildableStatus` (l.131) avant son `createWorktree` (l.188), donc le « patron systémique » ne tient pas pour la route unitaire ; (c) le desk n'expose aucun ticket done/released à la sélection batch, le cas n'est atteignable que par appel API direct ; (d) le worktree résultant n'est pas invisible : la page worktrees liste depuis `git worktree list` (worktrees.ts l.104-114) et le montre « idle » ; (e) en parallel, les sessions créées avant un rejet sont déjà soumises au scheduler (l.698) et tournent — la réponse 500/409 sans `sessionsCreated` ne produit qu'un toast trompeur (ProjectBatchToolbar l.79-92). Recommandation valide : préflight `transitionBuildStarted({ validateOnly: true })` + filtre buildable sur le chemin solo avant tout `createWorktree`, comme la branche team (l.238-247), et `Promise.allSettled` en parallel.

**Recommandation**

Valider d'abord (`transitionBuildStarted({ validateOnly: true })` + garde de concurrence) puis créer le worktree, comme le fait déjà la branche team (l.238-247 valide tout avant le premier createWorktree). En mode parallel, utiliser `Promise.allSettled` et renvoyer les sessions réellement créées avec la liste des refus.

<details><summary>Preuve relevée par l'auditeur</summary>

build/route.ts : createWorktree l.520-525 ; conflict check l.548-560 ; transitionBuildStarted l.566-571 ; `db.update(epics).set({ branchName })` l.572-575 ; createQueuedSession l.577. Branche parallel l.987 `await Promise.all(epicIds.map(launchEpic))` puis catch l.999-1012 renvoie `{ error }` sans sessionsCreated. epics/[epicId]/build/route.ts : createWorktree l.188, getRunningSessionForTarget l.259, transitionBuildStarted l.276.

</details>

### #24 — PUT /auto-mode réimplémente l'upsert de settings et trois surfaces écrivent les mêmes clés auto_mode_* avec des sous-ensembles différents

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `app/api/projects/[projectId]/auto-mode/route.ts:107-124`
- `app/api/projects/[projectId]/auto-mode/route.ts:126-250`
- `components/desk/NowDesk.tsx:591-635`
- `components/settings-piscine/FullAutoBand.tsx`
- `docs/architecture/full-auto-mode.md:30-52`

**Constat**

La route auto-mode porte son propre `putSetting` (select → update/insert) « JSON-encoded exactly like PATCH /api/settings », alors que PATCH /api/settings est l'écrivain canonique avec allowlist. Les clés auto_mode_* ont ainsi trois écrivains : AutoModeDialog (PUT, 7 champs, palier projet), NowDesk popover (PUT, `enabled` ou un seul agent), FullAutoBand (PATCH /api/settings, clés nues globales). full-auto-mode.md documente les « four surfaces » comme voulues, mais la conséquence pratique est que la validation (clamp 0..10, booléens) existe deux fois (parse dans la route PUT, parse dans settings-fields.ts pour le PATCH) et que le TopBar doit scanner /api/settings pour reconstruire ce que le registre sait déjà.

**Précision du vérificateur**

`app/api/projects/[projectId]/auto-mode/route.ts:107-123` réimplémente à l'identique (select → update/insert, JSON.stringify, updatedAt ISO) l'upsert de `app/api/settings/route.ts:196-217` ; aucun helper `upsertSetting` partagé n'existe (`rg` → un seul site). Les clés auto_mode_* ont bien trois écrivains : AutoModeDialog (PUT, 7 champs, palier projet, AutoModeDialog.tsx:130-137), le popover NowDesk (deux PUT partiels, NowDesk.tsx:591-618 et 620-639) et FullAutoBand via PATCH /api/settings (clés nues globales, useSettingsDraft.ts). En revanche, contrairement à ce qu'affirme le finding, la validation n'est PAS dupliquée : route PUT et `settings-fields.ts` importent le même `parseAutoModeEnabled` de `lib/auto-mode/constants`, `settings-fields.ts` ne contient aucun clamp de concurrence, et PATCH /api/settings ne valide aucune valeur auto_mode_* (allowlist de clés seulement). Il n'y a pas non plus de trou d'allowlist côté PUT : la route fabrique ses clés avec les builders, elle n'en accepte aucune du client. Le vrai reproche se réduit donc à ~15 lignes d'upsert dupliquées, plus une dispersion des surfaces d'écriture que `docs/architecture/full-auto-mode.md:30-52` assume explicitement.

**Recommandation**

Extraire un `upsertSetting(key, value)` dans lib/settings et l'utiliser depuis PATCH /api/settings et PUT /auto-mode ; faire que PUT /auto-mode délègue la validation aux mêmes parseurs que settings-fields.ts (déjà le cas pour les clamps, pas pour l'allowlist). Réduire à deux surfaces d'écriture : le dialogue (projet) et la bande settings (global).

<details><summary>Preuve relevée par l'auditeur</summary>

route.ts:107 `/** Upserts one settings row, JSON-encoded exactly like PATCH /api/settings. */ function putSetting(key, value)` ; `rg 'function putSetting|upsertSetting|writeSetting' app lib` → seul ce site, aucun helper partagé. NowDesk.tsx:598 et :625 : deux PUT distincts sur `/api/projects/${id}/auto-mode` (agent seul ; enabled seul). full-auto-mode.md:30 « Four surfaces, and they are not equivalent ».

</details>

### #74 — Le contrat de la requête night run est réécrit trois fois (schéma zod de la route, interface + validation dans actions.ts, validation dans crud.ts)

**Nature** doublon · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** pipeline-routines

**Fichiers**
- `app/api/projects/[projectId]/build/route.ts:93-101`
- `lib/routines/actions.ts:25-33`
- `lib/routines/actions.ts:130-185`
- `lib/routines/crud.ts:141-200`

**Constat**

app/api/projects/[projectId]/build/route.ts:93-101 déclare `batchBuildOptionsSchema` (mode, team, namedAgentId, failurePolicy halt|stop, pipeline, circuitBreaker int 0..10, costCapUsd positif). lib/routines/actions.ts:25-33 redéclare `NightRunRequest` à la main et parseNightRunRequest (L130-185) re-valide failurePolicy, circuitBreaker 0..10 et costCapUsd > 0 ; lib/routines/crud.ts:141-200 (validateConfig) refait les mêmes contrôles une troisième fois pour l'écriture. Le schéma zod est local à la route (non exporté), donc tout ajout côté route (ex. `team`) ou changement de borne désynchronise silencieusement la routine.

**Précision du vérificateur**

Le contrat de la requête night run est écrit trois fois. app/api/projects/[projectId]/build/route.ts:93-101 définit `batchBuildOptionsSchema` (zod, non exporté, seul usage L118). lib/routines/actions.ts:25-33 redéclare l'interface `NightRunRequest` à la main (sans `team`) et parseNightRunRequest (L130-185) re-valide failurePolicy halt|stop, circuitBreaker entier 0..10, costCapUsd > 0, namedAgentId string|null. lib/routines/crud.ts:138-187 (validateConfig, branche `kind === "night_run"`) refait les mêmes contrôles une troisième fois à l'écriture. La redondance actions.ts/route est totale : lib/routines/actions.ts:60-80 appelle le `POST` de la route via une NextRequest synthétique, donc le corps repasse par le schéma zod. Le schéma étant local à la route, tout ajout côté route (`team` en est déjà l'illustration : présent dans le zod, absent de NightRunRequest, donc inexprimable par une routine) ou tout changement de borne désynchronise silencieusement. (Correction de plage : crud.ts 138-187, pas 141-200.)

**Recommandation**

Déplacer `batchBuildOptionsSchema` dans lib/validation/build-schemas.ts, l'exporter, dériver `NightRunRequest` par `z.infer`, et faire valider la config night_run de crud.ts avec `schema.pick(...)` plutôt qu'à la main.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "batchBuildOptionsSchema" app lib` → défini et utilisé uniquement dans build/route.ts ; lecture des trois blocs de validation : mêmes bornes (0..10, > 0, halt|stop) codées trois fois.

</details>

