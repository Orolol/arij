# Lot 12 — Git, GitHub, import et suppression de projet

**Statut : réalisé le 16/09/2026.** Voir le [compte rendu d’implémentation et de validation](implementation-lots-12-13-16.md).
Les constats ci-dessous conservent l’état relevé pendant l’audit.

**Difficulté** 2/4 — Moyen
**Findings** 9 (1 fort · 5 moyen · 3 faible ; effort 6 S · 3 M · 0 L)
**Dépendances** Indépendant.

## Décision

Le flux d'import GitHub redevient atteignable depuis le menu « + » ; la suppression de projet a un bouton ; git/connect et git/detect-remote sont supprimés.

## Objectif

Lien vers /projects/import, action « Supprimer le projet » dans DeskProjectMenu ou les réglages projet, runAuthenticatedGit partagé par push/pull/fetch/release (PAT + GIT_TERMINAL_PROMPT=0), page git-sync qui ne fait plus 8 requêtes, un seul résolveur de chemin pour uploads/documents/artifacts, images de documents servies, importArjiJson en transaction, journal git_sync_log cohérent (un nom d'opération, une orthographe d'échec), route PR scopée au projet.

## Démarche suggérée

1. Liens + bouton (Piscine, pas shadcn) ; retirer cloneSource du POST client.
2. Supprimer git/connect et git/detect-remote + tests ; déplacer la validation owner/repo dans updateProject.
3. runAuthenticatedGit dans lib/git ; l'utiliser dans remote.ts et release.ts.
4. resolveStoredPath partagé ; GET /documents/:id/image + rendu dans DocumentViewer.
5. git-sync : projet en prop du layout, RepoStrataBand consomme les données de la page.
6. Le portage Piscine de la page import/git-sync est dans le lot 17.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #55 — La page /projects/import est injoignable depuis l'UI ; clone, import, sync export et POST user-stories n'ont plus d'autre entrée

**Nature** à moitié câblé · **Impact** fort · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `app/projects/import/page.tsx:226`
- `app/projects/import/page.tsx:293`
- `app/projects/import/page.tsx:354`
- `app/projects/import/page.tsx:403`
- `app/projects/new/page.tsx:34-46`
- `components/piscine/TopBar.tsx:443`
- `app/api/projects/clone/route.ts`
- `app/api/projects/import/route.ts`
- `app/api/projects/[projectId]/sync/route.ts:27`
- `components/import/`

**Constat**

app/projects/import/page.tsx (619 l.) est le seul flux de création par URL GitHub ou par analyse d'un dossier existant, mais aucun lien ne pointe dessus : le « + » de la TopBar mène à /projects/new (formulaire nom/description/chemin qui ne propose pas l'import). Par ricochet, POST /api/projects/clone, POST /api/projects/import, l'action `export` de POST /api/projects/[id]/sync et POST /api/projects/[id]/user-stories n'ont plus d'appelant produit hors cette page, et tout components/import/ n'est importé que par elle. La page envoie aussi `cloneSource: "github"` (l.403) que createProjectSchema ne déclare pas (la provenance vient du marqueur disque) — champ mort côté client.

**Précision du vérificateur**

app/projects/import/page.tsx (619 l.) est l'unique flux d'import (URL GitHub ou analyse d'un dossier), mais plus aucun lien produit ne l'atteint : les deux `<Link href="/projects/import">` ont été supprimés au commit 99e2de34 (rebuild Piscine) sans remplacement ; le « + » pointillé de la rangée de chips (TopBar.tsx:443, testid top-bar-add-project) mène à /projects/new, dont le formulaire (nom/description/chemin, l.34-41) n'offre pas l'import, et la pilule « New » (l.660) mène à /tickets/new. Seul e2e/i18n-interface.spec.ts:52 y navigue par URL directe. Par ricochet, POST /api/projects/clone (page.tsx:354), POST /api/projects/import (page.tsx:293), l'action `export` de POST /api/projects/[id]/sync (page.tsx:220 ; le layout projet n'envoie que `import`) et POST /api/projects/[id]/user-stories (page.tsx:192 ; useEpicDetail.ts:72 est un GET) n'ont plus d'appelant produit hors cette page, et components/import/ n'est importé que par elle et par ImportPreview.tsx. La page envoie aussi `cloneSource: "github"` (l.403) que createProjectSchema (schemas.ts:16-23) ne déclare pas volontairement ; validate.ts fait un safeParse d'un z.object non strict, la clé est donc ignorée silencieusement — champ mort côté client.

