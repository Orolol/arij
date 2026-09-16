# Lot 01 — Retrait complet du sous-système notifications

**Difficulté** 2/4 — Moyen
**Findings** 5 (2 fort · 0 moyen · 3 faible ; effort 2 S · 2 M · 1 L)
**Dépendances** Aucune. À faire AVANT le lot 04 (code mort) : il libère d'autres exports.

**Statut** fait le 11/09/2026 — retrait complet exécuté. Détail :

- Supprimés : `lib/notifications/**` (create/content/store, 1 076 l.),
  `app/api/notifications/**` (les deux routes), `components/notifications/`
  (renommé, voir plus bas) et les tests dédiés
  (`notifications-api`, `notifications-create`,
  `notification-message-migration`, `notifications-persistence`,
  `webhooks-emit-points`, `terminal-notification` — ce dernier remplacé par un
  test du webhook terminal).
- Migration `0060_drop_notifications.sql` (écrite à la main, entrée
  `_journal.json` à la main) : `DROP TABLE notifications`,
  `DROP TABLE notification_read_cursor`. Les tables disparaissent aussi de
  `lib/db/schema.ts` et l'entrée `POST_BASELINE_COLUMN_MIGRATIONS` de
  `lib/db/init.ts` qui portait `notifications.message` est retirée.
- **Ce qui n'a pas été perdu** : le seul `sendProjectWebhook` du module est
  extrait dans `lib/agent-sessions/session-outcome-webhook.ts`, appelé par le
  hook terminal d'`instrumentation.ts` — donc depuis le point de passage unique
  de toute finalisation, y compris les fermetures mortes avant leur route. Le
  message complet, l'`epicId`, la durée et le deep-link QA/session sont
  conservés à l'identique.
- **Reroutages décidés** : échec CI watch et autofix prêt → commentaire ticket
  (inbox) via `lib/workflow/system-comment.ts` ; échec de routine → webhook
  `routine.failed` (nouvel événement), l'état durable restant
  `routines.last_status` ; mentions de documents non résolues → commentaire
  ticket ; stalled, merge parké/bloqué, seconde opinion, mémoire
  dreamed/distillée/manuel, DAG wave, résumé de night run → aucun canal
  nouveau : la strate du desk et l'activity log portent déjà l'info, le résumé
  de night run reste dans le webhook `night_run.completed`.
- **Renommage demandé par le lot** : `components/notifications/` devient
  `components/toast/` et le namespace i18n `Notifications` devient `Toast`,
  pour que le ToastStack ne se confonde plus avec la table supprimée.
- `lib/refinement/report.ts` ne publie plus de notification : le commentaire de
  récapitulatif est la seule surface, `formatDiscardedTombstones` et le plafond
  `REFINEMENT_NOTIFICATION_MESSAGE_MAX_CHARS` partent avec elle.

**Écarts assumés** : le lot classait #10 (937 lignes de tests) et #88 comme
« à trancher avec le sort des notifications » — les deux tombent avec le
retrait. La table `notifications` n'est pas remplacée par une surface
« Alertes » : l'inbox reste le seul canal, conformément à la décision produit
du 11/09.

## Décision

Décision produit du 11/09 : on retire TOUT (tables, routes, créateurs, tests). L'inbox (ticket_comments / agent_sessions) reste la seule surface de signalement.

## Objectif

Supprimer les tables `notifications` et `notification_read_cursor` (migration manuelle, cf. CLAUDE.md), les routes GET /api/notifications et POST /api/notifications/read, lib/notifications/{create,store,content}.ts, les 28 sites d'appel, les clés i18n devenues orphelines et les tests dédiés. Les signaux qui n'avaient que ce canal (échecs de routines, CI watch, autofix prêt, mémoire) doivent être reroutés : commentaire ticket (inbox) quand il y a un ticket, webhook projet sinon, ou rien si le desk montre déjà l'état.

## Démarche suggérée

