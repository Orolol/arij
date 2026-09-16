# Lot 09 — Tickets côté client : polling, rafraîchissements, helpers partagés

**Réalisation du 11/09/2026** : changements implémentés ; [détail et état des vérifications](implementation-lots-06-08-09-15.md). Validation globale de l’arbre partagé encore non verte.

**Difficulté** 2/4 — Moyen
**Findings** 11 (0 fort · 7 moyen · 4 faible ; effort 2 S · 9 M · 0 L)
**Dépendances** Après le lot 08 (GET unitaire).

## Décision

usePolledResource + lib/api/client + useScopedMutation sont les seuls motifs autorisés ; chaque copie privée est migrée.

## Objectif

Un seul poller de /sessions/active par page, événements SSE filtrés par epicId avant de rafraîchir l'overlay, toasts de complétion dérivés du SSE, un seul useMergeBatch, lib/inbox/client.ts pour répondre/envoyer au dev/marquer lu, migration des 144 fetch bruts en commençant par les quatre copies exactes.

## Démarche suggérée

1. useAgentDispatch consomme useAgentPolling (ou usePolledResource partagé par projectId) ; supprimer le second poller.
2. ProjectDesk : filtrer par event.epicId, retirer la souscription redondante ticket:updated, retirer useAgentPolling au profit du SSE + pollTick.
3. useMergeBatch partagé NowDesk/ProjectBatchToolbar, un seul jeu de clés Desk.json.
4. lib/inbox/client.ts consommé par useInbox, NowDesk, useTicketOverlayData, /inbox.
5. Migrer useTicketsRegistry sur usePolledResource ; migrer useKeyedList/readConfigList/useUsage/fetchChatHistory sur requestJson.
6. Layout projet : projet passé en prop/contexte, plus de GET /api/projects/:id redondant.
7. Nettoyer les commentaires périmés (NowDesk requestSeq).

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #125 — Tempête de rafraîchissements sur la page projet : tout événement SSE (même sur un autre ticket) relance 5+ requêtes de l'overlay, et `ticket:updated` déclenche deux GET verify

**Nature** risque · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `app/projects/[projectId]/page.tsx:68-86,383`
- `hooks/useTicketOverlayData.ts:229-239,244-256,339-382`
- `hooks/useEpicDetail.ts:121-129`

**Constat**

ProjectDesk incrémente `refreshTrigger` sur 10 types d'événements sans filtrer `event.epicId` (y compris `session:progress`, jamais émis). Ce compteur descend dans TicketOverlay → useTicketOverlayData, où il relance `refresh()` (3 fetches dont la liste complète des epics + verify), `refreshActivity()` et l'effet de marche des sessions (`findUnifiedSession` page par page + GET session). Par ailleurs `ticket:updated` est traité deux fois pour le même ticket : useEpicDetail y répond par `fetchVerification()` et useTicketOverlayData par `refresh()` qui appelle aussi `fetchVerification()`.

**Précision du vérificateur**

Sur /projects/:id, pendant qu'un TicketOverlay est ouvert, tout événement SSE du projet (10 types, page.tsx:68-79, aucun ne lit `event.epicId` ; `session:progress` n'est jamais émis) incrémente `refreshTrigger`, transmis à useTicketOverlayData qui relance `refresh()` (GET /epics liste complète + /user-stories + /grading + /verify), `refreshActivity()` (1 GET) et la marche des sessions (`findUnifiedSession` page par page + GET session) : 6-7 requêtes par événement, même pour un autre ticket. Pour un `ticket:updated` sur le ticket ouvert, TROIS chemins indépendants (chaque useProjectEvents ouvre son propre EventSource, useProjectEvents.ts:83) se cumulent : bump de la page → refresh ; souscription propre de useTicketOverlayData.ts:250-255 → refresh + refreshActivity ; souscription de useEpicDetail.ts:121-124 → fetchVerification. Soit 3 GET /verify, 6 GET de fetchData, 2 GET activité et une marche sessions pour un seul événement. Attention : `emitTicketDependenciesChanged` (lib/events/emit.ts:72) émet `ticket:updated` sans `epicId` (ids dans `data.ticketIds`) — un filtre par `epicId` seul doit en tenir compte.

