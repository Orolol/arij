# Lot 21 — Usage et base de données : calculs inutiles, colonnes, journal

**Difficulté** 1/4 — Simple — agent peu coûteux
**Findings** 8 (0 fort · 2 moyen · 6 faible ; effort 6 S · 2 M · 0 L)
**Dépendances** Indépendant.

**Statut** fait le 16/09/2026 — détail dans [compte rendu des lots 18, 20-22, 24](implementation-lots-18-20-21-22-24.md).

## Décision

Le rapport /api/usage ne calcule que ce que l'écran rend ; les colonnes jamais lues sont retirées par migration manuelle.

## Objectif

Retirer six sections de getUsageReport, snapshot codex hors du GET synchrone (ou mis en cache), getTicketsShipped borné, un seul éditeur du plafond mensuel, projectsHaveColorIndex supprimé, readable_agent_name remplacé par namedAgents.name puis colonne retirée, colonnes écrites jamais lues retirées, registre de colonnes de init.ts et journal documentés (préfixes dupliqués tolérés mais expliqués).

## Démarche suggérée

1. Tests de contrat de usage-report à réduire avec les sections.
2. Migrations manuelles + entrées journal (when croissant).

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #2 — Six sections du rapport /api/usage sont calculées à chaque requête et jamais rendues : doubles SQL de la section dashboard

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `lib/usage/aggregate.ts:927`
- `lib/usage/aggregate.ts:76`
- `lib/usage/aggregate.ts:113`
- `lib/usage/aggregate.ts:180`
- `lib/usage/aggregate.ts:245`
- `lib/usage/aggregate.ts:610`
- `lib/usage/aggregate.ts:733`
- `lib/usage/aggregate.ts:777`
- `lib/usage/aggregate.ts:837`
- `lib/types/usage.ts:220`
- `components/usage/UsageScreen.tsx:105`
- `components/usage/UsageScreen.tsx:126`
- `components/usage/UsageScreen.tsx:201`

**Constat**

getUsageReport (aggregate.ts:927-942) exécute getTotals, getByAgent, getByProvider, getByProject, getByDay et deux getWindowUsage tous-providers, puis calcule séparément getDashboardTotals, getDashboardByAgent, getDashboardByProject, getDashboardByDay — des jumeaux quasi identiques scoperés par range. L'écran Piscine ne lit que report.dashboard, report.subscriptions et report.generatedAt ; les clés `totals`, `byAgent`, `byProvider`, `byProject`, `byDay`, `windows` ne sont consommées par aucun composant. Le commentaire de lib/types/usage.ts:227-229 (« they still feed subscriptions and the legacy consumers ») ne tient plus : seul byProvider sert encore, en interne, à savoir s'il existe des sessions codex. __tests__/usage-report.test.ts (892 l.) fige cette forme legacy.

**Précision du vérificateur**

getUsageReport (lib/usage/aggregate.ts:938) calcule à chaque requête six sections que rien ne rend : totals (getTotals, l.79), byAgent (l.114), byProject (l.184), byDay (l.244) et windows (deux getWindowUsage tous-providers, l.944-945) — soit ~6 requêtes SQL — puis recalcule séparément les jumeaux scopés par range dans getDashboard (l.894 : getDashboardTotals 572, getDashboardByAgent 730, getDashboardByProject 777, getDashboardByDay 829), commentés eux-mêmes comme reprenant la clé de regroupement de getByAgent (l.726) et le zéro-remplissage de getByDay (l.822). Les deux seuls consommateurs de /api/usage ne lisent que dashboard, subscriptions et generatedAt : components/usage/UsageScreen.tsx (l.105/126/127) et app/settings/page.tsx:84-90, qui n'extrait que `data.dashboard.cap`. byProvider reste utilisé en interne uniquement pour `hasCodexSessions` (aggregate.ts:375-377) ; getWindowUsage reste utilisé pour la carte claude (l.461-462) et ne doit pas être supprimé, contrairement à la paire tous-providers de `report.windows`. Le commentaire lib/types/usage.ts:236-239 (« they still feed subscriptions and the legacy consumers ») est obsolète, et __tests__/usage-report.test.ts (892 l.) fige cette forme legacy.

**Recommandation**