1. Lister les 20 créateurs exportés de lib/notifications/create.ts et leurs 28 appelants (rg des noms sur app/ lib/ instrumentation.ts).
2. Extraire d'abord l'unique `sendProjectWebhook` du helper privé `publishSessionOutcome` (create.ts ~226-244) vers lib/webhooks ou lib/events/emit.ts : c'est le seul couplage utile à conserver.
3. Pour chaque appelant : décider reroutage (commentaire ticket via le chemin de handleAskedQuestionOutcome / inbox, webhook) ou suppression pure. Documenter le choix dans le commit.
4. Supprimer routes, lib, schéma Drizzle, puis migration SQL `DROP TABLE` numérotée + entrée _journal.json à la main.
5. Supprimer __tests__/notifications-*.test.ts, notification-message-migration.test.ts, terminal-notification.test.ts ; adapter les tests qui mockent lib/notifications/create.
6. npm run i18n:check ; npm test.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #0 — Le sous-système notifications est en écriture seule : 2 tables, 2 routes, 1 281 lignes de créateurs, zéro surface qui lit

**Nature** à moitié câblé · **Impact** fort · **Effort** L · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `lib/notifications/create.ts`
- `app/api/notifications/route.ts`
- `app/api/notifications/read/route.ts`
- `lib/db/schema.ts:884`
- `lib/db/schema.ts:911`
- `lib/refinement/report.ts:29`
- `lib/refinement/report.ts:446`
- `components/piscine/TopBar.tsx:180`
- `components/piscine/TopBar.tsx:617`
- `lib/events/emit.ts:94`
- `lib/agent-sessions/terminal-notification.ts:34`

**Constat**

lib/notifications/create.ts insère dans `notifications` depuis 25 sites d'appel (fin de session, watchdog « stalled », résumé de night run, tombstones de refinement, échec du canal de review, merge bloqué/parké par l'auto-mode, CI watch, DAG wave, mémoire dreamed/distillée, routines…). Les seules lectures sont GET /api/notifications et POST /api/notifications/read, qui n'ont aucun consommateur produit : le hook useNotifications est supprimé dans l'arbre (D dans git status) et aucun fetch de `api/notifications` n'existe hors __tests__/notifications-api.test.ts. La TopBar n'a qu'une pastille Inbox branchée sur /api/inbox (ticket_comments), pas sur cette table. Des signaux que le code lui-même qualifie de « seule façon pour l'utilisateur d'apprendre » (create.ts:626-633 review-channel, :788-793 merge-retry, :1204-1209 tombstones de tickets supprimés, :1157 résumé nocturne) sont donc perdus. L'autre agent vient encore de corriger l'ordre julianday de la route morte dans l'arbre non commité (git diff app/api/notifications/route.ts), signe que l'équipe maintient une surface qui n'affiche rien.

**Précision du vérificateur**

Le sous-système notifications est en écriture seule dans l'arbre de travail : 2 tables (`notifications` schema.ts:900, `notification_read_cursor` :927), 2 routes (GET /api/notifications, POST /api/notifications/read), et 1 076 lignes de créateurs désormais scindées en lib/notifications/create.ts (692, 20 créateurs exportés) + store.ts (117) + content.ts (267, ces deux derniers non suivis). 28 sites d'appel insèrent (fin de session via emit.ts:94/108 et terminal-notification.ts:34, watchdog.ts:233, night/run.ts:471/575, refinement/report.ts:498, auto-mode/merge.ts:423/935, review-channel-failure.ts:234, dreaming.ts:394, memory-distill.ts:673, agent-question.ts:53, routes build/merge/resolve-merge/review/memory/generate-spec/stories…). Les seules lectures sont les helpers de dédoublonnage/prune de store.ts (au service des créateurs) et la route GET, sans aucun consommateur : hooks/useNotifications.ts est supprimé (retrait délibéré listé dans docs/architecture/ui-rationalisation-2026-09-10.md:71-72, alors qu'il n'était déjà monté nulle part à HEAD), aucun fetch de `api/notifications` hors __tests__/notifications-api.test.ts, la TopBar (:180, :617) lit /api/inbox (ticket_comments/agent_sessions), et nav.ts:189-192 renvoie « notifications » vers /settings#notifications (webhooks). refinement/report.ts:29-32 et :445-448 le documentent explicitement. Le diff non commité de app/api/notifications/route.ts (julianday) entretient une route morte. Couplage à traiter avant suppression : l'unique `sendProjectWebhook` de create.ts (ligne 236) vit dans le helper privé `publishSessionOutcome`, partagé par createNotificationFromSession et createAskedQuestionNotificationFromSession — un seul point à extraire. Tests concernés : notifications-api (212), notifications-create (725), notifications-persistence (97, non suivi), notification-message-migration (296), terminal-notification (59).

