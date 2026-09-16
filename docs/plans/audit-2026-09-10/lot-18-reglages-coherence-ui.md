# Lot 18 — Réglages et cohérence de l'UI partagée

**Difficulté** 1/4 — Simple — agent peu coûteux
**Findings** 6 (0 fort · 3 moyen · 3 faible ; effort 3 S · 3 M · 0 L)
**Dépendances** Indépendant.

**Statut** fait le 16/09/2026 — détail dans [compte rendu des lots 18, 20-22, 24](implementation-lots-18-20-21-22-24.md).

## Décision

Un seul sélecteur d'agent nommé (AgentSelectPill avec mode dispatch) ; chaque clé de réglage écrivable a un champ ou est retirée de l'allowlist ; sélecteur de langue dans AppearanceBand.

## Objectif

Migrer les 8 consommateurs de NamedAgentSelect, ajouter les champs manquants (ou retirer les clés), SegmentedControl langue, WebhooksBand qui distingue erreur et « aucun projet », clés définies une fois (lib), menu Réglages du TopBar aligné sur le modèle de nav (Pipeline/Apparence, actif sur /settings/integrations).

## Démarche suggérée

1. Clé par clé : champ dans la bande correspondante (SETTING_FIELDS) ou retrait de WRITABLE_SETTING_KEYS.
2. AgentSelectPill mode dispatch + migration ; supprimer NamedAgentSelect.
3. nav.ts : ajouter pipeline/appearance, corriger isActive.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #26 — Deux sélecteurs d'agent nommé coexistent : NamedAgentSelect (shadcn, 8 consommateurs) et AgentSelectPill (Piscine, « the one agent picker », 5 consommateurs)

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `components/shared/AgentSelectPill.tsx:23-40`
- `components/shared/NamedAgentSelect.tsx:61-69`
- `components/shared/NamedAgentSelect.tsx:127-190`
- `components/desk/ProjectBatchToolbar.tsx`
- `components/shared/AgentDispatchDialog.tsx`
- `components/auto-mode/AutoModeDialog.tsx`
- `components/night/NightRunDialog.tsx`
- `components/qa/StartQaCheckDialog.tsx`
- `components/kanban/RefinementDialog.tsx`
- `components/releases/ChangelogAgentPopover.tsx`
- `app/projects/[projectId]/git-sync/page.tsx`

**Constat**

`components/shared/AgentSelectPill.tsx:23-24` se présente comme « The one agent picker » censé avoir remplacé « three menus ». Mais `components/shared/NamedAgentSelect.tsx` (Radix `Select` de `components/ui/select`) reste importé par 8 fichiers, dont `components/desk/ProjectBatchToolbar.tsx` créé par la rationalisation en cours — le doublon se propage donc encore. Les deux composants ne sont pas équivalents : NamedAgentSelect porte le badge de fiabilité par rôle (`dispatchRole` → `useDispatchReliability`, lignes 61-69 et 165-190), AgentSelectPill n'a aucune notion de fiabilité (`rg 'reliability|dispatchRole' AgentSelectPill.tsx` → 0). Les deux ré-implémentent séparément la marque composite + ladder (NamedAgentSelect:127-152 vs AgentSelectPill:102-136). Un dispatch depuis le desk et un dispatch depuis un dialog n'offrent donc pas la même information sur le même agent.

**Précision du vérificateur**

