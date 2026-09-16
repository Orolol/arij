# Lot 10 — Chat : une seule interface, un seul runner de tour

**Difficulté** 4/4 — Très difficile — agent fort + revue humaine
**Findings** 14 (1 fort · 6 moyen · 7 faible ; effort 10 S · 2 M · 2 L)
**Dépendances** Indépendant. Gros lot : découper serveur / client en deux tickets.

## Décision

Une seule grammaire de rendu : UnifiedChatPanel consomme les composants de chat-page (ChatThread, ChatComposer, ConversationRoster compact) ; components/chat/ disparaît sauf ce qui est réellement partagé. Le POST non-stream est supprimé.

## Objectif

Fusionner les deux interfaces, extraire lib/chat/turn-runner.ts (un ReadableStream, un activityRegistry, une persistance, un cancel, cinq stratégies), permettre la création de conversation « chat » depuis /chat, afficher le statut « error » en mot, brancher renommer, corriger type === "epic", centraliser les libellés persistés, convertir la migration cutover en migration SQL unique, scoper les uploads au projet.

## Démarche suggérée

1. Commencer par le serveur : turn-runner + suppression de POST /chat (déplacer le test composite-route-boundaries sur le stream).
2. Migration cutover : marqueur persistant ou migration SQL, exécutée une fois depuis instrumentation.ts ; supprimer data/migrations/unified-chat-cutover.
3. NewConversationCard : entrée « Chat » ; statut error rendu en mot ; renommer branché.
4. UnifiedChatPanel → composants chat-page ; supprimer components/chat/* redondants et les 8 tests dédiés (remplacer par des tests du composant commun).
5. GET /chat/uploads/:id : vérifier attachment.projectId === params.projectId.
6. Labels Brainstorm/New Epic/Chat : une constante + clé i18n.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #41 — Depuis /chat, impossible de créer une conversation de type « chat » : les board tools MCP n'atteignent jamais la surface principale

**Nature** à moitié câblé · **Impact** fort (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `components/chat-page/NewConversationCard.tsx:73-84`
- `components/chat/ChatTabBar.tsx:128-148`
- `lib/chat/conversation-agent.ts:49-56`
- `lib/chat/cli-tool-channel.ts:529`
- `app/api/projects/[projectId]/chat/stream/route.ts:459-461`
- `app/api/projects/[projectId]/conversations/route.ts:331-347`

**Constat**

Les deux canaux d'outils (canal MCP CLI via createChatCliToolChannel, et board tools du mode OpenAI-compatible) sont désactivés pour les types brainstorm et epic_creation par isToolIneligibleConversationAgentType. Or NewConversationCard (la seule création sur /chat) ne propose que BRAINSTORM_AGENT_TYPE et EPIC_CREATION_AGENT_TYPE, et la conversation auto-créée par GET /conversations est un brainstorm. Seul ChatTabBar, dans le panneau de la page projet, sait créer type « chat ». Conséquence : sur la page de chat « primaire » (doc unified-chat-left-panel.md), un utilisateur ne peut jamais obtenir une conversation avec list_tickets/get_ticket/start_build, alors que 652 l. de lib/chat/board-tools.ts et 129 l. de cli-tool-channel.ts existent pour cela. La base locale confirme : 8 conversations, 2 brainstorm, 6 epic_creation, 0 chat.

**Précision du vérificateur**

Depuis /chat (page « primary » selon docs/architecture/unified-chat-left-panel.md:14), aucune action utilisateur ne peut créer une conversation de type « chat », le seul type qui passe la garde des outils. Les deux canaux d'outils sont gatés par `isToolIneligibleConversationAgentType` (lib/chat/conversation-agent.ts:49-56 : epic_creation || brainstorm) : canal MCP CLI dans lib/chat/cli-tool-channel.ts:74 (aussi utilisé par le runner persistant, lib/chat/persistent-providers/claude.ts:182-187) et board tools du mode OpenAI-compatible dans app/api/projects/[projectId]/chat/stream/route.ts:459-461 ; le type lu est celui de la ligne BD (stream/route.ts:175). Or les seuls appelants de `createConversation(` hors tests sont ChatPageView.tsx:600 (→ NewConversationCard.tsx:73-84, qui n'émet que brainstorm et epic_creation, son commentaire l.21-26 croyant à tort que ChatTabBar n'avait que deux entrées) et UnifiedChatPanel.tsx:102 (→ ChatTabBar.tsx:130 `{ type: "chat" }`, monté uniquement sur app/projects/[projectId]/page.tsx:300). La conversation auto-créée est `type: "brainstorm"` (conversations/route.ts:58-75) et le POST retombe sur "brainstorm" (l.167) ; le PATCH [conversationId] n'accepte pas `type`. Base locale : brainstorm 2, epic_creation 6, chat 0. Lignes corrigées : cli-tool-channel.ts:74 (pas 529), conversations/route.ts:58-75 et 167 (pas 331-347).

Sur /chat, la seule affordance de création (`components/chat-page/NewConversationCard.tsx:72-86`) ne propose que brainstorm et epic_creation, et la conversation auto-créée par `GET /api/projects/:id/conversations` (`route.ts:57-72`) est un brainstorm ; or ces deux types sont exclus des outils par `isToolIneligibleConversationAgentType` (`lib/chat/conversation-agent.ts:49-56`), portée appliquée à `lib/chat/cli-tool-channel.ts:74`, `chat/stream/route.ts:459-461` et au runner persistant (`persistent-providers/claude.ts:183`, `oh-my-pi.ts:212`). Le seul créateur de type « chat » est le `+` de `components/chat/ChatTabBar.tsx:128-134`, monté uniquement dans `UnifiedChatPanel` sur `/projects/:id` (`page.tsx:300`). Le POST conversations accepte pourtant tout `type`. Une conversation « chat » créée depuis le panneau projet apparaît ensuite dans le roster de /chat et y obtient bien les board tools : le code n'est pas mort, c'est un trou de câblage du menu de /chat (dont le commentaire d'en-tête, l.21-27, affirme à tort que ChatTabBar n'avait que deux entrées). Base locale : 2 brainstorm, 6 epic_creation, 0 chat.

**Recommandation**

Ajouter l'entrée « Chat » (CHAT_AGENT_TYPE, label "Chat") au menu de NewConversationCard, ou faire de « chat » le type par défaut de la conversation auto-créée ; documenter dans ChatKnowsCard que seul ce type a les outils.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n 'type: "chat"|CHAT_AGENT_TYPE' app components hooks lib → créateur unique ChatTabBar.tsx:130 ; cli-tool-channel.ts:529 `if (isToolIneligibleConversationAgentType(conversationType)) return null;` ; stream/route.ts:459 `!isToolIneligibleConversationAgentType(conversationType) && isMcpToolsEnabled()` ; better-sqlite3 readonly sur data/arij.db : `select type,count(*) from chat_conversations group by type` → brainstorm 2, epic_creation 6.

</details>

### #40 — Deux interfaces de chat : mesure exacte du dupliqué et du divergent après la rationalisation

**Nature** doublon · **Impact** moyen · **Effort** L · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `components/chat/UnifiedChatPanel.tsx`
- `components/chat-page/ChatPageView.tsx`
- `components/chat/MessageList.tsx:475`
- `components/chat-page/ChatThread.tsx:26`
- `components/chat/ChatTabBar.tsx:130`
- `components/chat-page/NewConversationCard.tsx:73`
- `components/chat/ChatWorkspaceHeader.tsx:208`
- `components/chat-page/ConversationRosterCard.tsx:628`
- `lib/i18n/messages/en/ChatLegacy.json`
- `lib/i18n/messages/en/Chat.json`
- `app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx`
- `docs/architecture/ui-rationalisation-2026-09-10.md:75`

**Constat**

La rationalisation a mutualisé la logique (hooks/useChatWorkspace.ts 82 l., hooks/useChatComposer.ts 71 l., components/chat-page/agent-selection.ts, QuestionCards, MarkdownContent, ImageLightbox, AgentSelectPill) mais chaque surface garde son propre rendu. UnifiedChatPanel (components/chat/, monté sur /projects/:id) rend transcript+composer+liste avec MessageList (102 l.), MessageInput (99 l.), ChatTabBar (155 l.), ChatWorkspaceHeader+ChatProposalCard (192 l.) ; ChatPageView (/chat) rend le même trio avec ChatThread+AgentBubble+UserBubble+TypingBubble (≈366 l.), ChatComposer (204 l.), ConversationRoster+ConversationRosterCard+NewConversationCard (327 l.). Ce sont ~1 450 lignes de composants pour trois concepts. Deux namespaces i18n portent la même copy (ChatLegacy.header.sessionWarm/sessionCold/sessionLinked/restartAria ≡ Chat.roster.sessionWarm/sessionCold/sessionLinked/restartSession ; ChatLegacy.proposal.createEpic/generateSpec ≡ Chat.thread.createEpic/generateSpec). Divergences fonctionnelles : le panneau seul sait supprimer une conversation (closeTab → deleteConversation), créer une conversation de type « chat », se replier sur Escape, se redimensionner, et ne poll les conversations que visible ; la page seule a la carte d'epic dans le fil (DraftedEpicCard), le rail contexte (ContextRail), « Créé dans ce chat », « Vers la spec », la bulle de frappe avec chrono, l'auto-scroll qui respecte la lecture (useFeedAutoScroll — MessageList fait scrollIntoView à chaque delta, ce que l'en-tête de ChatThread.tsx documente comme un défaut), le deep-link ?conversation=, le pane switcher mobile et l'overlay ticket. Une troisième transcription lecture seule existe encore dans app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx (238 l., MessageList).

**Précision du vérificateur**

Le constat est exact sur le fond, mais plusieurs ancres de lignes citées sont hors fichier et doivent être corrigées. Deux rendus de chat coexistent pour les trois mêmes concepts (transcript, composer, liste) : components/chat/{MessageList 102 l., MessageInput 99, ChatTabBar 155, ChatWorkspaceHeader 192 — qui contient `ChatProposalCard`, il n'existe pas de fichier ChatProposalCard.tsx} = 548 l. contre components/chat-page/{ChatThread 228 + AgentBubble 34 + UserBubble 59 + TypingBubble 48, ChatComposer 204, ConversationRoster 102 + ConversationRosterCard 134 + NewConversationCard 91} = 900 l., soit 1 448 l. au total, plus UnifiedChatPanel 402 l. et ChatPageView 770 l. de câblage. Les doublons i18n sont plus nombreux qu'annoncé : 11 libellés strictement identiques entre en/ChatLegacy.json (35 clés) et en/Chat.json — les 6 cités plus tabs.newConversation ≡ roster.newConversation, tabs.new.brainstorm ≡ roster.newBrainstorm, tabs.new.epic ≡ roster.newEpic, messages.empty ≡ thread.emptyBrainstorm, panel.epicIntro ≡ thread.emptyEpic. Divergences confirmées : suppression de conversation seulement dans UnifiedChatPanel.tsx:63,189 ; création de type « chat » seulement dans ChatTabBar.tsx:130 ; polling conditionné à la visibilité (UnifiedChatPanel.tsx:94), Escape (l. 170-177) et redimensionnement (l. 311) seulement au panneau ; ContextRail/ChatPaneSwitcher/CreatedHereCard/TowardSpecBand/overlay ticket/deep-link ?conversation= seulement sur la page (ChatPageView.tsx:10,26-35,70,116,262,297-299,755-761). Auto-scroll : MessageList.tsx:30 (scrollIntoView à chaque delta, défaut documenté par ChatThread.tsx:25-32) contre ChatThread.tsx:110 useFeedAutoScroll. Troisième transcription lecture seule : app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:11,230. Conservation déclarée volontaire dans docs/architecture/ui-rationalisation-2026-09-10.md:92 (et non 75). Ancres erronées à remplacer : MessageList.tsx:475→:30, ChatWorkspaceHeader.tsx:208→:105-130, ConversationRosterCard.tsx:628→fichier de 134 l., ChatThread.tsx:312→:110.

**Recommandation**

Décider d'un seul rendu : faire consommer par UnifiedChatPanel les composants chat-page (ChatThread, ChatComposer, ConversationRoster en mode compact) et supprimer components/chat/{MessageList,MessageInput,ChatTabBar,ChatWorkspaceHeader}.tsx + le namespace ChatLegacy (35 clés). À défaut, au minimum porter sur la page les deux parcours manquants (suppression, type « chat ») et sur le panneau l'auto-scroll respectueux (useFeedAutoScroll).

<details><summary>Preuve relevée par l'auditeur</summary>

wc -l sur les composants cités ; rg 'deleteConversation' app components hooks -g '!hooks/useConversations.ts' → uniquement components/chat/UnifiedChatPanel.tsx:63,189 ; rg 'type: "chat"' → seul ChatTabBar.tsx:130 crée ce type ; node -e sur en/Chat.json et en/ChatLegacy.json montre les libellés identiques ; MessageList.tsx:475-477 `bottomRef.current?.scrollIntoView({behavior:"smooth"})` sur [messages] vs ChatThread.tsx:312 useFeedAutoScroll ; docs/architecture/ui-rationalisation-2026-09-10.md:75-77 déclare la conservation volontaire.

</details>

### #42 — POST /api/projects/:id/chat (route non-stream) n'a plus aucun appelant produit et diverge du stream

**Nature** mort · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `app/api/projects/[projectId]/chat/route.ts:74-249`
- `app/api/projects/[projectId]/chat/route.ts:135-142`
- `lib/validation/chat-schemas.ts:3`
- `__tests__/composite-route-boundaries.test.ts:93`

**Constat**

Les deux surfaces envoient via hooks/useChat.ts → POST /chat/stream ; le GET /chat (historique) reste vivant. Le POST non-stream (l.74-249, 175 l.) n'est appelé que par __tests__/composite-route-boundaries.test.ts:93. Il a dérivé : l'historique injecté dans le prompt est celui du PROJET entier (l.135-142, pas de filtre conversationId, donc fuite entre conversations), il ne met pas à jour chat_conversations.status, ne génère pas de titre, n'a ni canal MCP ni mode persistant ni mode OpenAI-compatible, laisse deux console.log (l.182, l.193 avec un aperçu de 300 caractères), et répond 200 {data} même en échec en enregistrant « Error: … » comme message assistant (l.201-216, l.234-247). lib/validation/chat-schemas.ts:3 documente encore « chat POST + chat/stream POST ».

**Précision du vérificateur**

Exact tel quel, avec une précision : le POST non-stream n'a plus aucun appelant *interne* (seul `__tests__/composite-route-boundaries.test.ts:93` l'importe), mais il reste exporté donc joignable en HTTP ; la fuite de l'historique non filtré par `conversationId` (l. 135-142) est une fuite de contexte de prompt bornée au même projet, non déclenchable par l'UI actuelle.

**Recommandation**

Supprimer le handler POST de chat/route.ts et déplacer le test de frontière composite sur la route stream (qui passe déjà par withAgentResolutionErrors) ; corriger le commentaire de chat-schemas.ts.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n '/chat`|/chat"' app components hooks lib e2e __tests__ (hors stream/upload) → seuls des GET `?conversationId=` (useChat.ts:69, useEpicCreate.ts:64, sessions/chat page:76) ; le seul POST est le test composite-route-boundaries.test.ts:93 `nonStreamChat(new NextRequest(".../chat", {method:"POST"…}))`.

</details>

### #43 — La « migration one-shot » du cutover chat se rejoue à chaque démarrage du serveur et écrit un backup de tout l'historique par projet

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `lib/chat/unified-cutover-migration.ts:97`
- `lib/chat/unified-cutover-migration.ts:370-390`
- `app/api/projects/[projectId]/conversations/route.ts:322`
- `app/api/projects/[projectId]/conversations/route.ts:349-358`
- `docs/architecture/unified-chat-left-panel.md:84-99`

**Constat**

runUnifiedChatCutoverMigrationOnce est appelé par GET /conversations à chaque liste ; sa garde `migratedProjects` est un Set de module, donc remis à zéro à chaque process (redémarrage de next dev, hot reload). Chaque passage écrit <ts>-backup.json (snapshot complet conversations+messages+attachments) et <ts>-report.json dans data/migrations/unified-chat-cutover/<projectId>/. Mesuré sur disque : 373 paires backup/report réparties sur 141 répertoires de projets, 6,4 Mo, 242 fichiers écrits aujourd'hui (2026-09-10), et 0 rapport avec messagesReassigned > 0 ou createdFallbackConversation: true ; la base n'a aucun message orphelin. Le GET fait en plus lui-même le rattachement des orphelins (l.349-358) : la migration est doublement inutile. Le doc unified-chat-left-panel.md la décrit encore comme « one-time-per-project ».

**Précision du vérificateur**

`runUnifiedChatCutoverMigrationOnce` (lib/chat/unified-cutover-migration.ts:370-390) est appelé par GET /api/projects/[projectId]/conversations (route.ts:49) ; sa seule garde est `migratedProjects`, un Set de module (l.102) sans marqueur persisté, donc la migration se rejoue à chaque nouveau process (redémarrage/hot reload) et par projet. Chaque passage écrit inconditionnellement `<ts>-backup.json` (snapshot complet conversations+messages+attachments, l.238-251) puis `<ts>-report.json` (l.339-343) dans data/migrations/unified-chat-cutover/<projectId>/. Mesuré : 141 répertoires (dont 139 de projets qui n'existent plus en base — seuls u1HcvrXnpuvm et SqAXUvSO9QCQ existent), 373 paires, 6,4 Mo ; le projet réel u1HcvrXnpuvm cumule 140 paires depuis le 15/08 (backup de 141 Ko ce matin). Les 242 fichiers du 10/09 proviennent pour 240 d'entre eux de 120 projets éphémères de tests e2e, pas de redémarrages. Aucun des 373 rapports n'a agi (0 messagesReassigned, 0 fallback) et la base n'a aucun message orphelin : la migration est inerte en pratique. Nuance : le backfill de la route (l.76-84) ne couvre que le cas « aucune conversation » ; il n'est pas équivalent à la migration. Le doc unified-chat-left-panel.md:96-99 la décrit encore comme « one-time-per-project » ; le retrait est déjà listé non fait dans docs/plans/2026-08-14-cleanup-refactor-plan.md:173.

`runUnifiedChatCutoverMigrationOnce` (lib/chat/unified-cutover-migration.ts:370) n'a qu'un appelant, GET /api/projects/[projectId]/conversations (route.ts:49), atteint par hooks/useConversations.ts:68 via useChatWorkspace (ChatPageView.tsx:339, UnifiedChatPanel.tsx:70) : chaque ouverture du chat d'un projet la déclenche. Sa garde `migratedProjects` (l.102) est un Set de module remis à zéro à chaque process ; backup complet (l.241-253) et rapport (l.344-348) sont écrits inconditionnellement sous `process.cwd()/data` (l.92). État mesuré : 231 répertoires, 463 rapports, 926 fichiers, 7,5 Mo, 422 fichiers datés du 10/09 ; 0 rapport avec réassignation ou conversation de repli, 0 message orphelin en base. Seuls 2 répertoires correspondent aux 2 projets réels (140 rapports en 26 jours pour « Arij », preuve du rejeu par process) ; les 229 autres viennent des projets e2e, car playwright redirige la base (`ARIJ_DB_PATH` → data/e2e.db) mais pas le dataDir du module, qui pollue data/ de production. Le GET rattache lui-même les orphelins (route.ts:76-84), mais seulement quand le projet n'a aucune conversation. Doc unified-chat-left-panel.md:97-99 parle encore de « one-time-per-project » ; le retrait est déjà un item non coché de docs/plans/2026-08-14-cleanup-refactor-plan.md:173.

**Recommandation**

Retirer l'appel de GET /conversations et le module (ou le convertir en migration SQL numérotée à la main, cf. CLAUDE.md), supprimer data/migrations/unified-chat-cutover, mettre à jour le doc.

<details><summary>Preuve relevée par l'auditeur</summary>

unified-cutover-migration.ts:97 `const migratedProjects = new Set<string>();` ; `ls data/migrations/unified-chat-cutover | wc -l` → 141 ; `find … -name '*-report.json' | wc -l` → 373 ; dates des rapports : 242 fichiers datés 2026-09-10 ; `grep -l '"messagesReassigned": [1-9]' -r …` → 0 ; better-sqlite3 readonly `select count(*) from chat_messages where conversation_id is null` → 0.

</details>

### #44 — Le statut de conversation « error » est écrit par le stream mais aucune surface de chat ne l'affiche ; « generated » n'est jamais écrit

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `app/api/projects/[projectId]/chat/stream/route.ts:322-361`
- `lib/chat/parity-contract.ts:3-10`
- `hooks/useChatWorkspace.ts:31-33`
- `components/chat/ChatTabBar.tsx:85`
- `components/chat-page/ConversationRosterCard.tsx`
- `app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:195-208`

**Constat**

Le stream route persiste status='error' via saveAssistantAndTitle(…, "error") sur chaque chemin d'échec (fast-mode, persistant, provider, resume, frais) et il n'est remis à 'active' qu'au prochain tour. Côté client, les seuls lecteurs du statut sont isLegacyConversationGenerating (spinner dans ChatTabBar, badge de la bande repliée, `busy` de useChatWorkspace) : un onglet/roster en erreur ne se distingue en rien d'un onglet sain, l'erreur ne survit que comme texte « Error: … » dans le contenu du message assistant. Seule la page de détail sessions/chat imprime `meta.status` brut. Le contrat parity-contract déclare aussi « generated », qu'aucun code n'écrit (rg → parity-contract.ts uniquement). Sur la base locale, 2 conversations sur 8 sont en 'error'.

**Précision du vérificateur**

Le stream route (app/api/projects/[projectId]/chat/stream/route.ts) est l'unique writer de chatConversations.status et persiste 'error' sur chaque chemin d'échec (l.701, 922, 1034/1044, 1127/1136, 1211) ; le statut n'est remis à 'generating'/'active' qu'au tour suivant (l.492, 771) ou sur cancel(). Côté client, les seuls lecteurs sont isLegacyConversationGenerating (useChatWorkspace.ts:32, UnifiedChatPanel.tsx:91, ChatTabBar.tsx:85) et la détection de changement dans useChat.ts:60-65 — aucun ne distingue 'error' de 'active'. ConversationRosterCard.tsx ne lit pas status ; la liste app/projects/[projectId]/sessions/page.tsx (l.381-385, 983, 1023) ignore aussi 'error' et exclut explicitement les conversations du filtre « failed ». Seule la page de détail app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx l.160-172 imprime meta.status brut (non traduit, distingué par couleur text-destructive). Sur le chemin « frais » (l.1200-1211) aucun texte d'erreur n'est enqueued ni sauvé : l'erreur n'y survit que dans la colonne status invisible. « generated » n'est écrit nulle part (rg → parity-contract.ts:6,10 seulement). Base locale : active 6, error 2. Aucun consommateur MCP/routine/desk ne lit ce statut.

La route stream (app/api/projects/[projectId]/chat/stream/route.ts) persiste status='error' via saveAssistantAndTitle(…, "error") aux l.701, 922, 1034, 1044, 1127, 1136, 1211 ; les seuls retours à 'active' hors succès sont dans les cancel() (l.709, 931, 1051, 1143, 1217), donc 'error' reste jusqu'au prochain tour (setConversationStatus("generating") l.492/771). Aucun autre module n'écrit le statut. Côté client, les lecteurs du statut sont : isLegacyConversationGenerating (hooks/useChatWorkspace.ts:32, components/chat/UnifiedChatPanel.tsx:91, components/chat/ChatTabBar.tsx:85), hooks/useChat.ts:60-65 (simple signal de rechargement) et app/projects/[projectId]/sessions/page.tsx:384 et ~1027 (filtre/libellé « generating », sinon « chat ») — tous ne distinguent que 'generating' : un onglet, une carte du roster (ConversationRosterCard.tsx ne lit pas le statut) ou une ligne de la liste sessions en 'error' est indiscernable d'une conversation saine ; l'erreur ne survit que dans le texte « Error: … » du message assistant. Seule app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:160-173 affiche `meta.status` brut (mot anglais non traduit) en le colorant text-destructive quand il vaut "error". Le contrat lib/chat/parity-contract.ts:3-10 (et le commentaire lib/db/schema.ts:163) déclare « generated », valeur écrite autrefois par app/api/projects/[projectId]/epic-create/route.ts supprimé au commit ca1883dd (12/02/2026) ; plus aucun code ne l'écrit. Base locale data/arij.db : 6 conversations 'active', 2 'error'.

**Recommandation**

Afficher l'état en mot sur la carte/onglet (règle Piscine : l'état est un mot, pas une couleur) ou cesser de persister 'error' ; retirer « generated » du contrat ou en documenter l'origine.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n '"generated"' app lib components hooks → lib/chat/parity-contract.ts:6,10 seulement ; rg 'conversation.status|\.status' components/chat components/chat-page hooks/useChat*.ts → seuls appels : isLegacyConversationGenerating (useChatWorkspace.ts:32, UnifiedChatPanel.tsx:91, ChatTabBar.tsx:85) ; sqlite readonly `select status,count(*) from chat_conversations group by status` → active 6, error 2.

</details>

### #45 — chat/stream/route.ts est un god-file de 1 222 lignes : cinq chemins d'exécution qui recopient le même échafaudage SSE

**Nature** refacto · **Impact** moyen · **Effort** L · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `app/api/projects/[projectId]/chat/stream/route.ts:495`
- `app/api/projects/[projectId]/chat/stream/route.ts:831`
- `app/api/projects/[projectId]/chat/stream/route.ts:971`
- `app/api/projects/[projectId]/chat/stream/route.ts:1062`
- `app/api/projects/[projectId]/chat/stream/route.ts:1162`

**Constat**

La route porte la résolution provider/agent, la construction des prompts (chat, refinement, finalization), la lecture des réglages, puis cinq branches (fast-mode OpenAI, persistant claude/omp, provider non-Claude, Claude resume, Claude frais) qui construisent chacune leur `new ReadableStream({start, cancel})`, leur `activityRegistry.register`, leur `saveAssistantAndTitle`, leur `cliToolChannel?.release()` et leur `setConversationStatus("active")`. La logique de « resume expiré → retenter en frais » est écrite trois fois (l.884-914, l.1010-1027, l.1102-1117). C'est de la logique métier dans une route, et la route non-stream en recopie une partie (finding dédié).

**Précision du vérificateur**

`app/api/projects/[projectId]/chat/stream/route.ts` fait 1 222 lignes et porte, en plus de la validation HTTP, la résolution provider/agent (l.83, l.177), la lecture des réglages (l.102, l.806-814), la construction des prompts chat / création d'epic / finalisation (l.382-435), et cinq chemins d'exécution qui recopient chacun le même échafaudage SSE : `activityRegistry.register` (l.495, 831, 971, 1062, 1162) suivi d'un `new ReadableStream({start, cancel})` (l.535, 842, 982, 1073, 1176) — fast-mode OpenAI, tour persistant, provider dynamique non-Claude, Claude resume-first, Claude fresh stream-json — chacun refaisant sa persistance (`saveAssistantAndTitle`, l.314) et son `setConversationStatus("active")`. La logique « resume expiré → retenter en frais » est écrite trois fois (l.888-914 sur exception, l.998-1027 et l.1095-1117 sur `!result.success`). Nuance par rapport au finding d'origine : la libération du canal d'outils n'est pas uniforme — `cliToolChannel?.release()` n'existe que dans les trois derniers chemins, le fast-mode a son propre `releaseToolChannel()` (l.527) et le chemin persistant ne libère rien, ce qui renforce l'argument (l'échafaudage est dupliqué *et* divergent).

**Recommandation**

Extraire un lib/chat/turn-runner.ts : une fonction `runChatTurn(strategy)` qui possède le ReadableStream, l'activityRegistry, la persistance et le cancel, et cinq stratégies (`fastMode`, `persistent`, `provider`, `claudeResume`, `claudeStream`) qui ne rendent qu'un AsyncIterable<StreamChunk> ; la route ne fait plus que valider et choisir la stratégie.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n 'new ReadableStream\(|activityRegistry\.register\(' → 5 occurrences chacun (l.495/535, 831/842, 971/982, 1062/1073, 1162/1176) ; rg -c des cinq appels d'échafaudage (ReadableStream, register, saveAssistantAndTitle, setConversationStatus("active"), release) → 40 occurrences ; wc -l → 1222.

</details>

### #136 — La migration « unified chat cutover » tourne à chaque démarrage, par projet, et écrit un backup complet à chaque fois

**Nature** à moitié câblé · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `lib/chat/unified-cutover-migration.ts:370`
- `app/api/projects/[projectId]/conversations/route.ts:49`
- `lib/chat/unified-cutover-migration.ts:217`
- `docs/plans/2026-08-14-cleanup-refactor-plan.md:173`

**Constat**

runUnifiedChatCutoverMigrationOnce (lib/chat/unified-cutover-migration.ts:370-390) n'a qu'un garde en mémoire (`migratedProjects` Set) : à chaque nouveau process, le premier GET /api/projects/:id/conversations (route.ts:49) relance la migration pour ce projet. runUnifiedChatCutoverMigration (L217-262) écrit systématiquement un snapshot complet des conversations/messages/attachments dans data/migrations/unified-chat-cutover/<projectId>/<ts>-backup.json puis un report. Sur ce poste : 141 répertoires projet, 746 fichiers, 6,4 Mo, dernier run 2026-09-10T10:14. Le plan de nettoyage du 14/08 (docs/plans/2026-08-14-cleanup-refactor-plan.md:173 et :323) liste encore ce retrait comme ouvert, et docs/architecture/unified-chat-left-panel.md:98 décrit la situation comme « live code ». C'est une migration de données qui n'est jamais devenue une migration (pas de marqueur persisté, pas dans lib/db/migrations, pas dans instrumentation.ts).

**Précision du vérificateur**

runUnifiedChatCutoverMigrationOnce (lib/chat/unified-cutover-migration.ts:370-390) n'a qu'un garde `migratedProjects` en mémoire (L102) : à chaque nouveau process, le premier GET /api/projects/:id/conversations (route.ts:49, seul appelant) relance runUnifiedChatCutoverMigration (L217-262), qui écrit inconditionnellement un backup JSON complet des conversations/messages (corps `content` en clair)/attachments puis un report, avant même de chercher des orphelins. Aucun marqueur persisté (0 clé settings, rien dans lib/db/migrations ni instrumentation.ts). Sur ce poste (arbre de travail, 2026-09-11) : 231 répertoires projet, 926 fichiers, 7,5 Mo, dernier run 2026-09-10T12:19:47Z, alors que la base ne contient que 2 projets et 0 message orphelin — la migration est un no-op qui continue d'archiver les chats à chaque démarrage. Le plan du 14/08 (:173, :322) et unified-chat-left-panel.md:96-99 confirment le retrait comme ouvert.

`runUnifiedChatCutoverMigrationOnce` (lib/chat/unified-cutover-migration.ts:370-390) n'a qu'un garde en mémoire (`migratedProjects` Set, L102). Son unique appelant est `GET /api/projects/:id/conversations` (route.ts:49), lui-même atteint depuis la page /chat via `useConversations` → `useChatWorkspace` → `ChatPageView`/`ConversationRoster` (dont le commentaire L24-28 documente l'effet de bord). À chaque nouveau process (ou rechargement HMR du module de route), le premier chargement des conversations d'un projet relance la migration pour ce projet ; `runUnifiedChatCutoverMigration` (L217-250) écrit alors inconditionnellement un backup complet (conversations + messages avec `content`/`metadata` + attachments) puis un report, même quand before/after = 0 et `messagesReassigned = 0`. État mesuré le 11/09 : 231 répertoires projet, 926 fichiers, 7,5 Mo dans data/migrations/unified-chat-cutover, jusqu'à 140 backups pour un même projet (u1HcvrXnpuvm), dernier run 2026-09-10T12:19:47Z. Aucun marqueur persisté (ni settings, ni lib/db/migrations, ni instrumentation.ts) ; le retrait reste ouvert dans docs/plans/2026-08-14-cleanup-refactor-plan.md:173 et :323, et docs/architecture/unified-chat-left-panel.md:98 le décrit comme « Still wired ».

**Recommandation**

Persister un marqueur (clé settings `chat_cutover_migrated:<projectId>` ou migration SQL numérotée 0056 qui fait le UPDATE chat_messages SET conversation_id … en une passe globale), l'exécuter une seule fois depuis instrumentation.ts après ensureDbReady(), puis supprimer le module, la couche lib/chat/parity-contract.ts et les shims Legacy* qu'il justifie. Purger data/migrations/unified-chat-cutover.

<details><summary>Preuve relevée par l'auditeur</summary>

rg runUnifiedChatCutoverMigrationOnce → seul appelant conversations/route.ts:49 ; `migratedProjects` est un Set module (L370-376) ; writeFileSync du backup L241 inconditionnel ; `ls data/migrations/unified-chat-cutover | wc -l` = 141, `find … -type f | wc -l` = 746, `du -sh` = 6.4M ; ls -t montre 2026-09-10T10-14-57-914Z-backup.json.

</details>

### #46 — Renommer une conversation existe dans l'API et le hook mais aucune interface ne l'appelle

**Nature** à moitié câblé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `app/api/projects/[projectId]/conversations/[conversationId]/route.ts:644-646`
- `lib/validation/chat-schemas.ts:31`
- `hooks/useConversations.ts:29-34`
- `hooks/useChatWorkspace.ts:42-47`
- `components/chat-page/agent-selection.ts:29-35`

**Constat**

PATCH /conversations/:id accepte `label` (route:644-646), updateConversationSchema le valide, UpdateConversationInput.label est typé dans useConversations.ts, mais le seul appelant de updateConversation est useChatWorkspace.selectAgent avec agentSelectionPatch, qui ne produit que provider/namedAgentId. Ni le panneau ni la page n'ont d'édition de titre ; le titre n'est donc modifiable que par la génération automatique du stream (route:345). Le champ de contrat traverse trois couches pour rien.

**Précision du vérificateur**

PATCH /api/projects/:projectId/conversations/:conversationId accepte et persiste `label` (route.ts:188-189, schéma lib/validation/chat-schemas.ts:31, type client hooks/useConversations.ts:31), mais l'unique appelant de updateConversation est hooks/useChatWorkspace.ts:45 (selectAgent) avec agentSelectionPatch (components/chat-page/agent-selection.ts:29-35), qui ne produit jamais `label`. Aucun fetch PATCH direct, aucune UI de renommage, aucun test n'exerce ce champ ; c'était déjà le cas à HEAD (ChatPageView.tsx:791, UnifiedChatPanel.tsx:287). Le titre n'est modifiable que par l'auto-titrage de app/api/projects/[projectId]/chat/stream/route.ts:345-358 (réservé aux labels par défaut « Brainstorm »/« New Epic »/« Chat »). Le champ `type` d'UpdateConversationInput est dans le même cas (absent du schéma et du handler PATCH). Les numéros de ligne « route:644-646 » et « route:345 » du finding sont erronés (le fichier fait 218 lignes).

PATCH /api/projects/:projectId/conversations/:conversationId accepte `label` (route.ts:188-189, fichier de 218 lignes — pas 644-646), `updateConversationSchema` le valide (lib/validation/chat-schemas.ts:31) et `UpdateConversationInput.label` est typé (hooks/useConversations.ts:29-34), mais le seul appelant de `updateConversation` est `useChatWorkspace.selectAgent` (hooks/useChatWorkspace.ts:42-46) via `agentSelectionPatch` (components/chat-page/agent-selection.ts:29-35) qui ne produit que provider/namedAgentId. Aucune surface (roster card, tab bar, page sessions/chat) n'a d'éditeur de titre, aucun appel PATCH par URL ailleurs (MCP, routines, bin). Le titre n'est donc modifiable que par la génération automatique dans app/api/projects/[projectId]/chat/stream/route.ts:354 (`.set({ label: title })`), pas « route:345 ». La branche `label` du PATCH est du code mort sur trois couches ; `UpdateConversationInput.type` (useConversations.ts:30) est dans le même cas et n'est même pas dans le schéma.

**Recommandation**

Soit ajouter le renommage (double-clic sur la carte du roster / onglet), soit retirer `label` du PATCH, du schéma et d'UpdateConversationInput pour que le contrat reflète l'usage.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n 'updateConversation\(' app components hooks -g '!hooks/useConversations.ts' → seul hooks/useChatWorkspace.ts:45 `updateConversation(activeId, patch)` avec patch = agentSelectionPatch(choice) qui ne renvoie que {namedAgentId} ou {provider, namedAgentId:null}.

</details>

### #47 — Les pages Sessions testent `type === "epic"` alors que toutes les conversations sont écrites en « epic_creation »

**Nature** cassé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `app/projects/[projectId]/sessions/page.tsx:984`
- `app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:133`
- `app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:189-194`
- `app/api/projects/[projectId]/sessions/route.ts:216`
- `app/api/projects/[projectId]/conversations/[conversationId]/route.ts:28`
- `lib/chat/conversation-agent.ts:27-31`

**Constat**

app/projects/[projectId]/sessions/page.tsx:984 et sessions/chat/[conversationId]/page.tsx:133 choisissent l'icône Sparkles sur `type === "epic"`. Tous les créateurs écrivent EPIC_CREATION_AGENT_TYPE = "epic_creation" (ChatTabBar:144, NewConversationCard:83, UnifiedChatPanel:157) ; « epic » n'est que la valeur héritée que normalizeConversationAgentType convertit — mais seule la route de LISTE normalise (conversations/route.ts:304) ; la route de détail (conversations/[conversationId]/route.ts:28) et l'API sessions (sessions/route.ts:216 `type: chatConversations.type`) renvoient la colonne brute. Résultat : l'icône epic n'apparaît jamais pour les lignes récentes, et le badge de la page détail affiche « epic_creation » non traduit (l.189-194). Base locale : 6 conversations epic_creation, 0 « epic ».

**Précision du vérificateur**

app/projects/[projectId]/sessions/page.tsx:984 et app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:133 choisissent l'icône Sparkles sur `type === "epic"`, alors que tous les créateurs (ChatTabBar:144, UnifiedChatPanel:157, NewConversationCard:83) écrivent "epic_creation" et que la route POST (conversations/route.ts:167) l'insère tel quel. `normalizeConversationAgentType` (lib/chat/conversation-agent.ts:27-31) n'est appliqué que par la route de liste (conversations/route.ts:31) ; la route de détail (conversations/[conversationId]/route.ts:28) et l'API sessions (sessions/route.ts:216) renvoient la colonne brute — et de toute façon la normalisation produit "epic_creation", que les deux tests ne reconnaissent pas non plus. Résultat : l'icône epic n'apparaît pour aucune conversation récente, et le badge de la page détail (l.158, `{meta.type}`) affiche « epic_creation » brut, sans clé i18n. Base locale : 6 epic_creation, 2 brainstorm, 0 « epic ». Correctif : remplacer les deux tests par `isEpicCreationConversationAgentType(type)` (déjà utilisé par ChatTabBar:70 et useChatWorkspace:73) et traduire le type ; normaliser en plus dans les routes de détail/sessions est secondaire et ne suffirait pas seul.

`app/projects/[projectId]/sessions/page.tsx:984` et `app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:133` choisissent l'icône Sparkles sur `type === "epic"`, valeur héritée que seule `normalizeConversationAgentType` (`lib/chat/conversation-agent.ts:27-31`) convertit. Les trois créateurs écrivent « epic_creation » (ChatTabBar:144, UnifiedChatPanel:157, NewConversationCard:83 via EPIC_CREATION_AGENT_TYPE) et `POST conversations/route.ts:167` l'insère brut. Les deux pages sont atteintes (nav.ts:165, DeskProjectMenu:27, lien liste→détail page:994) et consomment des routes qui renvoient la colonne brute : `sessions/route.ts:216` (via `lib/agent-sessions/session-list.ts:108`) et `conversations/[conversationId]/route.ts:28` (fetch page détail:75) ; seule la route de liste normalise (`conversations/route.ts:31`), et elle n'est pas utilisée ici. Résultat vérifié sur `data/arij.db` (6 epic_creation, 2 brainstorm, 0 epic) : l'icône epic n'apparaît jamais, et le badge de la page détail (`{meta.type}` l.158, pas l.189-194 qui est le badge provider) affiche « epic_creation » brut, sans clé i18n dans ProjectSessions.json.

**Recommandation**

Remplacer les deux tests par isEpicCreationConversationAgentType(type) et traduire le type via une table de clés ; normaliser le type dans la route de détail et l'API sessions comme le fait la liste.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n 'type === "epic"' app components → les deux sites ; rg -n 'type: "epic_creation"|EPIC_CREATION_AGENT_TYPE' → tous les créateurs ; sqlite readonly group by type → epic_creation 6, brainstorm 2.

</details>

### #48 — UnifiedChatPanelHandle.openChat/collapse/hide et la branche `?panel=chat` n'ont aucun producteur

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `components/chat/UnifiedChatPanel.tsx:37-42`
- `components/chat/UnifiedChatPanel.tsx:149-167`
- `app/projects/[projectId]/page.tsx:166`
- `app/projects/[projectId]/page.tsx:196-199`
- `app/projects/[projectId]/layout.tsx:173-181`
- `docs/architecture/unified-chat-left-panel.md:52-56`

**Constat**

La page projet consomme `?panel=chat` (page.tsx:196-197 → panelRef.openChat()) et l'expose dans son commentaire, mais rien ne pousse ce paramètre : le menu New du layout ne pousse que panel=new-epic-manual, panel=new-epic et panel=new-bug (layout.tsx:173,181,…), la TopBar lie vers /chat. Le seul producteur est le test __tests__/kanban-build-toolbar.test.tsx:168. `collapse()` et `hide()` du handle ne sont appelés nulle part hors du composant. Le doc unified-chat-left-panel.md:52-56 affirme encore que `?panel=chat` est poussé par le menu New.

**Précision du vérificateur**

Vrai, avec numéros de ligne corrigés. La page projet consomme `?panel=chat` dans son effet `app/projects/[projectId]/page.tsx:187-203` (`panelRef.current?.openChat()` l.196-197) mais aucun code ne pousse cette valeur : l'unique émetteur est `openBoardPanel` (`app/projects/[projectId]/layout.tsx:109`), appelé seulement avec les littéraux `panel=new-epic-manual` (l.155), `panel=new-epic` (l.163), `panel=new-bug` (l.172) et `night=start` (l.187) — pas 173/181. Les seules autres occurrences de `panel=chat` sont le commentaire page.tsx:166, le doc `docs/architecture/unified-chat-left-panel.md:50-53` (qui affirme à tort que le menu New la pousse) et `__tests__/kanban-build-toolbar.test.tsx:167-168`. Sur le handle `UnifiedChatPanelHandle` (UnifiedChatPanel.tsx:37-42, impl. 149-167), `collapse()` et `hide()` n'ont aucun appelant ; `openChat()` n'a que l'appelant mort ci-dessus (la bande repliée appelle la fonction locale `openChatConversation()` en l.364, pas le handle). Seul `openNewEpic()` est réellement atteint.

**Recommandation**

Réduire le handle à openNewEpic (ou ajouter un vrai déclencheur `panel=chat` si le parcours est voulu), supprimer la branche morte de page.tsx et corriger le doc.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n 'panel=chat' app components lib hooks e2e __tests__ → page.tsx:166 (commentaire) et __tests__/kanban-build-toolbar.test.tsx:168 uniquement ; rg -n '\.collapse\(\)|\.hide\(\)' app components hooks → 0 résultat ; rg 'panelRef.current' page.tsx → openChat (197) et openNewEpic (199).

</details>

### #50 — Les libellés persistés « Brainstorm » / « New Epic » / « Chat » sont recopiés à neuf endroits et servent de sentinelle à la génération de titre

**Nature** doublon · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `app/api/projects/[projectId]/conversations/route.ts:69`
- `app/api/projects/[projectId]/conversations/route.ts:168`
- `app/api/projects/[projectId]/chat/stream/route.ts:345`
- `components/chat/UnifiedChatPanel.tsx:104`
- `components/chat/ChatTabBar.tsx:130-144`
- `components/chat-page/NewConversationCard.tsx:75-83`
- `lib/chat/parity-contract.ts:37-42`
- `lib/chat/conversation-agent.ts:14-25`
- `lib/db/schema.ts:162`

**Constat**

Le même littéral est écrit en base par : conversations/route.ts:69 et :168 (défauts GET/POST), schema.ts:162 (default SQL), UnifiedChatPanel.tsx:104,139,157, ChatTabBar.tsx:130-144, NewConversationCard.tsx:75,83, unified-cutover-migration.ts:311 ; parity-contract.ts:37-42 les reconstruit comme repli d'affichage ; et stream/route.ts:345 compare `conv.label === "Brainstorm" || "New Epic" || "Chat"` pour décider s'il faut générer un titre. Une conversation créée avec un autre libellé par un client API ne sera jamais titrée ; un renommage d'un défaut casse silencieusement la sentinelle. lib/chat/conversation-agent.ts:14-25 contient déjà BUILTIN_CONVERSATION_AGENT_TYPES (type → label → mode) mais cette table est morte (0 référence).

**Précision du vérificateur**

Finding confirmé, avec deux précisions. (1) Les sites d'écriture sont au moins onze, pas neuf : app/api/projects/[projectId]/conversations/route.ts:69 et :168, lib/db/schema.ts:162 (default SQL, repris dans lib/db/migrations/0000_rare_apocalypse.sql:23), components/chat/UnifiedChatPanel.tsx:104,139,157, components/chat/ChatTabBar.tsx:130 (`{type:"chat",label:"Chat"}`), :137, :144, components/chat-page/NewConversationCard.tsx:75,83, lib/chat/unified-cutover-migration.ts:311. (2) BUILTIN_CONVERSATION_AGENT_TYPES n'est pas un simple doublon prêt à l'emploi : son entrée epic_creation porte le label « Epic Creation », pas « New Epic » (lib/chat/conversation-agent.ts:20-23), et il manque l'entrée `chat` — la faire vivre telle quelle changerait les libellés persistés et casserait la sentinelle. Le reste est exact : la constante est bien morte (unique occurrence = sa déclaration, alors que les autres exports du même fichier sont utilisés), et app/api/projects/[projectId]/chat/stream/route.ts:345 conditionne la génération de titre à `conv.label === "Brainstorm" || "New Epic" || "Chat"`, donc une conversation créée par un client API avec `body.label` personnalisé (route.ts:168 accepte n'importe quelle chaîne) n'est jamais titrée.

**Recommandation**

Faire vivre BUILTIN_CONVERSATION_AGENT_TYPES (ajouter le type chat) comme unique source des couples type/label, l'utiliser dans les trois menus, les défauts de route et la sentinelle de titre (ou remplacer la sentinelle par un flag `titleGenerated`).

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n '"Brainstorm"|"New Epic"' app components hooks lib -g '!*.json' → 15 lignes dont 9 sites d'écriture ; rg -l 'BUILTIN_CONVERSATION_AGENT_TYPES' app components hooks lib __tests__ e2e → lib/chat/conversation-agent.ts seul.

</details>

### #51 — Exports morts du domaine chat (vérifiés un par un)

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `lib/chat/conversation-agent.ts:1-25`
- `lib/chat/parity-contract.ts:9`
- `lib/chat/parity-contract.ts:58`
- `lib/chat/persistent-runner.ts:1018`
- `hooks/useChat.ts:186`
- `components/chat-page/agent-selection.ts:11`

**Constat**

lib/chat/conversation-agent.ts : CUSTOM_REVIEW_AGENT_PREFIX (l.6), BUILTIN_CONVERSATION_AGENT_TYPES (l.14) et son type BuiltinConversationAgentType (l.8) — 0 référence dans app/components/hooks/lib/__tests__/e2e/scripts ; UNSELECTED_AGENT_TYPE (l.1) et LEGACY_EPIC_AGENT_TYPE (l.4) n'ont qu'un usage interne, l'export est superflu. lib/chat/parity-contract.ts : compareConversationsByLegacyOrder (l.58) interne seulement ; LEGACY_CONVERSATION_STATUSES (l.9) test-only ; de plus la liste est triée deux fois (route conversations:301 puis useConversations.ts:251 withConversations). lib/chat/persistent-runner.ts : isPersistentChatSessionWarm (l.1018) interne seulement. hooks/useChat.ts : setMessages (l.186) exporté, aucun consommateur produit (seuls deux tests). components/chat-page/agent-selection.ts : alias ChatAgentSelectionInput (l.11) utilisé uniquement dans son fichier.

**Précision du vérificateur**

Exports morts du domaine chat — confirmés, avec lignes corrigées et une réserve sur le double tri.

Sans aucun consommateur (ni prod, ni test, ni e2e, ni réexport) : lib/chat/conversation-agent.ts CUSTOM_REVIEW_AGENT_PREFIX (l.6), BUILTIN_CONVERSATION_AGENT_TYPES (l.14) et BuiltinConversationAgentType (l.8) ; lib/chat/parity-contract.ts compareConversationsByLegacyOrder (l.58) ; lib/chat/persistent-runner.ts isPersistentChatSessionWarm (l.443, PAS 1018) ; components/chat-page/agent-selection.ts ChatAgentSelectionInput (l.11).
Exports superflus (usage interne seul) : UNSELECTED_AGENT_TYPE (l.1) et LEGACY_EPIC_AGENT_TYPE (l.4) de conversation-agent.ts.
Test-only : LEGACY_CONVERSATION_STATUSES (parity-contract.ts:9, consommé par __tests__/chat-parity-contract.test.ts).
hooks/useChat.ts : setMessages construit l.131 et exposé l.137 (PAS 186) ; aucun consommateur produit, seulement deux mocks de test — le setMessages de app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx est un useState local homonyme.

Réserve : le « double tri » existe (app/api/projects/[projectId]/conversations/route.ts:28 et hooks/useConversations.ts:52, pas 301/251) mais le tri client N'EST PAS retirable : withConversations est aussi appelé l.133 (insertion locale d'une conversation créée) et l.153 (suppression), où rien d'autre ne garantit l'ordre. Seul l'appel du chemin refresh (l.78) est redondant, et il est défensif/bon marché.

**Recommandation**

Supprimer les exports/constantes sans consommateur, retirer le second tri client (garder celui de la route ou l'inverse), retirer setMessages de l'API de useChat.

<details><summary>Preuve relevée par l'auditeur</summary>

Pour chaque symbole : rg -l '\bNOM\b' app components hooks lib __tests__ e2e scripts → uniquement le fichier de définition (CUSTOM_REVIEW_AGENT_PREFIX, BUILTIN_CONVERSATION_AGENT_TYPES, BuiltinConversationAgentType, UNSELECTED_AGENT_TYPE, LEGACY_EPIC_AGENT_TYPE, compareConversationsByLegacyOrder, isPersistentChatSessionWarm) ; setMessages → hooks/useChat.ts + 2 tests (la page sessions/chat a son propre useState homonyme).

</details>

### #52 — Deux chemins de création d'epic depuis une conversation, avec des charges utiles différentes, cohabitent sur /chat

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `hooks/useEpicCreate.ts:138-147`
- `components/chat-page/DraftedEpicCard.tsx:94-126`
- `components/chat-page/ChatPageView.tsx:640-670`
- `hooks/useChatWorkspace.ts:48-55`

**Constat**

hooks/useEpicCreate.ts (chemin « fallback », bouton Create Epic du footer et ChatProposalCard du panneau) relit l'historique via GET /chat, envoie jusqu'à deux tours de finalisation, poll 180 s, puis POST /epics avec `status: "backlog"` et sans `type`. components/chat-page/DraftedEpicCard.tsx (carte dans le fil, page seulement) POST /epics avec `status: "todo"|"backlog"` et `type: "feature"`, puis optionnellement POST /build. Sur /chat, les deux sont atteignables pour une même conversation (le footer apparaît tant qu'aucun message ne parse, la carte dès qu'un message parse : ChatPageView.tsx:640-641). Les sorties de useEpicCreate (`createdEpic`, `onEpicCreated(result)`) ne sont pas consommées par useChatWorkspace, qui se contente d'un router.refresh().

**Précision du vérificateur**

Deux chemins de création d'epic depuis une conversation cohabitent, avec des charges utiles et un parsing différents, mais ils sont mutuellement exclusifs dans l'UI et le serveur les déduplique. Fallback : `hooks/useEpicCreate.ts` (bouton footer de /chat, ChatProposalCard du panneau projet) relit `GET /api/projects/:id/chat`, envoie jusqu'à 2 tours de finalisation, poll 180 s (l. 10-11, 93-125), puis POST /epics avec `status: "backlog"` et sans `type` (l. 133-143), à partir d'un parse de tout l'historique. Carte en fil : `components/chat-page/DraftedEpicCard.tsx:96-127` poste `status: "todo"|"backlog"` + `type: "feature"` à partir d'un parse d'un seul message, avec POST /build optionnel. Le footer n'apparaît que tant qu'aucun message ne parse (`ChatPageView.tsx:646-647`), donc les deux ne sont pas atteignables en même temps, seulement successivement. Côté serveur, `epics/route.ts:529` applique `body.type || "feature"` et `lib/chat/epic-proposals.ts:25-41` inclut ce même `type` normalisé dans l'empreinte d'idempotence tout en excluant volontairement `status` : à charge utile identique il n'y a pas de doublon, seul le premier statut posé gagne. Le vrai résidu est de la duplication et du code mort : `useEpicCreate` n'a qu'un consommateur, `hooks/useChatWorkspace.ts:23`, qui ne passe pas `onEpicCreated` (prop l. 25/168 sans fournisseur) et n'expose pas `createdEpic` (l. 195), lequel n'est donc jamais lu.

**Recommandation**

Faire de DraftedEpicCard le seul créateur (déjà prévu par le doc frame 11a) et réduire useEpicCreate à la finalisation (tours + poll) qui alimente la carte ; supprimer createdEpic/onEpicCreated non lus.

<details><summary>Preuve relevée par l'auditeur</summary>

useEpicCreate.ts:144 `status: "backlog"` sans type ; DraftedEpicCard.tsx:100-106 `status, type: "feature", userStories` ; rg -n 'createdEpic' hooks/useChatWorkspace.ts components/chat components/chat-page → 0 (hors ChatThread.onEpicCreated qui est une autre prop) ; epics/route.ts:514 applique `body.type || "feature"` donc l'écart de type est masqué côté serveur mais l'écart de statut ne l'est pas.

</details>

### #53 — GET /chat/uploads/:attachmentId sert n'importe quelle pièce jointe quel que soit le projectId de l'URL

**Nature** risque · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** chat

**Fichiers**
- `app/api/projects/[projectId]/chat/uploads/[attachmentId]/route.ts:9-18`
- `app/api/projects/[projectId]/chat/uploads/[attachmentId]/route.ts:54-60`
- `lib/uploads/attachment-ownership.ts:156-159`

**Constat**

La route lit `chatAttachments` par id seul (l.13-18) et ignore `projectId` de la route, alors que le DELETE voisin passe par discardStagedUpload(projectId, attachmentId) qui scope par projet. Contrat incohérent entre les deux verbes d'une même route ; une URL /api/projects/AUTRE/chat/uploads/<id> renvoie le fichier. Application locale, mais à rapprocher des findings ouverts du 06/09 sur le bind 0.0.0.0.

**Précision du vérificateur**

GET /api/projects/:projectId/chat/uploads/:attachmentId (route.ts l.13-19) lit chat_attachments par id seul et ne lit jamais `projectId` ; toute URL avec un autre projectId sert le fichier. Le DELETE voisin (l.58-60 → discardStagedUpload, attachment-ownership.ts l.153-172) et la route sœur /uploads/[fileName] (lookupServableUpload) scopent tous deux par projet : le GET chat est le seul point d'entrée non scopé. Aucun garde dans proxy.ts, aucun consommateur cross-projet légitime, et le test chat-attachment-serve-route.test.ts ne fait jamais varier projectId. Correction : appliquer au GET la même règle d'appartenance que discardStagedUpload (project_id égal, ou préfixe `uploadsDirectoryFor(projectId)/` du file_path pour les lignes à project_id NULL) plutôt qu'un `eq(projectId)` strict qui divergerait du DELETE.

GET /api/projects/:projectId/chat/uploads/:attachmentId (route.ts l.13-19) lit chat_attachments par id seul et ignore le projectId de l'URL, alors que le DELETE de la même route (l.58-60 → discardStagedUpload, attachment-ownership.ts l.156-175) et la route sœur /uploads/[fileName] (lookupServableUpload, servable-uploads.ts l.81-87) sont scoped par projet. Le GET est bien atteint en production (chat/route.ts:67, useImageAttachments.ts:123 → <img src> dans MessageList.tsx:84 et UserBubble.tsx:48) et le test chat-attachment-serve-route.test.ts ne couvre pas le cas projectId étranger. Incohérence de contrat et d'hygiène (une URL /api/projects/AUTRE/chat/uploads/<id> sert le fichier), mais pas une frontière de sécurité : l'application n'a aucune autorisation par projet (proxy.ts = Host/Origin/token uniquement), le DELETE documente son scoping comme « reads as absent » et l'id est un nanoid. Correction : réutiliser la même vérification belongsToProject que le DELETE (égalité projectId, repli sur le préfixe uploadsDirectoryFor(projectId)/ pour les lignes à project_id NULL) plutôt qu'un simple eq(projectId).

**Recommandation**

Ajouter `eq(chatAttachments.projectId, projectId)` au SELECT du GET (la colonne existe : upload/route.ts:88 l'écrit).

<details><summary>Preuve relevée par l'auditeur</summary>

uploads/[attachmentId]/route.ts:13 `const { attachmentId } = await params;` (projectId non lu) puis `.where(eq(chatAttachments.id, attachmentId))` ; DELETE l.58 `discardStagedUpload(projectId, attachmentId)`.

</details>


## État au 16/09/2026 — livré

Branche `feature/lots-03-05-10`, commit `5f6e6a8b`, au-dessus du lot 03 (même
base instantanée `012cdf02`, voir la fiche du lot 03). Serveur puis client, chacun
revu par un agent adverse puis corrigé.

Fait : #45 (`lib/chat/turn-runner.ts` + `turn-strategies.ts`), #42 (POST
non-stream retiré), #43/#136 (migration SQL `0063_chat_orphan_messages_cutover`,
plus aucun backup), #53 (uploads scopés au projet), #50
(`lib/chat/conversation-labels.ts`), #47, #41 (entrée « Chat » sur /chat), #44
(statut error en mot), #46 (renommer), #52 (un seul chemin de création d'epic),
#48, #51, #40 (UnifiedChatPanel rend les composants de chat-page ; ChatTabBar,
ChatWorkspaceHeader, MessageInput et le namespace ChatLegacy supprimés).
En plus : le titre généré ne remplace plus un renommage fait pendant le titrage
(UPDATE conditionnel, `__tests__/chat-title-rename-race.test.ts`). Les 12 échecs
de base de `conversations-route.test.ts` sont corrigés (mocks `request.text`).

Reste :
- `rm -rf data/migrations/unified-chat-cutover` à la main dans le dépôt principal.
- `MessageList.tsx` gardé : seul consommateur, la transcription en lecture seule
  de `sessions/chat/[conversationId]`.
- Suppression de conversation non branchée sur /chat (il faut une confirmation
  PermanentDeleteDialog) ; ContextRail / Created here / pane switcher restent
  propres à la page, par choix.
- `isPersistentChatSessionWarm` (export mort), champ `namedAgentId` de
  `chatMessageSchema` (mort), commentaire « generated » de `lib/db/schema.ts`.

À faire au merge — migrations : la rationalisation porte 0057–0060 non
commitées ; lot 11 `0057_release_published_at` → 0061 ; lot 07
`0061_agent_session_tool_calls` → 0062 ; lot 10 est déjà `0063` (when
1786716300000, au-dessus de tous). Mettre à jour les `MIGRATION_TAG` des tests
de migration renumérotés et garder `idx` contigu dans `_journal.json`.

Validation : même mesure que le lot 03 (commune aux deux commits).
