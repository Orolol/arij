# Lot 23 — Helpers et types dupliqués

**Difficulté** 1/4 — Simple — agent peu coûteux
**Findings** 11 (0 fort · 3 moyen · 8 faible ; effort 11 S · 0 M · 0 L)
**Dépendances** Indépendant ; petit et mécanique, bon premier lot pour un agent peu coûteux.

**Statut** fait le 11/09/2026 — 11/11 findings traités, sur l'arbre
`45e96387` + rationalisation UI non commitée. Détail :

- **#35** `lib/utils/timestamps.ts` créé et devient l'unique normaliseur
  (`parseStoredTimestamp` accepte la forme SQLite, le « T sans Z » et `HH:MM` ;
  `compareStoredTimestamps`, `latestActivityTimestamp`). 16 importeurs
  repointés, `lib/agent-sessions/last-activity.ts` et son test supprimés ;
  `lib/i18n/format.ts` et `lib/telescope/collect.ts` délèguent au module
  partagé. Cas « T sans Z » / sans secondes ajoutés à `i18n-format.test.ts`.
- **#58** `isGitRepo` devient un wrapper d'`assertGitRepository` (sonde
  `git rev-parse --is-inside-work-tree` en locale C) : plus de `checkIsRepo()`.
- **#152** `lib/agent-sessions/active-activity.ts` porte `UnifiedActivity` et
  `classifySessionActivity`, importés par la route, `useAgentPolling`,
  `useAgentDispatch` et `lib/control-desk/aggregate.ts` (`inferTaskType`
  délègue) ; la copie divergente du hook et `lib/types/agent-session.ts`
  disparaissent, les trois casts de `useTicketOverlayData` partent, et les
  types de payload de `useAgentConfig` / `LimitsView` sont importés depuis
  `lib/agent-config`.