Deux sélecteurs d'agent nommé coexistent. components/shared/AgentSelectPill.tsx:23-25 se déclare « The one agent picker » ayant absorbé « three menus », dont explicitement « the project panel's shadcn Select » — mais ce Select, components/shared/NamedAgentSelect.tsx, est toujours importé par 8 fichiers, dont components/desk/ProjectBatchToolbar.tsx:7, fichier NON SUIVI créé par la rationalisation en cours : le doublon se propage encore. Les deux ne sont pas équivalents : NamedAgentSelect porte le badge de fiabilité par rôle (imports useDispatchReliability/formatReliabilityBadge lignes 13-16, prop dispatchRole documentée 55-62, rendu 165-190), effectivement utilisé par 7 de ses 8 consommateurs (git-sync/page.tsx:485, StartQaCheckDialog:286, AutoModeDialog:218 et 245, RefinementDialog:73, ProjectBatchToolbar:221, NightRunDialog:310, ChangelogAgentPopover:79, plus le relais AgentDispatchDialog:109) ; AgentSelectPill n'a aucune notion de fiabilité (0 occurrence) alors qu'il expose lui aussi un mode `dispatch` (ligne 43) monté par DeskComposer.tsx:201. La marque composite + le ladder sont ré-implémentés deux fois — NamedAgentSelect.tsx:126-149 vs AgentSelectPill.tsx:221-256 (copie admise en commentaire ligne 128) — et non aux lignes 102-136 du pill. Côté pill : 6 fichiers importateurs, dont 3 mounts réels (ChatComposer:192, DeskComposer:201, ChatWorkspaceHeader:95) et 3 imports du seul type AgentSelection. docs/architecture/ui-rationalisation-2026-09-10.md ne mentionne aucun des deux composants.

**Recommandation**