Retirer les six clés de UsageReport et les fonctions getTotals/getByAgent/getByProject/getByDay ; remplacer byProvider par un `EXISTS(SELECT 1 FROM agent_sessions WHERE provider='codex')` interne ; élaguer usage-report.test.ts en conséquence. Gain : ~6 requêtes SQL et un payload plus petit par lecture.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "report\.(totals|byAgent|byProvider|byProject|byDay|windows)" components/usage hooks app/usage` → 0 résultat ; les seuls accès sont `report.generatedAt` (UsageScreen.tsx:105), `report.dashboard` (:126) et `report.subscriptions` (:201). SubscriptionCard ne lit que sub.* / metered.* / claudeLive / codexLive (grep des accès). __tests__/usage-page.test.tsx:51 : « The legacy 8-key `byDay`, which the 8d screen no longer reads ». aggregate.ts:375-377 `byProvider.some(row => row.provider === CODEX_PROVIDER)` est le seul usage interne des sections legacy.

</details>

### #3 — named_agents.readable_agent_name n'est jamais écrit : le badge d'agent des conversations ne s'affiche jamais

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `lib/db/schema.ts:524`
- `lib/db/schema.ts:544`
- `app/api/projects/[projectId]/sessions/route.ts:223`
- `app/api/projects/[projectId]/conversations/[conversationId]/route.ts:36`
- `app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:175`
- `lib/db/migrations/0016_readable_ids_and_agent_names.sql`

**Constat**

La colonne est ajoutée par 0016 avec un index unique mais sans backfill, et aucun INSERT/UPDATE ne la renseigne. Deux routes la sélectionnent pourtant comme `namedAgentName` pour les conversations de chat, et la page de conversation rend un Badge sous `meta.namedAgentName ? … : …` — la branche est donc toujours fausse et on tombe sur le fallback provider. La colonne + son index unique ne servent qu'à ce faux positif.

**Précision du vérificateur**

`named_agents.readable_agent_name` (schema.ts:540, index unique l.560, migration 0016) n'est écrite par aucun code : les 4 inserts/updates de lib/agent-config/named-agents.ts ne la renseignent pas, et le seul écrivain (registre GREEK_NAMES) a été supprimé au commit f0242187 en laissant les lecteurs. Deux routes la sélectionnent comme `namedAgentName` pour les conversations de chat (sessions/route.ts:223, conversations/[conversationId]/route.ts:36) ; en conséquence le badge d'agent de la page de conversation (sessions/chat/[conversationId]/page.tsx:175) et le libellé de la ligne chat de la liste des sessions (sessions/page.tsx:986) retombent toujours sur le provider (ou sur rien pour claude-code). Vérifié sur data/arij.db : 8 agents nommés, 0 readable_agent_name rempli. Les agent_sessions ne sont pas concernées (colonne propre `named_agent_name`, écrite par les dispatchers).

named_agents.readable_agent_name (lib/db/schema.ts:540, index unique :560, ajouté par la migration 0016 sans backfill) n'est renseigné par aucun INSERT/UPDATE (named-agents.ts:213/274/378/513, init.ts:446 omettent tous la colonne ; data/arij.db : 8 agents, 0 valeur). Deux routes la sélectionnent comme `namedAgentName` pour les conversations de chat (sessions/route.ts:223, conversations/[conversationId]/route.ts:36) et deux écrans la consomment : le badge de la page de conversation (sessions/chat/[conversationId]/page.tsx:175-181) et la ligne de conversation de la liste des sessions (sessions/page.tsx:986, `ChatSessionRow`). Dans les deux cas la branche est toujours nulle et on retombe sur le libellé provider, alors que les runs d'agent affichent bien leur nom via agent_sessions.named_agent_name. Sélectionner `namedAgents.name` dans les deux routes, puis supprimer colonne + index par migration manuelle et la propriété du schéma (et adapter __tests__/db-schema.test.ts:347/980 et les DDL de test named-agents-crud/named-agent-options-persistence).

**Recommandation**

Sélectionner `namedAgents.name` à la place dans les deux routes, puis ajouter une migration DROP INDEX named_agents_readable_agent_name_unique + DROP COLUMN readable_agent_name et retirer la propriété du schéma.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "readableAgentName|readable_agent_name" app components hooks lib` (hors schema/migrations) → exactement deux lignes, toutes deux des SELECT (`namedAgentName: namedAgents.readableAgentName`). Aucune occurrence dans lib/agent-config/named-agents.ts (createNamedAgent). page.tsx:175-181 rend `<Badge>{meta.namedAgentName}</Badge>` uniquement si non nul.

</details>

### #4 — Colonnes écrites mais jamais lues, et un mapping Drizzle décoratif

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `lib/db/schema.ts:121`
- `lib/db/schema.ts:122`
- `lib/db/schema.ts:731`
- `lib/db/schema.ts:967`
- `lib/db/schema.ts:992`
- `lib/db/schema.ts:33`
- `lib/db/schema.ts:167`
- `lib/github/issues.ts:319`
- `lib/github/issues.ts:331`
- `app/api/desk/dismiss/route.ts:30`
- `lib/usage/codex-snapshot.ts:136`
- `lib/db/readable-id.ts:28`
- `lib/db/resolve-cli-session-id.ts:13`
- `app/api/projects/[projectId]/conversations/route.ts:100`
- `app/api/projects/[projectId]/conversations/[conversationId]/route.ts:150`
- `lib/db/migrations/0015_cli_session_resume.sql:10`

**Constat**

Plusieurs colonnes de schema.ts n'ont aucun lecteur : epics.github_issue_url / github_issue_state (écrites une fois à `issue.githubUrl` / `"open"` et jamais mises à jour), github_issues.imported_at, desk_dismissals.dismissed_at (le lecteur du desk ne lit que signal_at), provider_usage_snapshots.source_file (écrit comme provenance, jamais relu), plus 7 timestamps updated_at/created_at écrits sans lecteur. À part : projects.ticket_counter est piloté uniquement en SQL brut (readable-id.ts) alors que la propriété Drizzle `ticketCounter` n'est jamais utilisée. Correction de l'inventaire fourni : chat_conversations.claude_session_id EST encore lu, via `select()` complet + resolveCliSessionId dans trois routes ; comme 0015 a déjà recopié claude_session_id → cli_session_id et que les seuls écrivains posent NULL, le fallback est mort en pratique mais pas dans le code.

**Précision du vérificateur**

Cinq colonnes de lib/db/schema.ts sont écrites sans jamais être relues : epics.github_issue_url et epics.github_issue_state (schema.ts:121-122, posées une seule fois à l'import GitHub, lib/github/issues.ts:319-320, et jamais rafraîchies — l'UI utilise evidence.githubUrl), github_issues.imported_at (schema.ts:747, écrite issues.ts:331), desk_dismissals.dismissed_at (schema.ts:983, écrite app/api/desk/dismiss/route.ts:30/35 alors que le seul lecteur, app/api/control-desk/route.ts:567-569, ne sélectionne qu'epicId/kind/signalAt) et provider_usage_snapshots.source_file (schema.ts:1008, écrite lib/usage/codex-snapshot.ts:136 ; les deux lecteurs font un select() complet mais n'exploitent que capturedAt et les quotas). À part, projects.ticket_counter (schema.ts:33) n'est piloté que par du SQL brut (lib/db/readable-id.ts:28-32) : la propriété Drizzle ticketCounter n'a aucun usage produit. Deux corrections au finding d'origine : (1) le sous-claim « 7 timestamps updated_at/created_at sans lecteur » n'est ni listé ni exact — settings.updatedAt est relu (lib/routines/settings.ts:40-45, components/spec/SpecWorkspace.tsx:68/109) et doit être retiré ; (2) les numéros de ligne cités pour schema.ts sont ceux de HEAD, pas de l'arbre de travail (décalage de +16 lignes au-delà de la ligne 185 à cause de l'ajout non commité de chatEpicProposals) : 731→747, 967→983, 992→1008. La remarque sur chat_conversations.claude_session_id est exacte telle quelle (code vivant via resolveCliSessionId, donnée morte depuis 0015).

**Recommandation**

