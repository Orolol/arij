# Lot 06 — Un seul chemin de lancement de session (build, review, merge, pull, create-epics)

**Réalisation du 11/09/2026** : changements implémentés ; [détail et état des vérifications](implementation-lots-06-08-09-15.md). Validation globale de l’arbre partagé encore non verte.

**Difficulté** 4/4 — Très difficile — agent fort + revue humaine
**Findings** 8 (4 fort · 4 moyen · 0 faible ; effort 2 S · 4 M · 2 L)
**Dépendances** À faire avant les lots 15 (batch/vagues) et 11 (releases) qui réutilisent le helper. Ne pas lancer en parallèle du lot 15.

## Décision

dispatchBackgroundSession devient l'unique fermeture de lancement. Les routines appellent des fonctions lib/, plus jamais des handlers de routes.

## Objectif

Extraire dispatchBuildSession / dispatchReviewSession / dispatchMergeResolution dans lib/agent-sessions (ou lib/build, lib/review), consommés par les 6 routes, stage-session.ts, stage-review.ts, git/pull, create-epics et lib/routines. Un seul agent de résolution de merge (resolve-merge), une seule liste VALID_REVIEW_TYPES/REVIEW_LABELS.

## Démarche suggérée

1. Cartographier les 7 copies (fichiers:lignes dans les fiches) et leurs différences réelles (émission d'événements, handleAskedQuestionOutcome, resolvePriorFindingsFromProse, transitions).
2. Écrire le helper avec le contrat settle/evaluate/onTerminal de dispatchBackgroundSession, tests de contrat rouges d'abord (session:started/completed émis, ask-question, verdict).
3. Migrer route par route en gardant la suite verte ; supprimer la branche autoAgent de merge/route.ts ; resolve-merge utilise resolveAgentPrompt("merge") + resolveDefaultBranch + verrous.
4. create-epics : insertion via le chemin commun de POST /epics (readable id, événement, export) et génération en arrière-plan avec sessionId renvoyé.
5. lib/routines/{actions,ci-autofix}.ts : appel direct de la fonction lib/, suppression des NextRequest synthétiques.
6. Ne pas refaire le fix SIGKILL (lot 14).

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #71 — La fermeture de lancement d'une session agent est copiée sept fois (routes build/review, batch, pipeline) alors qu'un helper partagé existe déjà

**Nature** refacto · **Impact** fort · **Effort** L · **Statut** confirmé · **Domaine d'audit** pipeline-routines

**Fichiers**
- `lib/pipeline/stage-session.ts:143-226`
- `app/api/projects/[projectId]/epics/[epicId]/build/route.ts:330-446`
- `app/api/projects/[projectId]/stories/[storyId]/build/route.ts:233-301`
- `app/api/projects/[projectId]/build/route.ts:363-414`
- `app/api/projects/[projectId]/build/route.ts:619-683`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:261-285`
- `app/api/projects/[projectId]/stories/[storyId]/review/route.ts:254-280`
- `lib/agent-sessions/dispatch-background-session.ts`
- `lib/routines/actions.ts:60-97`
- `lib/routines/ci-autofix.ts:30-92`

**Constat**

La séquence markSessionRunning → processManager.start → waitForProcessCompletion → fs.writeFileSync(logs) → classifySessionOutcome → markSessionTerminal → finalisation est dupliquée dans app/api/projects/[projectId]/epics/[epicId]/build/route.ts:330-446, stories/[storyId]/build/route.ts:233-301, build/route.ts:363-414 et :619-683 (team + launchEpic), epics/[epicId]/review/route.ts:261-285, stories/[storyId]/review/route.ts:254-280 et lib/pipeline/stage-session.ts:146-226, qui se décrit lui-même comme « replica of the route closure » (L143 ; stage-code.ts:151 « build-route replica », stage-review.ts:169 « review-route replica »). Le littéral `["Edit","Write","Bash","Read","Glob","Grep"]` apparaît 9 fois. Pendant ce temps lib/agent-sessions/dispatch-background-session.ts consolide déjà 9 dispatchers (refinement, second-opinion, dreaming, memory-distill, spec-auto-rewrite, spec-update, qa/check, forensic, grading) mais aucun des chemins build/review. C'est la cause racine du finding connu du 06/09 (toujours ouvert) : lib/routines/actions.ts:60-97 et lib/routines/ci-autofix.ts:30-92 doivent importer une route app/api et forger une NextRequest parce que « dispatch un build » n'a pas de foyer dans lib/.

**Précision du vérificateur**

La fermeture de lancement d'une session agent (markSessionRunning → processManager.start → waitForProcessCompletion → fs.writeFileSync(logs) → classifySessionOutcome → markSessionTerminal → finalisation) est copiée 7 fois : epics/[epicId]/build/route.ts:331-360, stories/[storyId]/build/route.ts:233-260, build/route.ts:363-395 (team) et :619-643 (launchEpic), epics/[epicId]/review/route.ts:261-285, stories/[storyId]/review/route.ts:254-280, et lib/pipeline/stage-session.ts:151-179 qui se décrit lui-même comme « replica of the route closure » (L143 ; stage-code.ts:151 « build-route replica », stage-review.ts:169 « review-route replica »). Le littéral `["Edit","Write","Bash","Read","Glob","Grep"]` apparaît 8 fois en dur (dont 2 déjà nommées, CODE_ALLOWED_TOOLS et MERGE_ALLOWED_TOOLS), plus une 9e variante avec "Task" à build/route.ts:368. Pendant ce temps lib/agent-sessions/dispatch-background-session.ts consolide déjà 9 dispatchers, mais aucun chemin build/review. Ce manque de foyer dans lib/ contribue au finding connu du 06/09 (toujours ouvert) : lib/routines/actions.ts:60-97 et lib/routines/ci-autofix.ts:30-92 importent une route app/api et forgent une NextRequest — sans en être la seule cause, puisque leurs commentaires invoquent aussi tout ce que la route possède en propre (worktree, transitions workflow, garde AGENT_ALREADY_RUNNING, file d'attente projet).

**Recommandation**

Extraire `dispatchBuildSession` / `dispatchReviewSession` dans lib/agent-sessions (même contrat settle que dispatchBackgroundSession), faire consommer ces helpers par les 6 routes et par stage-session.ts, puis remplacer les import() de routes dans lib/routines/{actions,ci-autofix}.ts par l'appel direct au helper. Une constante CODE_AGENT_ALLOWED_TOOLS unique.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "markSessionRunning|processManager.start|waitForProcessCompletion|markSessionTerminal"` sur ces 7 fichiers → la même séquence de 4 appels dans chacun ; `rg -n '"Edit", "Write", "Bash", "Read", "Glob", "Grep"' app lib` → 9 sites ; `rg -n "dispatchBackgroundSession\(" app lib` → 9 consommateurs, aucun dans les routes build/review ni stage-session.ts.

</details>

### #90 — Le dispatch de review est écrit trois fois à la main au lieu de passer par dispatchBackgroundSession

**Nature** doublon · **Impact** fort · **Effort** L · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:67-80`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:233-262`
- `app/api/projects/[projectId]/stories/[storyId]/review/route.ts:57-70`
- `app/api/projects/[projectId]/stories/[storyId]/review/route.ts:226-255`
- `app/api/projects/[projectId]/prompt-estimate/route.ts:38`
- `lib/pipeline/stage-review.ts:47-53`
- `lib/agent-sessions/dispatch-background-session.ts:240`

**Constat**

La route review epic (425 l.) et la route review story (384 l.) contiennent la même boucle « createQueuedSession → agentScheduler.submit → processManager.start → waitForProcessCompletion → markSessionTerminal → insert ticketComments → handleAskedQuestionOutcome → resolvePriorFindingsFromProse → resolveReviewVerdict → transitionReviewRejected » copiée ligne à ligne, et lib/pipeline/stage-review.ts se décrit lui-même comme « a review-route replica ». Pendant ce temps lib/agent-sessions/dispatch-background-session.ts est le dispatcher partagé utilisé par 9 appelants (grading, refinement, qa/check, second-opinion, forensic, spec, dreaming, memory-distill). VALID_REVIEW_TYPES et REVIEW_LABELS sont en outre redéclarés dans trois routes (review epic, review story, prompt-estimate). Chaque correctif du cycle de review (verdict, prior findings, asked_question) doit être porté trois fois ; la route story a déjà divergé (voir finding suivant).

**Précision du vérificateur**

Exact sur tous les points vérifiables : les closures scheduler des routes review epic (233-262+) et story (226-255+) sont copiées ligne à ligne (mêmes appels, mêmes commentaires), `lib/pipeline/stage-review.ts:47-53` se décrit lui-même comme « a review-route replica » et ligne 58 « mirror of the review routes », `VALID_REVIEW_TYPES` est déclaré 3 fois (epic:67, story:57, prompt-estimate:38) et `REVIEW_LABELS` 2 fois à l'identique (epic:74, story:64), et `dispatchBackgroundSession` compte bien 9 appelants produit dont aucune route review (elles n'en importent que `mintAssignedCliSessionId`). Divergences réelles côté story : pas d'`emitSessionStarted/Completed/Failed` (le module `lib/events/emit` n'est même pas importé) et pas de branche « review passed » (ni `transitionReviewPassed`, ni `readSessionFindingsWindow`/`collectBlockingFindings`). Une nuance à ajouter à la recommandation : `dispatchBackgroundSession` mint toujours un nouveau `cliSessionId` et n'expose aucun chemin de reprise, alors que les deux routes portent `resumeSessionId → useResume → processManager.start({ resumeSession })` ; l'extraction d'un `dispatchReviewSession` suppose donc d'abord d'étendre le dispatcher partagé au resume, ce n'est pas un simple branchement.