Trancher un seul composant : soit ajouter `dispatchRole`/fiabilité à AgentSelectPill (mode `dispatch`) et migrer les 8 consommateurs, soit corriger le commentaire d'AgentSelectPill et documenter NamedAgentSelect comme le picker de formulaire. Dans tous les cas, ne plus créer de nouveaux consommateurs de NamedAgentSelect (ProjectBatchToolbar vient d'en ajouter un).

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -l 'shared/NamedAgentSelect"' app components hooks lib` → 8 fichiers (git-sync/page.tsx, AutoModeDialog, StartQaCheckDialog, ProjectBatchToolbar, NightRunDialog, AgentDispatchDialog, RefinementDialog, ChangelogAgentPopover). `rg -l 'shared/AgentSelectPill"'` → 5 (useChatWorkspace, ChatComposer, agent-selection.ts, ChatWorkspaceHeader, DeskComposer). `sed -n 120,373p AgentSelectPill.tsx | rg 'reliability|dispatchRole'` → 0 ligne ; NamedAgentSelect.tsx:13-16 importe `useDispatchReliability` et `formatReliabilityBadge`.

</details>

### #29 — Locale `fr` livrée (24 fichiers) et clé `ui_locale` écrivable, mais aucun sélecteur de langue nulle part

**Nature** à moitié câblé · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `lib/i18n/locales.ts:23-47`
- `lib/i18n/resolve-request-locale.ts:14-58`
- `app/layout.tsx:66-71`
- `components/settings-piscine/AppearanceBand.tsx`
- `lib/settings/writable-keys.ts`
- `lib/i18n/messages/fr/`

**Constat**

`lib/i18n/locales.ts:23-44` déclare `UI_LOCALES = ["en","fr"]`, exclut `fr` de la négociation automatique et précise qu'« a stored ui_locale of fr is still honoured (that is what the follow-up epic writes) ». `lib/settings/writable-keys.ts` autorise `ui_locale` en PATCH. `lib/i18n/messages/fr/` contient 24 namespaces (dont 6 ajoutés par la rationalisation en cours : ChatLegacy, Inbox, ProjectDocuments, ProjectFrictions, ProjectSettings, ProjectShell). Mais aucun composant ni page ne lit ou n'écrit `UI_LOCALE_SETTING_KEY`/`ui_locale` : la seule surface d'apparence, `components/settings-piscine/AppearanceBand.tsx`, ne propose que jour/nuit. Le catalogue français n'est donc atteignable que par un PATCH `/api/settings` fabriqué à la main ; la couche serveur (`resolve-request-locale.ts`, lecture DB à chaque requête dans `app/layout.tsx:71`) tourne pour une valeur que l'UI ne peut jamais positionner.

**Précision du vérificateur**

Locale `fr` déclarée (`lib/i18n/locales.ts:23`), honorée si stockée (`:37-40`), clé `ui_locale` écrivable en PATCH (`lib/settings/writable-keys.ts:76`) et exposée par GET `/api/settings` dans `defaults` (`app/api/settings/route.ts:70-83`), mais aucune surface UI ne la lit ni ne l'écrit : seul hit hors API = commentaire `app/layout.tsx:68` ; `AppearanceBand.tsx` ne propose que jour/nuit ; `useSettingsDraft` charge `defaults` sans jamais lire `ui_locale`. Le catalogue fr (28 fichiers dans l'arbre actuel, 10 non suivis, 14 namespaces en sans fr) n'est atteignable que par un PATCH manuel. Toutefois ce report est déjà documenté comme volontaire dans `docs/qa/english-interface-localization.md:9-11` (« No switcher », seed fr « for development ») ; ce qui manque réellement, c'est l'epic de suite « French locale + language switcher » promis par le commentaire de `locales.ts`, absent d'`arji.json`. Reste ouvert : soit créer cet epic (SegmentedControl langue + `router.refresh()`), soit retirer `ui_locale` de `WRITABLE_SETTING_KEYS` d'ici là.

La locale `fr` (28 namespaces sur 42, 14 sans français ; 10 ajoutés par la rationalisation non commitée) est composée et honorée côté serveur (lib/i18n/catalogue.ts:123-142, lib/i18n/request.ts, lib/i18n/resolve-request-locale.ts:16-31, app/layout.tsx:70) et `ui_locale` est écrivable/validé par PATCH /api/settings (lib/settings/writable-keys.ts:76, app/api/settings/route.ts:164-167), mais aucun chemin réel ne la positionne ni ne l'affiche : rien dans components/, hooks/, app/settings, lib/mcp, lib/routines, bin/, instrumentation.ts, proxy.ts ni e2e/ ne lit ou n'écrit `ui_locale` ; components/settings-piscine/AppearanceBand.tsx n'offre que jour/nuit ; et `defaults.ui_locale` renvoyé par GET /api/settings « so the settings UI can show the effective locale » (route.ts:72-81) n'est lu par personne (seul WorkspaceBand.tsx:30 lit `draft.defaults`, pour projects_root). Ce n'est pas un oubli mais un report documenté (docs/qa/english-interface-localization.md:11 « No switcher », epic QPevlG9ZTFqY section « Follow-up epic (not this one) »), sans toutefois de ticket ouvert dans arji.json pour ce follow-up. Recommandation ajustée : créer le ticket « French locale + language switcher » (ou retirer le `defaults.ui_locale` mort du GET) plutôt que retirer `ui_locale` de WRITABLE_SETTING_KEYS, qui est validé et inoffensif.

**Recommandation**

Soit ajouter le SegmentedControl langue dans AppearanceBand (écriture `ui_locale` + `router.refresh()`), soit documenter la locale fr comme non livrée et retirer `ui_locale` de WRITABLE_SETTING_KEYS jusqu'à l'epic prévu.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n -i 'ui_locale|UI_LOCALE_SETTING_KEY|setLocale' components app --glob '*.tsx' --glob '*.ts' | grep -v app/api` → un seul hit, le commentaire app/layout.tsx:68. `ls lib/i18n/messages/fr | wc -l` → 24 ; `comm` en vs fr → 18 namespaces sans français (AutoMode, GitSync, Kanban, NightRuns, Review, Routines, Sessions, SettingsLegacy, Shared, Story, Verify…).

</details>

### #30 — Six clés déclarées écrivables par le client (writable-keys.ts) n'ont aucune surface d'édition