app/projects/import/page.tsx (619 l.) — seul flux d'import par URL GitHub ou analyse d'un dossier — n'a plus aucune entrée UI depuis le commit 99e2de34 (28/08) qui a supprimé components/dashboard/ProjectGrid.tsx et ses deux `<Link href="/projects/import">` ; le « + » de la TopBar (components/piscine/TopBar.tsx:443) mène à /projects/new, dont le formulaire (l.34-46) n'a ni lien ni option d'import. Seul e2e/i18n-interface.spec.ts:52 atteint encore la page, par URL directe. Par ricochet, POST /api/projects/clone (page.tsx:354), POST /api/projects/import (:293), l'action `export` de POST /api/projects/[id]/sync (:220 ; app/projects/[projectId]/layout.tsx:87 n'envoie que `import`) et POST /api/projects/[id]/user-stories (:192 ; useEpicDetail.ts:72 ne fait que GET) n'ont plus d'appelant produit — aucun chemin MCP, routine ou instrumentation ne les touche. La fonction `exportArjiJson` de lib/sync/export.ts reste vivante par ailleurs ; seule l'action HTTP est orpheline. components/import/ n'est importé que par cette page (ImportPreview.tsx:11 n'importe qu'un type interne). Le POST client envoie `cloneSource: "github"` (:403) que createProjectSchema (lib/validation/schemas.ts:16-23) exclut volontairement (commentaire l.9-15) ; validate.ts:18/:74 `safeParse` non strict → champ mort côté client.

**Recommandation**

Rendre le flux atteignable (lien depuis /projects/new ou entrée « Importer depuis GitHub » dans le menu + de la TopBar) ou assumer sa suppression avec les routes clone/import et components/import/. Retirer le champ cloneSource du POST client. Si le flux est conservé, le migrer sur les primitives Piscine (voir finding dédié).

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'projects/import' app components hooks lib hors app/api et hors la page → un seul hit, un commentaire components/piscine/TopBar.tsx:849. rg '"/api/projects/clone"' → import/page.tsx:354 uniquement. rg 'action: "export"' app components hooks → import/page.tsx:220 uniquement. rg -l 'components/import/' → app/projects/import/page.tsx et components/import/ImportPreview.tsx. lib/validation/schemas.ts:16-23 createProjectSchema sans cloneSource ; validate.ts utilise safeParse d'un z.object non strict → clé ignorée silencieusement.

</details>

### #56 — DELETE /api/projects/[projectId] et toute la chaîne de nettoyage (sessions, clone, uploads, settings) ne sont atteignables par aucune surface

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `app/api/projects/[projectId]/route.ts:117-173`
- `app/api/projects/[projectId]/route.ts:56-62`
- `lib/projects/clone-cleanup.ts:228`
- `lib/projects/cancel-sessions.ts:31`
- `lib/uploads/attachment-ownership.ts:203`
- `lib/projects/project-settings-keys.ts:35`

**Constat**

La route DELETE (l.117-173) orchestre cancelProjectSessions, removeProjectClone (lib/projects/clone-cleanup.ts, 274 l. avec trois portes de sécurité), deleteProjectUploads et deleteProjectSettings. Aucun bouton, menu ou hook ne l'appelle : il n'existe pas de suppression de projet dans l'UI. Le message d'erreur de PATCH (l.59) dit pourtant à l'utilisateur « Delete the project and import it again to move it » — un conseil impossible à suivre. Le seul consommateur est le fixture e2e et un test unitaire.

**Précision du vérificateur**

DELETE /api/projects/[projectId] (route.ts l.117-173 : cancelProjectSessions, removeProjectClone via ?removeDirectory=true, deleteProjectSettings, deleteProjectUploads, db.delete(projects)) n'est appelée par aucune surface produit : aucun fetch/requestJson en DELETE vers `/api/projects/${id}` nu dans components/, hooks/, app/ (hors app/api), lib/ (MCP, routines, workflow), bin/, scripts/ ; DeskProjectMenu n'a que des liens de navigation, la page settings projet ne parle qu'à /api/settings, aucune clé i18n de suppression de projet, et aucun bouton n'a jamais existé dans l'historique (a80cb49f ne touche que la route). Le message d'erreur du PATCH (l.59) « Delete the project and import it again to move it » renvoie donc à une action impossible depuis l'UI. Les seuls consommateurs sont test-side : __tests__/clone-lifecycle-delete-route.test.ts, e2e/fixtures/arij-project.ts:196 et quatre specs Playwright (top-bar-project-scope:72, desk-toasts:54/64, top-bar-responsive:253, piscine-finishing:117). Lignes exactes : cancelProjectSessions l.30 et deleteProjectUploads l.202 (décalage d'une ligne par rapport au finding).

DELETE /api/projects/[projectId] (route.ts l.117-173) et la chaîne cancelProjectSessions (lib/projects/cancel-sessions.ts l.30) / removeProjectClone (lib/projects/clone-cleanup.ts l.228) / deleteProjectUploads (lib/uploads/attachment-ownership.ts l.202) / deleteProjectSettings (route.ts l.176) ne sont atteints par aucune surface produit : aucun fetch DELETE vers `/api/projects/${id}` nu dans components/hooks/app (15 sites DELETE lus, tous sous-ressources), aucun outil MCP ni script bin/, DeskProjectMenu n'a que des liens de pages, la page settings projet ne parle qu'à /api/settings, aucune clé i18n. Seuls consommateurs : le teardown e2e (e2e/fixtures/arij-project.ts l.190/487) et __tests__/clone-lifecycle-delete-route.test.ts (plus deux tests unitaires de la chaîne lib). Le 400 de PATCH (route.ts l.59) renvoie l'utilisateur vers une suppression qu'il ne peut pas déclencher.

**Recommandation**