Le sous-système notifications est en écriture seule dans l'arbre de travail : lib/notifications/ (create.ts 692 l. + content.ts 267 l. + store.ts 117 l., soit 1 076 lignes après la rationalisation non commitée ; 1 281 à HEAD) insère dans `notifications` depuis ~30 sites d'appel dans 22 fichiers (routes build/merge/resolve-merge/review, lib/night/run.ts, lib/auto-mode/merge.ts et engine.ts, lib/mcp/review-channel-failure.ts, lib/agents/watchdog.ts, lib/routines/scheduler.ts et ci-watch.ts, dreaming/memory-distill/agent-question, lib/events/emit.ts:94, lib/agent-sessions/terminal-notification.ts:34, instrumentation.ts:95). Les seules lectures sont GET /api/notifications et POST /api/notifications/read (aucun appelant hors __tests__/notifications-api.test.ts) et les gardes d'idempotence de store.ts:17-31 (dédoublonnage à l'écriture, pas un affichage). hooks/useNotifications.ts est supprimé (D) mais n'avait déjà aucun consommateur à HEAD — le NotificationBell a disparu au commit cd6fedec (top bar). La TopBar lit /api/inbox (ticketComments/agentSessions), le desk lit agentSessions/ticketComments/userStories, nav.ts:189-192 renvoie vers /settings#notifications (webhooks). La base réelle le confirme : 200 lignes (plafond d'élagage atteint), 146 `failed`, read_cursor figé au 2026-08-28. Couplage à extraire avant toute suppression : sendProjectWebhook est appelé dans `publishSessionOutcome` (create.ts:236), partagé par createNotificationFromSession (:184) et createAskedQuestionNotificationFromSession (:209). Tables : schema.ts:900 et :927.

**Recommandation**