**Nature** à moitié câblé · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `lib/settings/writable-keys.ts:32-79`
- `components/settings-piscine/settings-fields.ts:1-30`
- `lib/i18n/messages/en/Routines.json:36`
- `lib/verify/regression-constants.ts`
- `lib/mcp/user-global-sync.ts`
- `lib/routines/retention.ts`
- `lib/claude/visual-proof.ts`
- `lib/agents/watchdog-constants.ts`

**Constat**

`lib/settings/writable-keys.ts:32-79` liste les clés qu'un client « may write », mais pour six d'entre elles aucun composant ni page n'écrit ni ne lit la clé (ni sa constante, ni une variante camelCase) : `bug_regression_timeout_ms`, `mcp_user_global_sync`, `session_chunk_retention_days`, `visual_proof_enabled`, `watchdog_threshold_minutes` et `clone_timeout_ms` (celle-ci n'est en plus lue par personne, point déjà relevé par l'inventaire). Elles sont pourtant consommées côté exécution (lib/verify/regression-constants.ts, lib/mcp/user-global-sync.ts, lib/routines/retention.ts, lib/claude/visual-proof.ts + prompt-builder.ts, lib/agents/watchdog.ts). Le texte d'aide de l'éditeur de routines (`Routines.json:36` : « The window itself is the session_chunk_retention_days setting ») renvoie même l'utilisateur vers un réglage qu'aucun écran ne permet de saisir. Les seuls chemins d'écriture sont un PATCH manuel ou l'ancienne page de 1862 lignes que settings-fields.ts dit avoir remplacée « sans perdre un réglage ».

**Précision du vérificateur**

`lib/settings/writable-keys.ts:32-83` déclare six clés écrivables (bug_regression_timeout_ms l.42, clone_timeout_ms l.50, mcp_user_global_sync l.58, session_chunk_retention_days l.73, visual_proof_enabled l.81, watchdog_threshold_minutes l.82 ; retention et watchdog aussi scopables l.108/111) qu'aucun composant, hook ni page n'écrit ni ne lit (absentes de SETTING_FIELDS/SETTINGS_INVENTORY dans components/settings-piscine/settings-fields.ts:168-502 et des 19 autres appelants de /api/settings). Toutes les six SONT consommées côté exécution — y compris clone_timeout_ms, lue par app/api/projects/clone/route.ts:72 (contrairement à ce qu'affirmait l'inventaire) alors que lib/git/clone-constants.ts:4-5 prétend exister « so the Settings UI can import the key » et qu'aucune UI ne l'importe. Le hint Routines.json:36 (rendu par components/routines/RoutinesSettings.tsx:415) renvoie vers session_chunk_retention_days qu'aucun écran ne permet de saisir. L'ancienne page de 1862 lignes n'existe plus (app/settings/page.tsx = 123 lignes depuis cd6fedec) : le seul chemin d'écriture est un PATCH /api/settings manuel.

`lib/settings/writable-keys.ts` (lignes 42, 50, 58, 73, 81, 82 ; 108 et 111 pour les variantes scopées) déclare écrivables par le client six clés — `bug_regression_timeout_ms`, `clone_timeout_ms`, `mcp_user_global_sync`, `session_chunk_retention_days`, `visual_proof_enabled`, `watchdog_threshold_minutes` — qu'aucun composant, hook ni page n'écrit ni ne lit (ni littéral, ni constante `*_SETTING_KEY`, ni variante camelCase dans components/ et hooks/ ; le registre SETTING_FIELDS/SETTINGS_INVENTORY de components/settings-piscine/settings-fields.ts:168-502 les ignore ; aucun autre appelant de PATCH /api/settings ni outil MCP ne les porte). Toutes les six sont pourtant consommées côté serveur (lib/pipeline/verify.ts:103-104, app/api/projects/clone/route.ts:71-72 — lecture ajoutée par la rationalisation non commitée, lib/mcp/user-global-sync.ts:122-126, lib/routines/retention.ts:223-231, lib/claude/visual-proof.ts:40 + app/api/projects/[projectId]/build/route.ts:538, lib/agents/watchdog.ts:68-70). Le hint `lib/i18n/messages/en/Routines.json:36` renvoie l'utilisateur vers `session_chunk_retention_days`, réglage qu'aucun écran ne permet de saisir. Contrairement à ce qu'avance le finding, ce n'est pas une perte de la refonte : l'ancienne page de 1862 lignes (cd6fedec^) ne contenait aucune de ces clés et n'existe plus ; elles n'ont jamais eu d'UI, le seul chemin d'écriture est un PATCH manuel. À la différence des `chat_persistent_*` (writable-keys.ts:44-46), l'absence d'UI n'est pas documentée pour ces six clés.

