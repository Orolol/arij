# Lot 08 — Tickets côté serveur : projection de GET /epics, GET unitaire, read-model partagé

**Réalisation du 11/09/2026** : changements implémentés ; [détail et état des vérifications](implementation-lots-06-08-09-15.md). Validation globale de l’arbre partagé encore non verte.

**Difficulté** 3/4 — Difficile
**Findings** 10 (3 fort · 6 moyen · 1 faible ; effort 3 S · 7 M · 0 L)
**Dépendances** Avant le lot 09 (client). Coordonner avec le lot 05 (githubIssueNumber).

## Décision

lib/control-desk/read-model.ts devient l'unique source des « faits » par ticket (dernière session, dernier commentaire, findings ouverts, échecs de merge) pour le desk, le registre, l'inbox et la liste d'epics.

## Objectif

Ajouter GET /api/projects/:id/epics/:epicId (projection étroite), réduire GET /epics à ce que lisent ses quatre consommateurs, faire consommer readEpicActivityFacts par /api/inbox, supprimer user-stories PATCH/DELETE, corriger la validation des dépendances à la création, faire passer DELETE /epics/:id par retireTicket (refus 409 si session en cours, tombstone, nettoyage worktree).

## Démarche suggérée

1. Écrire GET unitaire + tests ; migrer useEpicDetail (lot 09 côté client) et useProjectEpicsList vers une liste légère {id, readableId, title}.
2. Réduire la projection liste (retirer ranked*/openFindingCounts/latestMergeFailures/grading/listUnverifiableReviewEpicIds) — vérifier la page Releases, NightRunDialog, la bande dépendances.
3. readMergeFacts(db, epicIds) + readActiveSessionRows dans read-model.ts, consommés par epics/route, control-desk, tickets, inbox/read.ts.
4. POST /epics : validateSameProject, 422 DEPENDENCY_TARGET_NOT_FOUND.
5. DELETE /epics/:id → helper commun avec retireTicket.
6. Supprimer PATCH/DELETE user-stories (doublons sans appelant).

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #77 — GET /api/projects/:id/epics calcule une dizaine de champs que plus aucune surface ne lit

**Nature** à moitié câblé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `app/api/projects/[projectId]/epics/route.ts:73-423`
- `hooks/useEpicDetail.ts:25-44`
- `hooks/useEpicDetail.ts:71-88`
- `hooks/useProjectEpicsList.ts:5-9`
- `components/releases/derive.ts:30-41`
- `components/night/NightRunDialog.tsx:43-48`

**Constat**

La route liste (app/api/projects/[projectId]/epics/route.ts, GET l.73-423) est l'ancienne requête du board : fenêtres ROW_NUMBER sur ticket_comments et agent_sessions, comptage usWithCriteriaCount, CTE epicSessionFacts, comptage des findings ouverts, LIKE sur ticket_activity_log pour les échecs de merge, listUnverifiableReviewEpicIds (2 requêtes), puis evaluateMergeReadiness par epic. Depuis le passage au desk, ses seuls consommateurs (useEpicDetail, useProjectEpicsList, la page Releases, NightRunDialog) ne lisent que id/title/status/readableId/releaseId/usCount/usDone/updatedAt et les colonnes brutes de l'epic. Les champs dérivés usWithCriteriaCount, reviewUnverifiable, gradingStatus/gradingSummary/gradingCreatedAt (le client lit /grading à part), latestCommentId/Author/CreatedAt, lastReadAt, latestSessionOutcome/EndedAt, latestUserCommentCreatedAt, sessionsCostUsd et mergeReadiness n'ont aucun lecteur ; les deux derniers sont déclarés dans l'interface EpicDetail de useEpicDetail.ts:42-43 mais aucun composant ne les rend. Cette route est refetchée à chaque ouverture d'overlay, toutes les 5 s tant qu'une session tourne (useEpicDetail.ts:120) et une seconde fois par useProjectEpicsList dans le même overlay.

**Précision du vérificateur**