Trancher : soit monter une surface (un onglet « Alertes » alimenté par les lignes `status='failed'`, ou verser ces signaux dans la strate « Your turn » du desk qui n'affiche aujourd'hui que asks/failed/conflict dérivés des sessions), soit supprimer la table notifications, notification_read_cursor, les deux routes, les tests (937 lignes) et réduire create.ts aux seuls effets encore utiles. Attention au couplage : sendProjectWebhook est appelé DANS createNotificationFromSession (create.ts:472) et createAskedQuestionNotificationFromSession (:519) — extraire l'envoi de webhook avant toute suppression, sinon les webhooks session.completed/failed disparaissent avec. Renommer au passage components/notifications/ (ToastStack, namespace i18n Notifications.stack) qui n'a rien à voir avec cette table.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "api/notifications" app components hooks lib e2e` (hors app/api/notifications) → uniquement __tests__/notifications-api.test.ts. `rg -n "notificationReadCursor"` → seulement les deux routes. `git status --porcelain | grep useNotifications` → `D __tests__/use-notifications.test.ts`, hooks/useNotifications.ts absent du disque. lib/refinement/report.ts:29-30 et :446-447 disent explicitement « nothing in the app renders `notifications` today … the chrome reads /api/inbox ». lib/piscine/nav.ts:189-192 : l'entrée « notifications » du menu pointe vers /settings#notifications (les webhooks), pas vers une liste. Sites d'appel : `rg -n "createNotificationFromSession|createNightRunSummaryNotification|createRefinementReportNotification|…" app lib instrumentation.ts` → 25 sites (build/merge/resolve-merge/review routes, lib/night/run.ts:471,575, lib/auto-mode/merge.ts:423,935, lib/mcp/review-channel-failure.ts:234, lib/agents/watchdog.ts:233, lib/routines/scheduler.ts:4, lib/workflow/dreaming.ts:1119, memory-distill.ts:673, agent-question.ts:53).

</details>

### #69 — Les issues des routines, les échecs CI watch et les autofix prêts sont écrits dans une table `notifications` que plus aucune surface ne lit

**Nature** à moitié câblé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** pipeline-routines

**Fichiers**
- `lib/notifications/create.ts:113-240`
- `lib/routines/scheduler.ts:283-307`
- `lib/routines/ci-watch.ts:370-378`
- `app/api/notifications/route.ts:13`
- `app/api/inbox/route.ts:4-10`
- `hooks/useInbox.ts:18`
- `lib/refinement/report.ts:446-448`

**Constat**

Le scheduler (lib/routines/scheduler.ts:283-307) et CI watch (lib/routines/ci-watch.ts:370-378) rapportent tout via lib/notifications/create.ts : createRoutineRunNotification (L113-150), createCiWatchFailureNotification (L153-194) et createCiAutofixReadyNotification (L196-240) font uniquement `db.insert(notifications)` — aucun sendProjectWebhook (les seuls appels sont L472 et L519, pour les sessions). Or le seul lecteur de cette table est app/api/notifications/route.ts:13/28, route orpheline depuis la suppression de hooks/useNotifications.ts (D dans l'arbre, rationalisation UI). La cloche lit /api/inbox (hooks/useInbox.ts:18) qui ne joint que agentSessions/epics/projects/ticketComments/ticketReadCursors (app/api/inbox/route.ts:4-10). Conséquence : une routine `failed` n'affiche que le mot « failed » dans RoutinesSettings (la ligne routines ne stocke pas le message), un PR dont la CI casse ne remonte nulle part, et toute la mécanique de dédoublonnage (lastThrownErrors L184-189/267-275 du scheduler, failureNotified par SHA dans ci-watch L240-263, ciWatchErrorState) protège un canal muet. lib/refinement/report.ts:446-448 le constate déjà en commentaire.

**Précision du vérificateur**

Les trois constructeurs de lib/notifications/create.ts:113-240 (routine run, CI watch failure, CI autofix ready — ce dernier appelé depuis app/api/projects/[projectId]/epics/[epicId]/build/route.ts:411, pas depuis ci-watch) font uniquement `db.insert(notifications)` : aucun sendProjectWebhook (L472/L519 servent les sessions seulement), aucun commentaire ticket (rg vide dans lib/routines/ci-watch.ts et ci-autofix.ts). Le seul lecteur de la table est app/api/notifications/route.ts:13/28 (les lectures create.ts:206/429/680 sont du dédoublonnage interne, :1268-1275 la purge), route sans aucun appelant hors __tests__ — déjà à HEAD, où hooks/useNotifications.ts n'était monté nulle part (`git grep useNotifications HEAD` → commentaires seulement) ; la rationalisation n'a fait que supprimer ce hook mort. La cloche TopBar (L180/617) lit /api/inbox, bâti sur agentSessions/epics/projects/ticketComments/ticketReadCursors (app/api/inbox/route.ts:4-10). La table `routines` n'a que lastRunAt/lastStatus (lib/db/schema.ts) et RoutinesSettings.tsx:341-344/475 n'affiche que ce statut : une routine `failed` ne montre aucune cause, un PR dont la CI casse n'atteint aucune surface, et la dédup (scheduler L184-189/267-275, ci-watch L240-263) protège un canal muet. lib/refinement/report.ts:29-31 et :446-448 le documentent déjà.

Le scheduler (lib/routines/scheduler.ts:98/122 → notifySafely L283-307) et CI watch (lib/routines/ci-watch.ts:158 → L370-378) rapportent tout via lib/notifications/create.ts : createRoutineRunNotification (L113-150), createCiWatchFailureNotification (L153-194) et createCiAutofixReadyNotification (L196-240, appelé par build/route.ts:411) font uniquement `db.insert(notifications)` — aucun sendProjectWebhook (seuls L472 et L519, pour les sessions). Le seul lecteur de la table est app/api/notifications/route.ts:13/28, route sans aucun consommateur client (`rg "api/notifications"` hors app/api/notifications et __tests__ → 0) — orpheline non pas depuis la rationalisation UI mais depuis cd6fedec (2026-08-31), qui a supprimé components/layout/NotificationBell.tsx ; la rationalisation a seulement retiré le hook hooks/useNotifications.ts déjà sans consommateur. La cloche (TopBar.tsx:180/617) lit /api/inbox (hooks/useInbox.ts:18), construit sur agentSessions/epics/projects/ticketComments/ticketReadCursors (app/api/inbox/route.ts:4-10). Conséquences : une routine `failed` n'affiche que le mot « failed » dans components/routines/RoutinesSettings.tsx:341-344/462-477 (la ligne routines ne stocke que lastStatus, scheduler.ts:91-96 ; le state `message` du composant n'est que le feedback saved/created) ; un PR dont la CI casse ne remonte nulle part ; l'instruction « push manuellement » de l'autofix est muette (la session d'autofix elle-même reste visible via son commentaire ticket, build/route.ts:430). Toute la mécanique de dédoublonnage (lastThrownErrors scheduler.ts:184-189/267-275, failureNotified par SHA ci-watch.ts:240-263, ciWatchErrorState L31/151) protège un canal que personne ne lit. lib/refinement/report.ts:29-32 et :446-448 le constatent déjà en commentaire.

Les issues des routines (lib/routines/scheduler.ts:243-249 et 267-275 via createRoutineRunNotification, lib/notifications/create.ts:32-61), les échecs CI watch (lib/routines/ci-watch.ts:370-378 via createCiWatchFailureNotification, create.ts:63-95) et les autofix prêts à pousser (app/api/projects/[projectId]/epics/[epicId]/build/route.ts:411 via createCiAutofixReadyNotification, create.ts:97-127) ne font que `persistNotification` → `db.insert(notifications)` (lib/notifications/store.ts:96). Le seul `sendProjectWebhook` du module est create.ts:236 (`publishSessionOutcome`), réservé aux sessions. Aucune surface ne lit `notifications` : les seules lectures sont app/api/notifications/route.ts:13/28 (route sans aucun appelant client — `rg "api/notifications"` hors app/api/notifications et __tests__ → 0) et lib/notifications/store.ts:17-30 (dédoublonnage interne). La route était déjà orpheline à HEAD (report.ts:30 : useNotifications sans consommateur) ; la rationalisation a supprimé le hook (D hooks/useNotifications.ts). La cloche (TopBar.tsx:180/617) lit /api/inbox (useInbox.ts:19-20), construit par lib/inbox/read.ts:4-10 depuis agentSessions/epics/projects/ticketComments/ticketReadCursors uniquement. La ligne `routines` ne persiste que lastStatus (scheduler.ts:91-96, schéma L45-58), donc RoutinesSettings.tsx:309-313/443-444 n'affiche que « failed » sans cause ; une CI cassée sur un PR n'apparaît nulle part ; les gardes de dédoublonnage (scheduler lastThrownErrors L184-189/267-275, ci-watch failureNotified par SHA L240-263) protègent un canal muet. lib/refinement/report.ts:29-31 et :445-448 le constatent déjà.

Les notifications des routines (createRoutineRunNotification, lib/notifications/create.ts:32-60), des échecs CI watch (createCiWatchFailureNotification, L63-93) et de l'autofix prêt à pousser (createCiAutofixReadyNotification, L97-125) ne font que `persistNotification` → `db.insert(notifications)` (lib/notifications/store.ts:95-100), sans sendProjectWebhook (unique appel L236, sessions seulement ; lib/webhooks/send.ts:27-28 ne connaît que session.completed/failed). La table n'a aucun lecteur produit : la route GET app/api/notifications/route.ts:13,28 n'est fetchée par rien (hooks/useNotifications.ts supprimé, déjà sans consommateur à HEAD), et les seules autres lectures sont les gardes de dédoublonnage/prune de lib/notifications/store.ts:17-31,104-111 (côté écriture). La cloche (TopBar.tsx:180 → useInbox → /api/inbox → lib/inbox/read.ts:3-9) ne joint que agentSessions/epics/projects/ticketComments/ticketReadCursors ; le desk (lib/control-desk/aggregate.ts) ne lit aucun état CI. Conséquences : une routine `failed` n'expose que le mot dans RoutinesSettings.tsx:313,444 (table `routines` sans colonne message, schema.ts) ; un PR dont la CI casse ne remonte nulle part ; le dédoublonnage (scheduler.ts:184-189/267-275, ci-watch.ts:240-263) protège un canal muet. Nuance : la session autofix elle-même reste visible via le commentaire ticket posté en build/route.ts:430-439 (sortie brute de l'agent → inbox), seul le message explicite « branche non poussée » est perdu.

**Recommandation**

Décider d'un canal visible pour les routines : soit router ces trois constructeurs vers un item d'inbox (commentaire ticket pour CI watch/autofix, entrée projet pour les routines) et vers sendProjectWebhook, soit rebrancher un lecteur de `notifications` dans la TopBar. Tant que ce n'est pas tranché, stocker au moins `lastMessage` sur la ligne routine pour que l'écran Routines montre la cause d'un échec.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "from\(notifications\)" app lib components hooks` → uniquement app/api/notifications/route.ts:13 et :28 ; `rg "api/notifications"` hors __tests__ → aucun fetch client ; `git status --porcelain` liste hooks/useNotifications.ts et __tests__/use-notifications.test.ts en D ; `rg -n "sendProjectWebhook" lib/notifications/create.ts` → L13 (import), L472, L519 seulement.