**Recommandation**

Décider clé par clé : ajouter la ligne dans PipelineBand/VerificationBand/NightRunsBand (le registre SETTING_FIELDS rend cela à ~10 lignes par clé), ou retirer la clé de WRITABLE_SETTING_KEYS et la basculer dans SERVER_MANAGED_SETTING_KEYS avec sa raison. Corriger le hint Routines si la clé reste sans UI.

<details><summary>Preuve relevée par l'auditeur</summary>

Pour chaque clé : `rg -ln <clé> app components hooks lib` → uniquement des fichiers lib/ (et app/api/…/sessions/active/route.ts pour watchdog). `rg -l -i 'userGlobalSync|globalSync|visualProof|watchdog|retentionDays|chunkRetention|regressionTimeout' components app --glob '*.tsx'` → aucun composant (les hits « retention » de SessionOutputStream/SessionLogTail concernent le marqueur de prune, pas le réglage). `rg -l 'BUG_REGRESSION_TIMEOUT|MCP_USER_GLOBAL_SYNC|SESSION_CHUNK_RETENTION|VISUAL_PROOF|WATCHDOG_THRESHOLD' app components hooks` → vide.

</details>

### #31 — WebhooksBand fabrique l'état « aucun projet » quand la lecture échoue, à l'inverse de la règle que NotificationsBand documente pour la même donnée

**Nature** cassé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `components/settings-piscine/WebhooksBand.tsx:33-45`
- `components/settings-piscine/WebhooksBand.tsx:100-104`
- `components/settings-piscine/NotificationsBand.tsx:21-31`
- `app/settings/page.tsx:47-62`

**Constat**

`components/settings-piscine/WebhooksBand.tsx:33-45` charge `/api/settings/webhooks` avec `.catch(() => {})` et sans état `loaded`/`failed` ; `rows` reste `[]` et le rendu (l.100-104) affiche `t("webhooks.empty")` (« aucun projet ») pour une réponse non-ok, un JSON invalide ou une panne réseau. La bande sœur `NotificationsBand.tsx:21-24` pose explicitement la règle inverse (« A failed read → header plus the truthful footnote, never a fabricated "no projects" state ») et `app/settings/page.tsx:47-62` fait ce travail (`webhooksFailed`). Les deux bandes déclarent par ailleurs deux types identiques champ pour champ, `NotificationWebhook` (NotificationsBand.tsx:26-31) et `WebhookRow` (WebhooksBand.tsx:20-24), tous deux exportés par le barrel.

**Précision du vérificateur**

`components/settings-piscine/WebhooksBand.tsx:33-46` charge `/api/settings/webhooks` sans tester `response.ok`, avec `.catch(() => {})` et sans état `loaded`/`failed` ; `rows` reste `[]` et le rendu (l.98-101) affiche `t("webhooks.empty")` (« No projects yet… ») aussi bien pendant le chargement initial que sur une réponse 500 (la route renvoie `{ error }` via errorResponse), un JSON invalide ou une panne réseau. La bande sœur `NotificationsBand.tsx:23-25` documente la règle inverse et `app/settings/page.tsx:47-62` l'applique (`webhooksFailed`). Trois types identiques champ pour champ coexistent : `NotificationWebhook` (NotificationsBand.tsx:27-32), `WebhookRow` (WebhooksBand.tsx:20-24), tous deux ré-exportés par le barrel (index.ts:69, :82), plus `ProjectWebhookEntry` côté route (app/api/settings/webhooks/route.ts:14-19). Aucun test (`__tests__/settings-webhooks-section.test.tsx` mocke le GET toujours `ok: true`) ne couvre l'échec de lecture.