**Recommandation**

Extraire un `dispatchReviewSession({ scope: 'epic'|'story', … })` dans lib/review/ ou lib/agent-sessions/ construit sur dispatchBackgroundSession (evaluate/onTerminal), consommé par les deux routes et par stage-review.ts ; centraliser VALID_REVIEW_TYPES/REVIEW_LABELS dans lib/agent-config/constants.ts à côté de REVIEW_TYPE_TO_AGENT_TYPE.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'VALID_REVIEW_TYPES|REVIEW_LABELS' → 3 déclarations `const VALID_REVIEW_TYPES: ReviewType[]` (review epic :67, review story :57, prompt-estimate :38) et 2 `REVIEW_LABELS` identiques. rg 'dispatchBackgroundSession\(' → 9 appelants produit, aucun des deux routes review. Diff visuel des deux closures scheduler : seules différences = userStoryId/story vs epic, emitSession* (epic seulement) et la promotion to_merge (epic seulement).

</details>

### #92 — Deux agents de résolution de merge concurrents (merge?autoAgent vs resolve-merge) avec provider, prompt et verrous différents

**Nature** doublon · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/epics/[epicId]/merge/route.ts:222-264`
- `app/api/projects/[projectId]/epics/[epicId]/merge/route.ts:250`
- `app/api/projects/[projectId]/epics/[epicId]/resolve-merge/route.ts:56-60`
- `app/api/projects/[projectId]/epics/[epicId]/resolve-merge/route.ts:226-239`
- `app/api/projects/[projectId]/epics/[epicId]/resolve-merge/route.ts:284-294`
- `lib/claude/prompt-builder.ts:1547-1557`
- `lib/agent-config/prompts.ts:36-66`

**Constat**

La route merge (branche `autoAgent`, appelée par ProjectBatchToolbar/NowDesk) lance un agent « merge » avec provider figé `"claude-code"` (:250), sans resolveAgentForDispatch, avec un prompt ad hoc bâti sur resolveAgentPrompt("merge") (:225), via agentScheduler, sous beginMergeWork+tryLockProjectMerge, et une relance « no retry cap ». La route resolve-merge (appelée par l'overlay) résout l'agent via resolveAgentByNamedId("merge") mais construit son prompt avec buildMergeResolutionPrompt(..., globalPrompt) où globalPrompt est la valeur brute du réglage `global_prompt` (:232-239) — le prompt système « merge » édité dans l'atelier Agents (agent_prompts, résolu par resolveAgentPrompt) est ignoré sur ce chemin ; elle appelle processManager.start directement sans passer par agentScheduler (:286, markSessionRunning immédiat, donc hors des quotas de concurrence), et lance `startMergeInWorktree` — qui mute le worktree — sans beginMergeWork ni tryLockProjectMerge (le verrou n'est pris qu'au merge final :157/:373). Même concept, deux comportements.

**Précision du vérificateur**

Deux chemins concurrents pour l'agent de résolution de merge, avec provider, prompt et verrous divergents. (a) merge/route.ts, branche `autoAgent` (:208), déclenchée uniquement par components/desk/ProjectBatchToolbar.tsx:163 (NowDesk.landOne poste `{}` et n'active pas le drapeau) : provider figé `"claude-code"` avec `model: null` et `namedAgentName: null` (:250-255), sans aucune résolution d'agent, prompt ad hoc bâti à la main autour de `resolveAgentPrompt("merge")` (:225-237) mais SANS `global_prompt`, dispatch via `agentScheduler.submit` (:264), sous `beginMergeWork` (:125) + `tryLockProjectMerge` (:157), relance « no retry cap ». (b) resolve-merge/route.ts, appelée par l'overlay (GitBand.tsx:236 → useAgentDispatch.ts:145) ET par le desk (NowDesk.tsx:345) : agent résolu par `resolveAgentByNamedId("merge", …)` (:60) avec provider/model/namedAgentId réels, mais prompt bâti par `buildMergeResolutionPrompt(…, globalPrompt)` (:227-239) où le 5e paramètre est `systemPrompt` (implementation.ts:339-344) — le prompt système « merge » éditable dans l'atelier Agents (agent_prompts / resolveAgentPrompt) est donc ignoré sur ce chemin ; spawn direct `markSessionRunning` + `processManager.start` (:285-286) hors scheduler ; et surtout `startMergeInWorktree` (:134), qui mute le worktree, s'exécute sans `beginMergeWork` (absent du fichier) ni `tryLockProjectMerge` — le verrou projet n'est pris qu'au merge final (:157) et au retry (:373), seul un garde de session par épic (:96) protège en amont. Nuance à retirer de l'énoncé initial : l'exemption de scheduler de resolve-merge est explicitement documentée et voulue (lib/agents/scheduler.ts:31-38), ce n'est pas une dérive ; le vrai défaut résiduel est la divergence provider/prompt et l'absence de verrou merge avant la mutation du worktree.

**Recommandation**

Faire de resolve-merge l'unique chemin (le desk peut l'appeler après un merge refusé pour conflit) ; y utiliser resolveAgentPrompt("merge"), dispatchBackgroundSession, et prendre beginMergeWork/tryLockProjectMerge avant startMergeInWorktree. Supprimer la branche autoAgent de merge/route.ts.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'resolveAgentPrompt("merge"' → merge/route.ts:225 et lib/auto-mode/merge.ts:741 seulement ; resolve-merge lit `settings.key = 'global_prompt'` (:227-232) et le passe comme `systemPrompt` (signature :1552). rg 'agentScheduler.submit' → présent dans merge :264, absent de resolve-merge (processManager.start :286 précédé de markSessionRunning :285). rg 'beginMergeWork' → merge :125 uniquement.

</details>

### #94 — create-epics fabrique des tickets hors du chemin de création commun et bloque la requête HTTP sur un appel LLM synchrone

**Nature** à moitié câblé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/qa/reports/[reportId]/create-epics/route.ts:247-296`
- `app/api/projects/[projectId]/qa/reports/[reportId]/create-epics/route.ts:335-390`
- `app/api/projects/[projectId]/epics/route.ts:603-613`
- `app/api/projects/[projectId]/epics/route.ts:721-722`
- `lib/mcp/create-bug.ts:6`
- `components/qa/ReportDetail.tsx:265-266`