Une migration de nettoyage : DROP des colonnes github_issue_url/state, imported_at, dismissed_at, source_file ; supprimer le fallback resolveCliSessionId côté chat_conversations et DROP claude_session_id sur les deux tables (0015 a déjà backfillé) ; déclarer ticket_counter via l'ORM ou retirer la propriété. Mettre à jour __tests__/db-schema.test.ts qui épingle chaque colonne.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "githubIssueUrl|githubIssueState|github_issue_url|github_issue_state" app components hooks lib` (hors schema) → uniquement lib/github/issues.ts:319-320 (écritures). `rg -n "importedAt|imported_at"` → issues.ts:331 seul. `rg -n "dismissedAt|dismissed_at"` → dismiss/route.ts:30,35,39 seul ; app/api/control-desk/route.ts sélectionne epicId/kind/signalAt. `rg -n "sourceFile|source_file"` → codex-snapshot.ts (écriture) seul. `rg -n ticketCounter app lib` → 0 ; readable-id.ts:28-32 `UPDATE projects SET ticket_counter = …`. claudeSessionId dans [conversationId]/route.ts:150,158,175,185 = `updates.claudeSessionId = null` ; conversations/route.ts:88-100 `db.select().from(chatConversations)` puis `resolveCliSessionId(conversation)` ; chat/stream/route.ts:735 idem.

</details>

### #5 — refreshCodexUsageSnapshot scanne ~/.codex et lit des rollouts entiers de façon synchrone à chaque GET /api/usage, même quand le résultat n'est pas utilisé

**Nature** risque · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `app/api/usage/route.ts:41`
- `lib/usage/codex-snapshot.ts:59`
- `lib/usage/codex-snapshot.ts:200`
- `lib/usage/codex-rate-limits.ts:105`
- `lib/usage/aggregate.ts:370`
- `lib/usage/aggregate.ts:381`

**Constat**

La route appelle refreshCodexUsageSnapshot() inconditionnellement après les polls live. Cette fonction parcourt jusqu'à 5 répertoires-jours, stat jusqu'à 10 fichiers, puis fait readFileSync du fichier entier (le parseur lui-même reconnaît des « multi-megabyte transcript ») avant d'upserter provider_usage_snapshots — tout cela sur le thread unique qui porte better-sqlite3 et les SSE. Or getSubscriptions ne consulte le snapshot que si le poll live codex a échoué (`codexLiveData` nul) ; quand le live réussit, le scan disque et l'écriture DB sont du travail perdu à chaque lecture de la page.

**Précision du vérificateur**

La route GET /api/usage (atteinte par /usage via useUsage au montage/changement de range/refresh, et par /settings à chaque montage ; jamais pollée) appelle refreshCodexUsageSnapshot() inconditionnellement (route.ts:41). Celle-ci scanne ~/.codex/sessions (5 répertoires-jours, stat de ≤10 fichiers) puis fait readFileSync + split du fichier entier le plus récent — 17,4 Mo mesurés sur cette machine — en synchrone sur le thread qui porte better-sqlite3 et les SSE. Or quand le poll live codex réussit, quota-cache.ts:127 a déjà persisté le snapshot avec capturedAt=now, donc la garde forward-only de storeSnapshot (codex-snapshot.ts:124) rejette le rollout avant l'upsert, et getSubscriptions (aggregate.ts:381) ne lit le snapshot que si codexLiveData est nul : dans ce cas le scan FS, la lecture du fichier entier, le split et un SELECT sont du travail perdu (pas l'écriture DB, qui est court-circuitée). Recommandation inchangée ; __tests__/usage-route.test.ts:170 épingle l'appel et devra suivre.

GET /api/usage (app/api/usage/route.ts:41) appelle refreshCodexUsageSnapshot() inconditionnellement après les polls live. Celle-ci (lib/usage/codex-snapshot.ts:59-104, 209-228) parcourt en synchrone jusqu'à 5 répertoires-jours de ~/.codex/sessions, fait un statSync sur chaque rollout-*.jsonl qu'ils contiennent (123 fichiers sur cette machine), puis readFileSync du fichier entier de mtime la plus récente (17,5 Mo ici) que extractLatestRateLimitSnapshot splitte intégralement en lignes (codex-rate-limits.ts:116 — le commentaire l.109 « costs only the tail » est faux même pour le parse). Or getSubscriptions (lib/usage/aggregate.ts:385-389, 395, 426) n'utilise le snapshot que si `codexLive.data` est nul ; quand le live a réussi, storeCodexLiveSnapshot (quota-cache.ts:127) a déjà écrit un snapshot daté « now », donc le garde forward-only (codex-snapshot.ts:124) fait sauter l'upsert du scan : il ne reste qu'un SELECT, mais le scan disque et la lecture/split de plusieurs Mo restent du travail perdu sur le thread principal (better-sqlite3, SSE) à chaque chargement de la page Usage et de la page Settings (app/settings/page.tsx:84). Pas de boucle de polling : coût par chargement de page, pas en continu. Le test __tests__/usage-route.test.ts:170 épingle l'appel inconditionnel et devra être ajusté.

**Recommandation**

N'appeler refreshCodexUsageSnapshot que si `codexLive.data === null`, ou le placer derrière le même TTL que quota-cache ; lire la queue du fichier (fs.openSync + lecture des derniers N Ko) plutôt que le fichier entier.

<details><summary>Preuve relevée par l'auditeur</summary>

route.ts:41 `refreshCodexUsageSnapshot(); // best-effort, never throws` après `Promise.all([getClaudeQuotaCached, getCodexQuotaCached])`. codex-snapshot.ts:204-206 `content = fs.readFileSync(filePath, "utf8")` dans la boucle sur findRecentRolloutFiles ; :59-100 readdirSync/statSync. codex-rate-limits.ts:105-108 « a multi-megabyte transcript costs only the tail » — vrai pour le parse, faux pour la lecture qui charge tout le fichier. aggregate.ts:370-375 `snapshot = db.select().from(providerUsageSnapshots)…` puis :381 `if (codexLiveData) { … } else if (snapshot || hasCodexSessions)` : le snapshot ne sert que dans la branche else.

</details>

### #6 — getTicketsShipped fait un full scan de ticket_activity_log à chaque /api/usage, contrairement à ce que son commentaire affirme

**Nature** risque · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `lib/usage/aggregate.ts:597`
- `lib/usage/aggregate.ts:625`
- `lib/db/schema.ts:871`
- `lib/db/migrations/0021_ticket_activity_log.sql:16`

**Constat**