`components/settings-piscine/WebhooksBand.tsx:33-46` lit `/api/settings/webhooks` sans tester `response.ok` ni poser d'état loaded/failed (`.catch(() => {})`), et le rendu l.98-101 affiche `t("webhooks.empty")` (« No projects yet. Create a project to configure a webhook. ») dès que `rows` est `[]` — c'est-à-dire pendant le chargement, sur une 500 (`errorResponse` renvoie `{error}` en JSON valide, route.ts:46-48), sur une forme illisible et sur une panne réseau. Le composant est bien monté sans props sur `app/settings/integrations/page.tsx:102`, onglet atteignable via `app/settings/layout.tsx:42` et `lib/piscine/nav.ts:198`. La bande sœur `NotificationsBand.tsx:23-25,56` documente et applique la règle inverse, et `app/settings/page.tsx:51-68` pose `webhooksFailed`. Le seul test (`__tests__/settings-webhooks-section.test.tsx:47-58`) ne couvre que le vide avec `ok: true`. Trois types identiques coexistent : `NotificationWebhook` (NotificationsBand.tsx:27-32), `WebhookRow` (WebhooksBand.tsx:20-24, aucun consommateur externe, réexporté par index.ts:82) et `ProjectWebhookEntry` (app/api/settings/webhooks/route.ts:14-19).

**Recommandation**

Ajouter `loaded`/`failed` (comme la page Workspace), rendre une note d'échec et masquer le message « vide » tant que la lecture n'a pas abouti ; fusionner `WebhookRow` dans `NotificationWebhook`.

<details><summary>Preuve relevée par l'auditeur</summary>

WebhooksBand.tsx:35-44 : `fetch("/api/settings/webhooks").then((response) => response.json()).then((payload) => { … if (Array.isArray(list)) setRows(list) }).catch(() => {})` — pas de test `response.ok`, pas de setter d'échec. l.100 `{rows.length === 0 ? (<Mono …>{t("webhooks.empty")}</Mono>) : …}`.

</details>

### #33 — Cinq clés de réglage sont définies deux fois (client vs lib), avec un commentaire faux et `global_prompt` lu par littéral dans quatre routes

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `components/settings-piscine/settings-fields.ts:101-113`
- `lib/github/client.ts:6`
- `lib/documents/memory-constants.ts:111`
- `lib/workflow/spec-rewrite-constants.ts:15`
- `lib/claude/mcp-injection.ts:51`
- `app/api/projects/import/route.ts:50`
- `app/api/projects/[projectId]/releases/route.ts:149`
- `app/api/projects/[projectId]/chat/stream/route.ts:387`
- `app/api/projects/[projectId]/epics/[epicId]/resolve-merge/route.ts:230`

**Constat**

`settings-fields.ts:101-113` redéfinit `github_pat`, `global_prompt`, `memory_auto_distill`, `spec_auto_rewrite` et `mcp_tools_enabled`. Le commentaire l.109 dit que ces clés « have no constant », ce qui est faux pour trois d'entre elles : `lib/documents/memory-constants.ts:111`, `lib/workflow/spec-rewrite-constants.ts:15` et `lib/claude/mcp-injection.ts:51` exportent déjà la même constante (spec-rewrite-constants.ts est sans dépendance base, donc importable côté client). Inversement `GLOBAL_PROMPT_SETTING_KEY` n'existe QUE côté client : les quatre lecteurs serveur utilisent le littéral `"global_prompt"` (app/api/projects/import/route.ts:50, releases/route.ts:149, chat/stream/route.ts:387, resolve-merge/route.ts:230). Rien ne casse si un côté renomme la clé : le réglage disparaît silencieusement, exactement le mode de défaillance que le fichier dit combattre.