</details>

### #10 — 937 lignes de tests protègent le contrat d'une surface sans consommateur, et 892 lignes figent des sections de rapport jamais rendues

**Nature** gras de tests · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `__tests__/notifications-api.test.ts`
- `__tests__/notifications-create.test.ts`
- `__tests__/usage-report.test.ts`
- `__tests__/usage-page.test.tsx:51`

**Constat**

__tests__/notifications-api.test.ts (212 l.) et __tests__/notifications-create.test.ts (725 l.) vérifient le tri, le curseur de lecture, le message complet « so the bell can show it (AC1) » et le libellé de chaque type de notification — pour une cloche qui n'existe pas dans l'UI. __tests__/usage-report.test.ts (892 l.) épingle `totals`, `byAgent`, `byProvider`, `byProject`, `byDay`, `windows` que l'écran ne lit plus. Ces suites coûtent du temps CI et découragent la suppression des morts qu'elles couvrent.

**Précision du vérificateur**

La surface est bien morte, mais le volume de test réellement inutile est ~2× plus petit qu'annoncé. Confirmé : `/api/notifications` et `/api/notifications/read` n'ont aucun consommateur (hooks/useNotifications.ts supprimé dans l'arbre ; `lib/refinement/report.ts:29` l'écrit noir sur blanc), donc les 212 l. de `__tests__/notifications-api.test.ts` gardent un contrat que personne n'appelle. Confirmé aussi : `UsageScreen.tsx` ne lit que `report.dashboard`, `report.subscriptions` et `report.generatedAt`, donc les 8 clés legacy `totals/byAgent/byProvider/byProject/byDay/windows` (lib/usage/aggregate.ts:938-957) ne sont plus rendues. En revanche : (a) dans `usage-report.test.ts`, seuls les l.128-442 (315 l.) épinglent ces clés mortes ; les l.442-886 (445 l.) couvrent `subscriptions` / live-quota / `storeCodexLiveSnapshot`, rendus par `UsageScreen.tsx:226`, et `byProvider` reste l'entrée vivante de `getSubscriptions` (aggregate.ts:942). (b) `notifications-create.test.ts` (725 l.) ne fige pas que des libellés de cloche : il garde aussi les verrous anti-doublon de `lib/notifications/store.ts:17-31` et la purge `MAX_NOTIFICATIONS`, qui commandent le fan-out webhook et le tombstone `notifications.message` de `lib/refinement/report.ts`. À élaguer : ~527 l. sûres (212 + 315), le reste seulement après la décision produit sur la cloche.