Le commentaire dit que le cutoff « is what keeps this off a full-table scan ». Mais la clause est `datetime(created_at) >= datetime(?)` — une expression sur la colonne, inutilisable par un index — et la table n'a de toute façon aucun index sur created_at ni to_status (seulement epic_idx et project_idx). La table est décrite comme « never pruned ». Le coût croît donc linéairement avec l'historique des transitions, à chaque chargement de la page Usage. Le mélange de formats (ISO via logTransition vs CURRENT_TIMESTAMP par défaut) est la cause racine qui impose datetime().

**Précision du vérificateur**

getTicketsShipped (lib/usage/aggregate.ts:632-640) fait un scan complet de ticket_activity_log à chaque GET /api/usage (montage de la page Usage, changement de range, Refresh, plus un GET au montage de /settings), quel que soit `since` : EXPLAIN QUERY PLAN sur data/arij.db donne `SCAN ticket_activity_log USING INDEX ticket_activity_log_epic_idx` avec ou sans cutoff. Le commentaire :618-620 (« the window cutoff … is what keeps this off a full-table scan ») est faux : la table n'a que epic_idx/project_idx (schema.ts:888-889, migration 0021:16,18), `datetime(created_at)` rend la colonne non indexable, et le motif `(? IS NULL OR …)` empêcherait de toute façon SQLite d'utiliser une borne de plage même sur un index (to_status, created_at) avec comparaison brute. Cause racine du datetime() confirmée en base : 180 lignes au format CURRENT_TIMESTAMP (espace) contre 10 811 ISO. Jamais élaguée (aucun DELETE sur la table dans lib/ app/ components/). Impact mesuré aujourd'hui : 10 991 lignes accumulées en 24 jours, ≈1 ms par requête, croissance linéaire (~15 ms par année d'historique) — un mensonge de commentaire et une dette de croissance, pas un problème de perf actuel. Correctif : normaliser created_at en ISO à l'écriture (et migrer les 180 lignes), index (to_status, created_at), comparaison brute ET deux requêtes distinctes (avec/sans since) au lieu de `? IS NULL OR`.

`getTicketsShipped` (lib/usage/aggregate.ts:632-641) fait un scan complet de `ticket_activity_log` à chaque GET /api/usage — prouvé par `EXPLAIN QUERY PLAN` sur la base locale : `SCAN ticket_activity_log USING INDEX ticket_activity_log_epic_idx`, avec ou sans cutoff. Le commentaire lignes 621-623 (« the window cutoff … keeps this off a full-table scan ») est faux : `datetime(created_at)` est inindexable et la table n'a d'index que sur epic_id et project_id (schema.ts:888-889, migration 0021:16,18) ; aucune purge n'existe. Chemin réel : `/api/usage` → `getUsageReport` (:957) → `getDashboard` (:899) ; atteint au montage de `/usage` (hooks/useUsage.ts:50 via UsageScreen) et de `/settings` (app/settings/page.tsx:84), sans polling. Impact mesuré aujourd'hui : ~1,1 ms pour 10 991 lignes, croissance ~1 000 lignes/jour sous charge — dette latente plutôt qu'incident. Le mélange de formats vient des 180 lignes insérées par la migration 0041 (`CURRENT_TIMESTAMP` explicite, ligne 24), pas d'un fallback du code applicatif qui écrit déjà ISO (log.ts:36, epics/route.ts:698) ; corriger implique donc backfill de ces 180 lignes + retrait du `datetime()` + index (to_status, created_at), ou simplement rectifier le commentaire.

**Recommandation**

Normaliser created_at à l'écriture (toujours ISO, plus de dépendance au DEFAULT), ajouter un index (to_status, created_at) et comparer en brut ; ou corriger le commentaire pour ne plus prétendre que le scan est évité.

<details><summary>Preuve relevée par l'auditeur</summary>

aggregate.ts:601-603 « `ticket_activity_log` is unindexed on `to_status` and never pruned, so the window cutoff is not an optimisation, it is what keeps this off a full-table scan » ; :630 `AND (${since} IS NULL OR datetime(created_at) >= datetime(${since}))`. schema.ts:871-873 : index epic_idx et project_idx uniquement ; `rg ticket_activity_log lib/db/migrations/*.sql | grep -i index` → mêmes deux index. aggregate.ts:606-612 documente les deux formats de created_at présents en base.

</details>

### #7 — Le plafond mensuel usage_budget_usd_month est éditable à deux endroits avec deux validations, et son commentaire cite un handler qui n'existe plus

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `components/usage/MonthlyCapTile.tsx:22`
- `components/usage/MonthlyCapTile.tsx:56`
- `components/usage/MonthlyCapTile.tsx:78`
- `components/settings-piscine/BudgetBand.tsx:78`
- `components/settings-piscine/settings-fields.ts:272`
- `components/settings-piscine/settings-fields.ts:478`

**Constat**

MonthlyCapTile PATCHe /api/settings inline avec sa propre validation (Number(raw), > 0) et affirme être « edited inline here rather than on the settings page ». Mais BudgetBand (réglages) édite la même clé via settings-fields.ts avec readDollarBudget et le mécanisme de brouillon batché. Le commentaire du tile dit aussi « Mirrors handleSaveUsageBudget in app/settings/page.tsx » — cette fonction n'existe nulle part dans le dépôt. Deux chemins d'écriture, deux règles de parsing, aucun partage.

**Précision du vérificateur**

MonthlyCapTile (components/usage/MonthlyCapTile.tsx:61-79) et BudgetBand (components/settings-piscine/BudgetBand.tsx:66-83, spec settings-fields.ts:272-275 et :478, monté par app/settings/page.tsx:109) éditent tous deux la clé usage_budget_usd_month par deux chemins distincts : PATCH /api/settings immédiat avec validation inline pour le tile, brouillon batché via parseDollarBudget pour les réglages. La logique de parsing est aujourd'hui IDENTIQUE (vide → null ; Number(raw) ; non fini ou ≤ 0 refusé) mais dupliquée sans partage — le défaut est la dérive future et la double surface d'édition, pas une divergence de comportement actuelle ; seules diffèrent la clé de message d'erreur et l'instant d'écriture. Par ailleurs le commentaire MonthlyCapTile.tsx:24 (« edited inline here rather than on the settings page ») est faux, et :56 renvoie à `handleSaveUsageBudget` dans app/settings/page.tsx, fonction qui n'existe nulle part dans le dépôt.

**Recommandation**