**Précision du vérificateur**

`components/settings-piscine/settings-fields.ts:107-113` redéfinit cinq clés de réglage déjà (ou pas) portées par des constantes lib. Le commentaire l.109 « …have no constant » est faux pour trois d'entre elles : `lib/documents/memory-constants.ts:111`, `lib/workflow/spec-rewrite-constants.ts:15` et `lib/claude/mcp-injection.ts:51`. Deux nuances par rapport au finding initial : (a) `memory-constants.ts` (aucun import) et `spec-rewrite-constants.ts` (en-tête : « Kept free of database imports so client components (the Settings page) can import the key ») sont importables côté client, donc leur duplication est purement gratuite, tandis que `mcp-injection.ts` importe `@/lib/db` (l.38) — sa duplication est justifiée par la même contrainte de bundle que `github_pat`, seul le commentaire est à corriger ; (b) `GLOBAL_PROMPT_SETTING_KEY` n'existe effectivement que côté client et les quatre lecteurs serveur passent par le littéral (`app/api/projects/import/route.ts:50`, `.../chat/stream/route.ts:387`, `.../resolve-merge/route.ts:230`, `.../releases/route.ts:149`), mais le mode de défaillance n'est pas « silencieux » sur l'écriture : `app/api/settings/route.ts:108` refuse en 400 toute clé hors `lib/settings/writable-keys.ts`, et `__tests__/settings-writable-keys-coverage.test.ts` couvre le drift des constantes sous `lib/`. Le risque silencieux résiduel porte sur le chemin de LECTURE (les 4 littéraux `eq(settings.key, "global_prompt")`), qu'aucun test ne relie à la constante client.

**Recommandation**