Sur `/projects/:id` (et uniquement là — le desk `/` n'alimente pas `refreshTrigger`), ProjectDesk (page.tsx:68-78) bumpe `refreshTrigger` sur 10 types d'événements SSE sans filtrer `event.epicId` (dont `session:progress`, jamais émis). Ce compteur (`refreshKey`, l.84) atteint TicketOverlay (l.383) → useTicketOverlayData, où chaque bump relance `refresh()` (4 GET : `/epics` complet, `/user-stories`, `/grading`, `/verify` — l.230), `refreshActivity()` (l.239-242) et la marche des sessions (`findUnifiedSession` page par page + GET session, l.341-382), soit 7+ requêtes par événement même sur un autre ticket ; le même `refreshKey` re-déclenche aussi useAgentPolling, AutoModeToggle et RefinementButton. Pour `ticket:updated` sur le ticket ouvert, GET `/verify` part TROIS fois (useEpicDetail.ts:121-125, useTicketOverlayData.ts:252-256 via refresh(), et le bump page → l.230), depuis trois EventSource distincts (un par appel de useProjectEvents) ; `session:completed` est pareillement traité deux fois (handler overlay l.248-251 + bump). Les réponses périmées sont écartées par `verifyRequestSeq`, l'UI reste cohérente, seul le trafic est gaspillé. Note pour le fix : `emitTicketDependenciesChanged` (lib/events/emit.ts:72) émet `ticket:updated` sans `epicId`, un filtre doit laisser passer ce cas.

**Recommandation**

Filtrer les événements par `epicId` avant de bumper l'overlay, retirer la souscription redondante à `ticket:updated` dans l'un des deux hooks, et découpler le bump du desk (qui a déjà son propre poll) de celui de l'overlay.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:69-78 : dix handlers `() => setRefreshTrigger((t) => t + 1)` sans lecture de `event.epicId`. useTicketOverlayData.ts:230 `if (refreshTrigger > 0) void refresh();`, :339 `sessionRefreshToken = `${activeSession?.id ?? ""}:${refreshTrigger}``. useEpicDetail.ts:122-124 `"ticket:updated": (event) => { if (event.epicId === epicId) void fetchVerification(); }` et useTicketOverlayData.ts:250-255 `"ticket:updated": … void refresh();` avec refresh = fetchData + fetchVerification (useEpicDetail.ts:127-129). `rg session:progress lib app` → déclaré dans bus.ts:16, jamais émis.

</details>

### #126 — `/sessions/active` pollé deux fois toutes les 3 s sur la page projet, dont une fois uniquement pour des toasts que le SSE annonce déjà

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `app/projects/[projectId]/page.tsx:68-86,240-291`
- `hooks/useAgentPolling.ts:38-88`
- `hooks/useAgentDispatch.ts:36-58`
- `components/desk/WaveRunChips.tsx:71`
- `components/chat/UnifiedChatPanel.tsx:95`
- `components/auto-mode/AutoModeToggle.tsx:57`
- `components/kanban/RefinementButton.tsx:122`
- `lib/events/emit.ts:92,106`

**Constat**

ProjectDesk garde `useAgentPolling(projectId, 3000)` dont la seule utilisation est la détection de disparition d'une session pour afficher « session completed/failed » (l.244-291, avec un GET supplémentaire par session disparue). Or la page est déjà abonnée à `session:completed` et `session:failed` via useProjectEvents, événements émis par la route build, les stages pipeline et la seconde opinion. L'overlay ouvert ajoute son propre poll 3 s du même endpoint via useAgentDispatch. Avec le control-desk (4 s), WaveRunChips (3 s), UnifiedChatPanel (3 s), AutoModeToggle et RefinementButton, la page tient au moins six minuteurs indépendants.

**Précision du vérificateur**

ProjectDesk garde useAgentPolling(projectId, 3000) (page.tsx:86) dont la seule utilisation est la détection de disparition de session pour les toasts « session completed/failed » (l.240-291, avec un GET /sessions/<id> supplémentaire par session disparue), alors que la page est déjà abonnée à session:completed/session:failed via useProjectEvents (l.74-75, pollTick de secours l.83) ; quand l'overlay est ouvert, useAgentDispatch (useAgentDispatch.ts:43,58, monté par useTicketOverlayData.ts:148) poll le MÊME endpoint /sessions/active toutes les 3 s, soit deux polls identiques concurrents. Avec useControlDesk (4 s), WaveRunChips (3 s), UnifiedChatPanel (3 s, seulement si le panneau est visible), AutoModeToggle (5 s par défaut, pas 3 s) et RefinementButton, la page tient au moins six minuteurs. Correction importante sur le remède : les seuls appelants de emitSessionCompleted/emitSessionFailed sont build/route.ts, review/route.ts, grading/dispatch.ts, stage-code.ts, stage-review.ts et second-opinion.ts — aucun pour les types chat, spec_generation, release, memory, qa, merge et refinement de UnifiedActivity. Supprimer useAgentPolling au profit du seul SSE perdrait donc les toasts de ces sessions tant que les émissions ne sont pas étendues ; la déduplication franche et sûre est le second poll de l'overlay (lire isRunning/activeSession dans le payload control-desk `working`, types.ts:189).

**Recommandation**

Dériver les toasts de complétion des événements SSE (avec le poll de secours `pollTick` déjà fourni par useProjectEvents) et supprimer useAgentPolling de la page ; faire lire `isRunning`/`activeSession` de l'overlay dans le payload control-desk (`working`) au lieu d'un second poll.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:86 `const { activities } = useAgentPolling(projectId, 3000, refreshKey);` ; `rg -n activities app/projects/[projectId]/page.tsx` → l.86, 244, 248, 251 seulement (détection de complétion). useAgentDispatch.ts:43 `fetch(`/api/projects/${projectId}/sessions/active`)` + :58 `usePolling(pollSessions, 3000)`. Émetteurs : app/api/projects/[projectId]/epics/[epicId]/build/route.ts:396-398, lib/pipeline/stage-code.ts:185-196, lib/pipeline/stage-review.ts:246-248, lib/auto-mode/second-opinion.ts:472-474.

</details>

### #127 — « Land all » (desk) et « Merge all » (toolbar de lot) : deux boucles de merge séquentiel, mêmes trois toasts dupliqués dans le catalogue, règles de sécurité différentes

**Nature** doublon · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `components/desk/NowDesk.tsx:400-466`
- `components/desk/ProjectBatchToolbar.tsx:627-675,703-723,798-851`
- `components/desk/ReadyToLandBand.tsx:692,763-780`
- `lib/i18n/messages/en/Desk.json:127-129,162-164`

**Constat**

NowDesk.handleLandAll et ProjectBatchToolbar.handleBatchMerge font la même chose (POST merge par epic, compteurs merged/agent/failed, trois toasts) ; les libellés existent en double dans Desk.json (`toasts.mergedCount…` l.127-129 et `projectDesk.mergedCount…` l.162-164, chaînes identiques). Mais la toolbar ignore `agentBusy` et `mergeReadiness` que READY TO LAND applique (`rows.filter(!row.agentBusy)`), et n'attend pas le verrou `landingInFlight` du desk : deux merges peuvent partir en parallèle sur le même dépôt depuis les deux surfaces. ProjectBatchToolbar (fichier nouveau de la rationalisation) est en plus écrit en shadcn `Button`/`Select`/`Tooltip` au lieu des primitives Piscine.

**Précision du vérificateur**

Duplication réelle du merge de lot entre `NowDesk.handleLandAll` (components/desk/NowDesk.tsx:421-446) et `ProjectBatchToolbar.handleBatchMerge` (components/desk/ProjectBatchToolbar.tsx:148-194) : même POST par epic, mêmes compteurs, mêmes trois toasts, avec deux jeux de clés i18n identiques (lib/i18n/messages/en/Desk.json:134-136 `toasts.*` et :169-171 `projectDesk.*`). Les deux surfaces sont montées ensemble sur la page projet (app/projects/[projectId]/page.tsx:353 et :363) et n'ont pas de verrou commun (`landingInFlight` NowDesk.tsx:422 vs `batchBusy` ProjectBatchToolbar.tsx:149), et `lib/git/manager.ts` ne sérialise pas côté serveur : deux merges concurrents sur le même dépôt sont possibles. La toolbar boucle sur `batch.allSelected` sans le filtre `!row.agentBusy` qu'applique ReadyToLandBand.tsx:114 ; en revanche `mergeReadiness` n'est appliqué par AUCUNE des deux surfaces (seule la garde serveur `applyTransition` de app/api/projects/[projectId]/epics/[epicId]/merge/route.ts:74-80 impose to_merge). Nuances : les numéros de ligne cités pour ProjectBatchToolbar (627-851) et ReadyToLandBand (692-780) correspondent à l'ancien app/projects/[projectId]/page.tsx commité, pas à l'arbre (fichiers de 385 et 215 lignes) ; et le code shadcn (`@/components/ui/{button,select,tooltip}`, ProjectBatchToolbar.tsx:8-21) comme les clés dupliquées préexistent dans HEAD — la rationalisation n'a fait que les extraire, elle ne les a pas introduits. Différence fonctionnelle à préserver dans tout hook partagé : NowDesk poste `{}` tandis que la toolbar poste `{ autoAgent }`.

**Recommandation**

Extraire un hook `useMergeBatch(rows)` partagé (verrou, boucle, toasts, filtrage des rows non-landables), supprimer l'un des deux jeux de clés i18n, et réécrire la toolbar avec PillButton/SelectPill.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "mergedCount|mergeFixAgentCount|mergesFailed" lib/i18n/messages/en/Desk.json` → deux jeux de clés aux mêmes valeurs. ProjectBatchToolbar.tsx:635-658 boucle `for (const epicId of batch.allSelected)` sans test de readiness ; NowDesk.tsx:427-428 `if (landingInFlight.current) return;` n'est pas partagé. ProjectBatchToolbar.tsx:8,15 importent `@/components/ui/button` et `@/components/ui/select`.

</details>

### #131 — usePolledResource n'a pas remplacé le motif fetch+setState : useTicketsRegistry réimplémente sa garde requestSeq/appliedSeq, et son `loading` n'est lu par personne

**Nature** doublon · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `components/tickets-registry/useTicketsRegistry.ts:70-136`
- `components/tickets-registry/TicketsRegistryView.tsx:103`
- `components/tickets-registry/RegistryTable.tsx:1108`
- `hooks/usePolledResource.ts`
- `hooks/useEpicActivity.ts:44-58`
- `hooks/useTicketComments.ts:62-75`
- `hooks/useEpicPr.ts:27-38`
- `hooks/useEpicDependencies.ts:31-47`

**Constat**

La rationalisation a introduit usePolledResource (dernier snapshot conservé, lectures ordonnées, invalidation à la mutation) et l'a branché sur 7 consommateurs. Mais 15 sites appellent encore usePolling avec leur propre fetch/try/catch silencieux : useTicketsRegistry recopie à la main la même garde `requestSeqRef/appliedSeqRef` (~50 lignes) et le trio data/loading/error, useEpicActivity, useTicketComments, useEpicPr et useEpicDependencies avalent toute erreur réseau (`catch { /* silently fail */ }`) sans état d'erreur. Le `loading` calculé par useTicketsRegistry n'est pas destructuré par TicketsRegistryView : pendant le premier chargement le registre affiche un tableau vide (`tickets-empty`) au lieu d'un état de chargement.

**Précision du vérificateur**

Duplication résiduelle réelle mais périmètre surévalué. Faits vérifiés : (1) `components/tickets-registry/useTicketsRegistry.ts:70-71,93` réimplémente à la main la garde `requestSeqRef/appliedSeqRef` qu'offre déjà `hooks/usePolledResource.ts:26-28,50-52`, avec son propre trio data/loading/error et `usePolling(load, POLL_INTERVAL_MS)` en :141 ; (2) `components/tickets-registry/TicketsRegistryView.tsx:103` ne destructure pas `loading`, donc pendant le premier chargement `data` est null → `EMPTY_ROWS` (:399) → `RegistryTable.tsx:158` rend `data-testid="tickets-empty"` au lieu d'un état de chargement ; (3) seuls DEUX hooks avalent silencieusement les erreurs réseau — `hooks/useEpicActivity.ts:47-58` et `hooks/useTicketComments.ts:62-73` (`catch { // silently fail on poll }`), c'est l'exhaustif de `rg "silently fail"`. Corrections : `useEpicPr` et `useEpicDependencies` sont DÉJÀ migrés sur `usePolledResource` (useEpicPr.ts:6,36-38 ; useEpicDependencies.ts:6,36-38) et exposent un `error` — les citer comme sites fautifs est faux ; les consommateurs de `usePolledResource` sont 19, pas 7 ; la référence `RegistryTable.tsx:1108` est inexistante (fichier de 257 lignes).

**Recommandation**

Migrer useTicketsRegistry sur usePolledResource (URL mémoïsée + intervalle 10 s) et exposer `loading` au tableau ; convertir progressivement useEpicActivity/useTicketComments/useEpicPr/useEpicDependencies vers le même hook pour obtenir un état d'erreur uniforme.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "usePolling\(" app components hooks` → 15 sites hors usePolledResource ; `rg -n usePolledResource app components hooks` → 7 consommateurs. useTicketsRegistry.ts:70-71 `requestSeqRef/appliedSeqRef` + :93 `const stale = () => …` vs usePolledResource.ts:26-28,67. TicketsRegistryView.tsx:103 `const { data, error, setWindow, refresh } = useTicketsRegistry(...)` — pas de `loading`.

</details>

### #132 — Le triplet répondre / envoyer au dev / marquer lu est implémenté trois fois (desk, hook inbox, page inbox), avec `POST /api/inbox/read` écrit à la main en trois endroits

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `app/inbox/page.tsx:50-276`
- `hooks/useInbox.ts:22-60`
- `components/desk/NowDesk.tsx:210-283`
- `components/desk/AttentionRow.tsx:147-257`
- `hooks/useTicketOverlayData.ts:205-219`

**Constat**

La page `/inbox` (conservée « globale » par la rationalisation) reste un second YOUR TURN en shadcn (Button, Textarea, `bg-priority-yellow`) : InboxRow refait `handleReply`, `handleMarkRead`, `handleSendToDev` que AsksYouRow/NowDesk portent déjà (`handleReply`, `handleSendToDev`, dismiss), tandis que useInbox porte une troisième version de reply+markRead. Le POST du curseur de lecture est recopié dans useTicketOverlayData, useInbox et NowDesk, avec trois politiques d'erreur différentes (best-effort silencieux / throw / `.catch(() => {})`).

**Précision du vérificateur**

La page `/inbox` reste un second YOUR TURN en shadcn (`app/inbox/page.tsx:14-15` Button/Textarea, `bg-priority-yellow` l.166 et l.317) : `InboxRow` refait `handleReply` (l.81), `handleMarkRead` (l.100) et `handleSendToDev` (l.116) que `AsksYouRow` (`components/desk/AttentionRow.tsx:160-257`) et `NowDesk` (`handleReply` l.191, `handleSendToDev` l.226) portent déjà, tandis que `hooks/useInbox.ts:34-60` porte une troisième version de reply+markRead. Le POST du curseur de lecture est écrit à la main en trois endroits avec trois politiques d'erreur : `hooks/useTicketOverlayData.ts:212` (try/catch silencieux), `hooks/useInbox.ts:36` (throw), `components/desk/NowDesk.tsx:210` (`.catch(() => {})`). Correction des preuves : la ligne `app/inbox/page.tsx:683-690` n'existe pas (fichier de 382 lignes) et les deux dispatches ont DIVERGÉ, ce n'est pas le même POST — `app/inbox/page.tsx:126` envoie `{ comment }` à `/build`, alors que `NowDesk.tsx:248-251` poste le message comme commentaire séparé puis appelle `/build` avec `{ namedAgentId }` ; la page ignore donc l'agent nommé et le desk ignore le paramètre `comment` de la route. Le répertoire non suivi `lib/inbox/` (read.ts, types.ts) ne factorise que la lecture serveur et les types, pas les mutations client.

**Recommandation**

Extraire `lib/inbox/client.ts` (`markRead`, `replyToEpic`, `sendToDev`) consommé par useInbox, NowDesk et useTicketOverlayData ; faire rendre les lignes de `/inbox` par AsksYouRow (ou décider de retirer la page au profit du desk + TopBar inbox).

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "api/inbox/read" app components hooks` → useTicketOverlayData.ts:209, useInbox.ts:24, NowDesk.tsx:229 (+ commentaire app/inbox/page.tsx:98). `rg -n "@/components/ui/(button|textarea)" app/inbox` → 2 imports. NowDesk.tsx:267-271 et app/inbox/page.tsx:683-690 : même POST build avec `comment`.

</details>

### #153 — Deux pollers concurrents de /sessions/active à 3 s dès que l'overlay ticket est ouvert sur la page projet

**Nature** risque · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `hooks/useAgentPolling.ts:60-76`
- `hooks/useAgentDispatch.ts:36-58`
- `hooks/useTicketOverlayData.ts:120-147`
- `app/projects/[projectId]/page.tsx:86`
- `app/projects/[projectId]/page.tsx:244-251`
- `app/api/projects/[projectId]/sessions/active/route.ts:263-267`

**Constat**

La page projet monte useAgentPolling (fetch /sessions/active toutes les 3 s) et useTicketOverlayData monte useAgentDispatch, qui lance son propre usePolling(pollSessions, 3000) sur la même URL dès qu'un epicId est actif (overlay ouvert). Les deux hooks ne partagent ni cache ni requête en vol, et la route fait par session running un lookup lastSessionChunkAt (getSessionLastActivityAt) sur la connexion better-sqlite3 synchrone. La page projet n'utilise d'ailleurs le payload que pour comparer les ids (détection de fin), tandis que l'overlay filtre le même payload par epicId. La rationalisation a factorisé le polling du desk/QA/inbox dans usePolledResource mais pas celui-ci.

**Précision du vérificateur**

Sur /projects/:id, l'ouverture de l'overlay ticket crée un second poller de `/api/projects/:id/sessions/active` à 3 s : la page monte useAgentPolling (hooks/useAgentPolling.ts:65,76 ; page.tsx:86) et TicketOverlay → useTicketOverlayData (:120,:148) → useAgentDispatch (hooks/useAgentDispatch.ts:43,58) qui fetch la même URL dès que activeEpicId est non nul, sans cache, sans AbortController ni requête partagée (usePolling.ts = un setInterval par appelant ; usePolledResource.ts n'est utilisé par aucun des deux). La page n'exploite le payload que pour `activities.map(a => a.id)` (page.tsx:244-251, détection de complétion pour toasts) alors que le SSE émet déjà `session:completed`/`session:failed` avec sessionId (lib/events/emit.ts:92,106) auxquels la page est abonnée (page.tsx:72-73) ; useAgentPolling re-fetch en plus à chaque refreshKey (page.tsx:78-82). Côté serveur, chaque appel fait par session running un `getSessionLastActivityAt` → `lastSessionChunkAt` synchrone (route.ts:264 ; lib/agents/watchdog.ts:93-108, PAS 459-486 ; lib/agent-sessions/chunks.ts:740). Les références WaveRunChips:71, UnifiedChatPanel:95, AutoModeToggle:57, RefinementButton:122 concernent d'autres URLs et ne font pas partie du doublon. La rationalisation (doc l.45) n'a retiré que la lecture de l'historique dans useAgentPolling ; le doublon reste ouvert.

Sur /projects/:id avec l'overlay ticket ouvert, /api/projects/:id/sessions/active est pollé par deux hooks indépendants toutes les 3 s : useAgentPolling (page.tsx:86 ; payload utilisé seulement pour la liste d'ids, page.tsx:244-251) et useAgentDispatch (via TicketOverlay:107 → useTicketOverlayData:139-148 → useAgentDispatch.ts:43,58, sans abort ni garde de vol), sans cache partagé (ni l'un ni l'autre n'utilise usePolledResource). Chaque appel exécute getSessionLastActivityAt → lastSessionChunkAt par session running (sessions/active/route.ts:264 → watchdog.ts:93-115, l.108 — pas :459-486, le fichier fait 289 lignes). Le desk ajoute un troisième lookup identique toutes les 4 s via /api/control-desk (NowDesk.tsx:117, control-desk/route.ts:197), et chaque SSE session:completed déclenche en plus un refetch de /sessions/active des deux côtés (useAgentPolling.ts:78-82 ; useTicketOverlayData.ts:243-247). WaveRunChips.tsx:71 et UnifiedChatPanel.tsx:95 pollent d'autres URLs et sont hors périmètre.

Sur /projects/:id, dès que l'overlay ticket est monté (page.tsx:378-382, `open` forcé), deux GET /api/projects/:id/sessions/active tournent à 3 s sans partage : useAgentPolling (hooks/useAgentPolling.ts:65,76, seul appelant page.tsx:86, qui n'en lit que les ids l.244-251 pour les toasts de fin) et useAgentDispatch (hooks/useAgentDispatch.ts:43,58) via useTicketOverlayData.ts:120,139-148 avec epicId = activeEpicId. Chaque requête fait, par session running, un `max(createdAt)` synchrone sur agent_session_chunks (route.ts:264 → lib/agents/watchdog.ts:93-113 → lib/agent-sessions/chunks.ts:698-699,740 ; pas « watchdog.ts:459-486 »). Les SSE session:completed/failed (page.tsx:74-75) ne servent qu'à re-déclencher le poll. usePolledResource (nouveau) n'est utilisé par aucun des deux hooks ; la rationalisation n'a touché qu'au chargement d'historique (doc l.46).

Sur /projects/:id, dès qu'un ticket est ouvert dans l'overlay, deux pollers indépendants frappent GET /api/projects/:id/sessions/active toutes les 3 s : useAgentPolling (page.tsx:86 → hooks/useAgentPolling.ts:65,76) et useAgentDispatch monté par useTicketOverlayData (hooks/useTicketOverlayData.ts:120,148 → hooks/useAgentDispatch.ts:43,58). Ce sont les deux seuls appelants client de cette URL ; ils ne partagent ni état ni requête en vol (usePolling = setInterval brut), et useAgentPolling re-polle en plus à chaque événement SSE (page.tsx:78-82). La page n'exploite le payload que pour diffuser les ids disparus (page.tsx:244-251) tandis que l'overlay le filtre par epicId. Côté serveur, la route (sessions/active/route.ts:264) appelle getSessionLastActivityAt (lib/agents/watchdog.ts:93-118, et non 459-486) qui exécute une requête préparée max(createdAt) sur agent_session_chunks (lib/agent-sessions/chunks.ts:424-426,698-699) par session running, sur better-sqlite3 synchrone. Le doublon n'existe que sur la page projet : sur /, /tickets, /qa, /chat l'overlay est monté via TicketOverlayProvider sans useAgentPolling. La rationalisation (usePolledResource) n'a pas touché ce couple. Les autres sites cités (WaveRunChips:71, UnifiedChatPanel:95, AutoModeToggle:57, RefinementButton:122) pollent d'autres URLs et ne font pas partie du doublon.

**Recommandation**

Faire consommer à useAgentDispatch le résultat de useAgentPolling (via props/contexte ou un usePolledResource partagé par clé projectId) et ne garder qu'un poller ; ou au minimum désactiver le poll de useAgentDispatch (usePolling enabled=false) quand la page hôte poll déjà.

<details><summary>Preuve relevée par l'auditeur</summary>

useAgentPolling.ts:65 fetch(`/api/projects/${projectId}/sessions/active`) + :76 usePolling(poll, intervalMs=3000) ; useAgentDispatch.ts:43 même URL + :58 usePolling(pollSessions, 3000) ; useTicketOverlayData.ts:139-147 appelle useAgentDispatch avec epicId = activeEpicId (non null quand open). page.tsx:86 useAgentPolling(projectId, 3000, refreshKey) et :244-251 n'exploitent que activities.map(a => a.id). sessions/active/route.ts:264 getSessionLastActivityAt(row) → watchdog.ts:459-486 appelle lastSessionChunkAt(session.id) pour chaque running.

</details>

### #194 — Helpers clients livrés mais adoptés à un tiers : 144 fetch bruts dans 64 fichiers, et quatre copies privées du contrat de usePolledResource/requestJson

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:in-flight-extractions-adoption

**Fichiers**
- `lib/api/client.ts`
- `hooks/usePolledResource.ts`
- `hooks/useAgentConfig.ts:49-101`
- `hooks/useUsage.ts:38-79`
- `lib/chat/client.ts:33-42`
- `components/desk/NowDesk.tsx:196-625`
- `hooks/usePipelineRuns.ts:74-87`
- `hooks/useEpicActivity.ts:46-61`
- `hooks/useTicketComments.ts:62-77`
- `hooks/useNightRuns.ts:40-65`
- `hooks/useAgentDispatch.ts:43-58`
- `components/desk/WaveRunChips.tsx:62-71`

**Constat**

lib/api/client.ts (requestJson/fetchJson), hooks/useScopedMutation.ts et hooks/usePolledResource.ts existent, mais l'arbre garde 144 `fetch(` bruts dans 64 fichiers de hooks/components/app (hors app/api) : 25 fichiers importent lib/api/client, 11 useScopedMutation, 20 usePolledResource. Les gros foyers n'en utilisent aucun : components/desk/NowDesk.tsx (14 fetch, absent des importeurs de lib/api/client), hooks/useAgentConfig.ts (14), hooks/useTicketOverlayData.ts (6), hooks/useEpicDetail.ts (5), components/qa/QaScreen.tsx (5). Quatre sites réimplémentent exactement le contrat du helper : hooks/useAgentConfig.ts:69-101 (`useKeyedList` : requestSeq + generation + « dernière liste valide conservée », c'est usePolledResource sans intervalle) et :49-58 (`readConfigList` = requestJson), hooks/useUsage.ts:38-79 (importe requestJson mais recopie requestSeq et l'invalidation au démontage), lib/chat/client.ts:33-42 (`fetchChatHistory` importe le type ApiResult mais réécrit requestJson à la main), plus useTicketsRegistry déjà connu. Sept pollers restent sur usePolling + fetch + setState sans aucune garde d'ordre et avec `catch {}` silencieux, à rebours du « erreurs visibles » annoncé : hooks/usePipelineRuns.ts:74-87, hooks/useEpicActivity.ts:46-61, hooks/useTicketComments.ts:62-77, hooks/useNightRuns.ts:40-65, hooks/useAgentDispatch.ts:43-58, hooks/useAgentPolling.ts:65-76, components/desk/WaveRunChips.tsx:62-71.

**Précision du vérificateur**

Les helpers clients non suivis (lib/api/client.ts, hooks/usePolledResource.ts, hooks/useScopedMutation.ts) ne sont adoptés que partiellement : 144 `fetch(` bruts dans 64 fichiers hors app/api, contre 25 importeurs de lib/api/client, 20 consommateurs de usePolledResource et 11 de useScopedMutation. Les plus gros foyers n'en utilisent aucun : components/desk/NowDesk.tsx (14 fetch), hooks/useAgentConfig.ts (14), hooks/useTicketOverlayData.ts (6), hooks/useEpicDetail.ts (5), components/qa/QaScreen.tsx (5). Réimplémentations du contrat : hooks/useAgentConfig.ts:51-58 (`readConfigList` = requestJson) et :69-100 (`useKeyedList` = usePolledResource sans intervalle, même requestSeq/generation/dernière-valeur-conservée) ; lib/chat/client.ts:33-42 (`fetchChatHistory` importe le type ApiResult puis refait requestJson, avec un comportement d'erreur divergent en catch) ; hooks/useAgentDispatch.ts:60-74 (fonction locale littéralement nommée `requestJson` pour les POST) ; plus les gardes d'ordre recopiées dans hooks/useEpicDetail.ts, components/tickets-registry/useTicketsRegistry.ts, components/desk/NowDesk.tsx et hooks/useUsage.ts:38-79 (celui-ci importe déjà requestJson et ne duplique que l'ordonnancement, le reste étant un contrat range/fresh délibéré). Cinq pollers — et non sept — restent sur usePolling + fetch + setState sans numéro de requête : hooks/usePipelineRuns.ts:74-85, hooks/useEpicActivity.ts:46-59, hooks/useTicketComments.ts:62-74, hooks/useAgentDispatch.ts:42-57, components/desk/WaveRunChips.tsx:59-70 (usePolling ne sérialise pas les appels). À retirer de la liste : hooks/useAgentPolling.ts:55-74, qui possède déjà une garde (AbortController + vérification de scope + `signal.aborted`), et hooks/useNightRuns.ts:38-53, qui remonte l'erreur via setError et ne manque que l'ordonnancement ; le silence de usePipelineRuns et WaveRunChips est par ailleurs documenté comme un choix (chips décoratives).

**Recommandation**

Faire migrer d'abord les quatre copies exactes (useKeyedList/readConfigList → usePolledResource(url, null) + requestJson ; useUsage → usePolledResource avec refresh ; fetchChatHistory → requestJson avec validateData Array.isArray) puis les sept pollers usePolling+fetch vers usePolledResource(url, intervalMs, …). Ajouter un test-linter (comme react-compiler-coverage) qui liste les fichiers autorisés à appeler `fetch(` directement, pour que le nombre ne remonte pas.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -c '\bfetch\(' hooks components app --glob '!app/api/**'` → 64 fichiers, 144 occurrences. `rg -l '@/lib/api/client'` (hors tests) → 25 fichiers, NowDesk/useAgentConfig/useTicketOverlayData/QaScreen absents. `rg -n 'requestSeq|generation.current'` hors usePolledResource → useEpicDetail.ts:64-90, useUsage.ts:38-79, useAgentConfig.ts:73-98, useTicketsRegistry.ts:70-114. useAgentConfig.ts:69-101 : `const generation = useRef(0); const requestSeq = useRef(0); … if (issuedGeneration !== generation.current || request !== requestSeq.current) return false;` — même algorithme que usePolledResource.ts:32-58. lib/chat/client.ts:2 `import type { ApiResult } from "@/lib/api/client"` puis :33-42 `fetchChatHistory` refait fetch + response.json + `body.error || errorMessage`. usePipelineRuns.ts:75-84 : `try { const res = await fetch(...); if (Array.isArray(json?.data)) setRuns(...) } catch { // ignore }` sans numéro de requête.

</details>

### #135 — ProjectDesk : cinq deep-links consommés par cinq copies du même motif, dont `?panel=` géré deux fois (état + ref)

**Nature** refacto · **Impact** faible · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `app/projects/[projectId]/page.tsx:115-238,170-203`

**Constat**

La page projet (433 lignes, 17 useState, 7 useEffect) répète pour `deleted`, `ticket`, `panel`, `night`, `nightRun` le même couple « setState pendant le rendu si la valeur change » + « useEffect consumeQueryParam ». Pour `panel` il y a en plus un second garde par ref (`handledPanelParam`) parce que deux valeurs ouvrent des dialogues d'état et deux autres appellent une méthode impérative du chat panel. Le composant mélange donc routage d'URL, toasts, détection de complétion et six dialogues.

**Précision du vérificateur**

La page projet `app/projects/[projectId]/page.tsx` fait **479 lignes** (et non 433) après la rationalisation non commitée, avec 17 `useState` et 7 `useEffect` (comptes exacts). Elle répète pour `deleted` (l.117-143), `ticket` (l.151-162), `panel` (l.170-203), `night` (l.207-221) et `nightRun` (l.224-238) le même couple « garde de rendu setState si la valeur change » + « useEffect consumeQueryParam ». Trois de ces blocs (`ticket`, `night`, `nightRun`) sont strictement identiques et extractibles tels quels ; `deleted` ajoute un état de notice dérivé plus une branche de dismiss (l.131-133) et `panel` ajoute un second garde par ref (`handledPanelParam` l.170, testé l.193-194) parce que deux valeurs ouvrent des dialogues d'état (rendu, l.178-185) et deux autres appellent des méthodes impératives du chat panel (`openChat`/`openNewEpic`, l.196-200). Le composant mélange routage d'URL, pile de toasts, détection de complétion de session (l.242-291) et six surfaces modales (`EpicCreateDialog` l.413, `BugCreateDialog` l.424, `NightRunDialog` l.436, `AutoModeDialog` l.448, `NightRunSummaryDialog` l.468, `TicketOverlay`). Un hook `useConsumedQueryParam` servirait aussi `app/projects/[projectId]/qa/page.tsx:83`, qui appelle déjà `consumeQueryParam`.

**Recommandation**

Extraire un hook `useConsumedQueryParam(name, onValue)` (render-phase reset + consumeQueryParam) et regrouper les dialogues dans un sous-composant `ProjectDeskDialogs`.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:118-143 (`deleted`), :152-162 (`ticket`), :170-203 (`panel`, avec `handledPanel` l.176 ET `handledPanelParam` l.170), :208-221 (`night`), :225-238 (`nightRun`).

</details>

### #144 — Le même projet est chargé plusieurs fois par route : la liste /api/projects est pollée par trois hooks indépendants et le layout projet refait un GET /api/projects/:id pour deux champs déjà dans la liste

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `hooks/useProjects.ts:12`
- `components/piscine/TopBar.tsx`
- `app/projects/[projectId]/layout.tsx:70`
- `app/api/projects/route.ts:73`
- `app/projects/[projectId]/git-sync/page.tsx:112`
- `components/spec/SpecWorkspace.tsx:52`
- `hooks/useGitHubConfig.ts:12`

**Constat**

useProjects() (hooks/useProjects.ts:12-19, usePolledResource sur /api/projects) est instancié séparément dans components/piscine/TopBar.tsx, components/tickets-registry/NewTicketView.tsx et components/agents-workshop/ScopeSwitcher.tsx — aucun contexte partagé, donc jusqu'à deux lectures de la liste par écran. ProjectShell (app/projects/[projectId]/layout.tsx:70) refait un `fetch(/api/projects/${projectId})` pour extraire gitRepoPath et githubOwnerRepo, que GET /api/projects (app/api/projects/route.ts:73-74) renvoie déjà à la TopBar. La même ligne projet est encore relue par git-sync/page.tsx:112, SpecWorkspace.tsx:52, hooks/useGitHubConfig.ts:12 et hooks/useTicketOverlayData.ts:287. Aucun de ces lecteurs n'est en erreur, mais le shell n'offre aucun « projet actif » aux écrans, alors que CLAUDE.md fait de TopBar le seul chrome monté par app/layout.tsx.

**Précision du vérificateur**

Aucune source partagée pour la liste des projets ni pour le « projet actif » : `useProjects()` (hooks/useProjects.ts:12-19) est instancié séparément par TopBar.tsx:179, NewTicketView.tsx:64 et ScopeSwitcher.tsx:28, ce qui fait jusqu'à deux lectures de /api/projects par écran (TopBar est monté globalement). Ce ne sont pas des polls : `usePolledResource` reçoit `intervalMs = null`, donc une lecture au montage, plus une revalidation de TopBar à chaque changement de route (TopBar.tsx:190-199) — le coût est du trafic dupliqué au montage/navigation, pas une boucle. En plus, ProjectShell (app/projects/[projectId]/layout.tsx:70) refait un GET /api/projects/:id pour n'extraire que `gitRepoPath` et `githubOwnerRepo`, tous deux déjà renvoyés par GET /api/projects (app/api/projects/route.ts:73-74) : celle-là est bien redondante. Les autres relectures de la ligne projet — SpecWorkspace.tsx:58 (spec), useTicketOverlayData.ts:290 (name/colorIndex), useGitHubConfig.ts:12 (monté 4 fois : RepoStrataBand.tsx:62, releases/page.tsx:59, github-issues/page.tsx:97, useTicketOverlayData.ts:179), git-sync/page.tsx:112 — ne sont pas toutes substituables : git-sync a besoin de `defaultBranch`, absent du select de la liste. Reste un refactor de confort (contexte projets + `activeProject` dérivé de l'URL), pas un défaut de correction.

**Recommandation**

Monter un ProjectsProvider dans app/layout.tsx (liste chargée une fois, rafraîchie par un seul poll, `activeProject` dérivé de l'URL) ; TopBar, ProjectShell, ScopeSwitcher, NewTicketView et GitHubConnectBanner lisent le contexte ; ne garder GET /api/projects/:id que pour les écrans qui ont besoin des champs longs (spec, mémoire).

<details><summary>Preuve relevée par l'auditeur</summary>

rg -l "useProjects\(" app components hooks → TopBar.tsx, NewTicketView.tsx, ScopeSwitcher.tsx ; rg -n 'fetch\(`/api/projects/\$\{projectId\}`' app components hooks → 7 sites (dont layout.tsx:70) ; rg -n "gitRepoPath|githubOwnerRepo" app/api/projects/route.ts → sélectionnés L73-74.

</details>

### #195 — useScopedMutation livré avec, dans le même commit, trois nouvelles réécritures du même verrou scope/pending

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:in-flight-extractions-adoption

**Fichiers**
- `hooks/useScopedMutation.ts:6-27`
- `hooks/useEpicCreate.ts:30-52,183-190`
- `components/agents-workshop/useAssignmentMutation.ts:11-45`
- `hooks/useDocumentUploads.ts:17`
- `components/chat-page/DraftedEpicCard.tsx:132-162`

**Constat**

La rationalisation introduit hooks/useScopedMutation.ts (un `scope` mémoïsé, un ref `active`, un Set `pending`, résultat ignoré si le scope a changé) et, dans les mêmes fichiers non commités, réécrit ce motif trois fois au lieu de l'appeler : hooks/useEpicCreate.ts:30-52 (`owner`/`activeOwner`/`pending: Set<string>`, `if (activeOwner.current !== owner || pending.current.has(scope)) return null`), components/agents-workshop/useAssignmentMutation.ts:11-45 (variante par rôle : `active.current`, `scope.pending: Set<AgentType>`, `if (active.current !== scope) return`), hooks/useDocumentUploads.ts:17 (`const busy = useRef(false)`). components/chat-page/DraftedEpicCard.tsx:132-162 gère son propre `setPending("dev"|"backlog")` sans verrou. Le helper n'a donc que 11 importeurs alors que les nouveaux hooks de la même passe en avaient besoin.

**Précision du vérificateur**

Sur les quatre sites cités, un seul est un vrai quasi-doublon de hooks/useScopedMutation.ts : hooks/useEpicCreate.ts:30-34,49-51 (` M`, motif scope/owner/activeOwner/pending ajouté par la même passe non commitée). Encore n'est-il pas substituable tel quel — son état est un Record par scope conservé au changement de conversation (ligne 34, commentaire ligne ~184), là où le helper n'a qu'un slot et masque l'état hors scope. components/agents-workshop/useAssignmentMutation.ts:11-45 est une variante par rôle (Set<AgentType>, savingRoles[], errors par rôle) qui doit autoriser deux rôles concurrents — interdit par le `pending` booléen unique du helper, et épinglé par __tests__/agent-assignment-mutation.test.tsx ; l'auditeur admet qu'il faudrait étendre le helper. hooks/useDocumentUploads.ts:17 n'est qu'un `useRef(false)` de ré-entrance sans clé ni invalidation de scope (et la clé recommandée `${projectId}:${conversationId}` n'existe pas : le hook ne reçoit pas de conversationId). components/chat-page/DraftedEpicCard.tsx:132-162 est hors sujet : son `pending` est antérieur à la passe (le diff du fichier ne touche aucune ligne `pending`) et ne sert qu'à changer le libellé des boutons (lignes 224/233/244). Enfin la preuve « les quatre fichiers sont ?? » est fausse : useEpicCreate.ts et DraftedEpicCard.tsx sont ` M`. Le helper compte 10 fichiers importateurs / 11 sites d'appel.

**Recommandation**

Rebaser useEpicCreate et useDocumentUploads sur useScopedMutation(`${projectId}:${conversationId}`) ; étendre useScopedMutation d'une clé secondaire optionnelle (`run(op, fallback, subKey)`) pour couvrir le cas par rôle de useAssignmentMutation, puis supprimer ce dernier.

<details><summary>Preuve relevée par l'auditeur</summary>

useScopedMutation.ts:7-9 `const scope = useMemo(() => ({ key }), [key]); const active = useRef(scope); const pending = useRef(new Set())` ; :17 `if (!key || active.current !== scope || pending.current.has(scope)) return null;`. useEpicCreate.ts:31-34 `const owner = useMemo(() => ({ scope }), [scope]); const activeOwner = useRef(owner); const pending = useRef(new Set<string>())` ; :50 `if (activeOwner.current !== owner || pending.current.has(scope)) return null;`. useAssignmentMutation.ts:12 `const active = useRef<{ key; pending: Set<AgentType> } | null>(null)` ; :27 `if (!scope || scope.key !== scopeKey || scope.pending.has(role)) return;` ; :43 `if (active.current !== scope) return;`. `git status --porcelain` : les quatre fichiers sont `??` (créés par la même passe).

</details>

### #198 — NowDesk documente des gardes requestSeq/mutationSeq que useControlDesk n'a plus

**Nature** refacto · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:in-flight-extractions-adoption

**Fichiers**
- `components/desk/NowDesk.tsx:307-311`
- `hooks/useControlDesk.ts:7,43`
- `hooks/usePolledResource.ts:32-58`

**Constat**

components/desk/NowDesk.tsx:307-311 justifie le choix d'un `refresh()` plutôt qu'un état local par « useControlDesk's requestSeq/mutationSeq guards make the refresh win against the in-flight 4s poll ». Depuis la rationalisation, hooks/useControlDesk.ts délègue tout à usePolledResource (:7, :43) et ne contient plus ni requestSeq ni mutationSeq ; la garantie invoquée existe encore (generation/appliedSeq de usePolledResource.ts:32-58) mais sous un autre nom et dans un autre fichier. Un lecteur qui vérifie le commentaire conclut à tort qu'il est faux et risque de réintroduire un hidden-set local.

**Précision du vérificateur**

components/desk/NowDesk.tsx:307-311 justifie le `refresh()` optimiste par « `useControlDesk`'s requestSeq/mutationSeq guards ». Depuis la rationalisation non commitée, hooks/useControlDesk.ts ne contient plus aucun de ces identifiants : il délègue tout à `usePolledResource` (:7 import, :43 appel). Le mécanisme survit dans hooks/usePolledResource.ts, où `requestSeq` et `appliedSeq` gardent leur nom (:30-31) mais où `mutationSeq` est remplacé par `generation` (:32), bumpé par `refresh()` (:60) et testé dans `load()` (:49). Le commentaire est donc obsolète sur deux points — le fichier qu'il désigne et le nom `mutationSeq` — et devrait pointer usePolledResource, ou mieux utiliser `updateData()` (:72-85), conçu pour ce cas. Défaut de documentation uniquement : aucun comportement runtime n'est en cause.

**Recommandation**

Réécrire le commentaire pour pointer usePolledResource (`refresh()` incrémente `generation`, ce qui invalide le poll en vol) — ou, mieux, remplacer le `refresh()` optimiste par `updateData()` du même hook, qui a été conçu exactement pour ce cas.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'requestSeq|mutationSeq|usePolledResource' hooks/useControlDesk.ts` → 7:`import { usePolledResource }`, 43:`usePolledResource<ControlDeskPayload>(` ; aucune occurrence de requestSeq/mutationSeq. NowDesk.tsx:308 : `useControlDesk`'s requestSeq/mutationSeq guards make the refresh`.

</details>