Garder un seul éditeur (le tile, contextuel) et retirer le champ de BudgetBand, ou faire passer le tile par la même spec de champ (readDollarBudget/parse) pour une seule règle. Corriger le commentaire.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n handleSaveUsageBudget app components hooks lib` → seule occurrence : le commentaire MonthlyCapTile.tsx:56. `rg -n MONTHLY_CAP_SETTING_KEY components` → settings-fields.ts:272-273 (spec de champ) et BudgetBand.tsx:78-80 (`draft.set(MONTHLY_CAP_SETTING_KEY, …)`). MonthlyCapTile.tsx:63-69 validation inline ; :75-79 `fetch("/api/settings", { method: "PATCH", body: { usage_budget_usd_month: next } })`.

</details>

### #8 — projectsHaveColorIndex() sonde à chaque requête une colonne projects.color_index qu'aucune migration ne crée

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `lib/usage/aggregate.ts:758`
- `lib/usage/aggregate.ts:777`
- `lib/usage/aggregate.ts:783`
- `lib/types/usage.ts:150`
- `components/usage/formatters.ts:85`

**Constat**

getDashboardByProject exécute `PRAGMA table_info(projects)` à chaque GET pour détecter une colonne `color_index` décrite comme « does not exist in the schema yet (the redesign ships no migration) ». Le type UsageProjectBar.colorIndex et formatters.resolveProjectTone portent le même conditionnel. C'est du code spéculatif pour une feature jamais livrée : la branche `p.color_index` est inatteignable, et la règle Piscine (projectTone dérivé de l'identité projet) est déjà remplie par le hash de projectId.

**Précision du vérificateur**

Vrai tel quel. Précision à ajouter : la sonde n'est pas mémoïsée (aggregate.ts:765-773) et s'exécute à chaque GET /api/usage via getUsageReport → getDashboard (:957) → getDashboardByProject (:916, :778) ; la branche `projectTone(colorIndex)` de formatters.ts:95-96 n'a qu'un appelant (UsageBarRow.tsx:98) qui lui passe toujours null ; le null est épinglé par __tests__/usage-dashboard-aggregate.test.ts:436, à retirer avec le code. Coût runtime négligeable — c'est du nettoyage de code spéculatif, pas un bug.

GET /api/usage (route.ts:32 → getUsageReport → getDashboard:916 → getDashboardByProject:778) exécute à chaque requête `PRAGMA table_info(projects)` (aggregate.ts:765-773) pour détecter une colonne `projects.color_index` qu'aucun schéma ni migration ne définit (0 résultat dans lib/db/schema.ts et lib/db/migrations, aucun ALTER dynamique). La branche `p.color_index` (:783) et la branche `projectTone(colorIndex)` de formatters.ts:95-97, consommée par UsageBarRow.tsx:98, sont inatteignables ; le test usage-dashboard-aggregate.test.ts:436 épingle d'ailleurs `colorIndex === null` sur toutes les lignes. Même conditionnel spéculatif ailleurs sans coût SQL (components/ticket/derive.ts:60-72, hooks/useTicketOverlayData.ts:295-299 lit un `json.data.colorIndex` que /api/projects ne renvoie jamais, releases/page.tsx:34/248) ; le module usage est le seul à payer une sonde par requête, coût négligeable mais code mort à retirer ou à livrer avec sa migration.

**Recommandation**

Supprimer la sonde PRAGMA, la colonne `color_index` de la requête, `colorIndex` du type et la branche de formatters ; si l'identité colorée par projet doit devenir persistante, la livrer avec sa migration.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "color_index|colorIndex" lib/db/schema.ts lib/db/migrations` → 0 résultat. aggregate.ts:766-772 `db.all(sql`PRAGMA table_info(projects)`).some(c => c.name === "color_index")` ; :783 `${withColor ? sql`p.color_index` : sql`NULL`}`. formatters.ts:91-97 `if (colorIndex !== null …) return projectTone(colorIndex)` puis hash de projectId.

</details>

### #9 — Journal de migrations incohérent dans sa numérotation et registre parallèle de colonnes maintenu à la main dans init.ts

**Nature** risque · **Impact** faible (vérificateur : plutôt moins) · **Effort** M · **Statut** contesté · **Domaine d'audit** db-usage-notifications

**Fichiers**
- `lib/db/migrations/meta/_journal.json`
- `lib/db/migrations/meta/`
- `lib/db/init.ts:65`
- `lib/db/init.ts:246`
- `lib/db/init.ts:262`

**Constat**

Le journal est applicable (56 fichiers ↔ 56 entrées, `when` strictement croissants, drizzle ne lit que `entries`), mais les préfixes de fichiers ne reflètent plus l'ordre : 0004 ×2, 0005 ×3, 0014 ×2, idx 6 = 0005_oval_loners avant idx 7 = 0004_session_lifecycle_guard, trou 0007→0011, en-tête `"version": "7"` contre `"6"` sur chaque entrée, 8 snapshots pour 56 entrées. Par-dessus, lib/db/init.ts entretient POST_BASELINE_COLUMN_MIGRATIONS : une liste manuelle de 25 (when, table, colonne) qui doit être complétée à chaque migration ADD COLUMN pour les bases sans __drizzle_migrations ; un oubli fait rejouer l'ALTER et casse le démarrage de ces bases. Le commentaire de chaque entrée raconte une collision de slot différente, ce qui montre que ce registre est fragile.

**Précision du vérificateur**

Résidu factuel, cosmétique : les préfixes des fichiers de migration ne reflètent pas l'ordre d'application (0004×2, 0005×3, 0014×2, trou 0007→0011, idx 6 = 0005_oval_loners avant idx 7 = 0004_session_lifecycle_guard) et l'en-tête de _journal.json dit "version": "7" contre "6" sur chaque entrée ; aucun code du dépôt ne lit ni les préfixes ni cet en-tête (drizzle-orm/migrator.js:12 n'itère que `entries`, generate est interdit), CLAUDE.md:89-95 documente déjà que seul `when` compte et que les snapshots s'arrêtent à 0013. POST_BASELINE_COLUMN_MIGRATIONS (lib/db/init.ts:65-200) compte 23 entrées qui correspondent exactement aux 15 migrations ADD COLUMN post-baseline (57 fichiers/57 entrées dans l'arbre de travail), et un oubil en queue de chaîne est déjà détecté par __tests__/db-init.test.ts:213 (base complète sans __drizzle_migrations, initDb doit ne pas jeter).