Créer `lib/settings/keys.ts` (aucune dépendance base) portant les cinq constantes, y faire pointer settings-fields.ts, lib/github/client.ts, memory-constants, spec-rewrite-constants, mcp-injection et les quatre routes ; supprimer le commentaire l.101-109.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '"github_pat"|"memory_auto_distill"|"spec_auto_rewrite"|"mcp_tools_enabled"|"global_prompt"' lib components app --glob '!lib/settings/writable-keys.ts'` → les 5 déclarations de settings-fields.ts + 4 constantes lib + 4 littéraux `eq(settings.key, "global_prompt")` dans app/api.

</details>

### #34 — Menu Réglages du TopBar : « Workspace » reste actif sur /settings/integrations, et les onglets Pipeline/Apparence n'existent pas dans le modèle de nav

**Nature** cassé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `lib/piscine/nav.ts:176-200`
- `lib/piscine/nav.ts:238-253`
- `components/piscine/TopBarMenu.tsx:230-266`
- `app/settings/layout.tsx:38-44`

**Constat**

`lib/piscine/nav.ts:243-253` `isNavEntryActive` fait un préfixe `pathname.startsWith(path + "/")`. L'entrée `workspace` a `href: "/settings"`, donc sur `/settings/integrations` elle est active EN MÊME TEMPS que l'entrée `integrations` : `TopBarMenu.tsx:230-266` surligne deux lignes (`data-active`, `bg-strata-feed`, `font-semibold`). Le commentaire nav.ts:238-241 justifie ce comportement par « the four Settings entries share /settings … until 11c ships real sections » — 11c a livré des routes séparées (`app/settings/{pipeline,integrations,appearance}/page.tsx`) et la remarque est périmée. Par ailleurs le modèle de nav ne connaît ni `/settings/pipeline` ni `/settings/appearance` (`SETTINGS_TABS` de `app/settings/layout.tsx:38-44` en a 5, `NAV_CATEGORIES[2].entries` en a 4 avec deux ancres) : ces deux onglets ne sont atteignables que depuis la barre d'onglets d'une page réglages déjà ouverte.

**Précision du vérificateur**

`lib/piscine/nav.ts:244-253` `isNavEntryActive` fait un match par préfixe sans notion d'`exact`. L'entrée `workspace` (`href: "/settings"`, nav.ts:181-186) est donc active sur toute route `/settings/*` : sur `/settings/integrations` deux lignes du menu Réglages sont surlignées (`workspace` + `integrations`, `components/piscine/TopBarMenu.tsx:247,299-308` → `data-active`, `font-semibold`, `stratum.activeRow`), et sur `/settings/pipeline` et `/settings/appearance` c'est `workspace` seul qui est faussement allumé. Le chemin est réel : `app/layout.tsx:95` monte `TopBar`, `TopBar.tsx:571-574` passe `pathname` à `TopBarMenu`. `app/settings/layout.tsx:38-44` a déjà résolu le même problème côté onglets avec `exact: true` sur Workspace (commentaire l.20-22), mais nav.ts n'a pas suivi : les commentaires nav.ts:178-180 et 238-241 (« ONE page with sections », « ?tab= », « until 11c ships real sections ») sont périmés (routes `app/settings/{pipeline,integrations,appearance}/page.tsx` existantes ; les hrefs utilisent d'ailleurs `#`, pas `?tab=`). Le modèle nav (4 entrées : workspace, night-runs, notifications, integrations) ignore `/settings/pipeline` et `/settings/appearance`, qui ne sont liés nulle part hors `app/settings/` (grep vide). Aucun test ne couvre `isNavEntryActive` sur `/settings/<sous-route>` (`__tests__/top-bar.test.tsx` ne teste que `/settings`).

`lib/piscine/nav.ts:252` fait un préfixe `pathname.startsWith(path + "/")` sans notion d'`exact` ; l'entrée `workspace` (`href: "/settings"`) est donc active sur toute sous-route de `/settings`. Sur `/settings/integrations` elle l'est en même temps que l'entrée `integrations` : `TopBarMenu.tsx:300-309` rend deux lignes avec `data-active="true"`, `font-semibold` et `bg-strata-feed`. Sur `/settings/pipeline` et `/settings/appearance`, seule « Workspace » est surlignée alors que l'utilisateur n'y est pas. Les commentaires nav.ts:177-179 et 238-241 (« 11c is ONE page with sections », « until 11c ships real sections ») sont périmés : `app/settings/{pipeline,integrations,appearance}/page.tsx` existent et `SETTINGS_TABS` (`app/settings/layout.tsx:38-44`) compte 5 onglets contre 4 entrées dans `NAV_CATEGORIES[2].entries` ; `/settings/pipeline` et `/settings/appearance` sont absents du modèle de nav. Nuance : les deux entrées `night-runs` / `notifications` utilisent un `#` (pas `?tab=`) ; `pathOf` ne tronque que sur `?`, si bien qu'elles ne sont jamais actives par accident de comparaison de chaîne, et non par la garde `includes("?")`.

**Recommandation**

Donner `exact: true` (ou un `match` explicite) à l'entrée `workspace`, aligner `NAV_CATEGORIES[2].entries` sur `SETTINGS_TABS` (ou dériver l'un de l'autre), et retirer les commentaires « ONE page with sections ».

<details><summary>Preuve relevée par l'auditeur</summary>

nav.ts:252 `return pathname === path || pathname.startsWith(\`${path}/\`);` avec path=`/settings` et pathname=`/settings/integrations` → true ; l'entrée `integrations` (href `/settings/integrations`) → true aussi. Comparaison des deux tables : layout.tsx (workspace, agents, pipeline, integrations, appearance) vs nav.ts (workspace, night-runs, notifications, integrations).

</details>