Ajouter l'action « Supprimer le projet » (avec l'option removeDirectory pour les clones Arij) dans DeskProjectMenu ou les réglages projet, ou retirer la route et la chaîne de nettoyage si la suppression n'est pas voulue — dans ce cas corriger le texte de PATCH.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'method: "DELETE"' components hooks app hors app/api → 15 sites, aucun ne vise `/api/projects/${id}` nu (epics, stories, conversations, documents, routines, mcp-servers, qa, chat/uploads, sessions). rg 'removeDirectory|deleteProject|projectDelete' components app hooks lib/i18n/messages hors app/api → 0. rg -l removeDirectory __tests__ e2e → e2e/fixtures/arij-project.ts, __tests__/clone-lifecycle-delete-route.test.ts.

</details>

### #57 — git/connect et git/detect-remote sont des doublons orphelins de PATCH projet et github/detect ; seul le doublon mort valide le format owner/repo

**Nature** doublon · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `app/api/projects/[projectId]/git/connect/route.ts:26-33`
- `app/api/projects/[projectId]/git/detect-remote/route.ts`
- `app/api/projects/[projectId]/github/detect/route.ts`
- `components/github/GitHubConnectBanner.tsx:59`
- `components/github/GitHubConnectBanner.tsx:108-112`
- `lib/validation/schemas.ts:29`
- `lib/github/client.ts:96-107`
- `app/api/projects/[projectId]/github/issues/triage/route.ts:31-41`

**Constat**

POST git/connect (53 l.) écrit projects.githubOwnerRepo après avoir vérifié le format `owner/repo` ; POST git/detect-remote (46 l.) appelle detectGitHubRemote exactement comme GET github/detect. Aucun des deux n'a d'appelant : GitHubConnectBanner utilise github/detect (l.59) puis PATCH /api/projects/:id (l.108-112). Or updateProjectSchema accepte pour githubOwnerRepo n'importe quelle chaîne ≤ 200 sans format ; une valeur « foo » passe, puis parseOwnerRepo (client.ts:96-107) lève une Error générique dans syncProjectGitHubIssues → 500 « Failed to load triage issues » au lieu du 400+code prévu, et la route PR fait `project.githubOwnerRepo.split("/")` (pr/route.ts:113) avec repo undefined.

**Précision du vérificateur**

POST `git/connect` (53 l.) et POST `git/detect-remote` (46 l.) n'ont aucun appelant dans le produit (seuls des commentaires et des tests de convention de statut les citent) ; `git/detect-remote` recouvre `GET github/detect` en moins complet (pas de writeGitSyncLog, réponse partielle). Le chemin vivant est GitHubConnectBanner : `github/detect` (ligne 46 de l'arbre courant, pas 59) puis PATCH `/api/projects/:id` (lignes ~59-64, pas 108-112 — le fichier a été compacté par le travail non commité). Or `updateProjectSchema`/`createProjectSchema` (lib/validation/schemas.ts:20,29) n'acceptent qu'un `z.string().max(200).nullish()` et `app/api/projects/[projectId]/route.ts:84` recopie la valeur telle quelle : « foo » est écrit sans contrôle. La validation `owner/repo` n'existe donc plus que dans le doublon mort. En aval, `parseOwnerRepo` (lib/github/client.ts:96-107) lève une Error générique depuis `lib/github/issues.ts:42` et `lib/routines/ci-watch.ts:308` ; la route triage (route.ts:31-41) ne rattrape que `GitHubNotConfiguredError` et tombe dans `errorResponse` → HTTP 500 (le corps porte le message « Invalid GitHub owner/repo format… », pas le fallback « Failed to load triage issues » annoncé), et `epics/[epicId]/pr/route.ts:113`, `releases/route.ts`, `releases/[releaseId]/publish/route.ts` font `githubOwnerRepo.split("/")` avec `repo` undefined.

**Recommandation**