**Recommandation**

Supprimer ou réduire ces suites dans le même mouvement que la décision sur les notifications et l'élagage de UsageReport ; ne garder que les tests des créateurs qui déclenchent encore un effet vivant (webhooks).

<details><summary>Preuve relevée par l'auditeur</summary>

`wc -l` → 212 + 725 + 892. notifications-api.test.ts:124 « returns the full failure message so the bell can show it (AC1) ». usage-page.test.tsx:51 « The legacy 8-key `byDay`, which the 8d screen no longer reads ». Aucun consommateur produit de /api/notifications (cf. finding notifications) ni de report.totals/byAgent/byProvider/byProject/byDay/windows (cf. finding usage).

</details>

### #88 — Le rapport de refinement écrit une notification que rien ne lit

**Nature** à moitié câblé · **Impact** faible · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `lib/refinement/report.ts:26-32`
- `lib/refinement/report.ts:286-317`
- `lib/refinement/report.ts:444-457`
- `lib/refinement/report.ts:498-507`
- `lib/notifications/create.ts:1235`

**Constat**

publishRefinementReport (lib/refinement/report.ts:393-510) termine chaque passe par createRefinementReportNotification(...) (l.498-507) avec le texte des tombstones des tickets supprimés en `message`. Le module lui-même documente que la table notifications n'a « no consumer in the app » (l.26-32 et l.444-451) et que le commentaire de recap est la seule surface lisible. Vérifié : GET /api/notifications et POST /api/notifications/read n'ont aucun appelant (hooks/useNotifications.ts supprimé), /api/inbox ne lit pas la table. Le flux écrit donc un enregistrement et un plafond REFINEMENT_NOTIFICATION_MESSAGE_MAX_CHARS pour un lecteur inexistant, en plus de la logique de fallbackCommentHost qui existe précisément pour compenser cette absence.