**Constat**

POST .../qa/reports/[reportId]/create-epics insère directement dans `epics`/`userStories` (:381-386) sans generateReadableId (les tickets n'ont pas de readable_id, donc pas de E-xxx-NNN), sans emitTicketCreated, sans tryExportArjiJson, sans la déduplication de bug par titre que POST /epics et lib/mcp/create-bug appliquent. Il lance en plus le LLM dans la requête via spawnClaude / provider.spawn (:258-281) sans ligne agent_sessions, sans agentScheduler ni garde de concurrence, sans timeout : la génération n'apparaît ni dans QA RUNS ni dans /agents, ne peut pas être arrêtée, et un ReportDetail fermé pendant l'attente perd la réponse. C'est le seul endroit hors chat/generate-spec où spawnClaude est appelé depuis une route.

**Précision du vérificateur**

POST .../qa/reports/[reportId]/create-epics insère directement dans `epics`/`userStories` (route.ts:348-386) sans generateReadableId (readable_id NULL → aucun E-xxx-NNN/B-xxx-NNN), sans emitTicketCreated ni tryExportArjiJson, alors que POST /epics (epics/route.ts:636, :767-768) et lib/mcp/create-bug.ts (qui délègue par fetch à /epics, :235) les appliquent ; il rate aussi la dédup de bug par titre, mais celle-ci n'existe dans POST /epics que pour les bugs MCP attribués (isAttributedAgentBug, :443-447, :627-629), pas pour toute création. La génération LLM tourne dans la requête (:258-281, await :286-295) via spawnClaude / provider.spawn sans ligne agent_sessions, sans dispatchBackgroundSession/agentScheduler (contrairement à qa/check/route.ts:176), sans timeout et sans conserver le handle kill : invisible dans QA RUNS et /agents, non annulable. Un ReportDetail démonté pendant l'attente perd le feedback UI (useScopedMutation.ts:27), mais les tickets sont quand même persistés côté serveur. Seul appelant UI : components/qa/ReportDetail.tsx:224. Seuls autres appels de spawnClaude depuis une route : generate-spec:114 (même motif synchrone), chat:183, chat/stream:1081.

POST .../qa/reports/[reportId]/create-epics (seul appelant : components/qa/ReportDetail.tsx:224-229, bouton :506, monté par app/projects/[projectId]/qa/page.tsx:233) insère directement dans `epics`/`userStories` (route.ts:380-386, valeurs :348-378) sans generateReadableId (readable_id NULL → chips « — »), sans emitTicketCreated, sans tryExportArjiJson, et sans la déduplication par titre que lib/mcp/create-bug.ts:212 et le chemin MCP create_bug de POST /epics (epics/route.ts:443-447, :629-660, :767-768) appliquent. Il n'est pas le seul inserteur hors chemin commun (bugs/route.ts:109 et lib/projects/spec-write.ts:51 aussi), mais c'est le seul qui lance en plus le LLM dans la requête (spawnClaude :271 / provider.spawn :260, await :286-295) sans ligne agent_sessions, sans agentScheduler, sans timeout (spawn.ts:382 n'est que le SIGKILL post-kill) : la génération n'apparaît ni dans QA RUNS ni dans /agents et ne peut pas être arrêtée. Si ReportDetail est fermé pendant l'attente, les tickets sont quand même insérés côté serveur mais l'UI perd le retour (createdEpics/onCreateEpics). Hors chat et generate-spec, c'est le seul appel de spawnClaude depuis une route. dispatchBackgroundSession (utilisé par qa/check/route.ts:176) est disponible pour la refonte.

**Recommandation**

Réutiliser l'insertion partagée (celle de POST /epics ou lib/mcp/create-bug, qui annonce « exactly like board/chat creation: readable-id allocation, ticket-created event ») et dispatcher la génération via dispatchBackgroundSession avec un onTerminal qui parse et insère ; renvoyer un sessionId à ReportDetail.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'generateReadableId|emitTicketCreated|tryExportArjiJson' sur create-epics → 0 ; sur epics/route.ts → :29-30, :613, :721-722. rg 'spawnClaude\(' app → create-epics :271, generate-spec :114, chat :183, chat/stream :1081. Unique appelant UI : ReportDetail.tsx:266.

</details>

### #60 — POST git/pull réimplémente un dispatch d'agent complet dans la route et ignore le helper partagé et la validation zod

**Nature** refacto · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `app/api/projects/[projectId]/git/pull/route.ts:61-71`
- `app/api/projects/[projectId]/git/pull/route.ts:127-252`
- `app/api/projects/[projectId]/git/pull/route.ts:241-252`
- `lib/agent-sessions/dispatch-background-session.ts:123-240`

**Constat**

La route (379 l.) parse son corps à la main (l.61-71, contrairement à toutes ses voisines qui passent par validateBody), puis, en cas de conflit, construit elle-même la session : createQueuedSession, markSessionRunning, processManager.start, IIFE waitForProcessCompletion + writeFileSync des logs + markSessionTerminal (l.127-252). lib/agent-sessions/dispatch-background-session.ts expose dispatchBackgroundSession (l.240) avec exactement ces responsabilités (prompt, resolvedAgent, cwd, onTerminal). Effet de bord : la ligne d'audit du démarrage d'auto-résolution est enregistrée en status `failed` (l.241-252) alors que l'opération réussit (202).

**Précision du vérificateur**

La route POST git/pull (379 l.) parse son corps à la main (l.61-71, comme git/push:39, alors que git/connect:22 et la plupart des routes projet passent par validateBody) et réimplémente en ligne tout le cycle de vie d'une session d'agent en cas de conflit (l.127-252 : createQueuedSession, markSessionRunning, processManager.start, IIFE waitForProcessCompletion + writeFileSync + markSessionTerminal), là où lib/agent-sessions/dispatch-background-session.ts:240 encapsule ce cycle. Deux nuances : (a) le helper ne couvre pas le cas de reprise dont la route a besoin — il mint toujours un cliSessionId neuf (l.253) et interdit de le surcharger via session/spawn (l.171, l.182) — donc l'extraction suppose d'abord d'étendre le helper ; (b) l'écart est systémique et non propre à pull : 9 routes app/api refont ce cycle à la main via mintAssignedCliSessionId (releases, stories/build, epics/review, chat/stream, stories/review, resolve-merge, epics/build, build) contre une seule (qa/check:176) qui utilise dispatchBackgroundSession. L'« audit en failed » (l.241-252) n'est pas démontré comme un bug : la ligne qualifie l'opération pull, qui a effectivement échoué en conflits, le code de détail portant déjà merge_conflicts_auto_resolve_started.

**Recommandation**

Extraire un `dispatchPullConflictResolution()` dans lib/git ou lib/workflow bâti sur dispatchBackgroundSession ; ajouter un pullProjectSchema/pushProjectSchema (remote, branch, autoResolveConflicts, namedAgentId, resumeSessionId) ; journaliser le démarrage d'auto-résolution en `success` avec un code dédié.

<details><summary>Preuve relevée par l'auditeur</summary>

pull/route.ts:61 `const body = await request.json().catch(() => ({}))` puis typeof checks ; push/route.ts:39 idem, alors que clone/route.ts:35, connect, memory, label-mapping utilisent validateBody. dispatch-background-session.ts:123-160 DispatchBackgroundSessionInput { agentType, projectId, prompt, resolvedAgent, mode, cwd, session, spawn, onTerminal… }. pull/route.ts:244 `status: "failed"` avec code merge_conflicts_auto_resolve_started puis retour 202.

</details>

### #91 — La review de story n'émet aucun événement de session : desk et overlay ne se rafraîchissent pas

**Nature** à moitié câblé · **Impact** moyen (vérificateur : plutôt plus) · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/stories/[storyId]/review/route.ts:1-50`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:59-63`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:233`
- `app/projects/[projectId]/page.tsx:73-75`
- `hooks/useTicketOverlayData.ts:245`
- `app/projects/[projectId]/stories/[storyId]/page.tsx:150`

**Constat**

La route review epic appelle emitSessionStarted (:233 après createQueuedSession) puis emitSessionCompleted/emitSessionFailed dans la closure. La route review story, copie de la première, n'importe rien de lib/events/emit et n'émet donc rien. Or app/projects/[projectId]/page.tsx:73-75 incrémente son refreshTrigger sur session:started/completed/failed et hooks/useTicketOverlayData.ts:245 recharge sur session:completed. Une review lancée depuis la page story n'apparaît donc dans le desk et l'overlay qu'au prochain poll, et sa fin (verdict, retour in_progress) n'est pas poussée.

**Précision du vérificateur**

La route review story (app/api/projects/[projectId]/stories/[storyId]/review/route.ts) n'importe pas lib/events/emit et n'émet aucun événement de session ; aucun helper qu'elle appelle (lifecycle.ts, scheduler.ts, process-manager.ts, hook terminal d'instrumentation.ts:86-99) n'émet à sa place, et le rejet via transitionReviewRejected → applyStoryTransition (transition-service.ts:247-311) n'émet pas non plus de ticket:moved, à la différence d'applyTransition epic (:219-221). La route epic, elle, émet session:started (:254, pas :233), completed (:347) et failed (:349). Conséquences : page.tsx:73-75, useTicketOverlayData.ts:248-252, MemoryPanel.tsx:236-252 et PromptAnatomyBand.tsx:84 ne sont rafraîchis que par polling ; et comme emitSessionCompleted est le seul chemin créant la notification inbox « completed » (emit.ts:92-97 ; le hook terminal ne notifie que les échecs, terminal-notification.ts:32), une review de story réussie ne génère aucune notification. La route build story (stories/[storyId]/build/route.ts) a exactement le même trou.

La route `app/api/projects/[projectId]/stories/[storyId]/review/route.ts` (atteinte par la page story via `useAgentDispatch` → `sendToReview` → POST `…/stories/:storyId/review`, `hooks/useAgentDispatch.ts:26-31,104-110`, bouton `components/shared/AgentActionsBar.tsx:250`) n'importe pas `@/lib/events/emit` et n'émet aucun `session:started/completed/failed`, ni directement ni indirectement (lifecycle.ts sans bus ; hook terminal `instrumentation.ts:86-95` → notification failed uniquement ; `applyStoryTransition` sans `emitTicketMoved`, seul l'epic en émet à `transition-service.ts:220`). Sa jumelle epic émet aux lignes :254 (started, après createQueuedSession), :347 (completed) et :349 (failed), imports :60-63. Conséquences : `app/projects/[projectId]/page.tsx:73-75` (refreshTrigger → useAgentPolling/ticket panel), `hooks/useTicketOverlayData.ts:248`, `components/spec/MemoryPanel.tsx:236-252` et `PromptAnatomyBand.tsx:84` ne sont pas réveillés — ni au lancement, ni à la fin, ni au retour in_progress de la story ; et comme `emitSessionCompleted` est aussi l'unique voie de `createNotificationFromSession` pour un succès (emit.ts:93-94), une review de story réussie ne crée jamais sa notification de complétion (seul l'échec est couvert par le hook terminal). Le desk lui-même polle `/api/control-desk` indépendamment (page.tsx:65-67), l'écart est donc sur le monitor d'agents, l'overlay, les panneaux spec et les notifications, pas sur les strates du desk. État identique sur HEAD : pas une régression de la rationalisation.

**Recommandation**

Ajouter les trois emit dans la route story (ou, mieux, la faire passer par le dispatcher partagé du finding précédent qui les émet dans onQueued/onTerminal).

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n emitSession app/api/projects/[projectId]/stories/[storyId]/review/route.ts | wc -l` → 0. La même commande sur la route epic → emitSessionStarted/Completed/Failed importés :59-63 et appelés. La page story appelle bien sendToReview (:150) via useAgentDispatch kind 'story' (:51-52), la route est donc vivante.

</details>

### #93 — resolve-merge sonde les conflits contre `project.defaultBranch || "main"` brut au lieu de la résolution de base utilisée par mergeWorktree

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/epics/[epicId]/resolve-merge/route.ts:128-141`
- `lib/git/manager.ts:595-618`
- `lib/git/manager.ts:478-481`
- `app/api/projects/[projectId]/epics/[epicId]/diff/route.ts:52-63`

**Constat**

resolve-merge:134-136 passe `project.defaultBranch || "main"` tel quel à startMergeInWorktree (git merge <ref>). Le commentaire au-dessus affirme que c'est « the same one mergeWorktree is handed below », mais mergeWorktree (lib/git/manager.ts:447+) résout la base via resolveBaseBranch (existence vérifiée, fallback origin/HEAD → main → master) et la route diff explique en 8 lignes (:52-59) pourquoi le nom stocké brut ne doit jamais être utilisé (branche renommée après import, clone divergent). Sur un tel projet, git.merge lève, status.conflicted est vide, startMergeInWorktree relance l'erreur (manager.ts:614-617) et la route renvoie « Failed to start merge » 500 alors que le merge réel aurait réussi.

**Précision du vérificateur**

resolve-merge/route.ts:134-136 passe `project.defaultBranch || "main"` brut à startMergeInWorktree (git merge <ref>, manager.ts:602) alors que le commentaire l.128-131 affirme utiliser « the resolved default branch — the same one mergeWorktree is handed ». mergeWorktree (manager.ts:478-481) résout via resolveBaseBranch (base-branch.ts:52-72 : nom stocké seulement s'il existe localement, sinon origin/HEAD → main → master → première branche). Deux cas divergent : (a) nom stocké renommé/absent localement, (b) defaultBranch null (chemin fourni par l'utilisateur) sur un dépôt sans branche `main`. Dans les deux, git.merge lève, status.conflicted est vide, startMergeInWorktree relance (manager.ts:611-617) et la route répond 500 « Failed to start merge » alors que mergeWorktree aurait mergé. Le helper `resolveDefaultBranch` (manager.ts:46-53) existe et est déjà utilisé par diff/route.ts:59 et merge/route.ts:224. Le test resolve-merge-final-merge-failure.test.ts:261-300 fige le passage brut et ne couvre pas ces cas.

resolve-merge/route.ts:134-137 passe `project.defaultBranch || "main"` brut à startMergeInWorktree (`git merge <ref>` sans résolution, manager.ts:595-618), alors que mergeWorktree (manager.ts:479-481) et les routes merge (:224) / diff (:59-62) résolvent la base via resolveBaseBranch (existence vérifiée, fallback origin/HEAD → main → master → première branche). Le commentaire :128-131 (« the same one mergeWorktree is handed below ») est faux. Cas déclencheurs : defaultBranch null (chemin utilisateur, dépôt en master/develop/trunk) ou branche stockée renommée/absente localement. Sondé : `git merge main` sur un dépôt master-only → « merge: main - not something we can merge », exit 1, aucun fichier en conflit → rethrow → 500 `{ error: "merge: main - not something we can merge" }` (message git, pas le fallback), alors que le merge réel aurait réussi. Atteint depuis l'UI par GitBand.tsx:236 → useAgentDispatch.ts:145 et NowDesk.tsx:344-345. Le test __tests__/resolve-merge-final-merge-failure.test.ts:262-302 épingle l'argument brut et doit être ajusté avec le fix (`await resolveDefaultBranch(gitRepoPath, project.defaultBranch)`).

**Recommandation**

Remplacer l'argument par `await resolveDefaultBranch(gitRepoPath, project.defaultBranch)` comme dans diff/route.ts et merge/route.ts:224.

<details><summary>Preuve relevée par l'auditeur</summary>

sed -n 595,618p lib/git/manager.ts : startMergeInWorktree fait `git.merge([targetBranch])` sans résolution et rethrow hors conflit. mergeWorktree :478-481 appelle `resolveBaseBranch(git, branches.all, { preferred: options.defaultBranch })`. La route diff utilise `resolveDefaultBranch(project.gitRepoPath, project.defaultBranch)` (:59-62) pour la même raison.

</details>

### #146 — Toujours ouvert (audit 06/09) : lib/routines appelle des handlers de routes avec une NextRequest synthétique, et un composant importe un type depuis un module de route

**Nature** risque · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `lib/routines/ci-autofix.ts:33`
- `lib/routines/actions.ts:64`
- `components/kanban/RefinementButton.tsx:9`
- `instrumentation.ts:216`

**Constat**

Vérifié dans l'arbre actuel : lib/routines/ci-autofix.ts:33-37 fait `import("@/app/api/projects/[projectId]/epics/[epicId]/build/route")` puis `POST(new NextRequest("http://localhost/..."))`, et lib/routines/actions.ts:64-78 fait la même chose avec build/route. Le proxy (proxy.ts) n'est pas traversé, la réponse est re-parsée depuis JSON, et lib dépend de app (inversion). S'y ajoute components/kanban/RefinementButton.tsx:9 `import type { RefinementStatus } from "@/app/api/projects/[projectId]/refinement/route"` : le seul import components → app/api du dépôt (`rg 'from "@/app' lib hooks components` → 1 résultat). Les deux autres inversions relevées le 06/09 ne sont pas re-signalées ici ; celle-ci l'est parce qu'elle conditionne le découpage d'instrumentation.ts (le scheduler de routines qu'il démarre finit par exécuter des handlers HTTP hors requête).

**Précision du vérificateur**

Toujours ouvert (audit 06/09), vérifié dans l'arbre : lib/routines/ci-autofix.ts:33-59 importe dynamiquement `@/app/api/projects/[projectId]/epics/[epicId]/build/route` et appelle `POST(new NextRequest("http://localhost/..."), { params })` ; lib/routines/actions.ts:64-79 fait de même avec la route de build PAR LOT `@/app/api/projects/[projectId]/build/route` (Night Run), via `launchNightRunThroughBuildRoute` branchée l. 110 dans `executeRoutineAction`, que lib/routines/scheduler.ts:5-8 importe et que instrumentation.ts:72-75 (et non :216 — le fichier fait 102 lignes) démarre au boot. proxy.ts n'est pas traversé (aucune référence dans lib/routines), la réponse est re-parsée depuis JSON, et lib dépend de app. S'y ajoute components/kanban/RefinementButton.tsx:9 `import type { RefinementStatus } from "@/app/api/projects/[projectId]/refinement/route"` (exporté à refinement/route.ts:21) : seul import statique components/hooks/lib → app/api du dépôt. Attention pour la remédiation : un autre type nommé `RefinementStatus` existe déjà à lib/mcp/refinement.ts:39 (importé par lib/refinement/snapshot.ts:27) — le type de la route doit être renommé s'il migre sous lib/refinement/.

Toujours ouvert (audit 06/09), vérifié dans l'arbre tel quel : lib/routines/ci-autofix.ts:33-37 et lib/routines/actions.ts:64-78 importent dynamiquement les modules de route `@/app/api/projects/[projectId]/(epics/[epicId]/)build/route` et appellent `POST(new NextRequest("http://localhost/..."), { params })`, puis re-parsent la réponse JSON. Chemin réel : instrumentation.ts:72-75 `startRoutineScheduler()` → scheduler.ts:97/237 `executeRoutineAction` → actions.ts:200 `launchNightRun` (= launchNightRunThroughBuildRoute, actions.ts:110) et actions.ts:257 `runCiWatch` → ci-watch.ts:133 `launchAutofix: launchCiAutofixSession`. S'y ajoute components/kanban/RefinementButton.tsx:9 (monté par app/projects/[projectId]/page.tsx:332 et components/tickets-registry/TicketsRegistryView.tsx:285), seul import components→app/api du dépôt. Corrections : la référence « instrumentation.ts:216 » est fausse (fichier de 102 lignes, démarrage en 72-75) ; le contournement de proxy.ts est sans effet fonctionnel ni sécuritaire, les deux routes ne lisant que `request.json()` (build/route.ts:108, epics/[epicId]/build/route.ts:79) — le problème est purement architectural (lib dépend d'app, round-trip JSON). Pour la recommandation, noter que `lib/mcp/refinement.ts:39` exporte déjà un `RefinementStatus` différent : le type de la route devra être renommé en le déplaçant. Aucune règle eslint no-restricted-imports en place.

**Recommandation**

Extraire la logique de POST build (et night run) dans lib/build/dispatch.ts appelée par la route ET par les routines ; déplacer le type RefinementStatus dans lib/refinement/types.ts. Ajouter une règle eslint no-restricted-imports interdisant `@/app/**` depuis lib/, hooks/ et components/.

<details><summary>Preuve relevée par l'auditeur</summary>

sed -n 28,45p lib/routines/ci-autofix.ts et 60,78p lib/routines/actions.ts (import dynamique du module route + POST(request, {params})) ; rg -n 'from "@/app' lib hooks components --glob '!__tests__' → components/kanban/RefinementButton.tsx:9.

</details>