Le journal drizzle est applicable et verrouillé par tests (57 fichiers ↔ 57 entrées dans l'arbre de travail, `when` strictement croissants, unicité tag/when et parité fichiers↔journal testées dans __tests__/db-init.test.ts:452-556), mais les préfixes numériques ne reflètent plus l'ordre (0004×2, 0005×3, 0014×2, idx 6 `0005_oval_loners` avant idx 7 `0004_session_lifecycle_guard`, trou 0007→0011) et l'en-tête `"version": "7"` diffère des entrées `"6"` — sans effet : drizzle-orm/migrator.js:12 ne lit que `entries[].tag/when`. Les snapshots figés à 0013 et la règle « seul `when` compte » sont déjà dans CLAUDE.md:90-96 ; manque seulement la phrase « le préfixe du fichier n'est pas l'ordre ». Par-dessus, lib/db/init.ts:64-198 entretient POST_BASELINE_COLUMN_MIGRATIONS, registre manuel de 23 (when, table, colonne) consulté à chaque premier accès DB du process (lib/db/index.ts:66 → init.ts:320-327) pour les bases sans `__drizzle_migrations`. Il est aujourd'hui complet (parse des `ALTER TABLE … ADD COLUMN` de toutes les migrations post-0020 : zéro écart) et un oubli est attrapé par __tests__/db-init.test.ts:242 et :348 (rejouer initDb sur une base où la colonne existe encore fait échouer l'ALTER), sauf si le test est « réparé » en y ajoutant le DROP COLUMN sans toucher la liste — les tests énumèrent les colonnes à la main, ce qui fait deux registres parallèles. L'impact d'un oubli se limite aux bases créées/étendues par `drizzle-kit push` et jamais démarrées depuis février 2026. Recommandation conservée : dériver la liste (ou l'asserter) à partir d'un parse des SQL pour supprimer le double registre ; corriger l'en-tête version ; noter dans CLAUDE.md que le préfixe n'est pas l'ordre.

**Recommandation**

Dériver POST_BASELINE_COLUMN_MIGRATIONS en parsant les fichiers SQL (`ALTER TABLE x ADD [COLUMN] y`) plutôt qu'à la main, et ajouter un test qui compare la liste à ce parse. Documenter dans CLAUDE.md que le préfixe numérique n'est pas l'ordre (seul `when` compte) et régler l'en-tête version.

<details><summary>Preuve relevée par l'auditeur</summary>

`ls lib/db/migrations/*.sql` → 0004_fixed_spirit, 0004_session_lifecycle_guard, 0005_codex_session_chunks, 0005_glossy_spitfire, 0005_oval_loners, 0014_project_document_registry, 0014_push_parity ; aucun 0007-0011. `_journal.json` : `"version": "7"` en tête, entrées `"version": "6"`, idx 6 tag 0005_oval_loners (when 1770937223060) puis idx 7 tag 0004_session_lifecycle_guard (when 1770969600000). node_modules/drizzle-orm/migrator.js:12 itère `journal.entries` seulement. init.ts:65-200 liste manuelle avec commentaires « Renumbered off 0031's slot… », « Renumbered off 0041's slot… » ; :262-270 `columnExists(...) ? spec.folderMillis : ceiling`.

</details>


## Annexe — relevé schéma et dépendances

Inventaire schéma + dépendances sur l'arbre de travail tel quel (branche main, rationalisation UI non commitée : 29 fichiers supprimés, ~20 tests non suivis).

(A) SCHÉMA — lib/db/schema.ts déclare 37 tables et 347 colonnes.
• Tables : 0 table morte. Les 37 noms SQL de schema.ts correspondent exactement aux 37 `CREATE TABLE` des migrations. Les tables les moins utilisées restent atteignables : agent_session_sequences (1 module), qa_prompts (1 route), agent_session_chunks / custom_review_agents / composite_agent_members / git_sync_log / github_issues / notification_read_cursor / desk_dismissals / provider_usage_snapshots (2 modules chacune).
• Colonnes : 1 colonne lue mais jamais écrite (named_agents.readable_agent_name → toujours NULL), 1 colonne écrite uniquement à NULL et jamais lue (chat_conversations.claude_session_id), 13 colonnes écrites mais dont aucun consommateur ne lit la valeur (dont 7 timestamps updated_at/created_at), 1 colonne dont la propriété Drizzle n'est jamais utilisée mais dont la colonne SQL est pilotée en SQL brut (projects.ticket_counter).
• Colonnes legacy : les 2 `claude_session_id` (schema.ts L167 et L256) existent toujours ; seule celle d'agent_sessions est encore lue, via lib/db/resolve-cli-session-id.ts. named_agents.escalates_to est le seul ADD COLUMN des migrations absent de schema.ts, et c'est correct : 0054 le DROP.
• Migrations : 56 fichiers .sql, 56 entrées de journal, aucune manquante des deux côtés, idx contigus 0..55, `when` strictement croissants → le journal est applicable tel quel. Anomalies cosmétiques/structurelles : préfixes numériques dupliqués (0004 ×2, 0005 ×3, 0014 ×2), ordre du journal non monotone sur les préfixes (idx 6 = 0005_oval_loners précède idx 7 = 0004_session_lifecycle_guard), trou 0007→0011, `"version": "7"` en tête alors que chaque entrée dit `"version": "6"`, et surtout 8 snapshots seulement dans meta/ (0000-0005, 0012, 0013) pour 56 entrées → confirme l'interdiction de `drizzle-kit generate` de CLAUDE.md.

(B) DÉPENDANCES — 21 dependencies + 20 devDependencies = 41.
• 2 candidates réelles à la suppression, sans aucune référence hors package.json/package-lock.json : `vite` (^6.4.1, devDep) et `shadcn` (^3.8.4, devDep).
• 6 autres sans `import` littéral mais bien utilisées : @tailwindcss/postcss (postcss.config.mjs), jsdom (vitest.config.ts `environment: "jsdom"`), et les 4 paquets @types/* (better-sqlite3, node, react, react-dom).
• 0 dépendance importée et absente de package.json. Seul écart : `pdfjs-dist` est nommé dans next.config.ts:73 (serverExternalPackages) sans être déclaré — il n'est jamais importé directement, il arrive en transitif de pdf-parse (5.4.296 installé) ; c'est l'usage attendu de serverExternalPackages, à signaler seulement comme fragilité.
• Faux positifs écartés après vérification : `express` et `cors` n'apparaissent que dans des chaînes de fixture de __tests__/diff-parser.test.ts:18-42.

- `/home/orosius/workspace/arij/lib/db/schema.ts` · `namedAgents.readableAgentName (named_agents.readable_agent_name), L524` — COLONNE LUE, JAMAIS ÉCRITE — colonne morte à effet visible. Aucun INSERT/UPDATE ne la renseigne : lib/agent-config/named-agents.ts:213-223 (createNamedAgent) et :274-284 (composite) ne la listent pas, la migration 0016_readable_ids_and_agent_names.sql:9-14 se limite à ADD COLUMN + index unique sans backfill, et aucun autre écrivain n'existe (rg 'readableAgentName|readable_agent_name' hors __tests__ ne rend que schema.ts et deux SELECT). Elle est pourtant sélectionnée comme `namedAgentName` dans app/api/projects/[projectId]/sessions/route.ts:223 et app/api/projects/[projectId]/conversations/[conversationId]/route.ts:36. Conséquence mesurable : app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:175-180 rend le badge d'agent sous `meta.namedAgentName ? ...` — il est donc toujours absent. À supprimer, ou à joindre sur namedAgents.name.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `chatConversations.claudeSessionId (chat_conversations.claude_session_id), L167` — COLONNE LEGACY MORTE. Les seuls accès en production sont quatre écritures à NULL dans app/api/projects/[projectId]/conversations/[conversationId]/route.ts:150, 158, 175, 185. Aucun SELECT ne la lit : le GET de cette même route (L28-36) sélectionne cliSessionId, pas claudeSessionId ; resolveCliSessionId (lib/db/resolve-cli-session-id.ts:13) n'est appliqué qu'à des lignes agent_sessions. Contraste avec agentSessions.claudeSessionId (L256), elle bien lue — app/api/projects/[projectId]/releases/route.ts:229, lib/agent-sessions/validate-resume.ts:43, app/api/projects/[projectId]/qa/reports/[reportId]/create-epics/route.ts:229. La migration 0015_cli_session_resume.sql:10-15 a déjà recopié les deux colonnes vers cli_session_id.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `epics.githubIssueUrl (L121) et epics.githubIssueState (L122)` — ÉCRITES, JAMAIS LUES. Uniques écritures : lib/github/issues.ts:319 (`githubIssueUrl: issue.githubUrl`) et :320 (`githubIssueState: "open"`, valeur constante jamais mise à jour ensuite). Aucun lecteur : rg sur `githubIssueUrl|githubIssueState|github_issue_url|github_issue_state` dans app/ components/ hooks/ lib/ ne rend que schema.ts, ces deux lignes d'écriture, et __tests__/db-schema.test.ts. À comparer avec la sœur epics.githubIssueNumber (L120), elle bien consommée dans components/ticket/derive.ts:474-475.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `githubIssues.importedAt (github_issues.imported_at), L731` — ÉCRITE, JAMAIS LUE. Unique occurrence en production : lib/github/issues.ts:331 `.set({ importedEpicId: epicId, importedAt: now })`. Aucun SELECT, aucun `.importedAt`, aucun `imported_at` ailleurs dans app/ components/ hooks/ lib/. L'`importedEpicId` du même .set(), lui, est consommé.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `deskDismissals.dismissedAt (desk_dismissals.dismissed_at), L967` — ÉCRITE (NOT NULL), JAMAIS LUE. Écrite dans app/api/desk/dismiss/route.ts:30 (values) et :35 (onConflict set), et renvoyée dans l'echo JSON L39. Le seul lecteur de la table, app/api/control-desk/route.ts:565-572, ne sélectionne que epicId, kind et signalAt. La déduplication du desk s'appuie donc sur signal_at ; dismissed_at n'est qu'un journal jamais consulté.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `chatAttachments.sizeBytes (chat_attachments.size_bytes), L202` — ÉCRITE (NOT NULL), JAMAIS AFFICHÉE. Écrite dans app/api/projects/[projectId]/chat/upload/route.ts:94 et :106. Les lectures de la table se font en `select()` complet (app/api/projects/[projectId]/chat/route.ts:46-48), donc la valeur transite, mais aucun composant ne la lit : rg 'sizeBytes|size_bytes' dans components/chat, components/chat-page et hooks/ ne rend rien. Attention au faux positif : les nombreux `sizeBytes` de lib/documents/*, components/spec/DocsCard.tsx et app/projects/[projectId]/documents/page.tsx appartiennent à documents.sizeBytes (L82), une autre colonne, bien lue elle.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `qaReports.promptUsed (qa_reports.prompt_used), L756` — ÉCRITE, AUCUN RENDU. Écrite dans app/api/projects/[projectId]/qa/check/route.ts:136 (null) et :198 (prompt complet). Volontairement exclue du payload de app/api/qa/findings/route.ts (commentaire explicite L456-459 : « TWO COLUMNS OF THIS TABLE ARE NEVER SELECTED … report_content … prompt_used »). Elle sort quand même via les `.select()` complets de app/api/projects/[projectId]/qa/reports/route.ts:16 et .../[reportId]/route.ts:16, et est déclarée dans hooks/useQaReports.ts:14 — mais aucun composant ne la rend. Colonne non plafonnée transportée pour rien sur ces deux routes.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `providerUsageSnapshots.sourceFile (provider_usage_snapshots.source_file), L992` — ÉCRITE, JAMAIS LUE. Passée en paramètre puis insérée dans lib/usage/codex-snapshot.ts:116 et :136 ; les deux lecteurs (lib/usage/codex-snapshot.ts:118-122 et lib/usage/aggregate.ts:386-389) font `select()` complet mais ne consultent que capturedAt et les colonnes de quota. Aucun `.sourceFile` consommateur.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `7 colonnes updated_at/created_at écrites et jamais relues` — Vérifié globalement : `rg '\.updatedAt\b' app components hooks lib` ne rend que 11 fichiers, tous relatifs à documents/epics/projects. Sont donc écrites sans lecteur : agentSessionChunks.updatedAt (L307, écrite lib/agent-sessions/chunks.ts), pullRequests.updatedAt (L470, écrite app/api/projects/[projectId]/epics/[epicId]/pr/route.ts et pr/sync/route.ts), settings.updatedAt (L476, écrite dans 12 routes dont app/api/settings, auto-mode, resolve-merge), agentPrompts.createdAt/updatedAt (L486-487), agentProviderDefaults.createdAt/updatedAt (L593-594), qaPrompts.updatedAt (L800), providerUsageSnapshots.updatedAt (L994). Aucun tri, aucun affichage, aucun calcul de fraîcheur ne s'appuie dessus. Cas à part, bien lues : qaPrompts.createdAt (orderBy app/api/qa/prompts/route.ts:13) et documents/epics/projects.updatedAt.
- `/home/orosius/workspace/arij/lib/db/schema.ts` · `projects.ticketCounter (projects.ticket_counter), L33` — PROPRIÉTÉ DRIZZLE INUTILISÉE, COLONNE VIVANTE. Aucune occurrence de `ticketCounter` en production ; la colonne est pilotée exclusivement en SQL brut par lib/db/readable-id.ts:28-32 (`UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 … RETURNING ticket_counter`). Ne pas supprimer la colonne ; c'est le mapping Drizzle qui est décoratif. À signaler seulement comme incohérence d'accès (le reste du code passe par l'ORM).
- `/home/orosius/workspace/arij/lib/db/migrations/meta/_journal.json` · `journal des migrations` — COHÉRENT SUR L'ESSENTIEL, vérifié par script : 56 entrées / 56 fichiers .sql, aucun fichier orphelin, aucune entrée sans fichier, idx contigus de 0 à 55, `when` strictement croissants (1770824510382 → 1786715300000, soit 2026-02-11 → 2026-08-14). Anomalies relevées : (1) préfixes numériques dupliqués — 0004_fixed_spirit / 0004_session_lifecycle_guard, 0005_glossy_spitfire / 0005_oval_loners / 0005_codex_session_chunks, 0014_project_document_registry / 0014_push_parity ; (2) l'ordre du journal ne suit pas les préfixes — idx 6 = 0005_oval_loners est suivi d'idx 7 = 0004_session_lifecycle_guard ; (3) trou de numérotation 0007→0011 ; (4) l'en-tête déclare `"version": "7"` alors que les 56 entrées portent toutes `"version": "6"`.
- `/home/orosius/workspace/arij/lib/db/migrations/meta` · `snapshots drizzle-kit` — 8 snapshots seulement (0000, 0001, 0002, 0003, 0004, 0005, 0012, 0013) pour 56 entrées de journal — les 48 restants manquent. Confirme mécaniquement l'interdiction de `npx drizzle-kit generate` documentée dans CLAUDE.md et dans la mémoire arij-cleanup-2026-08 (qui parlait encore d'un journal à 0022 : il est aujourd'hui à 0056, l'écart s'est donc creusé).
- `/home/orosius/workspace/arij/lib/db/migrations/0054_drop_named_agent_escalation.sql` · `named_agents.escalates_to` — SEUL écart ADD COLUMN / schema.ts, et il est légitime : 0039_named_agent_escalation.sql ajoute la colonne, 0054 la retire par `ALTER TABLE named_agents DROP COLUMN escalates_to`. Aucun autre des 66 ADD COLUMN des migrations n'est absent de schema.ts. Rien à faire — noté pour clore la question.
- `/home/orosius/workspace/arij/package.json` · `devDependencies.vite (^6.4.1), L93` — DÉPENDANCE SANS USAGE DIRECT. Aucun `from "vite"` / `require("vite")` dans tout le dépôt (app, components, hooks, lib, scripts, bin, e2e, __tests__, configs racine). vitest.config.ts:1 importe `defineConfig` depuis `vitest/config`, pas depuis `vite` ; vitest.config.ts:2 importe @vitejs/plugin-react. `vite` est un transitif de vitest/@vitejs/plugin-react. Supprimable, sauf si l'épinglage de version est délibéré (à confirmer avec le lockfile avant de retirer, cf. la garde __tests__/lockfile-install-consistency.test.ts).
- `/home/orosius/workspace/arij/package.json` · `devDependencies.shadcn (^3.8.4), L90` — DÉPENDANCE SANS USAGE. Aucun import, aucun script npm (les 16 scripts de package.json ne l'appellent pas), aucune mention dans .github/workflows/ci.yml, aucune référence dans components.json (qui ne contient que le `$schema` ui.shadcn.com). Les seules occurrences du mot dans le dépôt sont de la prose (README.md:427, CLAUDE.md:8/18/25/45). C'est un CLI utilisé ponctuellement en `npx shadcn add` — il n'a pas besoin d'être installé.
- `/home/orosius/workspace/arij/package.json` · `6 dépendances sans import littéral mais bien utilisées — ne pas supprimer` — @tailwindcss/postcss → référencé comme nom de plugin dans postcss.config.mjs. jsdom → chargé par la chaîne `environment: "jsdom"` de vitest.config.ts:8. @types/better-sqlite3, @types/node, @types/react, @types/react-dom → paquets de types, consommés par tsc sans import. Les autres dépendances à faible compte sont toutes vérifiées vivantes : clsx et tailwind-merge (lib/utils.ts:1-2), mammoth (lib/converters/docx-to-md.ts:1), pdf-parse (import dynamique lib/converters/pdf-to-md.ts:3), @octokit/rest (lib/github/client.ts:1), next-themes (components/ThemeProvider.tsx:3 et components/settings-piscine/AppearanceBand.tsx:4 — toujours vivante malgré la suppression de components/ThemeToggle.tsx dans l'arbre), tw-animate-css (@import app/globals.css:2), drizzle-kit (drizzle.config.ts:1), @vitejs/plugin-react (vitest.config.ts:2), @testing-library/jest-dom (vitest.setup.ts:1), eslint-config-next (eslint.config.mjs).
- `/home/orosius/workspace/arij/next.config.ts` · `serverExternalPackages: ["better-sqlite3", "pdf-parse", "pdfjs-dist"], L73` — `pdfjs-dist` est nommé dans la config mais n'est PAS déclaré dans package.json. Il n'est jamais importé directement (seule mention : le commentaire lib/converters/pdf-to-md.ts:2) et arrive en transitif de pdf-parse — node_modules/pdfjs-dist est en 5.4.296. C'est l'usage attendu de serverExternalPackages, mais la ligne dépend d'un arbre transitif : une montée de pdf-parse qui changerait de moteur PDF la rendrait muette sans erreur. Seule occurrence de ce genre : aucune autre dépendance importée n'est absente de package.json.