**Précision du vérificateur**

publishRefinementReport (lib/refinement/report.ts:393-510) termine chaque passe par createRefinementReportNotification (l.498-507 ; définie dans l'arbre de travail à lib/notifications/create.ts:674-690, insertion via persistNotification de lib/notifications/store.ts:95) avec le texte des tombstones des tickets supprimés en `message`, plafonné par REFINEMENT_NOTIFICATION_MESSAGE_MAX_CHARS (report.ts:293, 4000 chars). Le module documente lui-même (l.26-32, l.444-451) que la table notifications n'a aucun consommateur, et le commentaire de report.ts:288 (« read whole by the notification list ») est périmé. Vérifié dans l'arbre : les seules lectures de la table sont GET /api/notifications (app/api/notifications/route.ts:13,28, sans appelant hors tests) et les gardes de dédup/purge de lib/notifications/store.ts (l.17-31, 104-111) ; lib/inbox/read.ts ne lit que ticketComments/agentSessions/epics, hooks/useInbox.ts n'appelle que /api/inbox. Le flux écrit donc un enregistrement et un plafond pour un lecteur inexistant, et fallbackCommentHost existe précisément pour compenser cette absence.

publishRefinementReport (lib/refinement/report.ts:393-510, appelé par lib/refinement/dispatch.ts:194 et :246) termine chaque passe par createRefinementReportNotification (lib/notifications/create.ts:674-692 dans l'arbre de travail ; :1235 à HEAD) avec formatDiscardedTombstones(report) en `message`, plafonné par REFINEMENT_NOTIFICATION_MESSAGE_MAX_CHARS (report.ts:286-317). La table `notifications` n'a aucun consommateur d'affichage : ses seuls lecteurs sont GET app/api/notifications/route.ts (0 appelant hors tests — hooks/useNotifications.ts supprimé, aucun appel dynamique, aucun MCP/routine/e2e) et les gardes de dédup + prune(200) de lib/notifications/store.ts. Le chrome (components/piscine/TopBar.tsx:180 → hooks/useInbox.ts:20 → /api/inbox → lib/inbox/read.ts) ne lit que ticket_comments/agent_sessions/ticket_read_cursors. Le module le documente lui-même (report.ts:26-32, 444-451) et compense par fallbackCommentHost. Aucun webhook ni effet de dédup n'en dépend : sur échec, la notification générique est déjà posée par le hook terminal avant onTerminal. Nuance : aucun ticket ouvert sur les routes /api/notifications orphelines n'a été trouvé dans arji.json (tous done) — la recommandation « à traiter avec le ticket déjà ouvert » n'est pas étayée.

**Recommandation**

Trancher : soit faire lire notifications par /api/inbox (et alors les tombstones n'ont plus besoin d'un ticket hôte artificiel), soit cesser d'écrire la notification de refinement et retirer formatDiscardedTombstones/REFINEMENT_NOTIFICATION_MESSAGE_MAX_CHARS. À traiter avec le ticket déjà ouvert sur les routes /api/notifications orphelines.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'api/notifications' app components hooks lib --glob '!app/api/**'` → 0 résultat hors commentaires. report.ts:446-448 « `notifications` has no consumer in the app (hooks/useNotifications.ts is unmounted; the chrome reads /api/inbox …) ». git status : D hooks/useNotifications.ts, D __tests__/use-notifications.test.ts.

</details>

### #189 — Les trois notifications mémoire (dreamed / distilled / manual-restore) et le deep-link `#memory-panel` n'ont aucun consommateur

**Nature** à moitié câblé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `lib/notifications/create.ts:491-565`
- `lib/workflow/dreaming.ts:392-408`
- `lib/workflow/memory-distill.ts:673-677`
- `components/spec/MemoryPanel.tsx:269-279`

**Constat**

dreaming.ts:394, memory-distill.ts:673, memory/route.ts:111 et restore/route.ts:65 écrivent dans `notifications` avec `targetUrl: /projects/:id/spec#memory-panel` (lib/notifications/create.ts:491-565). Aucun composant ni hook ne fait de fetch vers `/api/notifications` (grep vide hors app/api et tests) — la table n'est lue que par sa propre route et lib/notifications/store.ts. En face, MemoryPanel.tsx:269-279 monte un listener `hashchange` + scroll dont le docblock (:114) dit qu'il sert aux « notification deep links ». Le producteur et le consommateur existent tous deux, mais rien ne relie l'un à l'autre : c'est un cas supplémentaire de la table `notifications` orpheline déjà retenue, avec ici un effet client mort en plus. Le docblock de memory-provenance.ts:57-58 prétend aussi que « the history lives in notifications » — inaccessible.

**Précision du vérificateur**

Les trois créateurs mémoire (createMemoryDreamedNotification create.ts:491, createMemoryDistilledNotification :516, createMemoryManualWriteNotification :547 ; appelés à dreaming.ts:394, memory-distill.ts:673, memory/route.ts:111, restore/route.ts:65) n'écrivent que dans la table `notifications` via persistNotification (store.ts:95), sans webhook. Cette table n'a plus aucun lecteur produit : le seul hook qui appelait /api/notifications (hooks/useNotifications.ts) est supprimé dans l'arbre par la rationalisation et n'était déjà monté nulle part à HEAD (lib/refinement/report.ts:30 le documente) ; /api/inbox (lib/inbox/read.ts) et la TopBar ne lisent pas cette table ; seuls store.ts (dédup/prune) et app/api/notifications/route.ts la consultent. Précision : seuls dreamed (create.ts:504) et manual-write (:562) portent l'ancre `/spec#memory-panel` — distilled pointe vers `/sessions/:id` (:539-541). Le listener hashchange de MemoryPanel.tsx:269-279 (docblock :114) n'est atteignable que par une URL saisie à la main, aucun href produit ne cible `#memory-panel`. Le docblock « history lives in notifications » est à lib/documents/memory-provenance.ts:64. Le panneau reste informé du changement par le broadcast `memory:changed` (memory-distill.ts:667-672), indépendant de la table.

**Recommandation**

Soit brancher ces notifications sur l'inbox/TopBar (elles portent une vraie information : previousChars → newChars, sessionsAnalyzed), soit retirer les trois créateurs et l'effet `hashchange` du panneau.

<details><summary>Preuve relevée par l'auditeur</summary>

grep `/api/notifications` dans app components hooks (hors app/api) → 0 résultat. grep `memory-panel` → MemoryPanel.tsx (id + hashchange) et create.ts:504,562 (targetUrl) uniquement.

</details>

