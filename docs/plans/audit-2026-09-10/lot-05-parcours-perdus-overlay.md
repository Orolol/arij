# Lot 05 — Parcours perdus dans l'overlay ticket et le desk

**Difficulté** 2/4 — Moyen
**Findings** 9 (1 fort · 4 moyen · 4 faible ; effort 7 S · 2 M · 0 L)
**Dépendances** Coordonner avec le lot 08 (projection de GET /epics).

## Décision

Le réordonnancement manuel revient dans l'overlay (PATCH /epics/:id accepte déjà `position`) ; la route POST epics/reorder est supprimée si plus personne ne l'appelle après ce lot (garder le cœur MCP reorder_tickets).

## Objectif

Rendre à l'utilisateur les actions promises par CLAUDE.md et les commentaires : réordonner, naviguer entre tickets dépendants, voir l'état vivant du pipeline, avoir un retour sur 409/merge/suppression hors page projet, ouvrir le diff depuis une ligne CONFLICT.

## Démarche suggérée

1. Contrôle monter/descendre (ou position) dans la carte PIPELINE / bande UP NEXT, branché sur updateEpic({position}).
2. Passer onOpenTicket à DependenciesBand ; projeter githubIssueNumber dans GET /epics (coordonner avec le lot 08 qui réduit cette projection).
3. TicketOverlayProvider : toast stack par défaut pour onAgentConflict/onMerged/onDeleted.
4. Carte PIPELINE lit le registre (usePipelineRuns) : stage, tentative, cycle de fix, raison terminale.
5. Retirer `loading` inutilisé et le GET projet par ouverture (colorIndex n'existe pas).
6. Mettre à jour CLAUDE.md et les commentaires UpNextBand/TicketsRegistryView.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #119 — Réordonnancement manuel des tickets perdu : la route epics/reorder n'a plus aucun appelant UI et l'overlay ne touche jamais `position`

**Nature** à moitié câblé · **Impact** fort (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `app/api/projects/[projectId]/epics/reorder/route.ts:1-10`
- `components/ticket/TicketOverlay.tsx:214-230`
- `components/desk/UpNextBand.tsx:29`
- `components/tickets-registry/TicketsRegistryView.tsx:36-39`
- `CLAUDE.md`

**Constat**

CLAUDE.md et le commentaire de components/desk/UpNextBand.tsx:29 affirment que « re-ordering happens in the ticket overlay or Refinement ». Or l'overlay n'envoie que `{ status }` et `{ priority }` (TicketOverlay.tsx:217 et :226) ; aucune surface client n'appelle `POST /api/projects/:id/epics/reorder`, dont l'en-tête dit encore « used by drag-and-drop and by whole-column actions such as Sort by priority » — deux parcours retirés avec le board. Le seul écrivain de `epics.position` restant est l'outil MCP reorder-tickets (agents). Un utilisateur ne peut donc plus changer l'ordre d'exécution Full Auto à la main, alors que la documentation le promet.

**Précision du vérificateur**

CLAUDE.md (l.33-34, version non commitée) et les commentaires de components/desk/UpNextBand.tsx:30-31 et components/tickets-registry/TicketsRegistryView.tsx:36-39 affirment que le réordonnancement se fait « dans l'overlay ou en Refinement ». Or l'overlay n'envoie que `{ status }` (TicketOverlay.tsx:222) et `{ priority }` (l.231) ; aucune surface client n'appelle `POST /api/projects/:id/epics/reorder`, dont l'en-tête (l.1-4) décrit encore le drag-and-drop et « Sort by priority » du board retiré ; seuls deux tests l'exercent. Le PATCH epic accepte bien `position` (updateEpicSchema:161, route [epicId]), mais ni l'overlay ni l'outil chat `update_ticket` (board-tools.ts:472-476) ne l'envoient. Le seul chemin restant qui réécrit `epics.position` à la demande est agent-driven : `reorder_tickets` (MCP) invoqué par le run de Refinement. Un utilisateur n'a donc plus aucun moyen manuel de changer l'ordre d'exécution Full Auto, contrairement à ce que promettent la doc et les commentaires.

Dans l'arbre de travail, la suppression non commitée de hooks/useKanban.ts (seul appelant HTTP à HEAD, l.241) laisse `POST /api/projects/:id/epics/reorder` sans aucun consommateur hors __tests__/epics-reorder-route.test.ts, et `lib/kanban/reorder.ts` sans importeur ; l'overlay n'envoie que `{ status }` (TicketOverlay.tsx:222) et `{ priority }` (:231) alors que CLAUDE.md et UpNextBand.tsx:30-31 promettent un réordonnancement « dans l'overlay ». Nuances : (a) `PATCH /epics/:epicId` accepte déjà `position` (route.ts:67, updateEpicSchema:161) — l'overlay pourrait l'écrire via `updateEpic` sans nouvelle route, seule l'affordance manque ; (b) la moitié « ou Refinement » de la promesse tient : RefinementDialog (monté sur /projects/:id et /tickets) expose l'action « Execution order » qui autorise `reorder_tickets` avec instructions libres. Il ne reste donc aucun réordonnancement manuel/déterministe, seulement un réordonnancement médié par agent.

**Recommandation**

Soit ajouter un contrôle de position dans le PIPELINE card de l'overlay (ou dans UP NEXT) qui appelle la route existante avec `reorderOnly: true`, soit assumer la perte : supprimer la route HTTP (garder le core MCP) et corriger CLAUDE.md + les commentaires UpNextBand/TicketsRegistryView.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "epics/reorder" app components hooks lib` hors app/api → 0 résultat ; seul __tests__/epics-reorder-route.test.ts importe la route. `rg -n "updateEpic\(" components/ticket` → uniquement `{ status: next }` (l.217) et `{ priority: next }` (l.226). `rg -n reorderTickets` → lib/workflow/reorder.ts, app/api/mcp/reorder-tickets/route.ts, app/api/projects/[projectId]/epics/reorder/route.ts.

</details>

### #72 — L'état vivant du pipeline (registre : stage, tentative, cycles de fix, raison) n'est affiché que sur la page story ; l'overlay ticket et le desk le dérivent du statut kanban

**Nature** à moitié câblé · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** pipeline-routines

**Fichiers**
- `app/api/projects/[projectId]/pipeline/runs/route.ts:10-11`
- `hooks/usePipelineRuns.ts:66-97`
- `components/shared/AgentActionsBar.tsx:155-160`
- `app/projects/[projectId]/stories/[storyId]/page.tsx:140`
- `components/ticket/derive.ts:117-140`
- `components/session-live/NextChainCard.tsx:35-48`
- `lib/control-desk/aggregate.ts:603-606`

**Constat**

GET /api/projects/[projectId]/pipeline/runs (route.ts:10-11 : « Consumed by usePipelineRuns to badge session rows ») n'a qu'un consommateur : hooks/usePipelineRuns.ts → components/shared/AgentActionsBar.tsx:155, composant monté une seule fois, dans app/projects/[projectId]/stories/[storyId]/page.tsx:140. La page sessions ne contient aucune référence au pipeline (rg → 0). L'overlay ticket (surface principale post-Piscine) dessine sa carte PIPELINE à partir de `epic.status` seul (components/ticket/derive.ts:117-140 : SPEC/BUILD/REVIEW/LAND selon la colonne), l'écran session à partir de `agentType` (components/session-live/NextChainCard.tsx:35-48), et le desk ne reçoit rien (lib/control-desk/aggregate.ts:603-606 le dit explicitement). Les états calculés par le runner — running_fix cycle n/max, running_forensic, paused_question, failed + reason (constants.ts:293-324) — ne vivent donc que dans le registre mémoire et dans les lignes d'activité. Le hook expose aussi `runs`, `loading`, `refresh` que personne ne consomme (AgentActionsBar ne déstructure que sessionIndex).

**Précision du vérificateur**

GET /api/projects/[projectId]/pipeline/runs n'a qu'un consommateur UI : hooks/usePipelineRuns.ts → components/shared/AgentActionsBar.tsx:158, monté une seule fois (app/projects/[projectId]/stories/[storyId]/page.tsx:140). Cette puce n'affiche que le `stage` de la session vivante (« Pipeline · Review ») ; `stageAttempt`, `fixCycles` et `reason` du snapshot (lib/pipeline/constants.ts:305-318) ne sont rendus nulle part depuis le registre, page story incluse. Le commentaire de la route (« badge session rows ») est périmé depuis 7fefa179 (31/08), qui a supprimé AgentMonitor, le consommateur des lignes de session, sans reporter la puce ; la page sessions ne référence pas le pipeline. L'overlay ticket dérive sa carte PIPELINE de `epic.status` (TicketOverlay.tsx:384, derive.ts:117-140), l'écran session de `agentType` (NextChainCard.tsx:35-48). Le desk, lui, reçoit bien une dérivée du registre — le hold « owned » via lib/control-desk/read-model.ts:136 → lib/auto-mode/exclusions.ts:21-23 → aggregate.ts:650 → UpNextBand.tsx:88 — mais seulement la présence d'un run actif, pas son état ; aggregate.ts:603-606 est le doc-comment de la queue UP_NEXT, pas une déclaration d'absence. Les cycles/tentatives/raisons ne vivent donc en UI que dans les lignes d'activité (PIPELINE_REASONS, constants.ts:193-230, rendues par derive.ts:375-381). Le hook expose `runs`, `loading`, `refresh` sans consommateur.

L'état vivant du registre pipeline (PipelineRunSnapshot : state, stage, stageAttempt, fixCycles, reason — lib/pipeline/constants.ts:293-321) n'est lu côté UI que par hooks/usePipelineRuns.ts (fetch unique de /api/projects/[projectId]/pipeline/runs, ligne 76), consommé uniquement par components/shared/AgentActionsBar.tsx:158, monté une seule fois dans app/projects/[projectId]/stories/[storyId]/page.tsx:140, et ce consommateur ne rend qu'un chip « Pipeline · <stage> » (lignes 293-303) : stageAttempt, fixCycles et reason du snapshot ne sont rendus nulle part. Le hook expose runs/loading/refresh (lignes 91-96) que personne ne consomme. La page sessions ne référence pas le pipeline (0 résultat), la carte PIPELINE de l'overlay dérive ses quatre étapes du statut kanban seul (components/ticket/derive.ts:117-140, appelée TicketOverlay.tsx:384), NextChainCard lit agentType (lignes 38-50), et lib/control-desk/aggregate.ts n'importe pas le registre (seule mention : commentaire de politique ligne 602 ; les seuls importeurs de lib/pipeline/registry hors lib/pipeline sont la route et lib/auto-mode/exclusions.ts). Nuance : la trace textuelle du runner (stage, attempt n/max, fix cycle n/max, raison terminale) reste visible dans l'overlay via la bande d'activité (hooks/useTicketOverlayData.ts:412 → lib/kanban/activity-feed.ts:57 → derive.ts:375-381), lue depuis le journal d'activité et non du registre.

**Recommandation**

Faire lire le registre par la carte PIPELINE de l'overlay (stage + tentative + cycle de fix, raison terminale) et par la ligne de session sur la page sessions, comme le promet le commentaire de la route ; sinon supprimer route + hook et s'en tenir aux lignes d'activité. Nettoyer le retour du hook.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "usePipelineRuns" app components hooks` → AgentActionsBar.tsx:28/155 seul ; `rg -n "<AgentActionsBar" app components` → stories/[storyId]/page.tsx:140 seul ; `rg -n -i pipeline 'app/projects/[projectId]/sessions/page.tsx'` → 0 ; `rg -n "pipeline" components/ticket` → seulement derive.ts/PipelineCard (dérivation statut).

</details>

### #81 — POST /epics/reorder n'a plus d'appelant et le réordonnancement manuel n'a pas de remplacement dans l'UI

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `app/api/projects/[projectId]/epics/reorder/route.ts`
- `__tests__/epics-reorder-route.test.ts`
- `app/api/projects/[projectId]/epics/[epicId]/route.ts:63-70`
- `lib/validation/schemas.ts:152-161`
- `components/ticket/TicketOverlay.tsx:217-229`

**Constat**

app/api/projects/[projectId]/epics/reorder/route.ts (65 l.) se présente comme « the board's ordering endpoint, used by drag-and-drop » et journalise `source: "drag", reason: "Kanban drag-and-drop"`. Aucun composant, hook ou lib ne l'appelle ; seul __tests__/epics-reorder-route.test.ts (170 l.) le maintient. L'outil MCP reorder_tickets passe directement par lib/workflow/reorder.ts. CLAUDE.md dit que « re-ordering happens in the ticket overlay or Refinement », mais l'overlay n'a aucun contrôle de position et aucun appel PATCH n'envoie `position` : le seul chemin restant pour changer l'ordre d'exécution est l'agent de refinement. La colonne `position` reste pourtant le contrat d'ordre lu par Full Auto (compareExecutionOrder) et affiché en rang par UP NEXT et le registre. Par ailleurs PATCH epics/[epicId] accepte toujours `position` (updateEpicSchema:159, route.ts:67) en écriture directe hors de lib/workflow/reorder.ts — chemin sans appelant mais qui contourne la réécriture 0..n-1 par colonne.

**Précision du vérificateur**

POST /api/projects/:projectId/epics/reorder (route.ts, 65 l.) n'a plus aucun appelant dans l'arbre de travail : son unique consommateur à HEAD, `hooks/useKanban.ts:241`, est supprimé par la rationalisation non commitée (` D hooks/useKanban.ts`). Ne le maintiennent que `__tests__/epics-reorder-route.test.ts` et des commentaires/docs périmés (`docs/architecture/ticket-state-machine.md:167` cite encore useKanban.ts ; `lib/kanban/queue.ts:38`, `lib/refinement/snapshot.ts:11`, `e2e/fixtures/arij-project.ts:270`). Le seul chemin vivant vers `reorderTickets` est l'outil MCP `reorder_tickets`, gardé `REFINEMENT_ONLY` (`lib/mcp/refinement.ts:134`). CLAUDE.md et `components/desk/UpNextBand.tsx:30-31` affirment que l'overlay réordonne, mais `TicketOverlay.tsx` n'appelle `updateEpic` qu'avec `{status}` (l.222) et `{priority}` (l.231) ; aucun client n'envoie `position`. `position` reste pourtant le contrat lu par Full Auto (`lib/kanban/reorder.ts:61`, `compareExecutionOrder` via auto-mode/select, control-desk, queue, registre). Parallèlement `updateEpicSchema` (`lib/validation/schemas.ts:159`) et PATCH `epics/[epicId]/route.ts:67` (ainsi que stories `[storyId]/route.ts:82`) acceptent toujours une écriture directe de `position` hors de la transaction 0..n-1 de `lib/workflow/reorder.ts`, sans appelant.

POST /api/projects/[projectId]/epics/reorder n'a aucun appelant (UI, hook, lib, chat tools, MCP, e2e) : seul __tests__/epics-reorder-route.test.ts l'importe. reorderTickets (lib/workflow/reorder.ts) n'est atteint que par l'outil MCP reorder-tickets (agent Refinement) ; lib/kanban/reorder.ts (persistedColumnOrder) est lui aussi mort hors de son test. Aucune affordance de rang dans l'overlay, UP NEXT ou le registre (ce dernier le déclare « no reorder affordance » l.37-39) ; TicketOverlay n'appelle updateEpic qu'avec {status} (l.222) et {priority} (l.231). Pourtant PATCH epics/[epicId] (route.ts:67) et PATCH user-stories (route.ts:122) écrivent encore `position` directement (schemas.ts:161/180/190), et le type client `updateEpic(Partial<EpicDetail>)` inclut `position` — chemin sans appelant qui contourne la réécriture 0..n-1 de lib/workflow/reorder.ts, alors que `position` reste le contrat lu par compareExecutionOrder (auto-mode/select, control-desk, tickets-registry, queue).

**Recommandation**

Décider du parcours : soit exposer dans l'overlay (bande UP NEXT ou registre) une action « monter/descendre » branchée sur reorderTickets avec source "api", soit supprimer la route et son test et documenter que l'ordre n'est modifiable que par Refinement/MCP. Dans les deux cas retirer `position` de updateEpicSchema/updateStorySchema pour que lib/workflow/reorder.ts reste la seule écriture de position.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'epics/reorder' app components hooks lib bin --glob '!app/api/**'` → 0 résultat ; `rg -l reorderTickets app lib --glob '!lib/workflow/reorder.ts'` → epics/reorder/route.ts et app/api/mcp/reorder-tickets/route.ts. TicketOverlay.tsx n'appelle updateEpic qu'avec {status} (l.217) et {priority} (l.226). `rg -n 'position' hooks/useEpicDetail.ts lib/chat/board-tools.ts app/api/mcp/update-ticket/route.ts` → aucune écriture de position.

</details>

### #120 — Puces de dépendances inertes : `onOpenTicket` de DependenciesBand n'est jamais passé par son unique consommateur

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `components/ticket/DependenciesBand.tsx:60,74,190-196`
- `components/ticket/TicketOverlay.tsx:532-540`
- `components/ticket/derive.ts:190-192`

**Constat**

DependenciesBand déclare `onOpenTicket?: (epicId) => void` et ne rend un IdentityChip cliquable que s'il est fourni (`onClick={onOpenTicket ? … : undefined}`). TicketOverlay, seul consommateur produit, monte la bande sans cette prop. Les puces BLOCKS / WAITS ON sont donc purement décoratives : impossible de naviguer vers le ticket bloquant depuis l'overlay, alors que `DependencyRowItem.id` est documenté comme « the click target ».

**Précision du vérificateur**

DependenciesBand déclare `onOpenTicket?: (epicId) => void` (components/ticket/DependenciesBand.tsx:46) et ne rend un IdentityChip cliquable que s'il est fourni (:193 ; IdentityChip.tsx:99-125 rend un `<span>` inerte sinon). Son unique consommateur, TicketOverlay.tsx:539-550, monte la bande sans cette prop — et ce depuis la création de l'overlay (commit 7fec5315, ligne 462), pas à cause de la rationalisation non commitée. Les puces BLOCKS / WAITS ON sont donc décoratives : impossible de naviguer vers le ticket lié depuis l'overlay, alors que `DependencyRowItem.id` est documenté comme « the click target » (derive.ts:190-192). Aucun test ne couvre le clic. Le mécanisme de navigation existe (`useTicketOverlay().openTicket`, TicketOverlayProvider.tsx:45/94).

DependenciesBand (components/ticket/DependenciesBand.tsx:46,63,131,138,193) déclare `onOpenTicket?` et ne rend une IdentityChip cliquable que si la prop est fournie ; IdentityChip (components/piscine/IdentityChip.tsx:99-123) rend un `<span>` sans handler quand `onClick` est undefined. L'unique consommateur, TicketOverlay.tsx:539-550, monte la bande sans `onOpenTicket`, et `TicketOverlayProps` (lignes 48-58) n'offre aucun moyen de l'injecter depuis TicketOverlayProvider.tsx:161 ou app/projects/[projectId]/page.tsx:379. Les puces BLOCKS / WAITS ON sont donc purement décoratives, alors que derive.ts:191 documente `DependencyRowItem.id` comme « the click target ». Préexistant à la rationalisation (jamais passé dans l'historique de TicketOverlay.tsx), aucun test ne fige ce comportement.

**Recommandation**

Passer `onOpenTicket` depuis TicketOverlay (via `useTicketOverlay().openTicket` sur `/`, ou une prop hôte sur la page projet qui remplace `activeDetailTicketId`), ou retirer la prop et le commentaire « click target ».

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n DependenciesBand components app` → seul TicketOverlay.tsx:39/532. `rg -n onOpenTicket components/ticket/` → uniquement dans DependenciesBand.tsx (déclaration et usage), jamais côté TicketOverlay.

</details>

### #122 — Sur `/`, `/tickets`, `/qa` et `/chat`, un 409 « agent already running » est avalé en silence et merge/suppression ne donnent aucun retour

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `components/ticket/TicketOverlayProvider.tsx:158-167`
- `components/ticket/TicketOverlay.tsx:232-249,288-298,306-317,327-346`
- `app/page.tsx:15-17`
- `app/tickets/page.tsx:35-37`
- `app/qa/page.tsx:17-19`
- `app/chat/page.tsx:28-33`

**Constat**

TicketOverlayProvider monte TicketOverlay avec seulement `projectId/epicId/open/onClose` : ni `onAgentConflict`, ni `onMerged`, ni `onDeleted`. Dans TicketOverlayContent, `reportConflict()` renvoie `true` dès que l'erreur est un AGENT_ALREADY_RUNNING, que `onAgentConflict` existe ou non ; les handlers Review/Grade/Rebuild/Back-to-dev font `if (!reportConflict(error)) setStatusError(...)`, donc sur ces quatre pages le conflit n'est affiché nulle part. De même un merge réussi ferme l'overlay sans toast, et une suppression aussi. Seule la page projet reçoit ces retours.

**Précision du vérificateur**

TicketOverlayProvider (components/ticket/TicketOverlayProvider.tsx:161-166) monte TicketOverlay sans `onAgentConflict`/`onMerged`/`onDeleted`, et il est l'unique voie d'ouverture de l'overlay sur `/`, `/tickets`, `/qa`, `/chat`. Dans TicketOverlayContent, `reportConflict` (TicketOverlay.tsx:237-253) renvoie `true` pour tout AGENT_ALREADY_RUNNING même sans callback, et Review (293-302), Grade (311-321), Rebuild/Back-to-dev (handleDispatchDev 332-350) n'appellent `setStatusError` que si `reportConflict` renvoie `false` : un 409 réel (review/build/grading routes) lancé depuis l'overlay sur ces quatre pages n'est affiché nulle part. Resolve-merge reste visible via `mergeError` (GitBand), et les actions inline du desk ont leur propre `desk-toast` — le trou est propre à l'overlay hors page projet. Merge (useEpicMutations.ts:59 → onMergeSuccess → onClose) et suppression (l.80) ferment l'overlay sans retour. Seule app/projects/[projectId]/page.tsx:379-401 fournit les trois callbacks.

TicketOverlayProvider (components/ticket/TicketOverlayProvider.tsx:161-166) monte TicketOverlay sans `onAgentConflict`/`onMerged`/`onDeleted`, et le contexte n'offre aucun canal de retour. Dans TicketOverlayContent, `reportConflict` (TicketOverlay.tsx:237-254) renvoie `true` pour tout AGENT_ALREADY_RUNNING même sans `onAgentConflict` ; handleReview (l.293-303), handleGrade (l.311-322) et handleDispatchDev (l.332-348, Rebuild + Back-to-dev) ne tombent sur `setStatusError` que si `reportConflict` renvoie `false`. Sur `/`, `/tickets`, `/qa`, `/chat` un 409 sur ces quatre actions n'est donc affiché nulle part (useAgentDispatch se contente de throw, PipelineCard n'affiche que statusError). Un merge réussi (useEpicMutations.ts:59 → TicketOverlay.tsx:109-111) et une suppression réussie (l.113-117) ferment l'overlay sans retour. Seule app/projects/[projectId]/page.tsx:385-401 branche les trois callbacks sur son ToastStack. Le chemin resolveMerge (l.266-291) n'est pas touché (setMergeError systématique). Comportement préexistant à la rationalisation : à HEAD, toutes les erreurs de dispatch (409 ou non) étaient avalées ; le diff non commité n'a corrigé que les non-409.

**Recommandation**

Dans TicketOverlayContent, ne renvoyer `true` que si `onAgentConflict` est défini (sinon tomber sur `setStatusError`), et donner au provider un toast stack par défaut (ou remonter `onMerged/onDeleted/onAgentConflict` via le contexte).

<details><summary>Preuve relevée par l'auditeur</summary>

TicketOverlayProvider.tsx:161-166 : `<TicketOverlay projectId={projectId ?? ""} epicId={ticketId} open onClose={closeTicket} />`. TicketOverlay.tsx:235-245 : `if (isAgentAlreadyRunningError(error)) { onAgentConflict?.({...}); return true; }`. Seul app/projects/[projectId]/page.tsx:385-401 fournit les trois callbacks.

</details>

### #22 — La source « drag » et la route POST epics/reorder ne survivent que l'une par l'autre, sans appelant UI

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `lib/workflow/engine.ts:112`
- `lib/workflow/engine.ts:246-251`
- `lib/workflow/reorder.ts:33`
- `app/api/projects/[projectId]/epics/reorder/route.ts:49`
- `docs/architecture/ticket-state-machine.md:66-73`

**Constat**

Le DnD a été retiré du produit (ticket-state-machine.md le documente, le doc de rationalisation aussi). Le vocabulaire `source: "drag"` reste dans TransitionContext (engine.ts) avec une garde dédiée (« Cannot drag tickets to Released »), dans ReorderContext (reorder.ts), et son seul producteur est app/api/projects/[projectId]/epics/reorder/route.ts:49, route dont ticket-state-machine.md dit elle-même qu'elle n'a plus d'appelant (« its one client was hooks/useKanban.ts … no component mounts that hook any more »). useKanban.ts est supprimé dans l'arbre. Le cœur `reorderTickets` reste vivant via l'outil MCP reorder_tickets (source refinement).

**Précision du vérificateur**

Constat confirmé, avec deux précisions à porter au ticket : (a) la route app/api/projects/[projectId]/epics/reorder/route.ts n'est plus exercée que par __tests__/epics-reorder-route.test.ts — la supprimer implique de supprimer ce test ; (b) la garde « drag » de engine.ts:248 n'est redondante avec la garde actor≠system (engine.ts:246) que parce que la route est le seul producteur de source "drag" et code en dur actor:"user" ; une future UI de ré-ordonnancement avec un actor agent en aurait de nouveau besoin. Ne pas confondre lib/workflow/reorder.ts (cœur transactionnel, vivant) avec lib/kanban/reorder.ts (ordre d'exécution du desk, vivant et hors sujet).

**Recommandation**

Supprimer la route epics/reorder (le MCP reorder_tickets couvre le besoin agent ; une future UI de ré-ordonnancement passera par le même cœur avec source "api"), retirer "drag" des deux unions et la garde correspondante (déjà couverte par « only system actor can move to released »).

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '"drag"' app lib components hooks` → engine.ts:112 (type), engine.ts:248 (garde), reorder.ts:33 (type), epics/reorder/route.ts:49 (`source: "drag"`). `rg -n 'epics/reorder' app components hooks lib --glob '!app/api/**'` → aucun résultat. git status : `D hooks/useKanban.ts` (listé dans le doc de rationalisation « Hooks de l'ancien board »).

</details>

### #121 — Le segment « from GH #n » de la ligne méta ne peut jamais s'afficher : la route epics ne projette pas `githubIssueNumber`

**Nature** à moitié câblé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `components/ticket/derive.ts:460-478`
- `app/api/projects/[projectId]/epics/route.ts:314-352`
- `hooks/useEpicDetail.ts:25-44`
- `lib/i18n/messages/en/Ticket.json:124`

**Constat**

`descriptionMeta()` compose `priority · created · from GH #412` en lisant `epic.githubIssueNumber`. La colonne existe (schema.ts:120) mais la projection de `GET /api/projects/:id/epics` (la seule source de `useEpicDetail`) ne la sélectionne pas, et l'interface `EpicDetail` du hook ne la déclare pas. Le troisième segment est donc du code mort, avec sa clé i18n `Ticket.derived.github`.

**Précision du vérificateur**

Le segment « from GH #n » de `descriptionMeta()` (components/ticket/derive.ts:474-475) n'est jamais rendu à l'ouverture de l'overlay : `useEpicDetail` (hooks/useEpicDetail.ts:85) prend l'epic dans `GET /api/projects/:id/epics`, dont la projection explicite (app/api/projects/[projectId]/epics/route.ts:314-363) omet `githubIssueNumber`, et le type `EpicDetail` (l.25-44) ne le déclare pas. Mais il n'est pas mort : le PATCH `epics/[epicId]/route.ts:52-60` renvoie la ligne complète et `updateEpic` (useEpicDetail.ts:156-160) la fusionne dans l'état, si bien qu'un changement de priorité/statut depuis l'overlay (TicketOverlay.tsx:222/231) fait apparaître le segment sur un ticket importé de GitHub, jusqu'au prochain refresh/poll qui le fait disparaître. Résultat : ligne méta incohérente entre chargement et édition. Correctif : projeter `githubIssueNumber: epics.githubIssueNumber` dans la route liste et l'ajouter à `EpicDetail`.

Le segment « from GH #n » de la ligne méta n'est pas mort mais incohérent : `useEpicDetail.fetchData` (hooks/useEpicDetail.ts:70,85) lit la route liste `GET /api/projects/:id/epics`, dont la projection explicite (app/api/projects/[projectId]/epics/route.ts:316-362) omet `githubIssueNumber`, et l'interface `EpicDetail` (l.25-44) ne le déclare pas — à l'ouverture et à chaque poll, le segment est absent. Mais `updateEpic` (l.158-161) fusionne la réponse du PATCH détail, qui est la ligne complète `db.select().from(epics)` (app/api/projects/[projectId]/epics/[epicId]/route.ts:72), colonne incluse : après un changement de priorité/statut dans l'overlay (TicketOverlay.tsx:222,231) sur un ticket importé de GitHub (lib/github/issues.ts:318), « from GH #n » apparaît puis disparaît au prochain `fetchData` (poll 5 s, refresh ou événement). Clé i18n réelle : Ticket.json:127. Correction : ajouter `githubIssueNumber: epics.githubIssueNumber` à la projection du GET liste et au type `EpicDetail`.

**Recommandation**

Ajouter `githubIssueNumber: epics.githubIssueNumber` à la projection de la route (et au type EpicDetail), ou retirer le segment et la clé.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n githubIssueNumber lib/db/schema.ts app/api/projects/[projectId]/epics/route.ts hooks components/ticket` → schema.ts:120 et derive.ts:463/474-475 seulement ; aucune occurrence dans la route ni dans useEpicDetail.

</details>

### #133 — Le bouton « Diff » d'une ligne CONFLICT ouvre le ticket, pas le diff

**Nature** à moitié câblé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `components/desk/NowDesk.tsx:771`
- `components/desk/AttentionRow.tsx:360,429`
- `components/ticket/TicketOverlay.tsx:90,427`

**Constat**

ConflictRow expose `onOpenDiff` ; NowDesk le branche sur `handleOpenTicket(item.epicId)`. TicketOverlay n'a aucune prop pour s'ouvrir en mode diff : `diffView` est un état local initialisé à `false`. L'utilisateur qui clique « Diff » arrive sur la fiche standard et doit encore cliquer « Diff » dans la bande GIT.

**Précision du vérificateur**

ConflictRow (components/desk/AttentionRow.tsx:360, bouton l.429 libellé « Diff ») expose `onOpenDiff` ; NowDesk.tsx:771 le branche sur `handleOpenTicket(item.epicId)`, qui appelle `openTicket(epicId, { projectId })` (TicketOverlayProvider, options limitées à `projectId`) ou l'override `handlePrimaryTicketClick` de app/projects/[projectId]/page.tsx:90 — dans les deux cas TicketOverlay est monté sans aucune prop de vue (`TicketOverlayProps` l.48-58). `diffView` est un état local initialisé à `false` (TicketOverlay.tsx:90), rendu l.432, et seul le bouton Diff de la bande GIT (TicketOverlay.tsx:529 → GitBand.tsx:163) le passe à `true`. Le clic « Diff » sur une ligne CONFLICT ouvre donc la fiche standard, et l'utilisateur doit recliquer « Diff » dans la bande GIT ; la spec docs/specs.md:739 prévoit pourtant un `[diff]` dédié sur cette ligne.

Le bouton « Diff » d'une ligne CONFLICT (AttentionRow.tsx:429, libellé Desk.json `rows.diff`) est câblé dans NowDesk.tsx:771 sur `handleOpenTicket(item.epicId)`, qui sur `/` appelle `openTicket(epicId, { projectId })` (TicketOverlayProvider.tsx:94, options = `projectId` seulement) et sur `/projects/:id` appelle `handlePrimaryTicketClick` → `setActiveDetailTicketId` → `<TicketOverlay>` sans prop de vue (page.tsx:379-392). Dans les deux cas TicketOverlay démarre avec `diffView = useState(false)` (TicketOverlay.tsx:90) ; le diff ne s'ouvre que via le bouton de GitBand (`setDiffView(true)`, TicketOverlay.tsx:529). L'utilisateur arrive donc sur la fiche standard et doit recliquer « Diff ».

**Recommandation**

Ajouter une option `{ view: "diff" }` à `openTicket`/TicketOverlay (état initial de `diffView`), ou renommer le bouton « Ouvrir ».

<details><summary>Preuve relevée par l'auditeur</summary>

NowDesk.tsx:771 `onOpenDiff={(item) => handleOpenTicket(item.epicId)}`. `rg -n "diffView|initialView|openDiff" components/ticket/TicketOverlay.tsx` → uniquement l'état local l.90 et son usage l.427.

</details>

### #134 — L'overlay calcule `loading` que personne ne lit, et fait un GET projet par ouverture pour un `colorIndex` qui n'existe pas

**Nature** à moitié câblé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `hooks/useEpicDetail.ts:61,107-118,169`
- `hooks/useTicketOverlayData.ts:122-132,284-309,596-599`
- `components/ticket/TicketOverlay.tsx:120-170,416`

**Constat**

useEpicDetail maintient un `loading` (spinner « owned by initial navigation »), useTicketOverlayData le retourne, mais TicketOverlayContent ne le destructure jamais : l'overlay s'ouvre avec un titre vide et des bandes vides jusqu'à l'arrivée des données, sans aucun état intermédiaire. Par ailleurs l'effet « project identity » fait `GET /api/projects/:id` à chaque ouverture pour lire `name` et un `colorIndex` que le hook lui-même documente comme inexistant (`projects.colorIndex does not exist yet`), alors que le desk possède déjà `projects[].shortName/colorIndex` dans son payload.

**Précision du vérificateur**

useEpicDetail calcule un `loading` (hooks/useEpicDetail.ts:61,108-110,169) que useTicketOverlayData re-retourne (:125,:602) mais que TicketOverlayContent ne destructure jamais (components/ticket/TicketOverlay.tsx:120-171, aucun `data.loading`) ; seul consommateur de useEpicDetail, donc valeur morte. L'overlay s'ouvre avec `title=""` (:421), statut « backlog » par défaut (:510,:520) et bandes vides, sans état intermédiaire (déjà le cas à HEAD, pas une régression). Par ailleurs l'effet « project identity » (useTicketOverlayData.ts:287-309) fait `GET /api/projects/:id` à chaque ouverture — le contenu est démonté à la fermeture et remonté sous clé projectId:epicId (TicketOverlay.tsx:60-64) — pour lire `name` et un `colorIndex` absent du schéma (`lib/db/schema.ts` : 0 occurrence ; commentaire :295-296), si bien que la teinte tombe toujours sur `hashString(projectId)` (derive.ts:65-73), alors que le desk teinte le même projet par ordre de création (lib/control-desk/aggregate.ts:92-103 → AttentionRow.tsx:203-204 etc.) : la couleur d'identité peut différer entre desk et overlay. Nuances : l'overlay est aussi monté par TicketOverlayProvider.tsx:161-166 hors du desk (source alternative : `useProjects`), et la fixture e2e interdit le texte littéral « Loading... » dans le panneau (TicketOverlay.tsx:17-21) — l'état de chargement doit être un skeleton ou un « … » Mono, pas ce libellé.

useEpicDetail (hooks/useEpicDetail.ts:61,107-118,169) calcule un `loading` que useTicketOverlayData (:122-132, :596-599) relaie et que TicketOverlay.tsx (:120-176, seul consommateur) ne destructure jamais (le seul `loading` du fichier est `dependencyLoading` :546) : pas de skeleton, titre vide (:419) et bandes rendues avec des valeurs de repli (`status ?? "backlog"`, `priority ?? 1`, stories vides) tant que l'epic n'est pas arrivé. L'effet « project identity » (useTicketOverlayData.ts:284-306, préexistant à HEAD) fait un GET /api/projects/:id à chaque montage de l'overlay — donc à chaque ouverture (page.tsx:378, TicketOverlayProvider.tsx:158) — pour `name` et un `colorIndex` absent de la ligne DB (aucune colonne dans lib/db/schema.ts ; la route renvoie `found.project` brut), si bien que la puce projet de l'overlay prend toujours le ton hashé (derive.ts:72) alors que le desk (DeskProject.colorIndex, aggregate.ts:103, ordre de création) colore le même projet autrement : la couleur d'identité peut différer entre desk et overlay. Le desk et useProjects possèdent déjà name/shortName/colorIndex.

**Recommandation**

Rendre un état de chargement minimal (titre en Mono « … » ou skeleton) à partir de `loading`, et passer `projectName/colorIndex` depuis l'appelant (payload desk ou `useProjects`) au lieu d'un GET par ouverture.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n loading components/ticket/TicketOverlay.tsx` → 0 résultat. useTicketOverlayData.ts:292-293 : « `projects.colorIndex` does not exist yet ». lib/control-desk/types DeskProject expose déjà `colorIndex`/`shortName` (utilisés NowDesk.tsx:162-165, AttentionRow.tsx:1050-1052).

</details>


## État au 16/09/2026 — fait, intégré sur main

Commit `0085aed4` sur `main` (écrit sur `feature/lots-03-05-10`, puis
appliqué par-dessus l'intégration). Trois implémentations (overlay, serveur de
réordonnancement, carte PIPELINE), deux revues adverses, une passe de corrections.

Fait : #119, #81, #22 (route `POST/GET /api/projects/:id/epics/:epicId/position`,
up/down/top/bottom en une transaction, rang de colonne « Queue #n of m » dans la
carte PIPELINE ; route drag, source `drag` et écriture directe de `position` par
PATCH retirées ; le MCP `reorder_tickets` reste), #72 (la carte lit le registre :
étape, tentative, cycle de fix, story, raison et date du dernier run ;
`GET /pipeline/runs?epicId=`), #120 (puces de dépendances cliquables), #122 (409
affiché dans la carte hors page projet ; une seule pile de toasts, celle du
provider, où desk, QA et chat lèvent aussi), #133 (Diff depuis CONFLICT et depuis
un finding QA), #134 (état d'attente, teinte et nom du projet depuis le contexte
partagé, plus de GET projet), #121 (déjà vrai à l'exécution, type ajouté).

Choix : le rang affiché est celui de la colonne (ce que Full Auto lit), pas le
numéro d'UP NEXT qui fusionne en cours/à faire et saute les tickets exclus.

Reste :
- positions des user stories encore écrites en direct par PATCH ;
- mode « déplacement » de `reorderTickets` (sans `reorderOnly`) sans appelant
  de production, gardé pour `refinement-reorder-core.test.ts` ;
- badge pipeline sur les lignes de la page Sessions (suggestion de la fiche, non
  faite) ; aucun événement propre au pipeline : poll de 10 s limité aux runs actifs ;
- la raison terminale d'un run est affichée brute, en anglais.