- **#28** `projectColorIndexById` dans `lib/control-desk/aggregate.ts`, partagé
  avec TopBar (même comparateur d'instants, mêmes nuls en dernier).
- **#61** `createOctokit` seul constructeur ; les quatre blocs de
  `pull-requests.ts` et le `getOctokit` de `releases.ts` l'appellent. Les routes
  `pr/sync` et `releases/[releaseId]/publish` rattrapent
  `GitHubNotConfiguredError` en 400 + `code` et passent d'`EXCLUDED` à
  `EXERCISED` dans `git-github-route-status-convention.test.ts`.
- **#67** `isSafeRepoSegment` unique (`lib/git/github-url.ts`) ;
  `lib/projects/workspace-constants.ts` perd sa copie,
  `lib/projects/workspace-path.ts` et son test sont supprimés, la doc
  `github-import.md` pointe `resolveCloneDestination` / `isInsideProjectsRoot`.
- **#86** `ProjectEpicListRow` exporté ; les quatre vues client en dérivent par
  `Pick<>` et les casts `as unknown as` de `useTicketOverlayData` disparaissent.
- **#89** les schémas inline vivants rejoignent `lib/validation/schemas.ts`
  (reorder, dependencies, commentaire ticket), `comments`/`dependencies` passent
  par `validateBody`, `validateOptionalBody` s'appuie sur un `parseAndValidate`
  commun, et `__tests__/route-not-found-helper-convention.test.ts` empêche le
  retour des 404 recopiées. `RefinementStatus` vivait déjà dans
  `lib/refinement/types.ts` : seul l'import du composant depuis `app/api` était
  à corriger, fait.
- **#110** une seule table `AGENT_TYPE_LABEL_KEYS` (avec `release_notes`) et un
  seul namespace ; `STATUS_LABEL_KEYS` est partagé liste / vue live ;
  `OUTCOME_LABEL_KEYS` est importé par `SessionOutcomeBadge`.
- **#111** `compactElapsed` vit dans `lib/utils/format-elapsed.ts` ;
  `formatTokens` n'a plus qu'une définition ; `projectToneIndex` n'a plus qu'une
  implémentation (FNV-1a), consommée par TopBar, releases, usage et l'overlay.
- **#139** 8 routes passent aux helpers de `lib/api/route-helpers.ts`
  (agent-config ×5, generate-spec, review-comments, build).

**Écarts assumés** : rien de la liste n'a été laissé de côté. Deux points de
forme : le lot proposait `lib/utils/timestamps.ts` ou `lib/i18n/format.ts` pour
le normaliseur — c'est le premier qui a été retenu, pour rester sans dépendance
de catalogue ; et `RefinementStatus` n'a pas eu besoin d'être déplacé.

## Décision

Un helper par concept, importé partout : parseStoredTimestamp, compareStoredTimestamps, formatTokens, project colour index, isGitRepo (sur assertGitRepository), getProjectOr404, validateBody, UnifiedActivity, EpicRow.

## Objectif

Supprimer les 44 définitions dupliquées de l'inventaire (annexe : isRecord ×6, getGit ×3, escapeRegExp ×3, coerceNumber ×3, readSettingValue ×3, finiteOrNull ×3…), un seul schéma de hash pour la couleur projet, les tables de libellés de sessions partagées, six façons d'obtenir un Octokit ramenées à une, validation zod dans les 14 routes inline, types de payload importés depuis un module client-safe.

## Démarche suggérée

1. Utiliser l'annexe (relevé duplicates-utilities) comme check-list, une PR par famille de helpers.
2. La couleur projet : décider du schéma unique (celui du desk) et l'appliquer à TopBar, session-live, usage.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #35 — lib/i18n/format.ts:parseTimestamp n'accepte pas la forme zoneless « T sans Z » que parseStoredTimestamp normalise — deux parseurs, deux contrats

**Nature** doublon · **Impact** moyen (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `lib/i18n/format.ts:53-71`
- `lib/agent-sessions/last-activity.ts:1-18`
- `lib/i18n/index.ts:29-36`

**Constat**

`lib/i18n/format.ts:53-71` normalise uniquement `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(…)?$` (séparateur ESPACE obligatoire) avant `Date.parse`. `lib/agent-sessions/last-activity.ts:1-18` (`ZONELESS_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/`) accepte explicitement « legacy T separators without Z » et les force en UTC. Un timestamp `2026-08-30T06:00:00` (sans Z) est donc lu en UTC par les tris/fenêtres serveur mais en HEURE LOCALE par `formatRelative`/`formatDateTime` côté affichage : décalage d'un fuseau entier sur les stamps rendus, alors que les deux fonctions prétendent chacune être LA normalisation. `format.ts` accepte aussi `HH:MM` sans secondes que l'autre refuse. Trois copies du même contrat existent (avec lib/telescope/collect.ts, relevé par l'inventaire) ; celle de format.ts est la seule exposée au rendu.

**Précision du vérificateur**

Divergence de contrat confirmée, introduite par le diff non commité : `lib/agent-sessions/last-activity.ts:1-2` élargit sa regex de `/^(…) (…)$/` à `/^(…)[ T](…)$/` (« legacy T separators without Z »), tandis que `lib/i18n/format.ts:53` — non modifié — continue d'exiger le séparateur ESPACE. Un `2026-08-30T06:00:00` sans Z serait donc lu en UTC par les ~15 consommateurs serveur de `parseStoredTimestamp` et en heure LOCALE par `formatRelative`/`formatDateTime` (`format.ts:137` et `:207`, ré-exportés par `lib/i18n/index.ts:29-36`). La divergence est symétrique : `format.ts` accepte `HH:MM` sans secondes que `last-activity` refuse et laisse tomber en heure locale.

Deux corrections au finding :
1. Il n'y a pas « trois copies du même contrat » mais QUATRE parseurs pour TROIS contrats distincts : `format.ts` (espace, secondes optionnelles), `last-activity.ts` + `components/session-live/log-lines.ts:77-82` `toEpochMs` (espace ou T, secondes obligatoires — ce dernier non relevé par l'inventaire et lui aussi exposé au rendu), et `lib/telescope/collect.ts:241-244` qui ne normalise RIEN (`Date.parse` nu, donc tout zoneless en heure locale) — ce n'est pas une copie, c'est le contrat le plus faible.
2. Le décalage d'un fuseau au rendu est LATENT, pas actif : le sondage de toutes les colonnes horodatées de `data/arij.db` ne trouve que deux formes stockées — ISO `…Z` (5635) et SQLite `YYYY-MM-DD HH:MM:SS` (176) — et ZÉRO valeur « T sans Z ». La branche ajoutée est défensive ; le défaut réel est la dette de duplication et l'asymétrie des contrats, pas un mis-rendu observable aujourd'hui.

**Recommandation**

Faire de `parseStoredTimestamp` l'unique normaliseur (le déplacer dans un module sans dépendance, ex. lib/i18n/format.ts ou lib/utils/timestamps.ts) et faire pointer format.ts et telescope/collect.ts dessus ; ajouter un cas de test « T sans Z » côté format.

<details><summary>Preuve relevée par l'auditeur</summary>

format.ts:53 `const SQLITE_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;` vs last-activity.ts:1-2 `/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/`. `rg -n parseStoredTimestamp lib | wc -l` → 15 modules consommateurs ; `formatRelative`/`formatDateTime` (format.ts:139, 215) appellent le parseur local.

</details>

### #58 — Deux tests « est-ce un dépôt git » incompatibles : isGitRepo (checkIsRepo) dans 9 routes, assertGitRepository (locale C) dans 4

**Nature** doublon · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `lib/git/manager.ts:624-631`
- `lib/git/remote.ts:161-212`
- `app/api/projects/[projectId]/build/route.ts:213`
- `app/api/projects/[projectId]/epics/[epicId]/build/route.ts:160`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:146`
- `app/api/projects/[projectId]/epics/[epicId]/diff/route.ts:35`
- `app/api/projects/[projectId]/epics/[epicId]/resolve-merge/route.ts:72`
- `lib/grading/dispatch.ts:217`

**Constat**

lib/git/remote.ts:161-181 explique pourquoi checkIsRepo() de simple-git est inutilisable (dépend de la langue de git, rejette d'un GitError générique sur un git non anglais/allemand) et spawn git en locale C. Pourtant lib/git/manager.ts:624-631 exporte isGitRepo bâti sur ce même checkIsRepo, et c'est lui que build, review, diff, resolve-merge, story build/review et grading/dispatch utilisent. Les routes git-sync ont donc une sémantique (400 + code GIT_REPO_NOT_A_REPOSITORY) et les routes build/review une autre (bool, faux positif possible), pour le même chemin projet. validatePath (lib/validation/path.ts) ne teste que « répertoire existant ».

**Précision du vérificateur**

Deux définitions concurrentes de « dépôt git utilisable » coexistent. lib/git/remote.ts:161-181 documente pourquoi checkIsRepo() de simple-git est inutilisable (il ne convertit l'exit 128 en false que si stderr matche /Not a git repository|Kein Git-Repository/i, donc sur un git parlant une troisième langue il rejette d'un GitError générique) et assertGitRepository (remote.ts:182-212) spawn `git rev-parse --is-inside-work-tree` en locale C, levant GitRepositoryUnavailableError("GIT_REPO_NOT_A_REPOSITORY") → 400 typé. Pourtant lib/git/manager.ts:622-631 exporte isGitRepo, bâti sur ce même checkIsRepo via un getGit() nu (manager.ts:14-16, aucun pinning de locale/env), dans un try/catch qui écrase toute erreur en `false`. isGitRepo a 8 sites d'appel : 7 routes (projects/build:213, epics/build:160, epics/review:146, epics/diff:35, epics/resolve-merge:72, stories/build:93, stories/review:144) et 1 hors route (lib/grading/dispatch.ts:217). assertGitRepository couvre worktrees/route.ts:147+176, git/status:106, git/push:56, git/pull:88, plus indirectement github/detect et git/detect-remote via detectGitHubRemote (remote.ts:270). Le mode de défaillance de isGitRepo est un FAUX NÉGATIF, pas un faux positif : sur un git non anglophone et un répertoire ordinaire il renvoie tout de même false (bonne réponse), mais un dépôt légitime dont checkIsRepo échoue pour une autre cause (refus dubious-ownership, object store corrompu, binaire git absent) est rendu comme « Path is not a git repository » + 400, code d'erreur perdu. validatePath (lib/validation/path.ts:32-43) ne teste effectivement que « répertoire existant ».

**Recommandation**

Faire de isGitRepo un wrapper de assertGitRepository (try/catch → bool) ou remplacer ses 9 appelants par assertGitRepository et supprimer l'export, pour une seule définition de « dépôt utilisable ».

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'isGitRepo\b' app lib → 9 appelants listés ; rg 'assertGitRepository' app lib → remote.ts, worktrees route, git/status, git/push, git/pull, github/detect. remote.ts:166-173 : « checkIsRepo() converts exit 128 into false only when stderr matches /Not a git repository|Kein Git-Repository/i, so on a git speaking any third language it rejects with a generic GitError ».

</details>

### #152 — Trois types pour le payload de /sessions/active, et des types de payload recopiés dans les hooks au lieu d'être importés

**Nature** doublon · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `app/api/projects/[projectId]/sessions/active/route.ts:17-56`
- `hooks/useAgentPolling.ts:6-34`
- `lib/types/agent-session.ts:1-15`
- `hooks/useAgentDispatch.ts:7`
- `hooks/useAgentDispatch.ts:43-52`
- `hooks/useTicketOverlayData.ts:385-393`
- `hooks/useTicketOverlayData.ts:439-441`
- `hooks/useAgentConfig.ts:13`
- `hooks/useAgentConfig.ts:37`
- `hooks/useAgentConfig.ts:402`
- `hooks/useAgentConfig.ts:496`
- `lib/agent-config/agent-stats.ts:39-76`
- `components/agents-workshop/LimitsView.tsx:361`
- `lib/control-desk/aggregate.ts:170`

**Constat**

Le même objet renvoyé par GET /api/projects/:id/sessions/active est décrit par UnifiedActivity dans la route, par une copie verbatim de UnifiedActivity dans hooks/useAgentPolling.ts, et par AgentSession (lib/types/agent-session.ts, documenté « shape as returned by /sessions/active » alors qu'il lui manque type/label/namedAgentName/source/stale et qu'il a completedAt/error qui n'y sont pas). useAgentDispatch type sa lecture en AgentSession[], et useTicketOverlayData doit ensuite caster activeSession vers {type, label, namedAgentName} pour lire ce que la route envoie réellement. Même schéma pour les stats : AgentDayStats, NamedAgentStats, AgentDaySeriesPoint (hooks/useAgentConfig.ts « Mirrors lib/agent-config/agent-stats.ts »), ResolvedAgentPrompt (vs lib/agent-config/prompts.ts:12), CustomReviewAgent (vs CustomReviewAgentRecord) et ProjectReviewBounceRow (LimitsView.tsx:361 vs stats.ts:45). Enfin la classification « quel type de session » existe deux fois : inferDbActivityType (route active) et inferTaskType (lib/control-desk/aggregate.ts:170), que la route elle-même dit « meant to agree ».

**Précision du vérificateur**

Le finding tient, avec deux imprécisions à corriger.

Vérifié :
- `export interface UnifiedActivity` existe bien deux fois : `app/api/projects/[projectId]/sessions/active/route.ts:17` et `hooks/useAgentPolling.ts:6`. La copie du hook n'est PAS « verbatim » : elle rend optionnels `epicId?`, `userStoryId?`, `namedAgentName?`, `lastActivityAt?`, `stale?` (obligatoires dans la route) et abrège les commentaires — c'est une copie divergente, ce qui est pire, pas mieux.
- `lib/types/agent-session.ts` documente « shape as returned by /sessions/active » et décrit une 3e forme : pas de `type`/`label`/`namedAgentName`/`source`/`stale`/`cancellable`, et des `completedAt`/`error` que la projection de la route (`route.ts:266-282` pour les lignes DB, `:286-300` pour le registry) n'émet jamais.
- Seul importeur hors tests : `hooks/useAgentDispatch.ts:7` ; il type la lecture de `/sessions/active` en `AgentSession[]` (`useAgentDispatch.ts:43-52`).
- La conséquence est réelle : `hooks/useTicketOverlayData.ts` prend `activeSession` de `useAgentDispatch` (ligne 148) puis le caste trois fois pour lire ce que la route envoie vraiment — lignes **388**, **396** et **442** (et non 385-393 / 439-441 ; léger décalage dû aux modifications non commitées).
- Doublons de types de payload confirmés : `hooks/useAgentConfig.ts:13` `ResolvedAgentPrompt` (identique à `lib/agent-config/prompts.ts:12`) ; `:37` `CustomReviewAgent` (identique champ pour champ à `CustomReviewAgentRecord`, `lib/agent-config/review-agents.ts:5`) ; `:402` `AgentDayStats`, `:489` `AgentDaySeriesPoint`, `:496` `NamedAgentStats` sous le commentaire `:401` « Mirrors lib/agent-config/agent-stats.ts » (originaux `lib/agent-config/agent-stats.ts:39,51,63`) — avec dérive : `byRole` est `{ role: string; runs: number }[]` dans le hook contre `AgentRoleSplitRow[]` (`role: DispatchRole`) côté lib. `ProjectReviewBounceRow` re-déclaré à `components/agents-workshop/LimitsView.tsx:361` alors qu'il est exporté par `lib/agent-config/stats.ts:45`.
- Double classification confirmée : `inferDbActivityType` (`route.ts:93`) et `inferTaskType` (`lib/control-desk/aggregate.ts:170`) ont le même ordre de tests, les mêmes branches et la même chute (`orchestrationMode === "team"` → build, `mode === "plan"` → review) ; la route dit bien « The two classifications are meant to agree, and now do » (`route.ts:87-89`). Nuance à mentionner dans la recommandation : les deux ne renvoient pas le même vocabulaire (`UnifiedActivity["type"]` en minuscules vs `DeskTaskType` en majuscules) et la route passe par les constantes `REFINEMENT_AGENT_TYPE` / `MEMORY_WRITER_AGENT_TYPES` là où `aggregate.ts` code « refinement », « memory_distill », « dreaming » en dur — unifier demande donc une fonction commune plus un mapping, pas une simple suppression.

**Recommandation**

Déplacer UnifiedActivity dans un module client-safe (ex. lib/agent-sessions/active-activity.ts) importé par la route, useAgentPolling et useAgentDispatch ; supprimer lib/types/agent-session.ts ; remplacer les copies de hooks/useAgentConfig.ts et LimitsView par des `import type` depuis lib/agent-config ; faire porter inferDbActivityType et inferTaskType par une seule fonction.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'export interface UnifiedActivity' → sessions/active/route.ts:17 et hooks/useAgentPolling.ts:6. rg 'types/agent-session' hors tests → seul importeur hooks/useAgentDispatch.ts:7. useTicketOverlayData.ts:385 « activeSession as { type?: …; agentType?: …; mode?: … } », :393 « (activeSession as { label?: string | null } | null)?.label », :439 cast vers namedAgentName. useAgentConfig.ts:401 « Mirrors lib/agent-config/agent-stats.ts ». sessions/active/route.ts:100-104 : « lib/control-desk/aggregate.ts's inferTaskType dropped the same tests … The two classifications are meant to agree ».

</details>

### #28 — TopBar recalcule la teinte projet avec un comparateur différent de celui du desk (localeCompare brut vs compareStoredTimestamps)

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `components/piscine/TopBar.tsx:213-232`
- `lib/control-desk/aggregate.ts:92-107`
- `lib/agent-sessions/last-activity.ts:21-32`
- `lib/db/schema.ts:34`
- `app/api/projects/route.ts:143-158`

**Constat**

`components/piscine/TopBar.tsx:219-232` reconstruit `colorIndexById` en triant `allProjects` par `createdAt` avec `localeCompare` sur la chaîne brute, en prétendant appliquer « Same rule as deriveProjects() in lib/control-desk/aggregate.ts ». Or `lib/control-desk/aggregate.ts:92-98` trie avec `compareStoredTimestamps` (parse SQLite/ISO en instants, invalides en dernier) — c'est précisément ce que la rationalisation a introduit (« sélection du dernier événement indépendante du format SQLite/ISO »). Les deux formats coexistent dans `projects.created_at` : le schéma a `default(sql\`CURRENT_TIMESTAMP\`)` (forme `YYYY-MM-DD HH:MM:SS`, lib/db/schema.ts:34) alors que `POST /api/projects` écrit `new Date().toISOString()` (route.ts:2/16 de la fenêtre lue). Sur une base contenant une ligne de chaque forme le même jour, ' ' (0x20) < 'T' (0x54) : le tri chaîne diverge du tri instant et la puce du bar ne porte plus la couleur du desk. C'est aussi la 5e implémentation de la « teinte d'identité projet » (les 4 autres sont relevées par l'inventaire : releases/derive.ts, ticket/derive.ts, usage/formatters.ts, control-desk/aggregate.ts).

**Précision du vérificateur**

`components/piscine/TopBar.tsx:208-217` duplique la règle de teinte projet de `deriveProjects()` (lib/control-desk/aggregate.ts:92-103) — son commentaire l'annonce explicitement — mais trie avec `(a.createdAt ?? "").localeCompare(...)` alors que la rationalisation non commitée vient de faire passer aggregate.ts à `compareStoredTimestamps` (git diff sur aggregate.ts le montre ; TopBar n'a qu'un hunk sans rapport). Les deux comparateurs divergent sur (a) le mélange des formats `YYYY-MM-DD HH:MM:SS` / ISO et (b) les valeurs nulles ou invalides, que `localeCompare` place en premier et `compareStoredTimestamps` en dernier. Impact réel à nuancer : le seul chemin d'écriture applicatif (`app/api/projects/route.ts:143-155`, inchangé depuis le premier commit) écrit toujours de l'ISO, aucune migration n'insère dans `projects`, et la base locale ne contient que des `created_at` ISO — la puce du TopBar ne peut donc diverger du desk qu'avec une ligne écrite hors application (ou en test). Le défaut est une duplication de règle prête à dériver, pas un bug observable aujourd'hui. Le décompte « 5e implémentation de la teinte projet » est inexact : seules aggregate.ts et TopBar implémentent l'ordre de création ; releases/derive.ts, usage/formatters.ts et lib/usage/aggregate.ts sont des fallbacks par hash documentés.

**Recommandation**

Exporter un `projectColorIndexById(rows)` depuis lib/control-desk (ou lib/piscine/tokens.ts) basé sur `compareStoredTimestamps`, et le consommer dans TopBar, aggregate.ts et les trois dérivations par hash listées par l'inventaire.

<details><summary>Preuve relevée par l'auditeur</summary>

TopBar.tsx:221 `const byCreated = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");` vs aggregate.ts:95 `const byCreated = compareStoredTimestamps(a.createdAt, b.createdAt);`. `rg -n 'createdAt' lib/db/schema.ts` → `default(sql\`CURRENT_TIMESTAMP\`)` ; `sed -n 140,158p app/api/projects/route.ts` → `const now = new Date().toISOString(); … createdAt: now`.

</details>

### #61 — Six façons d'obtenir un Octokit : le contrat 400+code de client.ts n'est appliqué que par les issues, PR et releases lèvent des Error nues

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `lib/github/client.ts:81-90`
- `lib/github/pull-requests.ts:242-246`
- `lib/github/pull-requests.ts:276-280`
- `lib/github/pull-requests.ts:312-316`
- `lib/github/pull-requests.ts:434-438`
- `lib/github/releases.ts:3-9`
- `lib/github/issues.ts:41`

**Constat**

lib/github/client.ts définit createOctokit() qui lève GitHubNotConfiguredError typée (code GITHUB_PAT_NOT_CONFIGURED) précisément pour que les routes répondent 400 au lieu de 500. Mais pull-requests.ts refait `getGitHubTokenFromSettings(); if (!token) throw new Error("GitHub PAT not configured. Set it in Settings.")` quatre fois (l.242-246, 276-280, 312-316, 434-438) et releases.ts a son propre getOctokit avec un message différent (« Set it in project settings. », l.3-9). Ces Error génériques tombent dans errorResponse → 500 (pr/sync, ci-watch, releases), là où issues/triage renvoie 400 + code exploitable par l'UI.

**Précision du vérificateur**

La duplication est réelle et vérifiée : six sites obtiennent un client Octokit à partir du PAT — `createOctokit()` (lib/github/client.ts:78-87, seul à lever la `GitHubNotConfiguredError` typée avec `code: "GITHUB_PAT_NOT_CONFIGURED"`), quatre blocs copiés-collés dans lib/github/pull-requests.ts (throw aux l.244, 278, 314, 436) et `getOctokit()` dans lib/github/releases.ts:3-9, dont le libellé diverge (« Set it in project settings. » au lieu de la constante `GITHUB_PAT_NOT_CONFIGURED_MESSAGE` = « Set it in Settings. »). Seuls issues.ts (l.41, 89-97) passe par le contrat typé, et seules les routes github/issues/triage et github/issues/sync rattrapent `GitHubNotConfiguredError` pour répondre 400 + `code`.

En revanche l'impact décrit est faux sur deux des trois cibles citées :
- POST /api/projects/[projectId]/releases n'émet PAS de 500 : l'appel à `createDraftRelease` est déjà enveloppé d'un try/catch qui pousse le message dans `githubErrors` (route.ts:416-445) et la réponse reste un succès partiel.
- lib/routines/ci-watch.ts n'est pas une route HTTP : `fetchPullRequestCi*` y est appelé derrière des catch (l.310, 410, 446) et l'échec est enregistré comme `status: "failed"` dans le run de la routine, jamais en 500.
- POST /api/projects/[projectId]/epics/[epicId]/pr ne peut pas non plus atteindre le throw nu de `createPullRequest` : la route vérifie elle-même le PAT et répond 400 avant (route.ts:71-78) ; le throw de pull-requests.ts:244 est de la défense en profondeur morte.

Les vrais chemins 500 sont : POST .../epics/[epicId]/pr/sync (`fetchPrStatus` → `errorResponse(e, …)` par défaut à 500) et POST .../releases/[releaseId]/publish (`publishRelease`/`getRelease` → `getOctokit()` de releases.ts → `errorResponse` l.110-111), route que le finding ne cite pas. Ces deux routes sont par ailleurs listées explicitement, avec justification écrite, dans la liste `EXCLUDED` du pin de convention __tests__/git-github-route-status-convention.test.ts:608-621 — c'est une exclusion assumée, pas un oubli, ce qui abaisse la sévérité : le défaut réel est la duplication et la divergence de libellé, pas une régression de contrat non repérée.

**Recommandation**

Remplacer les six blocs par createOctokit() et rattraper GitHubNotConfiguredError dans pr/sync, releases et ci-watch comme le fait triage.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'GitHub PAT not configured' lib → client.ts:35 (constante), pull-requests.ts ×4, releases.ts:6 (libellé divergent). issues.ts:41 utilise createOctokit(). rg 'GitHubNotConfiguredError' app/api → triage, sync issues, pr (indirect) ; releases route et pr/sync ne le rattrapent pas.

</details>

### #67 — Trois validateurs du segment owner/repo et un confinement de chemin mort que la doc présente comme actif

**Nature** doublon · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `lib/git/github-url.ts:50-57`
- `lib/projects/workspace-constants.ts:25-31`
- `lib/projects/workspace.ts:113-134`
- `lib/projects/workspace-path.ts:25`
- `docs/architecture/github-import.md`

**Constat**

lib/git/github-url.ts (REPO_SEGMENT_PATTERN + isSafeRepoSegment, l.50-57), lib/projects/workspace-constants.ts (GITHUB_NAME_PATTERN + isSafeRepoNameSegment, l.25-31) portent la même regex /^[A-Za-z0-9._-]+$/ avec des règles voisines mais pas identiques (le premier refuse tout `..` embarqué et le tiret initial, le second seulement `.` et `..` exacts). lib/projects/workspace-path.ts (assertInsideRoot, WorkspacePathError) n'a aucun importeur produit alors que github-import.md §Safety properties l'affiche comme la seconde ligne de défense ; le confinement réel est isInsideProjectsRoot/containsPathOnDisk dans workspace.ts.

**Précision du vérificateur**

DEUX validateurs (pas trois) du segment owner/repo, plus un confinement de chemin mort que la doc présente comme actif. (1) `lib/git/github-url.ts:50-56` : `REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/` + `isSafeRepoSegment()`, qui rejette en plus la chaîne vide, le tiret initial, `.` exact et tout `..` embarqué. (2) `lib/projects/workspace-constants.ts:25-31` : `GITHUB_NAME_PATTERN`, regex strictement identique, mais `isSafeRepoNameSegment()` ne rejette que `.` et `..` exacts — il accepte donc `-flag`, `a..b`, `..a`. C'est celui-là que `resolveCloneDestination()` (`lib/projects/workspace.ts:117`) exécute, rattrapé par `isInsideProjectsRoot(destination, root)` (l.128-131, défini l.66 ; `containsPathOnDisk` l.84) — pas de trou exploitable, mais deux règles voisines et divergentes pour un même invariant. Le titre initial parlait de « trois validateurs » : la troisième couche est ce confinement de `workspace.ts`, pas un validateur de segment. Enfin `lib/projects/workspace-path.ts` (`assertInsideRoot` l.25, `WorkspacePathError` l.9) n'a aucun importeur produit — `rg` sur tout le dépôt hors node_modules ne trouve que `__tests__/workspace-path-guard.test.ts` et `docs/architecture/github-import.md` — alors que le tableau « Safety properties » de cette doc (l.153) l'affiche comme la seconde ligne de défense, et l.188 le cite comme couverture de la containment. Aucun de ces fichiers n'est touché par la rationalisation UI non commitée (`git status --porcelain` : absents).

**Recommandation**

Faire de workspace-constants.ts un ré-export de isSafeRepoSegment (github-url.ts est déjà client-safe), supprimer workspace-path.ts et son test, et mettre la doc à jour vers resolveCloneDestination/isInsideProjectsRoot.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'isSafeRepoNameSegment|isSafeRepoSegment|GITHUB_NAME_PATTERN|REPO_SEGMENT_PATTERN' app lib → workspace-constants.ts, workspace.ts:118, github-url.ts, remote.ts:230. rg 'assertInsideRoot|workspace-path' app lib components hooks → 0 (seul __tests__/workspace-path-guard.test.ts). Tableau « Safety properties » de la doc : « …even if it did | assertInsideRoot() (lib/projects/workspace-path.ts) ».

</details>

### #86 — Six types client distincts pour la même ligne du GET /epics, aucun dérivé du contrat serveur

**Nature** refacto · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `lib/types/kanban.ts:98-165`
- `hooks/useEpicDetail.ts:25-44`
- `hooks/useProjectEpicsList.ts:5-9`
- `hooks/useTicketOverlayData.ts:91-95`
- `components/releases/derive.ts:30-41`
- `components/night/NightRunDialog.tsx:43-48`

**Constat**

Le payload de GET /api/projects/:id/epics n'a pas de type partagé : KanbanEpic (lib/types/kanban.ts:98-165) était ce contrat mais n'est importé par aucun consommateur du GET ; chacun redéclare sa propre vue — EpicDetail (hooks/useEpicDetail.ts:25-44), ProjectEpicSummary (hooks/useProjectEpicsList.ts:5-9), ProjectEpicRow (hooks/useTicketOverlayData.ts:91-95, commenté « Row shape the epics route actually returns »), ReleaseEpic (components/releases/derive.ts:30-41), ScopeEpic (components/night/NightRunDialog.tsx:43-48). Côté serveur, EpicRow (lib/control-desk/aggregate.ts:295-323) et RegistryEpicRow en sont une septième forme. Un champ renommé dans la route ne casse aucun de ces types à la compilation.

**Précision du vérificateur**

GET /api/projects/:id/epics n'a pas de type de ligne partagé. `KanbanEpic` (lib/types/kanban.ts:98-164) est la forme la plus complète mais n'est importé que par lib/kanban/queue.ts et lib/kanban/filters.ts (consommateurs serveur/pur-logique) — aucun consommateur du GET ne l'importe. Cinq vues client redéclarées, toutes alimentées par ce même GET : `EpicDetail` (hooks/useEpicDetail.ts:25-44, qui malgré son nom lit la LISTE : `fetch(/api/projects/${projectId}/epics)` ligne 71 puis `.find(row => row.id === epicId)` ligne 83 — la route [epicId] n'exporte que PATCH et DELETE, pas de GET), `ProjectEpicSummary` (hooks/useProjectEpicsList.ts:5-9, fetch ligne 25), `ProjectEpicRow` (hooks/useTicketOverlayData.ts:91-95, commentaire « Row shape the epics route actually returns — wider than ProjectEpicSummary »), `ReleaseEpic` (components/releases/derive.ts:30-40, alimenté par app/projects/[projectId]/releases/page.tsx:92), `ScopeEpic` (components/night/NightRunDialog.tsx:44-49 — le finding disait 43-48, décalage d'une ligne —, fetch ligne 143 `requestJson<ScopeEpic[]>(/api/projects/${projectId}/epics)`). Aucune n'est dérivée d'un type exporté par la route ni de lib/types. Nuance sur la partie serveur : `EpicRow` (lib/control-desk/aggregate.ts:295-323) et `RegistryEpicRow` (lib/tickets-registry/aggregate.ts, servi par app/api/tickets/route.ts) sont des lignes SQL d'AUTRES endpoints, pas des vues du payload de /epics — ils illustrent la dispersion du concept « epic row », mais les compter comme « septième forme du même contrat » est imprécis.

**Recommandation**

Exporter depuis lib/types (ou lib/control-desk/types.ts) le type de ligne réellement renvoyé par la route après le finding 1, et faire dériver les cinq vues client par Pick<>.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -l '\bKanbanEpic\b' app components lib hooks` → lib/kanban/filters.ts, lib/kanban/queue.ts uniquement. `rg -n '^export (interface|type) \w*(Epic|Story|Ticket)' hooks components/…` liste les cinq interfaces client ci-dessus ; aucune n'importe un type de app/api ou de lib/types.

</details>

### #89 — Validation des bodies éclatée : zod inline dans 14 routes, validation manuelle dans d'autres, et un type de route importé par un composant

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `lib/validation/schemas.ts`
- `lib/validation/validate.ts:10-30`
- `lib/validation/validate.ts:69-86`
- `app/api/projects/[projectId]/dependencies/route.ts:35-62`
- `app/api/projects/[projectId]/epics/[epicId]/comments/route.ts:205-212`
- `app/api/projects/[projectId]/epics/reorder/route.ts:127-141`
- `components/kanban/RefinementButton.tsx:9`
- `app/api/projects/[projectId]/refinement/route.ts:21-26`

**Constat**

lib/validation/schemas.ts est censé centraliser les schémas, mais 14 fichiers de app/api définissent leur propre z.object (dont, dans le périmètre, epics/reorder/route.ts:127-141 et epics/[epicId]/dependencies/route.ts:324-326), tandis que dependencies/route.ts:35-62 et epics/[epicId]/comments/route.ts:205-212 valident à la main (`body.content`, `edges`) après `request.json().catch(() => ({}))`, sans le format `{ error: "Validation failed", details }` que apiErrorMessage (lib/validation/error-message.ts) attend côté client. lib/validation/validate.ts:69-86 est une copie de ses lignes 10-30. Enfin components/kanban/RefinementButton.tsx:9 importe `type RefinementStatus` depuis app/api/projects/[projectId]/refinement/route.ts:21, seule dépendance components → app/api du dépôt ; ce type appartient à lib/refinement.

**Précision du vérificateur**

Validation des bodies non homogène (dette de cohérence, sans impact utilisateur mesuré). 14 fichiers de app/api déclarent leur propre `z.object` au lieu de lib/validation/schemas.ts — dans le périmètre : app/api/projects/[projectId]/epics/reorder/route.ts:19-33 et app/api/projects/[projectId]/epics/[epicId]/dependencies/route.ts:18-20 (tous deux passent tout de même par validateBody). Deux routes valident encore à la main après `request.json().catch(() => ({}))` : app/api/projects/[projectId]/dependencies/route.ts:35-62 (`edges`) et app/api/projects/[projectId]/epics/[epicId]/comments/route.ts:32-39 (`body.content` / `body.author`). Le doublon est d'autant plus net que lib/validation/schemas.ts:95-98 définit déjà `dependencyInput = z.object({ ticketId, dependsOnTicketId })`, non exporté et utilisé seulement en schemas.ts:125. Contrairement à ce qu'affirme le finding d'origine, ces réponses `{ error }` nues ne cassent rien côté client : lib/validation/error-message.ts:41-54 retombe sur `error` quand `details` manque, et le seul consommateur d'apiErrorMessage (components/kanban/BugCreateDialog.tsx) n'appelle aucune de ces deux routes. lib/validation/validate.ts:66-85 (validateOptionalBody) recopie bien lib/validation/validate.ts:9-28 (validateBody) — pas « 69-86 vs 10-30 ». Enfin components/kanban/RefinementButton.tsx:9 importe `type RefinementStatus` depuis app/api/projects/[projectId]/refinement/route.ts:21-26 : c'est l'unique import `@/app/api` de tout components/hooks/lib du dépôt, et ce type appartient à lib/refinement. NB : tous les numéros de ligne du finding initial sauf ceux de dependencies/route.ts et refinement/route.ts pointaient au-delà de la fin des fichiers (65, 92, 82 et 86 lignes respectivement).

**Recommandation**

Déplacer les schémas inline vivants dans lib/validation/schemas.ts, passer comments/dependencies par validateBody, factoriser validateOptionalBody sur un `parseAndValidate(raw, schema)` commun, et déclarer RefinementStatus dans lib/refinement/dispatch.ts (ou constants.ts) pour couper l'import components → app/api.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -l 'z\.object\(' app/api | wc -l` → 14. comments/route.ts:205 `const body = await request.json().catch(() => ({}))` puis `if (!body.content || !body.author)`. RefinementButton.tsx:9 `import type { RefinementStatus } from "@/app/api/projects/[projectId]/refinement/route"`.

</details>

### #110 — Tables de libellés de sessions dupliquées entre la liste et la vue live, avec copies divergentes et un type manquant

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/projects/[projectId]/sessions/page.tsx:96-146`
- `components/session-live/labels.ts:22-75`
- `components/session-live/SessionHeaderBar.tsx:206-217`
- `components/shared/SessionOutcomeBadge.tsx:20-41`
- `lib/i18n/messages/en/ProjectSessions.json`
- `lib/i18n/messages/en/SessionLive.json`

**Constat**

`AGENT_TYPE_LABEL_KEYS` existe deux fois : sessions/page.tsx:96-113 (namespace `ProjectSessions.agentType.*`, 16 entrées dont `release_notes`) et session-live/labels.ts:22-38 (namespace `SessionLive.agentType.*`, 15 entrées, SANS `release_notes`). Les copies divergent pour le même type (« Ticket » vs « Ticket Build », « Security » vs « Security Review », « Compliance » vs « Compliance Review »). Une session `release_notes` s'affiche « Release Notes » dans la liste mais `release_notes` brut dans l'en-tête live (`deriveTypeLabel` retombe sur `session.agentType`, SessionHeaderBar.tsx:213-216). Même schéma pour les statuts (`STATUS_CONFIG` page.tsx:115-146 vs `STAMP_BY_STATUS` labels.ts:65-75, deux namespaces) et `OUTCOME_LABEL_KEYS` (labels.ts:45-51) qui recopie mot pour mot la table de `components/shared/SessionOutcomeBadge.tsx:22-40`.

**Précision du vérificateur**

`AGENT_TYPE_LABEL_KEYS` est défini deux fois avec des libellés divergents : `app/projects/[projectId]/sessions/page.tsx:96-113` (16 entrées, namespace `ProjectSessions.agentType.*`) et `components/session-live/labels.ts:22-38` (15 entrées, namespace `SessionLive.agentType.*`, sans `release_notes`). Quatre types portent deux textes selon l'écran : ticket_build « Ticket » vs « Ticket Build », team_build « Team » vs « Team Build », review_security « Security » vs « Security Review », review_compliance « Compliance » vs « Compliance Review ». Conséquence fonctionnelle vérifiée : une session `release_notes` (créée par app/api/projects/[projectId]/releases/route.ts:260) s'affiche « Release Notes » dans la liste mais `release_notes` brut dans l'en-tête live, car `deriveTypeLabel` (SessionHeaderBar.tsx:216-224) retombe sur `session.agentType` et la page live imprime ce fallback (sessions/[sessionId]/page.tsx:236-238). CORRECTIONS au finding : (a) `OUTCOME_LABEL_KEYS` (labels.ts:45-51) ne duplique PAS de copie — `components/shared/SessionOutcomeBadge.tsx:18-44` référence les mêmes clés `SessionLive.outcome.*` ; seul le Record est dupliqué, sans risque de divergence de texte ; (b) l'écart de statuts (`STATUS_CONFIG` Running/Completed vs `STAMP_BY_STATUS` LIVE/DONE) est un choix de design documenté en tête de labels.ts, pas une divergence accidentelle. Le défaut réel se réduit donc à la table agentType : un libellé cassé (`release_notes`) et quatre libellés incohérents entre deux écrans.

**Recommandation**

Une seule table de KEY REFERENCES (par ex. `lib/agent-sessions/labels.ts`) et un seul namespace pour agentType/status/outcome ; ajouter `release_notes` ; faire importer `OUTCOME_LABEL_KEYS` par le badge ou l'inverse.

<details><summary>Preuve relevée par l'auditeur</summary>

node : `ProjectSessions.agentType` = {…,"releaseNotes":"Release Notes",…} ; `SessionLive.agentType` sans clé releaseNotes ; `ticketBuild` = "Ticket" vs "Ticket Build". `rg -n release_notes components/session-live` → 0 hit.

</details>

### #111 — Helpers ré-implémentés localement : parsing de timestamps SQLite, elapsed compact, formatTokens, index de couleur projet (4 dérivations pour la même identité)

**Nature** doublon · **Impact** faible (vérificateur : plutôt plus) · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `components/session-live/log-lines.ts:78-86`
- `lib/agent-sessions/last-activity.ts:9-17`
- `components/session-live/SessionHeaderBar.tsx:184-195`
- `components/piscine/Chrono.tsx:30-34`
- `components/spec/spec-format.ts:47-59`
- `lib/utils/format-usage.ts:25-31`
- `components/releases/derive.ts:184-197`
- `components/ticket/derive.ts:60-72`
- `lib/control-desk/aggregate.ts:99-106`
- `components/session-live/SessionHeaderBar.tsx:116-131`

**Constat**

(a) `toEpochMs` (session-live/log-lines.ts:78-86) réécrit `parseStoredTimestamp` (lib/agent-sessions/last-activity.ts:9-17) avec la même regex et le même commentaire sur V8. (b) `compactElapsed` (SessionHeaderBar.tsx:191-195) est la copie de `compact` privé de Chrono.tsx:30-34 — le commentaire le dit lui-même. (c) `formatTokens` de components/spec/spec-format.ts:53-59 et celui de lib/utils/format-usage.ts:25-31 diffèrent (« 10k » vs « 10.0k », em-dash vs null, pas de « M ») ; les deux sont utilisés sur la même page spec (PromptBarRow) et sur la session live (SessionInfoCard). (d) Couleur d'identité projet : control-desk `colorIndex: index` (position dans la liste, aggregate.ts:103), `projectToneIndex` FNV dans components/ticket/derive.ts:65-72, `projectToneIndex` `hash*31` dans components/releases/derive.ts:191-197, et `tone={1}` en dur dans SessionHeaderBar.tsx:122/131. Un même projet reçoit donc jusqu'à quatre teintes selon la surface, contraire à « colour is project identity ».

**Précision du vérificateur**

Helpers ré-implémentés localement. (a) TROIS parseurs de timestamp SQLite : `toEpochMs` (components/session-live/log-lines.ts:77-84), `parseStoredTimestamp` (lib/agent-sessions/last-activity.ts:1-18, 41 usages) et `parseTimestamp` (lib/i18n/format.ts:53-71) — ce dernier avec un contrat DIFFÉRENT (regex à espace seulement, secondes optionnelles : la forme « T sans Z » lui échappe et repart en heure locale), et c'est lui qu'appellent formatRelative/formatDateTime. (b) `compactElapsed` (SessionHeaderBar.tsx:184-195) copie le `compact` privé de Chrono.tsx:31-35, le commentaire l'admet. (c) TROIS `formatTokens` divergents : components/spec/spec-format.ts:52 (« 10k », em-dash, pas de M), lib/utils/format-usage.ts:25 (« 10.0k », null, suffixe M), components/chat-page/chat-context-tokens.ts:46 (toujours une décimale, « — » sur ≤ 0). Correction : ils ne cohabitent pas sur la page spec — spec-format sert PromptBarRow, format-usage sert SessionInfoCard et PromptTokenEstimateView (monté par AgentDispatchDialog), chat-context-tokens sert ContextRail. (d) CINQ dérivations de l'identité couleur projet : `colorIndex: index` positionnel (lib/control-desk/aggregate.ts:103, consommé par qa/, desk/, tickets-registry, chat-page, TopBar), FNV (components/ticket/derive.ts:65 → useTicketOverlayData.ts:310), hash*31 (components/releases/derive.ts:191 → releases/page.tsx:247), djb2 (components/usage/formatters.ts:92-103 `resolveProjectTone`), et `tone={1}` en dur (SessionHeaderBar.tsx:122/131). Un même projet reçoit jusqu'à cinq teintes selon la surface ; usage/formatters.ts documente même que la position est un mauvais choix, ce que fait pourtant le control desk.

**Recommandation**

Importer `parseStoredTimestamp` ; exporter `compact` depuis Chrono ; garder un seul `formatTokens` ; centraliser `projectToneIndex` (une seule fonction, alimentée par un `colorIndex` stable quand il existera) et l'utiliser aussi dans SessionHeaderBar.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "function projectToneIndex"` → components/ticket/derive.ts:65 et components/releases/derive.ts:191 (algorithmes différents) ; `rg -n "projectTone\(" components app hooks` → releases/page.tsx:247 (hash), useTicketOverlayData.ts:307 (FNV), qa/* (`project.colorIndex` = index desk) ; `rg -n "export function formatTokens"` → 2 définitions.

</details>

### #139 — Sept routes réimplémentent getProjectOr404/getEpicOr404/getStoryOr404 en ligne alors que lib/api/route-helpers.ts est la convention (58 fichiers l'utilisent)

**Nature** doublon · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `lib/api/route-helpers.ts:41`
- `app/api/projects/[projectId]/agent-config/prompts/[agentType]/route.ts:26`
- `app/api/projects/[projectId]/agent-config/providers/[agentType]/route.ts:29`
- `app/api/projects/[projectId]/agent-config/review-agents/route.ts:25`
- `app/api/projects/[projectId]/build/route.ts:198`
- `app/api/projects/[projectId]/generate-spec/route.ts:41`
- `app/api/projects/[projectId]/epics/[epicId]/review-comments/route.ts:14`
- `app/api/projects/[projectId]/stories/[storyId]/route.ts:108`

**Constat**

lib/api/route-helpers.ts:41-68 fournit getProjectOr404 (58 fichiers consommateurs), getEpicOr404 (21) et getStoryOr404 (8). Pourtant `rg '"Project not found"' app` trouve 11 sites inline dans 7 routes qui n'importent pas le helper : agent-config/prompts/route.ts:18, agent-config/prompts/[agentType]/route.ts:26 et :86, agent-config/providers/route.ts:17, agent-config/providers/[agentType]/route.ts:29 et :116, agent-config/review-agents/route.ts:25 et :36, generate-spec/route.ts:41, build/route.ts:198. Idem pour epics/[epicId]/review-comments/route.ts:14 et :40 et epics/[epicId]/route.ts:99 (« Epic not found ») et stories/[storyId]/route.ts:108 (« Story not found »). Le helper porte aussi le scoping projet (epic d'un autre projet → 404) que les versions inline ne garantissent pas forcément.

**Précision du vérificateur**

lib/api/route-helpers.ts (getProjectOr404 :45, getEpicOr404 :81 avec scoping projet, getStoryOr404) est la convention (58 fichiers l'importent), mais 8 routes la contournent avec 12 lookups inline : 10 sites « Project not found » dans 7 routes qui n'importent pas le helper — agent-config/prompts/route.ts:18, agent-config/prompts/[agentType]/route.ts:26 et :86, agent-config/providers/route.ts:17, agent-config/providers/[agentType]/route.ts:29 et :116, agent-config/review-agents/route.ts:25 et :36, generate-spec/route.ts:41, build/route.ts:198 (ce dernier redouble aussi le cas requireGitRepo, avec un libellé divergent « no git repository configured » vs « no git repository path configured ») — plus 2 sites dans epics/[epicId]/review-comments/route.ts:14 et :40, où le lookup inline `eq(epics.id, epicId)` omet le scoping projet du helper : un epicId d'un autre projet résout au lieu de 404. En revanche epics/[epicId]/route.ts:99 et stories/[storyId]/route.ts:108 ne sont PAS des duplicatas : ces fichiers importent déjà getEpicOr404/getStoryOr404, et ces lignes ne font que mapper le ScopedDeleteNotFoundError levé par lib/planning/permanent-delete.ts, dont le lookup scopé est atomique avec la suppression. Enfin le 11e hit de `rg '"Project not found"' app` est app/api/mcp/create-planning-ticket/route.ts:103, hors périmètre (payload MCP avec `code`) — un éventuel test de convention doit l'exclure.

**Recommandation**

Remplacer les 15 sites par les helpers (`const found = getProjectOr404(projectId); if (isErrorResponse(found)) return found;`), et ajouter un test de convention (grep interdit sur '"Project not found"' hors route-helpers) pour que ça ne repousse pas.

<details><summary>Preuve relevée par l'auditeur</summary>

for f in $(rg -l '"Project not found"' app); do rg -c route-helpers $f; done → 0 pour les 7 routes agent-config/generate-spec/build ; rg -l getProjectOr404 app lib → 58 fichiers ; rg -n '"Epic not found"|"Story not found"' app → 4 sites hors helper.

</details>


## Annexe — relevé des utilitaires dupliqués (49 entrées)

- `/home/orosius/workspace/arij/components/releases/derive.ts` · `projectToneIndex` — DOUBLON À CONSÉQUENCE VISIBLE. Quatre implémentations concurrentes du même concept « teinte d'identité d'un projet », toutes actives (aucune colonne colorIndex dans lib/db/schema.ts — grep sur `colorIndex|color_index` dans schema.ts : 0 résultat, donc le chemin de repli est le seul chemin) : (1) components/releases/derive.ts:191 `hash = hash*31 + charCodeAt` puis Math.abs, consommé par app/projects/[projectId]/releases/page.tsx:250 ; (2) components/ticket/derive.ts:65 qui délègue à hashString (FNV-1a, derive.ts:50), consommé par hooks/useTicketOverlayData.ts:307 ; (3) components/usage/formatters.ts:91 `resolveProjectTone` en djb2 (hash=5381) ; (4) lib/control-desk/aggregate.ts:102 `colorIndex: index` = position dans l'ordre de création, servie au desk et au registre (lib/tickets-registry/types.ts:134 documente ce choix), ce que le commentaire de components/usage/formatters.ts:87 déconseille explicitement. Vérifié par calcul : pour l'id "proj_AbCdEf123", FNV-1a → 2317065412, hash×31 → 1680884691 — indices différents, donc teinte différente pour le même projet entre l'overlay ticket et la page Releases. Non interchangeables en l'état ; une seule source (l'index du desk, ou un hash unique) est nécessaire.
- `/home/orosius/workspace/arij/lib/telescope/collect.ts` · `parseTimestamp` — QUASI-DOUBLON DIVERGENT. collect.ts:241 `function parseTimestamp(value) { const parsed = Date.parse(value); … }` — Date.parse brut. Appliqué à des colonnes SQLite : lignes 450 (`sessionTerminalAt(row)` = endedAt/completedAt/startedAt/createdAt), 585 et 673 (`row.createdAt`) via isWithinWindow, et 814/850 pour le tri. Or lib/agent-sessions/last-activity.ts:10 `parseStoredTimestamp` existe précisément pour normaliser la forme SQLite zoneless `2026-08-30 06:00:00` en UTC avant Date.parse, et est importé par 15 modules (lib/verify/freshness.ts, lib/pipeline/findings.ts, lib/auto-mode/{second-opinion,select}.ts, lib/kanban/*, lib/control-desk/aggregate.ts, app/api/inbox/route.ts…). Troisième copie du même contrat dans lib/i18n/format.ts:62 `parseTimestamp` (normalisation SQLITE_TIMESTAMP identique, retourne NaN au lieu de null). Sur une valeur zoneless, telescope lit l'instant en heure locale : décalage d'une fenêtre entière hors UTC. Pas interchangeables : le lib/telescope est le seul des trois à ne pas normaliser.
- `/home/orosius/workspace/arij/components/chat-page/chat-context-tokens.ts` · `formatTokens` — TRIPLON DIVERGENT. Trois formateurs du même compteur de tokens : lib/utils/format-usage.ts:25 (830 → "830", 12480 → "12.5k", 3.4e6 → "3.4M", absent → null) ; components/spec/spec-format.ts:52 (830 → "830", 10000 → "10k" — supprime le ".0", pas de palier M, absent → EM_DASH) ; components/chat-page/chat-context-tokens.ts:46 (830 → "0.8k", pas de palier M, absent ou ≤0 → "—" littéral non traduit). Sorties différentes pour la même entrée, placeholders différents, et le troisième code en dur l'em-dash au lieu de laisser le choix à l'appelant comme le documente format-usage.ts. Non interchangeables sans décider d'un format unique.
- `/home/orosius/workspace/arij/lib/claude/json-parser.ts` · `isRecord` — SIX COPIES OCTET POUR OCTET : `return typeof value === "object" && value !== null && !Array.isArray(value);` — lib/claude/json-parser.ts:358, lib/usage/codex-rate-limits.ts:39, lib/usage/codex-appserver.ts:74, lib/usage/claude-quota.ts:64, lib/providers/pi.ts:87, lib/chat/persistent-runner.ts:657. Strictement interchangeables. Septième variante sous un autre nom : lib/epic-parsing.ts:93 `toRecord` (même prédicat, retourne le record ou null au lieu d'un type guard) ; à ne pas confondre avec lib/agent-config/named-agents.ts:84 `toRecord`, homonyme sans rapport (mappe une ligne namedAgents vers un DTO).
- `/home/orosius/workspace/arij/lib/usage/claude-quota.ts` · `finiteOrNull / strOrNull` — COPIES OCTET POUR OCTET dans le trio usage. `finiteOrNull` (`typeof value === "number" && Number.isFinite(value) ? value : null`) en 3 exemplaires : lib/usage/codex-rate-limits.ts:44, lib/usage/codex-appserver.ts:78, lib/usage/claude-quota.ts:68. `strOrNull` (`typeof value === "string" ? value : null`) en 2 exemplaires : lib/usage/codex-appserver.ts:82, lib/usage/claude-quota.ts:72. Confirmé par jscpd (clone #32 : claude-quota.ts:60-76 ↔ codex-appserver.ts:70-91, 17 lignes / 162 tokens) — c'est le bloc isRecord+finiteOrNull+strOrNull qui est copié en entier. Interchangeables ; les trois fichiers partagent déjà le répertoire lib/usage/.
- `/home/orosius/workspace/arij/lib/git/manager.ts` · `getGit` — TROIS COPIES IDENTIQUES : `function getGit(repoPath: string): SimpleGit { return simpleGit(repoPath); }` — lib/git/manager.ts:14, lib/git/clone.ts:1057, lib/git/remote.ts:241. Interchangeables. À noter : lib/git/clone.ts construit par ailleurs un env dédié (fonction qui se termine ligne 1055) que ce getGit n'utilise pas, donc la copie de clone.ts est bien le même wrapper nu que les deux autres. lib/git/manager.ts:6 porte aussi `slugify`, seule définition du dépôt (pas de doublon).
- `/home/orosius/workspace/arij/lib/agent-sessions/chunk-cap.ts` · `escapeRegExp` — TROIS COPIES IDENTIQUES : `value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")` — lib/agent-sessions/prompt-cap.ts:85, lib/agent-sessions/chunk-cap.ts:68, lib/agent-sessions/chunk-retention.ts:36. Les trois fichiers sont voisins dans le même répertoire et suivent le même motif (un marqueur d'élision + la source de regex qui le reconnaît) ; les trois marqueurs diffèrent, l'échappement non. Interchangeables.
- `/home/orosius/workspace/arij/lib/auto-mode/constants.ts` · `coerceNumber` — TROIS COPIES IDENTIQUES du même parseur tolérant (essaie JSON.parse sur une chaîne, retombe sur Number(), renvoie null si non fini) : lib/auto-mode/constants.ts:150, lib/night/constants.ts:81, lib/chat/persistent-chat-constants.ts:21. Le commentaire de lib/auto-mode/constants.ts:148 reconnaît lui-même la copie (« same coerceNumber body as lib/night/constants.ts »). Confirmé par jscpd (clone #18 : constants.ts:150-172 ↔ night/constants.ts:81-103, 23 lignes / 167 tokens). Interchangeables.
- `/home/orosius/workspace/arij/lib/pipeline/index.ts` · `readSettingValue` — TROIS COPIES de la même lecture `SELECT value FROM settings WHERE key = ?` : lib/pipeline/index.ts:76 et lib/night/run.ts:98 sont identiques octet pour octet ; lib/workflow/dreaming.ts:763 est la même requête enveloppée d'un try/catch qui renvoie null. Interchangeables si l'on retient la variante défensive.
- `/home/orosius/workspace/arij/lib/agent-config/agent-resolution.ts` · `normalizeProvider` — CINQ DÉFINITIONS, DEUX SÉMANTIQUES. Identiques octet pour octet : lib/agent-config/agent-resolution.ts:86 et lib/agent-config/composite-agents.ts:42 (`value && isAgentProvider(value) ? value : FALLBACK_PROVIDER`). Variante « null » : lib/agent-config/named-agents.ts:126 (prend un string non nullable), app/api/projects/[projectId]/sessions/resumable/route.ts:19 (isAgentProvider → null), app/api/projects/[projectId]/chat/stream/route.ts:83 (isChatProvider → null). Les deux premières sont interchangeables et vivent dans le même répertoire ; les trois autres NE le sont pas (repli vs null, et deux prédicats de provider différents) — les commentaires des deux routes documentent d'ailleurs pourquoi le null est délibéré.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/agent-config/providers/[agentType]/route.ts` · `validateProject` — DEUX COPIES IDENTIQUES (`db.select({id: projects.id}).from(projects).where(eq(projects.id, projectId)).get()`) : cette route ligne 13 et app/api/projects/[projectId]/agent-config/prompts/[agentType]/route.ts:10 — les 25 premières lignes des deux fichiers sont un clone (jscpd #15, 291 tokens). Redondant en plus avec lib/api/route-helpers.ts:46 `getProjectOr404`, qui fait la même lecture et rend directement la 404 ; ces deux routes réimplémentent la réponse 404 à la main. Interchangeables.
- `/home/orosius/workspace/arij/lib/auto-mode/config.ts` · `resolveAutoModeConfigForProject` — PLUS GROS CLONE TS DU DÉPÔT (jscpd #6 : lib/auto-mode/config.ts:86-148 ↔ lib/auto-mode/constants.ts:262-311, 63 lignes). Jumeau ASSUMÉ et documenté (constants.ts:243 : « Le jumeau côté serveur … vit dans lib/auto-mode/config.ts ») : `resolveAutoModeConfig` lit une map JSON côté client, `resolveAutoModeConfigForProject` lit la base côté serveur. Les deux helpers `pick` sont sémantiquement équivalents (clé absente → parse(undefined) → null → on descend la chaîne), mais les 7 blocs d'options (enabled, buildAgent, buildConcurrency, reviewAgent, reviewConcurrency, smartDispatch, secondOpinion) sont littéralement identiques sur ~45 lignes : ajouter un 8e réglage demande deux éditions synchrones. Factorisable en une table de descripteurs partagée sans toucher aux deux sources de lecture.
- `/home/orosius/workspace/arij/components/night/NightRunDialog.tsx` · `OptionRow` — CLONE VERBATIM DE COMPOSANT (jscpd #7 : components/auto-mode/AutoModeDialog.tsx:42-91 ↔ components/night/NightRunDialog.tsx:88-134, 50 lignes / 243 tokens). Même signature ({label, htmlFor, hint, last, children}) et même JSX au caractère près, y compris les valeurs en dur `py-[11px]`, `text-[12.5px]`, `text-[11.5px]`, `text-[13px]`. Le commentaire d'AutoModeDialog.tsx:38 revendique la copie (« la grammaire NightRunDialog, réutilisée verbatim »). Strictement interchangeables : candidat direct à components/piscine/ (le barrel est la surface d'import prescrite par CLAUDE.md).
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/stories/[storyId]/review/route.ts` · `POST (route review story)` — ROUTE JUMELLE. 384 lignes contre 425 pour app/api/projects/[projectId]/epics/[epicId]/review/route.ts, dont jscpd relève 5 blocs clonés : [24-47]↔[26-49] (imports, 2 lignes de différence), [82-99]↔[72-93], [135-155]↔[133-153] (1 ligne de différence), [258-276]↔[251-269] (1 ligne de commentaire de différence), [403-425]↔[362-384] IDENTIQUE OCTET POUR OCTET sur 23 lignes (fin de boucle de lancement + `NextResponse.json({data:{sessions, count, resolutions}})`). Les deux routes ne diffèrent en substance que par getEpicOr404/getStoryOr404 et le scope "epic"/"story". Non factorisées.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/stories/[storyId]/comments/route.ts` · `POST (route comments story)` — ROUTE JUMELLE INTÉGRALE. 82 lignes des deux côtés (l'autre : app/api/projects/[projectId]/epics/[epicId]/comments/route.ts). Diff des blocs POST [31-58] et [67-82] : seules différences `storyId`/`epicId` dans les params, `getStoryOr404` vs `getEpicOr404`, et `userStoryId: storyId` vs `epicId` à l'insert. Tout le reste — validation author/content, la garde `body.author !== "agent"` avec son commentaire de 3 lignes recopié mot pour mot, le catch MentionResolutionError, le createId/now, le re-SELECT et le 201 — est identique. Interchangeable derrière un helper prenant la colonne cible.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/stories/[storyId]/build/route.ts` · `POST (route build story)` — ROUTE JUMELLE. jscpd #12 : [311-339] ↔ app/api/projects/[projectId]/epics/[epicId]/build/route.ts:[453-480], 28 lignes / 236 tokens, différences réduites à `scope: "story"` vs `"epic"`, un retour à la ligne de prettier et la forme de la ternaire `pipelineActive`. La route epic embarque en plus un clone avec lib/pipeline/stage-session.ts (jscpd #14 : build/route.ts:[344-368] ↔ stage-session.ts:[164-188], 25 lignes) — donc la même séquence de clôture de session existe en trois exemplaires.
- `/home/orosius/workspace/arij/app/api/tickets/route.ts` · `activeRows / mergeFailureRows / emptyPayload` — TROIS CLONES AVEC app/api/control-desk/route.ts (697 vs 614 lignes). (a) jscpd #10, 31 lignes : le SELECT `latestMergeFailures` (tickets:430-460) ↔ `mergeFailureRows` (control-desk:414-444) — les deux MAX(CASE WHEN … LIKE … ESCAPE) sur ticketActivityLog sont identiques, seuls le nom de la variable et `.as()` vs `.all()` diffèrent. (b) jscpd #37/#38, 15+15 lignes : la projection `activeRows` sur agentSessions (tickets:478-506 ↔ control-desk:158-187) — mêmes 18 colonnes, même substr(lastNonEmptyText) ; la seule vraie divergence est que la version registre ne sélectionne pas endedAt/completedAt et ajoute le filtre `scopedProjectIds`. (c) `emptyPayload(now: Date)` défini deux fois, tickets/route.ts:169 et app/api/qa/findings/route.ts:129 — même forme (generatedAt + collections vides), types de charge utile différents, donc quasi-doublon non interchangeable tel quel. La rationalisation en cours annonce des lectures serveur partagées entre desk et registre ; ces trois blocs-là ne le sont pas.
- `/home/orosius/workspace/arij/lib/qa/aggregate.ts` · `deriveQueued` — QUASI-DOUBLON. lib/qa/aggregate.ts:187 et lib/control-desk/aggregate.ts:249 : même filtre `status === "queued"`, même projection {sessionId, projectId, epicId, readableId, title}. Seule différence : le titre — `sessionTitle(row, inferTaskType(row))` côté desk, `row.epicTitle ?? "Review"` côté QA (littéral non traduit, au passage). Le tri juste au-dessus (`compareStoredTimestamps(a.startedAt,b.startedAt) || a.sessionId.localeCompare(...)`) est également recopié dans les deux fichiers. Factorisable en passant le calcul du titre en paramètre.
- `/home/orosius/workspace/arij/lib/workflow/story-transition.ts` · `applyStoryTransition` — HOMONYME À DEUX SÉMANTIQUES — toujours ouvert (déjà relevé le 06/09, vérifié encore présent dans l'arbre). lib/workflow/transition-service.ts:247 `applyStoryTransition(opts: ApplyStoryTransitionOpts)` passe par la machine à états et journalise l'activité sur l'epic parent ; lib/workflow/story-transition.ts:50 `applyStoryTransition({storyId, epicId, toStatus, database})` fait sa propre lecture/écriture et promeut l'epic quand SETTLED_STORY_STATUSES est atteint, en renvoyant `{valid:false, error}`. Non interchangeables ; deux chemins d'écriture concurrents sur le même statut de story.
- `/home/orosius/workspace/arij/components/shared/AgentActionsBar.tsx` · `providerLabel` — TROIS DÉFINITIONS, DEUX PRÉDICATS. components/usage/formatters.ts:15 et components/shared/AgentSelectPill.tsx:183 sont le même corps `(PROVIDER_LABELS as Record<string,string>)[provider] ?? provider` (AgentSelectPill ajoute seulement un court-circuit sur null). components/shared/AgentActionsBar.tsx:36 diverge : `isChatProvider(provider) ? PROVIDER_LABELS[provider] : provider` — un provider connu d'isAgentProvider mais pas d'isChatProvider s'affiche brut ici et traduit ailleurs. Les deux premières sont interchangeables ; la troisième non.
- `/home/orosius/workspace/arij/components/shared/SessionPicker.tsx` · `truncate` — QUASI-DOUBLON. components/shared/SessionPicker.tsx:37 `slice(0, maxLen - 1) + "…"` (longueur finale = maxLen) contre lib/openai/client.ts:181 `slice(0, max) + "…"` avec `max = 300` par défaut (longueur finale = max + 1). Même intention, off-by-one différent ; lib/control-desk/aggregate.ts:327 `excerpt` (exporté) et lib/agent-sessions/arij-actions.ts:86 `excerpt` font une troisième et quatrième variante du même geste (collapse des blancs + coupe + ellipse), là encore avec un `limit - 1` d'un côté et `limit` de l'autre. Quatre coupeurs de chaîne, aucun partagé.
- `/home/orosius/workspace/arij/lib/pipeline/constants.ts` · `clamp` — DEUX COPIES ÉQUIVALENTES : lib/pipeline/constants.ts:134 `Math.min(max, Math.max(min, value))` et hooks/usePanelLayout.ts:18 `Math.min(Math.max(value, min), max)` — résultat identique pour min ≤ max. Interchangeables. Aucun helper `clamp` partagé n'existe dans lib/utils/.
- `/home/orosius/workspace/arij/components/settings-piscine/AppearanceBand.tsx` · `subscribe / clientSnapshot / serverSnapshot` — TRIPLET IDENTIQUE DUPLIQUÉ : `const subscribe = () => () => {}; const clientSnapshot = () => true; const serverSnapshot = () => false;` en components/settings-piscine/AppearanceBand.tsx:24-26 et components/notifications/ToastStack.tsx:39-41, tous deux uniquement pour un `useSyncExternalStore(...)` servant de détecteur `mounted`. Strictement interchangeables : un `useMounted()` dans hooks/ suffirait.
- `/home/orosius/workspace/arij/lib/mcp/token-store.ts` · `getStore` — QUASI-DOUBLON DE MOTIF (pas de corps identique) : lib/mcp/token-store.ts:63 et lib/usage/quota-cache.ts:53 implémentent tous deux le singleton `Symbol.for("arij.…")` sur globalThis résistant au hot reload, l'un avec `??=` sur une Map, l'autre avec un `if (!store[KEY])` sur un objet de deux entrées. Homonymes non interchangeables tels quels, mais un helper `globalSingleton(key, factory)` couvrirait les deux.
- `/home/orosius/workspace/arij/lib/routines/actions.ts` · `optionalBoolean` — HOMONYMES NON INTERCHANGEABLES, dans le même répertoire. lib/routines/crud.ts:117 `optionalBoolean(config, key): void` — valide et lève RoutineInputError. lib/routines/actions.ts:117 `optionalBoolean(config, key, fallback): boolean` — lit, applique un défaut et lève un Error nu. Même nom, même premier argument, arité et retour différents : piège de lecture. (Le module lib/routines/actions.ts reste par ailleurs celui qui importe des routes app/api, point déjà ticketé le 06/09.)
- `/home/orosius/workspace/arij/lib/agent-sessions/latest-failure.ts` · `timestamp` — TROIS WRAPPERS HOMONYMES autour de parseStoredTimestamp, avec trois contrats de valeur absente : lib/agent-sessions/latest-failure.ts:19 → `-Infinity` ; lib/kanban/merge-readiness.ts:111 → `null` ; lib/auto-mode/second-opinion.ts:68 → `null` (corps identique à merge-readiness). Les deux derniers sont interchangeables, le premier non — et le nom `timestamp` ne dit rien de la différence.
- `/home/orosius/workspace/arij/app/api/mcp/report-friction/route.ts` · `parseBody` — HOMONYMES QUASI-ÉQUIVALENTS : lib/mcp/server-routes.ts:88 `parseBody(request): Promise<unknown | NextResponse>` (400 « Invalid JSON body ») et app/api/mcp/report-friction/route.ts:30 (400 avec `code: "INVALID_PAYLOAD"` et un message spécifique). Même geste, même forme de retour union. Redondants en plus avec lib/validation/validate.ts:5 `validateBody(schema, request)`, qui fait déjà try/json/400 + safeParse — et dont lib/validation/validate.ts:69-86 est un clone interne de ses propres lignes 10-30 (jscpd #29, 18 lignes) pour la variante qui reçoit du texte brut.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/epics/route.ts` · `trimmedOrNull` — DEUX COPIES ÉQUIVALENTES : app/api/projects/[projectId]/epics/route.ts:59 (tolère null/undefined) et lib/epics/manual-epic-form.ts:172 (n'accepte qu'un string). Même règle métier — chaîne vide ⇒ NULL en base — écrite deux fois, dont une dans la route qui consomme le formulaire de l'autre. Interchangeables en retenant la signature large.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/sessions/route.ts` · `parseLimit` — QUASI-DOUBLON DIVERGENT : app/api/projects/[projectId]/sessions/route.ts:152 renvoie `SESSION_LIST_DEFAULT_PAGE_SIZE` quand `?limit=` est absent/invalide, app/api/projects/[projectId]/sessions/[sessionId]/route.ts:155 renvoie `undefined` dans le même cas ; bornes maximales différentes (SESSION_LIST_MAX_PAGE_SIZE vs SESSION_CHUNK_PAGE_MAX_LIMIT). Même corps `Number.parseInt` + `Math.min(Math.max(parsed,1), MAX)`. Factorisable en `parseLimit(raw, {fallback, max})` ; en l'état, non interchangeables.
- `/home/orosius/workspace/arij/components/settings-piscine/settings-fields.ts` · `GITHUB_PAT_SETTING_KEY / MEMORY_AUTO_DISTILL_SETTING_KEY / SPEC_AUTO_REWRITE_SETTING_KEY / MCP_TOOLS_ENABLED_SETTING_KEY` — QUATRE CLÉS DE RÉGLAGE DÉFINIES DEUX FOIS, littéral identique des deux côtés : settings-fields.ts:107/111/112/113 contre lib/github/client.ts:6 (`github_pat`), lib/documents/memory-constants.ts:111 (`memory_auto_distill`), lib/workflow/spec-rewrite-constants.ts:15 (`spec_auto_rewrite`), lib/claude/mcp-injection.ts:51 (`mcp_tools_enabled`). Le commentaire de settings-fields.ts:101-106 justifie la copie pour github_pat (le module serveur importe better-sqlite3 et polluerait le bundle client) — mais le même commentaire dit « Clés … qui n'ont pas de constante » juste avant les trois autres, ce qui est faux depuis : les trois constantes existent bien côté lib. Divergence silencieuse possible : rien ne casse si un des deux côtés change. Un module de clés sans dépendance base (comme lib/workflow/spec-rewrite-constants.ts l'est déjà) réglerait les quatre.
- `/home/orosius/workspace/arij/hooks/useGitHubDeviceFlow.ts` · `readString` — DEUX COPIES IDENTIQUES du lecteur de champ non fiable (`typeof value === "string" ? value.trim() : ""`) : hooks/useGitHubDeviceFlow.ts:107 et lib/github/device-flow.ts:164, avec chacun son `readInterval`/lecteur numérique jumeau juste en dessous. Les deux parsent la même réponse GitHub device-flow, l'une côté client l'autre côté serveur. Interchangeables si extraits dans un module sans dépendance base.
- `/home/orosius/workspace/arij/lib/agents/dag-batch-registry.ts` · `emptyCounts` — DEUX COPIES IDENTIQUES : `{ pending: 0, running: 0, done: 0, asked: 0, failed: 0, skipped: 0 }` — lib/agents/dag-batch-registry.ts:33 (typé DagBatchCounts) et lib/night/summary.ts:86 (typé Record<TicketExecutionStatus, number>). Même jeu de six clés, deux types nominaux distincts. Interchangeables une fois les types unifiés.
- `/home/orosius/workspace/arij/lib/pipeline/registry.ts` · `cloneSnapshot` — HOMONYMES DE MÊME RÔLE, corps différents : lib/pipeline/registry.ts:26 (`{...run, sessionIds:[...]}`) et lib/night/registry.ts:57 (`{...run, counts:{...}, epics: map(...)}`). Les deux registres in-memory partagent l'architecture (snapshot + patch + clone défensif) sans partager de code ; non interchangeables tels quels, mais c'est le même patron dupliqué à deux endroits.
- `/home/orosius/workspace/arij/lib/verify/runner.ts` · `errorMessage` — HOMONYMES DIVERGENTS : lib/verify/runner.ts:115 `error instanceof Error ? error.message : String(error)` ; lib/routines/scheduler.ts:173 `… : "Routine execution failed"`. Le second perd l'information sur un throw non-Error. Non interchangeables sans décider du repli ; le motif `error instanceof Error ? error.message : …` est par ailleurs recopié partout dans app/api (visible dans le clone jscpd #12 des routes build).
- `/home/orosius/workspace/arij/components/agents-workshop/agent-initials.ts` · `sourceLabelKey` — HOMONYMES DE MÊME PATRON, domaines différents : components/agents-workshop/agent-initials.ts:60 (source d'agent builtin/global/project) et components/spec/MemoryPanel.tsx:91 (source d'écriture mémoire dreaming/distill/unknown). Même forme (table SOURCE_* → TranslationKey), pas la même donnée. NON interchangeables — signalé pour lever l'ambiguïté à la lecture, pas pour fusion.
- `/home/orosius/workspace/arij/components/qa/ReportDetail.tsx` · `formatDuration / statusTone` — DEUX HOMONYMES CHACUN. `formatDuration` : ReportDetail.tsx:175 prend deux ISO et rend s/m/h+m ; lib/workflow/dreaming-digest.ts:164 prend des ms et rend s ou m+s — même vocabulaire de sortie, contrats incompatibles. `statusTone` : ReportDetail.tsx:187 rend des classes fond+texte (`bg-agent-bg text-agent`…), app/projects/[projectId]/qa/page.tsx:34 rend les mêmes états en texte seul (`text-agent`…) — même table d'états (completed/failed/running/défaut) dupliquée à deux endroits du même écran QA, donc deux endroits à modifier pour ajouter un statut. Les deux `statusTone` sont factorisables en une table d'états unique + deux habillages ; les deux `formatDuration` non.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/epics/[epicId]/dependencies/route.ts` · `POST/PUT dependencies` — CLONE DE 22 LIGNES (jscpd #22) avec app/api/projects/[projectId]/dependencies/route.ts:[66-87] : deux différences seulement, le statut 201 vs 200 et le libellé « Failed to create » vs « Failed to update ». Même famille : app/api/mcp/add-dependency/route.ts et app/api/mcp/remove-dependency/route.ts sont clonés deux fois (jscpd #17, 24 lignes [60-83]↔[49-72], une seule ligne de différence ; et #36, 15 lignes [26-40]↔[25-39]). Quatre routes de dépendances, un seul corps utile.
- `/home/orosius/workspace/arij/app/api/agent-config/providers/[agentType]/route.ts` · `PUT (providers global)` — CLONE DE 39 LIGNES / 394 tokens (jscpd #9, le plus gros clone entre deux routes) avec app/api/projects/[projectId]/agent-config/providers/[agentType]/route.ts:[29-67]. Différences : le 404 projet en tête et `eq(agentProviderDefaults.scope, "global")` vs `eq(..., projectId)`. La version projet contient de surcroît un clone interne (jscpd #35 : [105-119] ↔ [21-32], 15 lignes) et un clone avec sa voisine prompts (#26 : [97-…] ↔ prompts:[71-89], 19 lignes). Toute la résolution provider/namedAgent est donc écrite trois fois pour deux scopes.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/documents/scan/route.ts` · `POST (scan documents)` — CLONE DE 18 LIGNES (jscpd #31) avec app/api/projects/[projectId]/documents/import/route.ts:[60-77] : une seule ligne diffère (`scanProjectDocuments(project.gitRepoPath)` vs `importScannedDocuments(...)`). Tout l'échafaudage de garde/erreur autour est identique.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/git/pull/route.ts` · `bloc resume de session` — CLONE DE 19 LIGNES (jscpd #28) avec app/api/projects/[projectId]/releases/route.ts:[221-239] : le bloc `isResumableProvider(provider)` → SELECT des 5 colonnes de session (id, projectId, provider, cliSessionId, claudeSessionId) → `resolveCliSessionId(previous)` → triple garde d'appartenance. Seuls l'indentation et le nom de la variable provider diffèrent. Même bloc à extraire en `resolveResumeTarget(projectId, provider, resumeSessionId)`.
- `/home/orosius/workspace/arij/lib/pipeline/stage-review.ts` · `préparation de stage` — CLONE DE 15 LIGNES (jscpd #34) avec lib/pipeline/stage-code.ts:[59-73] : seuls les noms `codeAgentType`/`reviewAgentType` et `buildSystemPrompt`/`reviewSystemPrompt` changent ; l'appel `resolveAgentPrompt(...)` et son entourage sont identiques.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/epics/route.ts` · `factRows / rankedEpicSessions` — DEUX CLONES CROISÉS depuis cette route. (a) jscpd #21, 22 lignes : [225-246] ↔ lib/auto-mode/select.ts:[396-417] — la même CTE de faits de session dupliquée entre une route et le sélecteur Full Auto. (b) jscpd #39, 14 lignes : [137-150] ↔ app/api/inbox/route.ts:[80-93] — la même fenêtre `ROW_NUMBER()` de classement des sessions, à la clause WHERE près (`epicId IS NOT NULL` vs un `and(...)`). Ces requêtes classent la même chose pour trois surfaces différentes.
- `/home/orosius/workspace/arij/lib/agent-config/named-agents.ts` · `construction du patch de mise à jour` — AUTO-CLONE (jscpd #19, 23 lignes) : [341-360] et [429-451] du même fichier construisent la même validation/normalisation de mise à jour d'agent, l'une en accumulant dans `let nextName`, l'autre dans un objet `patch`. Deux chemins de validation du même champ dans un seul module.
- `/home/orosius/workspace/arij/components/usage/SubscriptionCard.tsx` · `bloc de quota (Claude / Codex)` — AUTO-CLONE (jscpd #43, 11 lignes / 141 tokens) : [172-182] pour `live: ClaudeQuota` et [357-367] pour `live: CodexLiveQuota` — même structure, seul le champ terminal diffère (`live.extraUsage` vs `live.credits`). Deux rendus de carte quota maintenus en parallèle dans le même fichier.
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/epics/[epicId]/review-comments/route.ts` · `PATCH / DELETE` — AUTO-CLONE (jscpd #23, 21 lignes / 204 tokens) : [80-100] (PATCH) et [120-140] (DELETE) partagent tout le préambule (params, parse du body, gardes, lookup) et ne divergent qu'à la dernière instruction (`db.delete(...)` vs la construction de `updates`).
- `/home/orosius/workspace/arij/app/api/projects/[projectId]/stories/[storyId]/route.ts` · `PATCH story` — CLONE DE 19 LIGNES / 251 tokens (jscpd #27) avec app/api/projects/[projectId]/user-stories/route.ts:[106-124] : la même construction incrémentale de `updates` (title, description, acceptanceCriteria, …) puis le même `db.update(userStories).set(updates)`, la seule différence étant l'origine de l'id (`body.id` vs `storyId`) et le formatage. Deux endpoints d'édition de story, un seul comportement.
- `/home/orosius/workspace/arij/lib/mcp/refinement.ts` · `ticketLabel` — HOMONYMES DIVERGENTS. lib/mcp/refinement.ts:164 `epic.readableId ?? epic.id` (id brut complet en repli, pour les logs d'activité) ; components/ticket/derive.ts:35 `readableId.trim()` sinon `shortId(id)` = les 6 derniers caractères (pour l'affichage). Même nom, même intention de « libellé du ticket », deux sorties différentes pour un epic sans readableId. Non interchangeables ; à distinguer par le nom.
- `/home/orosius/workspace/arij/app/projects/import/page.tsx` · `exportArjiJson` — HOMONYMES SANS RAPPORT DE CORPS mais même nom pour le même effet final : app/projects/import/page.tsx:214 est un POST `/api/projects/:id/sync {action:"export"}` côté client ; lib/sync/export.ts:51 est l'export serveur réel. Le premier est un déclencheur du second. Non interchangeables — signalé parce que le nom identique fait croire à un doublon de logique lors d'un grep (et parce que MEMORY note déjà qu'arji.json est réécrit par le dev server).
- `/home/orosius/workspace/arij/app/piscine-preview/page.tsx` · `Row` — HOMONYMES SANS RAPPORT : app/piscine-preview/page.tsx:108 (conteneur flex de spécimens) et components/usage/UsageBarRow.tsx:29 (ligne de barre de coût). Aucun doublon de logique — listé pour clore l'inventaire des noms comptés ≥ 2 fois, et écarté.