Supprimer git/connect et git/detect-remote (et leurs tests de convention), puis déplacer la validation `owner/repo` (regex isSafeRepoSegment de lib/git/github-url.ts) dans updateProjectSchema/createProjectSchema pour que le seul chemin d'écriture vivant refuse une valeur mal formée.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'git/connect|detect-remote|/connect`' app components hooks lib e2e __tests__ hors les deux routes → uniquement des commentaires (client.ts:21, github/detect:71, triage:34, worktrees:109) et des tests de convention de statut. updateProjectSchema l.29 : `githubOwnerRepo: z.string().max(200).nullish()`. triage/route.ts:35 ne rattrape que GitHubNotConfiguredError ; parseOwnerRepo jette `new Error(...)` → errorResponse 500.

</details>

### #59 — Push/pull/fetch de lib/git/remote.ts restent non authentifiés et sans garde anti-prompt ; l'écart « Known gap » de la doc est toujours ouvert

**Nature** risque · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `lib/git/remote.ts:241-243`
- `lib/git/remote.ts:362-412`
- `app/api/projects/[projectId]/git/push/route.ts:64`
- `app/api/projects/[projectId]/git/pull/route.ts:96`
- `app/api/projects/[projectId]/git/status/route.ts:62-70`
- `app/api/projects/[projectId]/epics/[epicId]/pr/route.ts:137`
- `docs/architecture/github-import.md`

**Constat**

Le clone injecte le PAT via -c http.extraHeader mais pushGitBranch (l.401-412), pullGitBranchWithConflictSupport (l.371-399) et fetchGitRemote (l.362-369) appellent simpleGit(repoPath) sans en-tête ni environnement (GIT_TERMINAL_PROMPT non posé). Un projet privé importé par le flux GitHub (HTTPS, sans credential helper) ne peut pas être poussé depuis Git Sync ni depuis la route PR (pr/route.ts:137 appelle pushGitBranch avant createPullRequest). git/status contourne le blocage par Promise.race à 4 s (status/route.ts:65-70) mais le processus git sous-jacent continue à attendre l'invite. github-import.md le documente comme « Known gap » sans ticket.

**Précision du vérificateur**

Le clone injecte le PAT via `-c http.extraHeader` (lib/git/clone.ts:154-155, 481-485) avec `nonInteractiveEnv()` (l.511) et un AbortSignal (l.472-474), et ne persiste volontairement aucun credential dans le dépôt. Mais `getGit` de lib/git/remote.ts:241-243 est un `simpleGit(repoPath)` nu : `fetchGitRemote` (l.362-369), `pullGitBranchWithConflictSupport` (l.371-399) et `pushGitBranch` (l.401-412) tournent sans en-tête d'auth, sans GIT_TERMINAL_PROMPT=0 et sans signal d'abort. Consommateurs : git/push/route.ts:64, git/pull/route.ts:96, git/status/route.ts:65-70 (Promise.race 4 s qui rejette la promesse sans tuer le process git, faute de signal), epics/[epicId]/pr/route.ts:139 (137 à HEAD) qui pousse avant createPullRequest. Un projet privé importé par le flux GitHub (HTTPS, aucun credential helper posé) ne peut donc ni pousser ni tirer ni créer de PR ; si le serveur a un tty de contrôle, git bloque sur l'invite, sinon il échoue en « could not read Username ». docs/architecture/github-import.md:127-131 documente ce « Known gap » depuis b72dc789 (21/08) et aucun ticket d'arji.json ne le porte. Précision : lib/git/release.ts n'effectue aucune opération distante (ni push ni tag), la mention « release tagging » de la doc est sans objet pour ce finding.

Le clone injecte le PAT via `-c http.extraHeader` + `nonInteractiveEnv()` (lib/git/clone.ts:154, 473-474, 511), mais lib/git/remote.ts:241 `getGit()` renvoie `simpleGit(repoPath)` nu : fetchGitRemote (l.362-369), pullGitBranchWithConflictSupport (l.371-399) et pushGitBranch (l.401-412) tournent sans en-tête d'auth ni GIT_TERMINAL_PROMPT=0. Même défaut pour le push de tag dans app/api/projects/[projectId]/releases/route.ts:396-397. Ces fonctions sont réellement atteintes depuis l'UI : git-sync/page.tsx:277 (push/pull), useGitStatus.ts:48 → RepoStrataBand (git-sync:409) et ReleaseHeaderCluster (releases/page.tsx:261), et le bouton « Create PR » (GitBand.tsx:147 → useEpicPr → pr/route.ts:139, qui vérifie le PAT l.73 sans le transmettre à git). git/status/route.ts:65-70 borne l'attente à 4 s par Promise.race sans AbortSignal : le process git enfant reste bloqué sur l'invite. github-import.md:127-131 documente l'écart comme « Known gap » ; aucun ticket arji.json ne le couvre (ZyR44QoPNBCA « Push and Create PR in one action » ne traite pas l'auth du transport).

**Recommandation**

Factoriser un `runAuthenticatedGit(repoPath, args, token)` (le withAuth/authConfigArgs + nonInteractiveEnv de clone.ts) et l'utiliser dans push/pull/fetch et release ; remplacer le Promise.race du status par l'AbortSignal de simple-git pour tuer réellement le fetch.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'extraHeader|authHeader|buildAuthHeaderConfig' lib app hors lib/git/clone.ts → seulement lib/git/redact.ts (commentaire). remote.ts getGit l.241 : `simpleGit(repoPath)` sans .env(). Aucune occurrence de GIT_TERMINAL_PROMPT hors clone.ts:1022.

</details>

### #62 — Le montage de /projects/:id/git-sync déclenche 8 requêtes dont 3 paires redondantes, deux d'entre elles shellant git

**Nature** cassé · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `app/projects/[projectId]/layout.tsx:70`
- `app/projects/[projectId]/git-sync/page.tsx:112`
- `app/projects/[projectId]/git-sync/page.tsx:209`
- `app/projects/[projectId]/git-sync/page.tsx:267`
- `components/github/RepoStrataBand.tsx:58-73`
- `hooks/useGitHubConfig.ts:10-23`
- `hooks/useGitStatus.ts:46-48`
- `hooks/useWorktrees.ts:70`
- `hooks/useTicketOverlayData.ts:176`

**Constat**

Trois lectures de GET /api/projects/:id (layout.tsx:70, git-sync/page.tsx:112, useGitHubConfig.ts:12 via RepoStrataBand), une de GET /api/settings (useGitHubConfig.ts:13), deux de GET git/status (page.tsx:209 avec remote+branch saisis ; useGitStatus.ts:47 avec la branche par défaut), deux de GET worktrees (page.tsx:267 et RepoStrataBand.tsx:70, chacune exécutant `git worktree list --porcelain`), plus GET prs. Chaque git/status refait assertGitRepository + getRemoteAvailability + fetch éventuel. Le même hook useGitHubConfig est aussi monté à chaque ouverture de l'overlay ticket (useTicketOverlayData.ts:176) et refait project + settings.

**Précision du vérificateur**

Le montage de /projects/:id/git-sync émet trois GET /api/projects/:id (layout.tsx:70, git-sync/page.tsx:113, useGitHubConfig.ts:12 via RepoStrataBand.tsx:62), un GET /api/settings (useGitHubConfig.ts:13), deux GET git/status aux query différentes (page.tsx:195-209 `?remote=origin` sans branche au premier rendu ; useGitStatus.ts:36-37 `?branch=<defaultBranch||main>`) et deux GET worktrees (page.tsx:261 et RepoStrataBand.tsx:74), plus GET prs (RepoStrataBand.tsx:80) si PAT + ownerRepo. RepoStrataBand n'est rendu qu'après la réponse projet de la page (page.tsx:408), donc ses requêtes partent en seconde vague, sans dédoublonnage (requestJson/usePolledResource n'ont aucun cache). Chaque git/status refait assertGitRepository + getRemoteAvailability + getBranchSyncStatus (status/route.ts:106-130) ; le `git fetch` n'est refait que si le TTL mémoire de 5 min est expiré (l.25-34). Chaque GET worktrees shelle `git worktree list --porcelain` (worktrees/route.ts:147-149, lib/git/worktrees.ts:110). useGitHubConfig est aussi relancé (project + settings) à chaque réouverture de l'overlay ticket (useTicketOverlayData.ts:179-181, projectId passé seulement quand activeEpicId est non nul). S'y ajoutent au montage useNamedAgentsList (page.tsx:184), SessionPicker (sessions/resumable) et éventuellement github/detect du banner du layout.

Le montage de /projects/:id/git-sync (atteint via NowDesk → DeskProjectMenu) déclenche 8 requêtes (9 avec PAT) en deux vagues : d'abord layout.tsx:70 et page.tsx:113 (GET /api/projects/:id ×2), page.tsx:209 (git/status?remote=origin), page.tsx:261 (worktrees) ; puis, une fois le projet résolu (page.tsx:408), RepoStrataBand.tsx:62 → useGitHubConfig.ts:12-13 (GET project + GET settings complet), RepoStrataBand.tsx:69 → useGitStatus.ts:36-37 (git/status?branch=<défaut>), RepoStrataBand.tsx:74 (worktrees, URL identique), :80-83 (prs si PAT). Les deux worktrees sont strictement redondants (chacun `git worktree list --porcelain`, worktrees/route.ts:146-149) ; les deux git/status répondent à des questions différentes (branche courante vs branche par défaut) mais refont chacun assertGitRepository + getRemoteAvailability + fetch TTL (git/status/route.ts:106-127), le TTL n'étant posé qu'après succès. Aucune dédup client (lib/api/client.ts) ni Cache-Control. useTicketOverlayData.ts:179 remonte useGitHubConfig (project + settings) à chaque ouverture d'overlay sur un epic. Le test git-sync-state.test.tsx:4 mocke RepoStrataBand, donc rien ne garde cette redondance ; la doc de rationalisation ne la déclare pas corrigée.

**Recommandation**

Faire passer le projet en prop du layout vers les pages (ou un contexte projet), faire de RepoStrataBand un consommateur des données déjà chargées par la page (status, worktrees) au lieu de re-lire, et remplacer la lecture de /api/settings entière par un endpoint léger « PAT présent » ou une valeur mise en cache par usePolledResource.

<details><summary>Preuve relevée par l'auditeur</summary>

Lecture directe des fichiers cités ; rg 'useWorktrees' → RepoStrataBand.tsx:70 et git-sync/page.tsx:267 montés simultanément (page.tsx:486 rend RepoStrataBand). rg 'useGitHubConfig' → RepoStrataBand, github-issues page, releases page, useTicketOverlayData.

</details>

### #63 — Trois stockages de fichiers avec trois copies du confinement de chemin, et les documents image sont stockés mais jamais servis

**Nature** à moitié câblé · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `lib/uploads/upload-paths.ts:88-108`
- `lib/documents/document-paths.ts:1-9`
- `lib/documents/document-paths.ts:50-72`
- `app/api/projects/[projectId]/documents/route.ts:171-192`
- `components/documents/UploadZone.tsx:57`
- `components/documents/DocumentViewer.tsx:17-26`
- `app/api/projects/[projectId]/uploads/[fileName]/route.ts`
- `lib/documents/mentions.ts:120-123`

**Constat**

data/uploads/<projectId> (chat_attachments, servi par /uploads/[fileName] et /chat/uploads/[id]), data/documents/<projectId> (documents.image_path) et data/sessions/<id>/artifacts (session_artifacts) ont chacun leur résolveur : storedUploadAbsolutePath (upload-paths.ts:88-108) et documentImageAbsolutePath (document-paths.ts:50-72) sont des copies ligne à ligne, le commentaire de document-paths.ts l'admet. Côté documents, POST /documents accepte les images (route.ts:171-192, UploadZone accept image/*) et les écrit sur disque, mais aucune route ne sert documents.image_path : DocumentViewer affiche le chemin disque en texte (l.17-26) et l'image n'est visible que par un agent (mentions.ts:120-123). Une capture d'écran uploadée dans Docs n'est donc jamais prévisualisable.

**Précision du vérificateur**

Deux stockages ont un résolveur de chaîne stockée dupliqué ligne à ligne (storedUploadAbsolutePath, upload-paths.ts:88-108 ; documentImageAbsolutePath, document-paths.ts:50-72, dont l'en-tête l.1-8 admet être la « counterpart »), et le test « strictement sous la racine » qu'ils contiennent est recopié en six endroits au total (upload-paths.ts:63-71, document-paths.ts:64-69, attachment-ownership.ts:220-224, agent-sessions/artifacts.ts:62-70, agent-sessions/servable-artifacts.ts:50-58, projects/workspace.ts:71-74) — session_artifacts n'a pas de résolveur de chaîne stockée mais deux copies locales d'isWithin. Côté documents, POST /documents (route.ts:32-37, 171-192) accepte image/* (UploadZone.tsx:57) et écrit data/documents/<projectId>/…, mais aucune route ne sert documents.image_path ([documentId]/route.ts n'exporte que DELETE ; pas de <img> ni de rewrite) : DocumentViewer.tsx:17-26 affiche « Filesystem path: … » en texte et seul l'agent voit l'image via mentions.ts:117-123. Une capture déposée dans Docs n'est jamais prévisualisable.

Deux (pas trois) copies ligne à ligne du confinement de chemin : storedUploadAbsolutePath (lib/uploads/upload-paths.ts:88-108) et documentImageAbsolutePath (lib/documents/document-paths.ts:50-72) ; le résolveur des session_artifacts (lib/agent-sessions/servable-artifacts.ts isSafeSegment+isWithin, session-paths.ts:19-25) est une conception distincte à base de segments. La duplication upload/document est délibérée et documentée (upload-paths.ts:12-20, commit 28713a24) : les segments doivent rester littéraux au join pour le traçage Turbopack, donc un `resolveStoredPath(rootSegments, …)` générique n'est pas applicable ; seul le check « à l'intérieur de la racine » est factorisable. En revanche le volet half-wired est exact : POST /documents accepte image/* (route.ts:33-38, 170-185 ; UploadZone.tsx:57) et écrit data/documents/<projectId>/<id>-<nom>, mais aucune route GET ne sert documents.image_path ([documentId]/route.ts n'exporte que DELETE ; pas de rewrite, pas de public/, pas de <img> dans app/projects/[projectId]/documents ni components/documents). Les seuls consommateurs sont DELETE (unlink), mentions.ts:121 (chemin absolu dans le prompt agent) et DocumentViewer.tsx:17-26 qui affiche « Filesystem path: … » en texte. Une image déposée dans Docs n'est donc jamais prévisualisable dans l'UI.

**Recommandation**

Factoriser un `resolveStoredPath(rootSegments, storedPath)` partagé par uploads, documents et artifacts ; soit ajouter GET /documents/[documentId]/image et rendre l'image dans DocumentViewer, soit refuser image/* dans UploadZone et la route documents (les captures ont déjà /chat/upload).

<details><summary>Preuve relevée par l'auditeur</summary>

ls app/api/projects/[projectId]/documents/ → [documentId], import, route.ts, scan : pas de route de service d'image. rg 'imagePath|image_path' components → seul DocumentViewer.tsx (rendu textuel). document-paths.ts:2 « The data/documents/ counterpart of lib/uploads/upload-paths.ts, and it exists for the same two reasons ».

</details>

### #65 — importArjiJson met à jour la ligne projet hors transaction et le seul chemin d'export manuel dépend de la page orpheline

**Nature** risque · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `lib/sync/import.ts:43-52`
- `lib/sync/import.ts:177-233`
- `lib/sync/arji-json.ts:54-68`
- `app/api/projects/[projectId]/sync/route.ts:27-32`
- `app/projects/[projectId]/layout.tsx:96-100`

**Constat**

lib/sync/import.ts écrit name/description/status/spec du projet (l.43-52) avant d'ouvrir la transaction SQLite qui réconcilie epics/stories/commentaires (l.177-233). Une erreur dans la transaction (contrainte, guard inattendu) laisse le projet renommé/re-spécifié depuis arji.json avec un board inchangé. readArjiJson (arji-json.ts:63) fait JSON.parse sans capture : un arji.json invalide remonte en 500 « Sync failed » sans indiquer le fichier. Par ailleurs l'action `export` de POST /sync n'a d'appelant que dans app/projects/import/page.tsx:220 (page injoignable) — l'export manuel n'est offert nulle part, seul le debounce automatique tryExportArjiJson tourne.

**Précision du vérificateur**

lib/sync/import.ts écrit name/description/status/spec du projet (l.43-52, autocommit) avant d'ouvrir la transaction SQLite qui réconcilie epics/stories/commentaires (créée l.69, corps l.70-231, exécutée l.233). Une erreur dans la transaction (contrainte, trigger, guard inattendu) laisse le projet renommé/re-spécifié depuis arji.json avec un board intact ; le test de rollback (__tests__/arji-json-sync-roundtrip.test.ts l.570-630) ne relit jamais la ligne projet. readArjiJson (arji-json.ts l.63) fait JSON.parse sans capture : un arji.json malformé remonte en 500 avec le message brut du SyntaxError (« Unexpected token … ») via errorResponse (route-helpers.ts l.135), qui prime sur le fallback client « Impossible d'importer arji.json. » — le fichier n'est nommé nulle part. L'action `export` de POST /sync n'a qu'un appelant, app/projects/import/page.tsx l.214-222, page sans point d'entrée UI (docs/specs.md l.283 ; aucun href dans app/components/hooks) ; le header projet (layout.tsx l.85-88) n'envoie que `{ action: "import" }` et la carte « arji.json sync » de Git Sync (git-sync/page.tsx l.713-720) est purement textuelle. Seul le debounce automatique tryExportArjiJson écrit le fichier.

importArjiJson (lib/sync/import.ts) écrit name/description/status/spec du projet en autocommit (l.43-52) AVANT la transaction SQLite qui réconcilie epics/stories/commentaires (ouverte l.69, fermée l.231, invoquée l.233). Une erreur dans la transaction — p. ex. TypeError l.154/156 sur un epic sans `user_stories` dans un arji.json édité à la main (readArjiJson ne valide que `project`/`epics`, arji-json.ts:64), ou violation de FK (foreign_keys=ON, lib/db/index.ts:58) — laisse le projet renommé/re-spécifié avec un board inchangé. Le chemin est joignable : bouton RefreshCw du layout projet (app/projects/[projectId]/layout.tsx:192-205 → POST /sync `{action:"import"}` l.85-87). Le test de rollback (__tests__/arji-json-sync-roundtrip.test.ts:570-628) ne couvre pas la ligne projet. readArjiJson fait `JSON.parse` sans capture (arji-json.ts:63) : le client reçoit le message brut de la SyntaxError (errorResponse renvoie `error.message`, route-helpers.ts:135), pas « Sync failed », mais sans nommer arji.json alors que la branche forme-invalide l.65 le nomme. L'action `export` de POST /sync (route.ts:27-31) n'a d'appelant que app/projects/import/page.tsx:220, page sans point d'entrée UI (aucun href/push ; docs/specs.md:283 le confirme) ; aucun MCP/routine/instrumentation ne l'appelle ; seul le debounce automatique tryExportArjiJson (lib/sync/export.ts:223) tourne. La carte « arji.json » de Git Sync (git-sync/page.tsx:713-719 dans l'arbre de travail) reste purement textuelle.

**Recommandation**

Déplacer l'update projet dans la transaction ; entourer JSON.parse d'un message nommant arji.json ; exposer l'export manuel (bouton sur Git Sync, qui affiche déjà une carte « arji.json » purement textuelle l.789-796) ou retirer l'action.

<details><summary>Preuve relevée par l'auditeur</summary>

import.ts:43 `db.update(projects).set({...}).run()` puis l.177 `const transaction = sqlite.transaction(() => {…})` ; l.233 `transaction()`. layout.tsx:99 n'envoie que `{ action: "import" }`. rg 'action: "export"' app components hooks → import/page.tsx uniquement.

</details>

### #66 — git_sync_log est un journal écrit sous deux noms et deux orthographes d'échec, que rien ne relit

**Nature** refacto · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `lib/github/sync-log.ts:6-20`
- `lib/github/sync-log.ts:117-128`
- `app/api/projects/clone/route.ts:139-158`
- `app/api/projects/[projectId]/git/pull/route.ts:49-56`
- `lib/github/issues.ts:171-190`

**Constat**

lib/github/sync-log.ts exporte logSyncOperation et son alias writeGitSyncLog « kept for backward compat with main's naming » ; le type GitSyncStatus admet à la fois "failed" et "failure", et les deux sont écrits (clone route → "failure", pull/push/detect → "failed"). getRecentSyncLogs n'est importé que par un test ; le seul lecteur produit est isGitHubIssueSyncDue (status = 'success', operation = 'issues_sync'). La page Git Sync n'affiche aucun historique. La table est donc un audit sans consommateur, avec un schéma de statut ambigu pour le jour où l'on voudra la lire.

**Précision du vérificateur**

Exact sur le fond, à deux précisions près. (a) L'orthographe `"failure"` n'est pas propre à la route clone : trois familles de sites l'écrivent — `app/api/projects/clone/route.ts:98,123` (via `recordCloneOutcome`, défini l.142 ; pas l.95/120), `app/api/projects/[projectId]/releases/route.ts:410,442` (`tag_push`) et `app/api/projects/[projectId]/epics/[epicId]/pr/sync/route.ts:98` (`pr_sync`), tandis que `"failed"` vient de pull/push/detect et de `epics/[epicId]/pr/route.ts:154,231`. Corriger la route clone seule ne suffirait donc pas à réduire `GitSyncStatus` à `success|failed`. (b) `getRecentSyncLogs` n'est référencé nulle part hors `__tests__/github-sync-log.test.ts` (vérifié sur tout le dépôt), le seul lecteur produit reste `isGitHubIssueSyncDue` (`lib/github/issues.ts:171-190`), la page `app/projects/[projectId]/git-sync/page.tsx` n'a qu'un `fetch` (l.113, `/api/projects/:id`) et n'affiche aucun historique, et `lib/routines/retention.ts` ne mentionne pas la table — elle croît donc sans purge.

**Recommandation**

Supprimer l'alias writeGitSyncLog, réduire GitSyncStatus à success|failed et corriger le clone route, puis soit exposer un panneau « dernières opérations » sur Git Sync via getRecentSyncLogs, soit supprimer cette fonction et ajouter la table à la rétention.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'getRecentSyncLogs' app lib components hooks → seule la définition ; rg 'gitSyncLog' app lib hors sync-log.ts → lib/github/issues.ts:172-181 uniquement. rg -o 'status: "(failed|failure)"' dans les routes git/github : clone/route.ts:95,120 "failure" ; pull/push/detect "failed". DB dev (lecture seule) : 17 lignes, detect 14, push 2, pull 1.

</details>

### #104 — Route PR : GET non scopé au projet, journal git_sync_log incohérent (« failed » vs « failure », opération « push » pour une création de PR)

**Nature** cassé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/epics/[epicId]/pr/route.ts:24-36`
- `app/api/projects/[projectId]/epics/[epicId]/pr/route.ts:141-152`
- `app/api/projects/[projectId]/epics/[epicId]/pr/route.ts:196-218`
- `app/api/projects/[projectId]/epics/[epicId]/pr/sync/route.ts:87-96`
- `lib/github/sync-log.ts:6-20`
- `lib/github/sync-log.ts:117-118`