GET /api/projects/:id/epics (route.ts:75-421) reste l'ancienne requête du board : fenêtres ROW_NUMBER sur ticket_comments (l.111) et agent_sessions (l.138), usWithCriteriaCount (l.104), CTE epicSessionFacts (l.178), rankedGradingReports (l.180), openFindingCounts (l.226), LIKE sur ticket_activity_log (l.250), latestUserComments (l.298), listUnverifiableReviewEpicIds (l.388) et evaluateMergeReadiness par epic (l.410). Ses cinq consommateurs GET — useEpicDetail.ts:71, useProjectEpicsList.ts:25, releases/page.tsx:92 (derive.ts:30-41), NightRunDialog.tsx:143 et l'outil chat/MCP list_tickets (lib/chat/board-tools.ts:353-373, oublié par l'auditeur) — ne lisent que les colonnes brutes de l'epic, usCount/usDone et, pour list_tickets seulement, latestSessionOutcome. Sans aucun lecteur du payload : usWithCriteriaCount (seul lecteur computeReadiness, lib/kanban/queue.ts:245, lui-même sans appelant), reviewUnverifiable, gradingStatus/gradingSummary/gradingCreatedAt (l'overlay les dérive de gradingReport via /grading, useTicketOverlayData.ts:509-513), latestCommentId/Author/CreatedAt, lastReadAt, latestSessionEndedAt, latestUserCommentCreatedAt, sessionsCostUsd et mergeReadiness (déclarés dans EpicDetail useEpicDetail.ts:42-43, rendus nulle part ; isMergeReadyEpic/sortMergeColumn sans appelant). La route est refetchée à l'ouverture de l'overlay, toutes les 5 s tant qu'une session tourne (useEpicDetail.ts:120) et une seconde fois par useProjectEpicsList dans le même overlay. La sous-requête latestEpicSessions doit être conservée (ou list_tickets adapté) ; le reste des sous-requêtes et de l'appel listUnverifiableReviewEpicIds peut être retiré.

GET /api/projects/:id/epics (app/api/projects/[projectId]/epics/route.ts:73-423) calcule une dizaine de champs dérivés que plus aucun chemin produit ne lit. Consommateurs GET réels : hooks/useEpicDetail.ts:71 (overlay, refetch à l'ouverture et poll 5 s l.120), hooks/useProjectEpicsList.ts:25 (même overlay, ne lit que id/title/readableId via useTicketOverlayData.ts:455-459), app/projects/[projectId]/releases/page.tsx:92 (ReleaseEpic, derive.ts:30-41), components/night/NightRunDialog.tsx:143 (ScopeEpic l.43-48) ET l'outil de chat/MCP `list_tickets` (lib/chat/board-tools.ts:353-373, atteint par app/api/projects/[projectId]/chat/stream/route.ts:641 et app/api/mcp/list-tickets/route.ts:19 via lib/mcp/board-tool-route.ts:105) qui lit id/readableId/title/status/type/priority/usDone/usCount/prStatus et latestSessionOutcome. Sans aucun lecteur produit : usWithCriteriaCount (seul lecteur computeReadiness lib/kanban/queue.ts:250, lui-même sans appelant), reviewUnverifiable, gradingStatus/gradingSummary/gradingCreatedAt (l'overlay dérive les siens de la route /grading, useTicketOverlayData.ts:509-513), latestCommentId/Author/CreatedAt, lastReadAt, latestSessionEndedAt, latestUserCommentCreatedAt, sessionsCostUsd et mergeReadiness (déclarés useEpicDetail.ts:42-43, jamais rendus ; isMergeReadyEpic/sortMergeColumn merge-readiness.ts:279-300 sans appelant). Peuvent donc être supprimés : storyCounts.usWithCriteriaCount, rankedEpicComments/latestEpicComments, latestUserComments, le CTE epicSessionFacts, openFindingCounts, latestMergeFailures, rankedGradingReports/latestGradingReports, la jointure ticketReadCursors, listUnverifiableReviewEpicIds et evaluateMergeReadiness — mais PAS rankedEpicSessions/latestEpicSessions (latestSessionOutcome est lu par list_tickets, épinglé par __tests__/chat-board-tools.test.ts:285). Les tests __tests__/epics-route.test.ts:356-364 et __tests__/board-merge-readiness-route.test.ts:199,608 épinglent les champs à retirer et devront suivre.

**Recommandation**

Réduire la projection du GET liste à ce que lisent les quatre consommateurs (colonnes epics + usCount/usDone), supprimer les sous-requêtes rankedEpicComments/latestEpicSessions/latestUserComments/openFindingCounts/latestMergeFailures/rankedGradingReports et l'appel listUnverifiableReviewEpicIds, et retirer usWithCriteriaCount/reviewUnverifiable/gradingStatus/mergeReadiness/sessionsCostUsd du payload et de KanbanEpic. Si un jour l'overlay doit afficher mergeReadiness ou le coût, le servir depuis une route GET epics/[epicId] dédiée (voir finding suivant).

<details><summary>Preuve relevée par l'auditeur</summary>

rg -l '\b<champ>\b' app components hooks --glob '!app/api/**' : usWithCriteriaCount → 0 fichier ; reviewUnverifiable → 0 ; gradingCreatedAt → 0 ; latestCommentId → 0 ; lastReadAt → 0 ; latestSessionOutcome → 0 ; latestUserCommentCreatedAt → 0 ; sessionsCostUsd → hooks/useEpicDetail.ts seul (déclaration d'interface l.42) ; mergeReadiness → hooks/useEpicDetail.ts seul (l.43) ; gradingStatus/gradingSummary → useTicketOverlayData.ts:506-510 les dérive de gradingReport (route /grading), pas du payload epics. Consommateurs de l'URL `/api/projects/${id}/epics` (GET) : hooks/useEpicDetail.ts:71, hooks/useProjectEpicsList.ts:25, app/projects/[projectId]/releases/page.tsx:92, components/night/NightRunDialog.tsx:171 (+ import/page.tsx:165 en POST).

</details>

### #124 — Ouvrir un ticket charge tout le board deux fois : pas de GET unitaire, `useEpicDetail` et `useProjectEpicsList` appellent chacun `GET /epics` (9 jointures + window functions), et l'un des deux poll toutes les 5 s

**Nature** refacto · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `hooks/useEpicDetail.ts:67-91,120`
- `hooks/useProjectEpicsList.ts:10-13,25`
- `app/api/projects/[projectId]/epics/route.ts:73-380`
- `app/api/projects/[projectId]/epics/[epicId]/route.ts:21,86`
- `hooks/useTicketOverlayData.ts:180-184,229-231`

**Constat**

`useEpicDetail.fetchData` fait `fetch('/api/projects/:id/epics')` puis `.find(row.id === epicId)` pour extraire UN ticket ; `useProjectEpicsList` (dont la doc parle encore du « dependency editor » supprimé) refait le même GET pour l'index des dépendances. La route `epics/[epicId]/route.ts` n'expose que PATCH et DELETE. La route liste construit 9 LEFT JOIN, deux ROW_NUMBER() OVER, les coûts de sessions, les rapports de grading et `evaluateMergeReadiness` par epic, puis loggue un `console.debug` par appel. Pendant qu'un agent tourne, `useEpicDetail` refait ce triple appel toutes les 5 s, et chaque bump SSE le relance encore.

**Précision du vérificateur**

Finding confirmé, deux imprécisions mineures de comptage/lignes : la route liste contient TROIS `ROW_NUMBER() OVER` (route.ts:117, :146, :186), pas deux, et son `export async function GET` est à :75 (pas 73). Par ailleurs, sur les trois fetch parallèles de `useEpicDetail` un seul est la liste lourde (les deux autres sont `user-stories?epicId=` et `.../grading`, ciblés) : le board complet est donc chargé DEUX fois à l'ouverture (`useEpicDetail` + `useProjectEpicsList`), dont une seule re-jouée toutes les 5 s pendant qu'un agent tourne et à chaque bump SSE. Tout le reste — absence de GET unitaire sur `epics/[epicId]/route.ts` (PATCH:21, DELETE:86 uniquement), `.find(row.id === epicId)` en useEpicDetail.ts:85, 9 LEFT JOIN, evaluateMergeReadiness par epic, `console.debug` par appel, doc périmée de `useProjectEpicsList` mentionnant un DependencyEditor supprimé dans l'arbre — est exact dans l'arbre de travail.

**Recommandation**

Ajouter `GET /api/projects/:id/epics/:epicId` (projection étroite réutilisant les helpers de lib/control-desk/read-model) et faire pointer useEpicDetail dessus ; partager une seule liste légère `{id, readableId, title}` pour l'index des dépendances (ou renvoyer les titres depuis la route dependencies).

<details><summary>Preuve relevée par l'auditeur</summary>

useEpicDetail.ts:71 `fetch(`/api/projects/${projectId}/epics`)` puis :85 `(epicData.data || []).find((row) => row.id === epicId)`. `rg -n "^export (async )?function" app/api/projects/[projectId]/epics/[epicId]/route.ts` → PATCH:21, DELETE:86 uniquement. epics/route.ts:314-364 : projection + 9 `.leftJoin`, :375 `console.debug("[epics/GET] query profile"`.

</details>

### #201 — Deux chemins de suppression définitive divergent : le bouton Delete de l'overlay efface un ticket en cours de build sans garde, sans tombstone, sans nettoyage du worktree

**Nature** cassé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:orphan-small-domains-and-docs

**Fichiers**
- `lib/planning/permanent-delete.ts:27-85`
- `lib/refinement/retire.ts:176-193`
- `lib/refinement/retire.ts:361-381`
- `app/api/projects/[projectId]/epics/[epicId]/route.ts:86-107`
- `components/ticket/TicketOverlay.tsx:567-574`
- `lib/claude/process-manager.ts:395-404`
- `lib/agent-sessions/chunks.ts:583-640`
- `lib/db/schema.ts:236`
- `app/api/projects/[projectId]/stories/[storyId]/route.ts:99-117`

**Constat**

Le chemin MCP (discard_ticket / merge_tickets → retireTicket) refuse tout ticket ayant une session (ticketRetirementGuard), capture un tombstone, supprime explicitement les arêtes de dépendance puis appelle deleteEpicPermanently. Le chemin UI (TicketOverlay → DELETE /epics/:id) appelle deleteEpicPermanently directement : aucune vérification de session en cours (le QuietDangerAction n'est pas `locked` par `isRunning`, la route ne consulte ni processManager ni agentScheduler), pas de tombstone, arêtes laissées au cascade FK. deleteEpicPermanently efface les lignes agent_sessions d'un process encore vivant : chaque chunk suivant échoue sur `Failed to reserve sequence` (FK, foreign_keys=ON) et est avalé par le catch de process-manager, le process continue jusqu'au bout, et ni le worktree `.arij-worktrees/<branche>` ni la branche `feature/epic-…` ne sont retirés (aucun appel git dans permanent-delete.ts ; les seuls `removeWorktrees` sont dans clone-cleanup.ts pour la suppression de projet). DELETE story (deleteUserStoryPermanently) n'émet en plus aucun événement SSE, contrairement à l'epic.

**Précision du vérificateur**

Deux chemins de suppression définitive divergent. Le chemin MCP (discard_ticket / merge_tickets → retireTicket, lib/refinement/retire.ts:366-381) refuse tout ticket ayant un historique de sessions (ticketRetirementGuard, retire.ts:162-174, 409 TICKET_HAS_SESSIONS), capture un tombstone, supprime explicitement les arêtes ticket_dependencies puis appelle deleteEpicPermanently. Le chemin UI (TicketOverlay.tsx:567-574 → useEpicMutations.ts:65-84 → DELETE /api/projects/:p/epics/:e, route.ts:86-107) appelle deleteEpicPermanently directement : le bouton n'est pas `locked` par `isRunning` (contrairement aux autres actions de l'overlay l.487/558/610/626/642), la route ne consulte ni processManager ni agentScheduler, pas de tombstone, arêtes laissées au cascade FK. deleteEpicPermanently (permanent-delete.ts:44-70) efface les lignes agent_sessions sans filtrer sur le statut, donc aussi celles d'un process vivant ; agent_session_sequences cascade (schema.ts:317-324, foreign_keys=ON à lib/db/index.ts:58), et chaque appendSessionChunk suivant échoue sur `FOREIGN KEY constraint failed` (upsert reserveSequenceStmt, chunks.ts:322-339/630), avalé par les catch de process-manager.ts:403-407 et 700-704 ; le process continue jusqu'au bout sans persistance. Ni le worktree `.arij-worktrees/<branche>` ni la branche `feature/epic-…` ne sont retirés : aucun appel git dans permanent-delete.ts ni dans la route ; les primitives existantes (`git worktree remove` dans lib/git/manager.ts:537 côté merge, `removeWorktrees` dans clone-cleanup.ts:143 côté suppression de projet, `pruneOrphanWorktrees` dans lib/git/worktrees.ts:117 qui ne purge que les répertoires déjà disparus) ne sont pas appelées sur ce chemin. Les deux routes DELETE story (stories/[storyId]/route.ts:99-117, appelée par app/projects/[projectId]/stories/[storyId]/page.tsx:81, et user-stories/route.ts:131-159) n'émettent aucun événement SSE, contrairement à l'epic.

**Recommandation**

Faire passer la route DELETE par un helper commun avec retireTicket : refuser (409) ou annuler proprement (`processManager.cancel` + `agentScheduler.remove`) toute session running/queued, retirer le worktree et la branche via lib/git/manager, supprimer les arêtes explicitement, et émettre `ticket:deleted` aussi pour les stories. Verrouiller le bouton de l'overlay quand `isRunning`.

<details><summary>Preuve relevée par l'auditeur</summary>

`grep -n "running\|processManager\|cancel" app/api/projects/[projectId]/epics/[epicId]/route.ts lib/planning/permanent-delete.ts` → vide ; `grep -rn worktree lib/planning/permanent-delete.ts app/api/…/epics/[epicId]/route.ts` → vide ; `grep -rn removeWorktree` → lib/projects/clone-cleanup.ts:143,254 uniquement ; retire.ts:176-193 `ticketRetirementGuard` 409 TICKET_HAS_SESSIONS ; TicketOverlay.tsx:567-574 `<QuietDangerAction onClick={() => setDeleteDialogOpen(true)}>` sans `locked`/`disabled` ; lib/db/index.ts:58 `foreign_keys = ON`.

</details>

### #1 — /api/inbox et /api/control-desk calculent les mêmes signaux par epic, et la TopBar polle les deux sur les pages desk

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `app/api/inbox/route.ts:52`
- `app/api/inbox/route.ts:83`
- `app/api/control-desk/route.ts:62`
- `app/api/control-desk/route.ts:248`
- `hooks/useControlDesk.ts:20`
- `hooks/useInbox.ts:17`
- `components/piscine/TopBar.tsx:180`
- `hooks/useTicketOverlayData.ts:209`
- `components/desk/NowDesk.tsx:210`

**Constat**

Les deux routes dérivent pour chaque epic le dernier commentaire, la dernière session, le dernier commentaire utilisateur et le curseur de lecture, puis appliquent les mêmes prédicats hasUnreadAiComment / isAwaitingReply. La TopBar monte useInbox (5 s) sur toutes les pages pour une pastille numérique, tandis que les pages / et /projects/:id pollent /api/control-desk (4 s par défaut). Le commentaire de useControlDesk.ts:20-22 affirme que ce hook « replaces the 3s board / 5s inbox / 10s dashboard polls with ONE request » — c'est faux, le poll inbox est toujours là. Pire, /api/inbox garde la version non bornée (ROW_NUMBER sur tout ticket_comments et tout agent_sessions) que la route control-desk a justement remplacée par des scans `epic_id IN (...)` indexés après mesure (control-desk/route.ts:24-46, 289-296). Le curseur de lecture est aussi posté par trois chemins distincts (useInbox.markRead, useTicketOverlayData.ts:209, NowDesk.tsx:210).

**Précision du vérificateur**

/api/inbox (dont le SQL vit désormais dans lib/inbox/read.ts, la route n'étant plus qu'un délégateur de 15 lignes) et /api/control-desk dérivent les mêmes faits par epic (dernier commentaire, dernière session, dernier commentaire user, curseur de lecture) et appliquent les mêmes prédicats hasUnreadAiComment / isAwaitingReply (lib/inbox/read.ts:157,185 vs lib/control-desk/aggregate.ts:347,356). Les deux implémentations ont divergé : control-desk a remplacé les fenêtres ROW_NUMBER par des scans bornés `epic_id IN (…)` après mesure (app/api/control-desk/route.ts:273-296, lib/control-desk/read-model.ts:38-69), tandis que lib/inbox/read.ts:57-135 garde des ROW_NUMBER non bornés sur tout ticket_comments et tout agent_sessions plus un scan complet d'epics — sur métadonnées seulement, le mode summary=1 ayant déjà supprimé la lecture des corps. Côté client, la TopBar montée par app/layout.tsx polle /api/inbox toutes les 5 s (TopBar.tsx:180, useInbox.ts:19) pour une simple pastille numérique, alors que les pages / et /projects/:id pollent déjà /api/control-desk toutes les 4 s (NowDesk.tsx:117), payload qui porte déjà unreadAi et awaitingReply. Le commentaire hooks/useControlDesk.ts:20-22 (« replaces the 3s board / 5s inbox / 10s dashboard polls with ONE request ») est faux et contredit par TopBar.tsx:114-116. Le POST /api/inbox/read est enfin dupliqué en trois endroits : useInbox.ts:36, useTicketOverlayData.ts:212, NowDesk.tsx:210.

**Recommandation**

Faire de /api/inbox un consommateur de readEpicActivityFacts (le helper borné de control-desk) ou, plus simple, exposer `inbox: { unreadCount, unreadMessageCount, awaitingReplyCount }` dans ControlDeskPayload et faire lire la pastille TopBar depuis le poll desk quand il est monté, en ne gardant le poll /api/inbox que sur /inbox. Centraliser le POST /api/inbox/read dans un seul helper.

<details><summary>Preuve relevée par l'auditeur</summary>

app/api/inbox/route.ts:52-63 `ROW_NUMBER() OVER (PARTITION BY epic_id ORDER BY julianday(created_at) DESC …)` sur ticket_comments sans borne, :83-95 idem sur agent_sessions ; :104-120 `MAX(julianday(created_at)) … GROUP BY epic_id` sur tous les commentaires user. app/api/control-desk/route.ts:62-63 « in the shape `/api/inbox` already established », :92 « must agree with `/api/inbox`, which computes the same two signals », :289-296 « A ROW_NUMBER window would rank every comment of every epic; this ranks none … 6.2 ms -> 1.0 ms ». hooks/useControlDesk.ts:29 `intervalMs = 4000` ; hooks/useInbox.ts:17-18 `usePolledResource<InboxData>("/api/inbox", 5000, …)` ; components/piscine/TopBar.tsx:180 `const { unreadCount } = useInbox();` rendu :617 `badge={unreadCount}`. lib/control-desk/types.ts:104 `unreadAi: boolean` et :191 `awaitingReply: DeskAwaitingReply[]` existent déjà dans le payload desk.

</details>

### #78 — Pas de GET pour un seul epic : l'overlay charge toute la liste projet deux fois pour trouver un ticket

**Nature** refacto · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `app/api/projects/[projectId]/epics/[epicId]/route.ts:21-108`
- `hooks/useEpicDetail.ts:67-91`
- `hooks/useProjectEpicsList.ts:16-34`
- `hooks/useTicketOverlayData.ts:180-184`

**Constat**

app/api/projects/[projectId]/epics/[epicId]/route.ts n'exporte que PATCH et DELETE. useEpicDetail contourne l'absence de GET unitaire en récupérant `/api/projects/${projectId}/epics` (la requête lourde du finding précédent) puis `.find(row => row.id === epicId)` (useEpicDetail.ts:71 et :85). Dans le même overlay, useTicketOverlayData appelle aussi useProjectEpicsList qui refait exactement le même GET pour n'en garder que id/title/readableId (useTicketOverlayData.ts:180-184 ; useProjectEpicsList.ts:25). Un overlay ouvert sur un ticket avec session en cours déclenche donc la requête board complète deux fois à l'ouverture puis toutes les 5 s.

**Précision du vérificateur**

Il n'existe pas de `GET /api/projects/:projectId/epics/:epicId` (route.ts n'exporte que PATCH l.21 et DELETE l.86). `useEpicDetail` récupère donc l'epic en chargeant toute la liste projet — `fetch(/api/projects/${projectId}/epics)` (useEpicDetail.ts:71) puis `.find(row => row.id === epicId)` (:85) — et rejoue ce GET toutes les 5 s tant qu'une session tourne (usePolling l.120, `setPolling(isRunning)` useTicketOverlayData.ts:228). Le même overlay monte en parallèle `useProjectEpicsList` (useTicketOverlayData.ts:183) qui refait exactement le même GET (useProjectEpicsList.ts:25), sans dédoublonnage, pour n'en tirer qu'un index id→{readableId,title} et les options de dépendances (useTicketOverlayData.ts:452-462, 484-492) — le hook type pourtant id/title/status et son commentaire cite encore le DependencyEditor supprimé. Ce GET est la requête lourde du board : 9 `leftJoin` sur des sous-requêtes à window functions (epics/route.ts:364-372), filtrée uniquement par projectId (:373). Ouvrir un ticket déclenche donc deux fois la requête board complète, puis une fois toutes les 5 s (seul `useEpicDetail` poll, pas `useProjectEpicsList`).

**Recommandation**

Ajouter GET /api/projects/:id/epics/:epicId (via getEpicOr404) retournant l'epic + stories + le rapport de grading en une lecture, faire pointer useEpicDetail dessus, et passer à useProjectEpicsList une projection légère (ou l'index d'epics que le desk possède déjà via /api/control-desk).

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '^export async function' app/api/projects/[projectId]/epics/[epicId]/route.ts` → PATCH (l.21), DELETE (l.86), pas de GET. useEpicDetail.ts:71 `fetch(`/api/projects/${projectId}/epics`)`, :85 `(epicData.data || []).find((row) => row.id === epicId)`. useTicketOverlayData.ts:180 `useProjectEpicsList(projectId, activeEpicId, open)`. usePolling(fetchData, 5000, polling …) l.120 ; setPolling(isRunning) useTicketOverlayData.ts:225.

</details>

### #79 — Les faits de merge-readiness (findings ouverts + échecs de merge) sont écrits trois fois en SQL, et la projection des sessions actives deux fois

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `app/api/projects/[projectId]/epics/route.ts:222-306`
- `app/api/control-desk/route.ts:159-189`
- `app/api/control-desk/route.ts:394-478`
- `app/api/tickets/route.ts:398-480`
- `app/api/tickets/route.ts:480-520`
- `lib/control-desk/read-model.ts`
- `lib/auto-mode/select.ts:361`

**Constat**

La même paire de sous-requêtes — COUNT des review_comments ouverts filtré par blocksMergeSql(epicSessionFacts.supersessionAt), et MAX(CASE WHEN reason LIKE … ESCAPE) sur ticket_activity_log pour lastMergeConflictAt/lastConflictMarkersAt — existe dans app/api/projects/[projectId]/epics/route.ts:222-306, app/api/control-desk/route.ts:394-478 et app/api/tickets/route.ts:398-480 (un quatrième open_finding_counts vit dans lib/auto-mode/select.ts:361). La projection des sessions running/queued avec substr(last_non_empty_text) et jointures epics/userStories est copiée entre control-desk/route.ts:159-189 et tickets/route.ts:480-520. La rationalisation en cours a créé lib/control-desk/read-model.ts (non suivi) pour partager readEpicActivityFacts/readLatestFailureSessions entre desk et registre, mais ces deux blocs n'y ont pas été déplacés.

**Précision du vérificateur**

Le bloc « findings ouverts qui bloquent le merge » (COUNT sur review_comments + blocksMergeSql(epicSessionFacts.supersessionAt)) est écrit quatre fois : app/api/projects/[projectId]/epics/route.ts:228-246, app/api/control-desk/route.ts:394-409, app/api/tickets/route.ts:403-418 (exécuté en .all(), donc sans alias) et lib/auto-mode/select.ts:311-330 (alias à la l.330, pas 361). Le bloc « échecs de merge » (MAX(CASE WHEN reason LIKE … ESCAPE) sur ticket_activity_log → last_merge_conflict_at / last_conflict_markers_at) est écrit trois fois : epics/route.ts:250-295 (scope par project_id), control-desk/route.ts:417-446 et tickets/route.ts:431-462 (scope par epic_id IN toMergeIds) ; lib/auto-mode/select.ts ne le duplique PAS. La projection des sessions running/queued (substr(last_non_empty_text) + jointures epics/user_stories) est copiée entre control-desk/route.ts:159-188 et tickets/route.ts:479-512, à deux colonnes près (endedAt/completedAt côté desk) et au scope projet près (tickets borne par scopedProjectIds). lib/control-desk/read-model.ts (non suivi, créé par la rationalisation) n'exporte que lookbackCutoff, storedTimestampSince, keepLatest, readEpicActivityFacts, readLatestFailureSessions : aucun de ces deux blocs n'y a été déplacé.

**Recommandation**

Ajouter à lib/control-desk/read-model.ts un `readMergeFacts(db, epicIds)` (findings ouverts + échecs de merge, scope par epic_id IN) et un `readActiveSessionRows(db, projectIds?)`, et les consommer depuis les trois routes et lib/auto-mode/select.ts. Une seule définition des motifs LIKE et du scope, comme le doc de rationalisation l'annonce pour les autres lectures.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'open_finding_counts|latest_merge_failures' app/api lib` → epics/route.ts:244,293 ; control-desk/route.ts:409,446 ; auto-mode/select.ts:361 ; tickets/route.ts porte la même requête via .all() (mergeFailureRows l.437-480, findingRows l.398-420, lues en entier). Les trois blocs importent MERGE_CONFLICT/CONFLICT_MARKERS/MERGE_FAILURE_REASON_LIKE_PATTERNS + blocksMergeSql + epicSessionFactsCte. read-model.ts n'exporte que lookbackCutoff, storedTimestampSince, keepLatest, readEpicActivityFacts, readLatestFailureSessions.

</details>

### #84 — POST /epics : une dépendance invalide est silencieusement abandonnée avec un 201, et la validation same-project est faite deux fois

**Nature** cassé · **Impact** moyen (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `app/api/projects/[projectId]/epics/route.ts:545-575`
- `app/api/projects/[projectId]/epics/route.ts:617-626`
- `lib/dependencies/validation.ts:146-178`
- `lib/dependencies/crud.ts:22-38`

**Constat**

Dans app/api/projects/[projectId]/epics/route.ts POST, le bloc de validation des `dependencies` (l.545-575) réimplémente inline la boucle de validateSameProject (SELECT par id référencé + CrossProjectError) puis appelle validateDagIntegrity. Toute erreur autre que Cycle/CrossProject — typiquement un ticketId inexistant envoyé par l'agent de chat ou DraftedEpicCard — est attrapée, loguée et remplacée par `dependencyEdges = []` (l.571-575) ; l'epic est créé et la réponse est un 201 avec `dependenciesCreated: 0`. Le même handler explique 80 lignes plus haut (l.461-465) que « silently dropping a member and still answering 201 makes partial persistence look like success » pour les stories. Ensuite createDependencies (l.617-626) refait validateSameProject et validateDagIntegrity (lib/dependencies/crud.ts:35-38) : le graphe projet est chargé deux fois et chaque ticket référencé SELECTé deux fois, avec un second try/catch qui avale aussi l'erreur.

**Précision du vérificateur**

POST /api/projects/[projectId]/epics (app/api/projects/[projectId]/epics/route.ts, arbre courant) : l.578-614 réimplémente inline validateSameProject (lib/dependencies/validation.ts:149-178, jamais importée hors lib/dependencies/crud.ts) puis appelle validateDagIntegrity ; toute erreur autre que Cycle/CrossProject (ticket référencé inexistant) est loguée et remplacée par `dependencyEdges = []` (l.612-613), l'epic est créé et la réponse est un 201 avec `dependenciesCreated: 0` (l.768-778) — contradiction avec le commentaire l.517-519 sur les stories. Ensuite createDependencies (l.755-764, branche non-proposal) ou insertDependencies dans la transaction (l.703-711, branche proposal chat) rejouent validateSameProject + validateDagIntegrity (crud.ts:35-38) sous un second try/catch qui avale l'erreur. MAIS aucun consommateur réel n'envoie `dependencies` : DraftedEpicCard.tsx:99-110, useEpicCreate.ts:133-143, board-tools.ts:445-452 (create_ticket chat), create-bug.ts:250-256 (MCP), NowDesk/NewTicketView/EpicCreateDialog n'incluent pas le champ, et ParsedEpic (lib/epic-parsing.ts:12-16) ne porte pas de `dependencies` bien que le prompt conversation.ts:171 le demande au LLM. Le chemin n'est exercé que par __tests__/chat-epic-idempotency.test.ts:126 ou un appel HTTP brut. Finding réel comme dette (validation dupliquée, politique best-effort contradictoire, et champ `dependencies` du prompt LLM jeté côté client), pas comme bug atteignable depuis l'UI ou le MCP.

POST /api/projects/:id/epics (app/api/projects/[projectId]/epics/route.ts, arbre de travail) : le bloc l.566-614 réimplémente inline validateSameProject (lib/dependencies/validation.ts l.146-178 ; la route n'importe pas ce helper) puis appelle validateDagIntegrity (l.596). Seuls CycleError/CrossProjectError donnent un 422 ; toute autre erreur — notamment un ticketId inexistant, que createEpicSchema (lib/validation/schemas.ts l.95-98) laisse passer — est loguée et remplacée par `dependencyEdges = []` (l.612-613), l'epic est créé et la réponse est 201 avec `dependenciesCreated: 0` (l.751, l.777), alors que le même handler refuse ce principe pour les stories (l.518). Ensuite les arêtes sont revalidées une seconde fois (SELECT par ticket + rechargement du graphe) via insertDependencies → validateSameProject/validateDagIntegrity (lib/dependencies/crud.ts l.35, l.38), appelé à l.708 (chemin proposal, dans la transaction) ou l.757 (createDependencies, chemin normal), chaque fois sous un try/catch qui avale l'erreur (l.709-711, l.759-763). Précision : aucun producteur in-repo n'envoie `dependencies` — DraftedEpicCard (l.102-109) ne transmet pas ce champ et ParsedEpic (lib/epic-parsing.ts l.12) ne le porte pas, bien que le prompt conversation.ts l.171 le demande au LLM ; le chemin n'est atteignable que par un client HTTP externe ou __tests__/chat-epic-idempotency.test.ts.

**Recommandation**

Remplacer la boucle inline par validateSameProject (en tolérant l'id "$self" hors base), renvoyer un 422 explicite (`code: "DEPENDENCY_TARGET_NOT_FOUND"`) au lieu d'abandonner les arêtes, et insérer les arêtes dans la même transaction que l'epic pour ne pas revalider le graphe après coup.

<details><summary>Preuve relevée par l'auditeur</summary>

route.ts:571-575 `console.error("[epics/POST] Skipping invalid dependencies:", error); dependencyEdges = [];` puis l.686 réponse 201. route.ts:549-566 boucle `for (const referencedId of referencedIds) { db.select(...).from(epics)...; if (!referenced) throw new Error(...); if (referenced.projectId !== projectId) throw new CrossProjectError(...) }` = validation.ts:154-177 validateSameProject. `rg -l validateSameProject app lib --glob '!lib/dependencies/*'` → 0 (la route ne l'importe pas). crud.ts:35 `validateSameProject(projectId, validEdges); validateDagIntegrity(projectId, validEdges);`.

</details>

### #95 — GET /epics calcule le grading de chaque epic (fenêtre SQL + jointure) que plus aucun consommateur ne lit

**Nature** mort · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/epics/route.ts:178-202`
- `app/api/projects/[projectId]/epics/route.ts:347-349`
- `app/api/projects/[projectId]/epics/route.ts:404-406`
- `hooks/useEpicDetail.ts:71-73`
- `hooks/useTicketOverlayData.ts:506-510`
- `lib/types/kanban.ts:153-156`

**Constat**

Depuis la suppression de GradingStatusBadge (D dans l'arbre), les champs gradingStatus/gradingSummary/gradingCreatedAt renvoyés par la liste d'epics (route :178-202 ROW_NUMBER sur grading_reports, leftJoin :367, aggregate :404) n'ont aucun lecteur : le seul affichage restant (Stamp dans UserStoriesBand :87-122 via useTicketOverlayData :506-510) vient de useEpicDetail qui fait un fetch séparé `${target}/grading` (:73). Le même overlay recharge en plus toute la liste `/epics` (:71) toutes les 5 s pour retrouver une ligne — donc le grading est calculé deux fois par poll, une fois pour rien. gradingSummary peut faire 4000 chars par epic.

**Précision du vérificateur**

Confirmé, avec numéros de ligne ajustés : GET /epics calcule pour chaque epic du projet la fenêtre `ROW_NUMBER()` sur `grading_reports` (route.ts:180-203), la joint (leftJoin l. 369) et expose `gradingStatus` (agrégé l. 406), `gradingSummary` et `gradingCreatedAt` (l. 350-351) — aucun de ces trois champs n'a plus de lecteur depuis la suppression de `components/grading/GradingStatusBadge.tsx` (D dans l'arbre) et la disparition d'EpicCard/EpicDetail. Le seul affichage restant (Stamp + résumé dans `UserStoriesBand.tsx:87-122`) est alimenté par `useTicketOverlayData.ts:509-513`, qui dérive tout de `gradingReport` issu du fetch séparé `${target}/grading` de `useEpicDetail.ts:71-87`. Le même overlay recharge en plus la liste complète `/epics` toutes les 5 s pour y retrouver une seule ligne, donc le grading est recalculé deux fois par poll — une fois pour rien, et pour tous les epics du projet. Seule référence restante aux champs : le test de contrat `__tests__/epics-route.test.ts:360-361`. À noter que `gradingCreatedAt` était déjà mort avant cette rationalisation.

**Recommandation**

Retirer la sous-requête ranked_grading_reports et les trois champs de la liste (ou, inversement, supprimer le GET /grading et lire le grading sur la liste — mais pas les deux). Envisager un GET /epics/[epicId] pour que l'overlay n'ait plus à recharger toute la liste.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'gradingStatus|gradingSummary|gradingCreatedAt' app components hooks lib (hors tests) → uniquement epics/route.ts, lib/types/kanban.ts, UserStoriesBand, TicketOverlay, useTicketOverlayData — ces trois derniers lisent `gradingReport` de useEpicDetail (:87 `gradingRes.ok ? gradingData.data`), jamais `epic.gradingStatus`. git status : `D components/grading/GradingStatusBadge.tsx`.

</details>

### #197 — lib/inbox/read.ts est l'ancienne route déplacée telle quelle, pas une factorisation : trois calculs serveur du « dernier signal par ticket » avec trois politiques pour les questions de story

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:in-flight-extractions-adoption

**Fichiers**
- `lib/inbox/read.ts:31-33,57-66,88-105,165`
- `app/api/inbox/route.ts:1-14`
- `lib/control-desk/read-model.ts:38-62,88-101`
- `lib/auto-mode/select.ts:361-440`
- `hooks/useInbox.ts:20`
- `components/piscine/TopBar.tsx:180`

**Constat**

Réponse à (d) : `diff <(git show HEAD:app/api/inbox/route.ts) lib/inbox/read.ts` montre un déplacement (212 → 232 l.) avec les mêmes deux fenêtres ROW_NUMBER (read.ts:57-66 sur ticket_comments, :88-105 sur agent_sessions), toujours sans aucun prédicat de projet : la seule occurrence de `projectId` est la projection de sortie (:165). Elles sont recalculées sur toute la base toutes les 5 s par la TopBar (hooks/useInbox.ts:20 intervalle 5000, components/piscine/TopBar.tsx:180 `useInbox({ summaryOnly: true })`) et par /inbox. Le desk et le registre lisent le même signal via lib/control-desk/read-model.ts:readEpicActivityFacts (MAX-then-join scopé aux epicIds, :60-101) et Full Auto via lib/auto-mode/select.ts:361-440 (ROW_NUMBER scopé projet). Les trois divergent sur une question posée par une story : select.ts:363-366 « A story session that asked a question is the STORY's business » (`user_story_id IS NULL`), read.ts:31-33 « Parent replies also answer story questions » et fait remonter le parent dans l'inbox, read-model.ts:60-62 « Only queue parents need per-story questions ». Le finding déjà retenu (/api/inbox vs /api/control-desk) reste donc ouvert, et la doc « contrat de données partagé » ne couvre que les types (lib/inbox/types.ts) et deux helpers (isAwaitingReply, hasUnreadAiComment).

**Précision du vérificateur**

Trois calculs serveur indépendants du « dernier signal par ticket » (dernière session, dernier commentaire user, awaiting-reply) coexistent : `lib/inbox/read.ts:56-160` (deux ROW_NUMBER + deux MAX, sans aucun prédicat de projet — balayage global rejoué toutes les 5 s par la TopBar via `hooks/useInbox.ts:20` et `components/piscine/TopBar.tsx:180`, `summary=1` n'économisant que les extraits), `lib/control-desk/read-model.ts:38-160` (MAX-then-join scopé epicIds/projectIds, seul lecteur du desk et du registre via `app/api/control-desk/route.ts:290` et `app/api/tickets/route.ts:333`), et `lib/auto-mode/select.ts:367-425` (ROW_NUMBER scopées projet). Les trois attribuent différemment une question posée par une story : select.ts:363-366 la laisse à la story (`user_story_id IS NULL` sur le rang epic), read.ts:31-33 et 157-160 la fait remonter sur la ligne du parent, read-model.ts:55-56 ne descend au niveau story que pour les parents de file. La politique de réponse (thread story ou thread parent) est en revanche bien commune à read.ts:154-160 et select.ts:470-484, et le partage existant se limite aux types (`lib/inbox/types.ts`) et aux helpers `isAwaitingReply`/`hasUnreadAiComment`/`latestActivityTimestamp`. En revanche `lib/inbox/read.ts` n'est PAS l'ancienne route déplacée telle quelle : outre les imports, la signature et la pagination, le diff contre `HEAD:app/api/inbox/route.ts` sort les corps de commentaires de la requête de rang (rechargés tronqués à 4096 pour la seule page visible, l. 199-207), normalise tous les tris en `julianday`/`strftime` (l. 62-65, 93-96, 118, 135) et réécrit le calcul awaiting-reply en partitionnant par `(epicId, userStoryId)` avec la nouvelle sous-requête `latestStoryReplies` (l. 132-160).

**Recommandation**

Faire de readEpicActivityFacts (read-model.ts) l'unique lecteur du triplet dernière session / dernier commentaire user / awaiting-reply, paramétré par scope (epicIds pour le desk, projectId pour Full Auto, « tous projets, epics candidats » pour l'inbox), et n'y laisser qu'une seule règle pour les questions de story. lib/inbox/read.ts ne garderait que le tri, la pagination et l'extrait.

<details><summary>Preuve relevée par l'auditeur</summary>

`git show HEAD:app/api/inbox/route.ts | wc -l` → 212 ; `grep -c ROW_NUMBER` → 2 ; diff limité aux imports, à la signature (`export async function GET()` → `readInboxPage(db, page, pageSize, summaryOnly)`), à la pagination et au commentaire de politique. `rg -n 'ROW_NUMBER|PARTITION BY' lib app/api` → select.ts:374,406, inbox/read.ts:62,93 (+ epics/route.ts, findings.ts). `rg -n projectId lib/inbox/read.ts` → 165, 177, 211 uniquement (projection/join, pas de filtre). `rg -l 'lib/inbox/'` → seuls app/api/inbox/route.ts et hooks/useInbox.ts (types). read-model.ts importe isAwaitingReply/latestActivityTimestamp mais aucun module ne partage la requête « dernière session par cible ».

</details>

### #82 — Deux familles de routes pour éditer une story : user-stories PATCH/DELETE sans appelant dupliquent stories/[storyId]

**Nature** doublon · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `app/api/projects/[projectId]/user-stories/route.ts:88-157`
- `app/api/projects/[projectId]/stories/[storyId]/route.ts:50-117`
- `lib/validation/schemas.ts:173-189`
- `hooks/useStoryDetail.ts:79-95`

**Constat**

app/api/projects/[projectId]/user-stories/route.ts expose PATCH (l.88-129, id dans le body via updateStoryByIdSchema) et DELETE (l.131-157, id en query). Ce sont des copies de app/api/projects/[projectId]/stories/[storyId]/route.ts PATCH (l.50-99) et DELETE (l.101-117) : même applyStoryTransition, même construction incrémentale d'`updates` (title/description/acceptanceCriteria/position), même deleteUserStoryPermanently + tryExportArjiJson. Aucun client n'appelle user-stories en PATCH/DELETE ; updateStoryByIdSchema n'existe que pour ce doublon (lib/validation/schemas.ts:181-189, copie de updateStorySchema + id). Les seuls usages vivants de user-stories sont GET ?epicId (useEpicDetail.ts:72) et POST (page d'import orpheline, import/page.tsx:192).

**Précision du vérificateur**

`app/api/projects/[projectId]/user-stories/route.ts` expose un PATCH (l.88-129, id dans le body via `updateStoryByIdSchema`) et un DELETE (l.131-157, id en query) qui dupliquent PATCH (l.50-97) et DELETE (l.99-117) de `app/api/projects/[projectId]/stories/[storyId]/route.ts` : même `applyStoryTransition`, même construction incrémentale d'`updates` (title/description/acceptanceCriteria/position), même `deleteUserStoryPermanently` + `tryExportArjiJson` ; seules l'origine de l'id et le libellé d'erreur diffèrent. Aucun appelant PATCH/DELETE dans app/, components/, hooks/, lib/, bin/, e2e/ ni __tests__ ; `updateStoryByIdSchema` (lib/validation/schemas.ts:184-191) n'existe que pour ce doublon (seul autre usage : __tests__/validation-schemas.test.ts). Les usages vivants de la route sont GET ?epicId (hooks/useEpicDetail.ts:72, e2e) et POST (app/projects/import/page.tsx:192 — une route réelle `/projects/import`, pas un fichier mort, même si aucun lien in-app ne pointe dessus — et trois specs e2e). L'édition de story passe par hooks/useStoryDetail.ts:79-85.

**Recommandation**

Supprimer PATCH et DELETE de user-stories/route.ts et updateStoryByIdSchema ; ne garder de cette route que GET/POST (ou les déplacer sous epics/[epicId]/stories pour aligner la famille sur stories/[storyId]).

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'user-stories' app components hooks lib bin --glob '!app/api/**'` → hooks/useEpicDetail.ts:72 (GET), app/projects/import/page.tsx:192 (POST), commentaire lib/validation/schemas.ts:59. L'édition de story passe par hooks/useStoryDetail.ts:80 (PATCH stories/${storyId}) et app/projects/[projectId]/stories/[storyId]/page.tsx:82.

</details>