**Constat**

GET .../epics/[epicId]/pr lit pullRequests par epicId seul (:24-36) sans vérifier que l'epic appartient au projet de l'URL. Le journal utilise deux orthographes de statut selon la route — pr/route.ts écrit `status: "failed"` (:145, :218), pr/sync écrit `"failure"` (:95) — et le type GitSyncStatus (sync-log.ts:20) les accepte toutes deux, ce qui fige l'incohérence ; la création de PR est journalisée comme opération `"push"` trois fois (:141, :152, :196) alors que `"pr_create"` existe dans GitSyncOperation (:12) et dans le commentaire du schéma (:706) sans aucun writer. Les deux routes appellent la même fonction sous deux noms (writeGitSyncLog / logSyncOperation).

**Précision du vérificateur**

Journal git_sync_log incohérent (le GET PR non scopé est déjà corrigé dans l'arbre de travail, non commité). Deux orthographes de statut d'échec coexistent : `"failed"` dans pr/route.ts:154 et :231, git/pull (6×), git/push (5×), github/detect (3×) ; `"failure"` dans pr/sync/route.ts:98 et releases/route.ts:410, :442. `GitSyncStatus` (lib/github/sync-log.ts:20) accepte les deux et le commentaire du schéma (lib/db/schema.ts:724) ne documente que `success | failure`. Aucun lecteur ne filtre sur un statut d'échec (seul filtre : issues.ts:178 sur "success"), donc pas d'impact fonctionnel actuel. L'opération `"pr_create"` (sync-log.ts:12, schema.ts:722) n'a aucun writer : pr/route.ts journalise la création de PR (succès :209-215, échec :227-233) sous `operation: "push"`, indistinguable du vrai push git journalisé en :141-156. L'alias `writeGitSyncLog` (sync-log.ts:118) est utilisé par 4 routes et pinné par __tests__/github-sync-log.test.ts:72-77. Correction : normaliser sur `"success" | "failed"` (ou `"failure"`) et mettre à jour le commentaire du schéma ; journaliser `pr_create` en :209 et :227 ; l'alias peut rester ou être supprimé avec son test.

Journal git_sync_log incohérent et sans lecteur : (a) deux orthographes d'échec figées par le type GitSyncStatus (lib/github/sync-log.ts:20) — `"failed"` écrit par github/detect, git/push, git/pull et epics/[epicId]/pr/route.ts (:154, :231), `"failure"` par epics/[epicId]/pr/sync/route.ts:98 et releases/route.ts:410, :442 ; (b) la création de PR est journalisée comme `"push"` dans pr/route.ts:209-215 (succès, detail {prNumber,url}) et :227-233 (échec) alors que `"pr_create"` (sync-log.ts:12, commentaire schema.ts:722) n'a aucun writer — les appels :141-156 sont un vrai push et sont corrects ; (c) alias `writeGitSyncLog` (sync-log.ts:117-118) maintenu à côté de `logSyncOperation`, 4 routes + 6 tests l'utilisent. Impact nul aujourd'hui : `getRecentSyncLogs` n'a aucun appelant hors tests, le seul lecteur SQL (lib/github/issues.ts:172-178) filtre sur issues_sync/success, aucune UI n'affiche le journal. Le GET non scopé au projet est DÉJÀ corrigé dans l'arbre de travail (diff non commité, getEpicOr404 ajouté dans pr/route.ts:26-27 et pr/sync/route.ts:22-23, test __tests__/epic-pr-scope.test.ts, déclaré dans ui-rationalisation-2026-09-10.md:59) — ne pas le re-signaler.

**Recommandation**

getEpicOr404 dans GET ; normaliser GitSyncStatus sur `"success" | "failed"` ; journaliser `pr_create` avec le numéro de PR ; supprimer l'alias writeGitSyncLog.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'pr_create' lib app components (hors tests) → sync-log.ts:12 et schema.ts:706 (commentaire) uniquement, 0 writer. sync-log.ts:20 `export type GitSyncStatus = "success" | "failed" | "failure";`.

</details>

