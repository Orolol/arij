# Lot 20 — App shell, distribution, docs et CI

**Difficulté** 1/4 — Simple — agent peu coûteux
**Findings** 7 (0 fort · 2 moyen · 5 faible ; effort 6 S · 1 M · 0 L)
**Dépendances** Indépendant.

**Statut** fait le 16/09/2026 — détail dans [compte rendu des lots 18, 20-22, 24](implementation-lots-18-20-21-22-24.md).

## Décision

error.tsx / global-error.tsx / not-found.tsx obligatoires ; la promesse `npx arij` est retirée (distribution git-clone assumée) sauf décision contraire ; docs alignées sur le code.

## Objectif

Frontières d'erreur sous la TopBar, notFound() sur projet inconnu, package.json sans bin/files trompeurs (ou prepack réel), README/CLAUDE_PATH/catégories de nav corrigés, porte lint CI nettoyée (suppressions vides, étape morte), une seule table d'onglets de deuxième rangée, dépendances inversées app/api → components et le cycle sessions ↔ session-live cassés, docs d'architecture mises à jour (useKanban, composants kanban, plan de cleanup 2026-08-14 archivé, 29 chemins morts).

## Démarche suggérée

1. error/not-found d'abord (S, visible).
2. Décision distribution à confirmer avec l'utilisateur avant de toucher package.json.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #137 — Aucune frontière d'erreur dans l'App Router : pas d'error.tsx, global-error.tsx ni not-found.tsx, aucun ErrorBoundary

**Nature** risque · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `app/layout.tsx`
- `app/projects/[projectId]/layout.tsx:77`
- `app/agents/layout.tsx`
- `app/settings/layout.tsx`

**Constat**

`find app -name error.tsx -o -name global-error.tsx -o -name not-found.tsx -o -name loading.tsx -o -name template.tsx` ne renvoie rien ; `rg ErrorBoundary|componentDidCatch|getDerivedStateFromError` sur app/components/hooks/lib ne renvoie rien ; `notFound()` n'est appelé nulle part. Conséquence : toute exception de rendu dans un composant client (la quasi-totalité des écrans sont `"use client"`) fait tomber tout l'arbre sous app/layout.tsx sur l'écran par défaut de Next « Application error: a client-side exception has occurred », sans TopBar ni possibilité de naviguer ; un id de projet inconnu rend un shell vide (ProjectShell avale l'échec de /api/projects/:id, layout.tsx:77-81) au lieu d'un 404. Le root layout est le seul chrome de l'app (CLAUDE.md), il devrait donc aussi être le seul filet.

**Précision du vérificateur**

Aucune frontière d'erreur dans l'App Router : pas d'error.tsx, global-error.tsx, not-found.tsx (ni loading/template/default) sous app/, aucun ErrorBoundary/componentDidCatch/getDerivedStateFromError ni handler global onerror/unhandledrejection dans app/ components/ hooks/ lib/ ; `notFound()` n'est appelé nulle part. `app/layout.tsx` rend `<TopBar/>` + `<main>{children}</main>` sans filet : toute exception de rendu client (23/31 pages sont "use client", les 8 autres sont des wrappers serveur triviaux de vues clientes) fait tomber tout l'arbre sur l'écran Next par défaut, sans TopBar. Un id de projet inconnu rend un shell vide : `GET /api/projects/:id` répond 404 (`route-helpers.ts:64-66`), `requestJson` (`lib/api/client.ts:37-41`) le convertit en `{data:null}` sans throw, et `ProjectShell` (`app/projects/[projectId]/layout.tsx:70-74`, pas 77-81) fait `return` silencieusement puis rend `children`. `e2e/i18n-interface.spec.ts:25` teste déjà l'absence de « Application error » dans le body, signe que le symptôme est connu.

Aucune frontière d'erreur dans l'App Router : l'arbre de travail ne contient ni error.tsx, ni global-error.tsx, ni not-found.tsx (ni loading/template/default), aucun ErrorBoundary/componentDidCatch/getDerivedStateFromError, aucun usage de `catchError`/`unstable_rethrow`/`notFound()`, et aucune dépendance react-error-boundary. app/layout.tsx:94-96 monte TopBar + <main>{children}</main> sans filet : toute exception de rendu dans un sous-arbre client (22 des 31 page.tsx sont "use client", les 9 autres n'enveloppent que des composants client) remplace tout l'arbre par l'écran par défaut de Next, TopBar comprise. Un id de projet inconnu ne produit jamais de 404 : app/projects/[projectId]/layout.tsx:70-74 ignore l'échec de GET /api/projects/:id (qui répond pourtant 404 via getProjectOr404, app/api/projects/[projectId]/route.ts:25), et GET /api/control-desk (route.ts:123) ne reçoit aucun projectId — le desk filtre côté client (components/desk/NowDesk.tsx:73,115) et se rend avec des strates vides repliées sur leur libellé (NowDesk.tsx:50), sans message. Seule garde existante : e2e/i18n-interface.spec.ts:25 vérifie l'absence du texte « Application error », ce qui n'est pas une frontière.

**Recommandation**

Ajouter app/error.tsx (client, rendu sous la TopBar, bouton reset + lien vers /), app/global-error.tsx (au cas où le root layout lui-même casse) et app/not-found.tsx ; faire appeler notFound() par la page projet quand /api/projects/:id répond 404. Un error.tsx sous app/projects/[projectId]/ isole en plus les écrans projet du desk global.

<details><summary>Preuve relevée par l'auditeur</summary>

find app -type f \( -name 'error.tsx' -o -name 'loading.tsx' -o -name 'not-found.tsx' -o -name 'template.tsx' -o -name 'global-error.tsx' -o -name 'default.tsx' \) → vide ; rg -n "ErrorBoundary|componentDidCatch|getDerivedStateFromError" app components hooks lib → vide ; rg -n "notFound\(\)" app components → vide.

</details>

### #140 — Le package npm annoncé « publié comme CLI » (npx arij) ne peut ni se builder ni démarrer depuis son tarball

**Nature** à moitié câblé · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `package.json:19`
- `package.json:22`
- `package.json:78`
- `postcss.config.mjs:3`
- `eslint.config.mjs:5`
- `docs/specs.md:84`

**Constat**

package.json déclare `bin.arij` (L19) et une liste `files` (L22-35) ; docs/specs.md:61 et :84 promettent `npx arij`. Mais `npm pack --dry-run` (1 015 fichiers) montre : aucun `.next/` (pas dans files) et aucun script prepare/prepack/postinstall (`rg prepare|prepack|postinstall package.json` → vide) → `arij start` échoue faute de build ; `arij build` échoue sur une install prod car `next build` a besoin de tailwindcss, @tailwindcss/postcss (postcss.config.mjs:3) et typescript (next.config.ts/proxy.ts/instrumentation.ts sont en TS) qui sont tous en devDependencies (package.json:78, :92, :94). Le tarball embarque en outre eslint.config.mjs (files L35) qui importe ./eslint-rules/no-bare-jsx-copy.mjs (eslint.config.mjs:5) alors que eslint-rules/ n'est pas dans files (absent du tarball), et les scripts npm i18n:index / i18n:check pointent vers scripts/ absent lui aussi. Le README, lui, n'installe que par git clone + install.sh. La machinerie bin/files est donc à moitié câblée : elle sert le launcher local, pas une distribution.

**Précision du vérificateur**

package.json déclare `bin.arij` (L19) et `files` (L22-35), sans `private`, sans .npmignore ni job publish, et docs/specs.md:61/:84 promettent `npx arij` ; le README n'installe que par git clone + install.sh. Le tarball (`npm pack --dry-run`, 1 050 fichiers) n'embarque ni `.next/` ni script prepare/prepack/postinstall → `arij start` échoue (next-server.js:649 « Could not find a production build »). `arij build` sur une install prod échoue de façon sûre parce que app/globals.css:1-3 importe `tailwindcss`, `tw-animate-css` et `shadcn/tailwind.css` et postcss.config.mjs:3 charge `@tailwindcss/postcss`, tous en devDependencies (L78, L91, L92, L93) ; `typescript` (L94) n'est un échec sec qu'en CI ou hors ligne, Next 16 tentant sinon de l'installer lui-même (verify-typescript-setup.js:166-178). Points secondaires, sans impact runtime : eslint.config.mjs est embarqué mais importe ./eslint-rules/ absent du tarball (Next 16 ne lint plus au build, eslint est devDependency) ; les scripts npm i18n:* pointent vers scripts/ absent (l'index i18n généré est bien embarqué).

package.json déclare `bin.arij` (L19-21) et `files` (L22-35), docs/specs.md:61 et :84 promettent `npx arij`, et arji.json marque l'epic « NPM Package & CLI Distribution » (_SkKpExbeUt3) done — mais le tarball (`npm pack --dry-run`, 1 050 fichiers dans l'arbre actuel) n'est pas démarrable : pas de `.next/` (gitignoré, absent de `files`), aucun script prepare/prepack/postinstall, et bin/arij.mjs:65 lance `next start` sans vérifier le build → échec. `arij build` sur une install prod échoue aussi : app/globals.css:1-3 importe `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css` et postcss.config.mjs:3 charge `@tailwindcss/postcss`, tous en devDependencies (L78, L91-93). Nuance : `typescript` (L94) n'est pas un bloqueur dur — Next l'auto-installe hors CI (verify-typescript-setup.js:173) et transpile next.config.ts sans lui ; c'est une erreur seulement sous `isCI`. Le tarball embarque eslint.config.mjs dont l'import `./eslint-rules/no-bare-jsx-copy.mjs` (L5) manque, et les scripts `i18n:*` (package.json:50-51) pointent vers `scripts/` absent — non bloquants pour build/start (Next 16 ne lance plus ESLint au build) mais cassés dès qu'on les invoque depuis le package installé. Aucun consommateur ne rejoint `files`/`bin` public : ci.yml ne publie rien, README n'installe que par git clone + install.sh ; le `bin` ne sert que `npm run dev/start` (L41, L43), install.sh:18 et lib/claude/mcp-injection.ts. Le test __tests__/cli.test.mjs:29-40 ajouté par la rationalisation ne vérifie que 5 fichiers du tarball, pas sa capacité à builder ou démarrer.

**Recommandation**

Trancher : soit assumer la distribution git-clone seule (retirer `files`, le `bin` public et la promesse `npx arij` de specs.md), soit la rendre réelle (script `prepack: next build` + `.next` dans files, ou déplacer tailwindcss/@tailwindcss/postcss/typescript en dependencies ; retirer eslint.config.mjs de files ou y ajouter eslint-rules/ ; ajouter scripts/ ou retirer les scripts i18n du package publié). Un test type lockfile-install-consistency peut vérifier que chaque import de next.config.ts/eslint.config.mjs est couvert par `files`.

<details><summary>Preuve relevée par l'auditeur</summary>

npm pack --dry-run 2>&1 | grep -E "^npm notice [0-9.]+[kMB]+ [^/]+$" → LICENSE README components.json eslint.config.mjs instrumentation.ts next.config.ts package.json postcss.config.mjs proxy.ts tsconfig.json (pas de .next, pas d'eslint-rules, pas de scripts) ; rg -n "prepare|prepack|postinstall" package.json → vide ; rg -n "tailwindcss|typescript" package.json → lignes 78, 92, 94 sous devDependencies.

</details>

### #112 — Dépendances inversées app/api → components et cycle d'imports entre components/sessions et components/session-live

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/api/projects/[projectId]/sessions/[sessionId]/files/route.ts:14-19`
- `app/api/projects/[projectId]/prompt-anatomy/route.ts:14`
- `components/sessions/SessionOutputStream.tsx:6,14`
- `components/session-live/types.ts:16`
- `components/session-live/SessionLogTail.tsx:13`
- `components/session-live/LiveLogBand.tsx:15`

**Constat**

Deux routes API importent des types définis dans `components/` : `sessions/[sessionId]/files/route.ts:14-19` (`SessionDiff`, `SessionFilesTicket`… depuis `@/components/session-live/types`) et `prompt-anatomy/route.ts:14` (`PromptAnatomyRow` depuis `@/components/spec/spec-format`). Par ailleurs `components/sessions/` ne contient qu'un fichier, `SessionOutputStream.tsx`, consommé uniquement par `components/session-live/LiveLogBand.tsx:15` ; il ré-exporte `SessionStreamSeed` depuis `session-live/useSessionStreamPager` (:14) et `session-live/types.ts:16` + `SessionLogTail.tsx:13` réimportent ce type via `components/sessions/SessionOutputStream` — un aller-retour entre les deux répertoires pour un type qui vit déjà à côté d'eux.

**Précision du vérificateur**

Constat exact, avec deux précisions. (1) Les deux imports de routes sont `import type` : `app/api/projects/[projectId]/sessions/[sessionId]/files/route.ts:14-19` (`import type { SessionDiff, SessionDiffFile, SessionFilesProject, SessionFilesTicket } from "@/components/session-live/types"`) et `app/api/projects/[projectId]/prompt-anatomy/route.ts:14` (`import type { PromptAnatomyRow } from "@/components/spec/spec-format"`). Ils sont donc effacés à la compilation : la dépendance est de couche/typage, sans couplage runtime ni contamination du bundle client. La surface transitive est même plus large que dit — `components/session-live/types.ts:15` type-importe aussi `ArijActionItem` depuis `@/components/shared/ArijActionsList`. À noter que `components/spec/spec-format.ts:1-5` documente explicitement ce partage (« Kept out of the components so they can be unit-tested directly and so the prompt-anatomy route and the band agree on one row shape ») : c'est un choix assumé, pas un oubli — mais le contrat partagé serait mieux placé dans `lib/`. (2) L'aller-retour `components/sessions` ↔ `components/session-live` est exact et vérifié : `components/sessions/` ne contient que `SessionOutputStream.tsx` (modifié, non supprimé dans l'arbre), qui importe et ré-exporte `SessionStreamSeed` depuis `@/components/session-live/useSessionStreamPager` (:6 et :16 — le finding cite :14, la ligne réelle du ré-export est 16), tandis que `session-live/types.ts:16` et `session-live/SessionLogTail.tsx:13` réimportent ce type via `@/components/sessions/SessionOutputStream` alors qu'il est défini à `session-live/useSessionStreamPager.ts:28`. Seuls consommateurs de `components/sessions/` : `session-live/LiveLogBand.tsx:15`, `session-live/types.ts:16`, `session-live/SessionLogTail.tsx:13`, plus `__tests__/session-output-stream.test.tsx:23` et l'entrée `__tests__/react-index-keys-census.test.ts:82` (chemin en dur à mettre à jour si le fichier bouge).

**Recommandation**

Déplacer `SessionFiles*`/`SessionDiff*` et `PromptAnatomyRow` dans `lib/` (contrat partagé) ; déplacer `SessionOutputStream.tsx` dans `components/session-live/` et supprimer le répertoire `components/sessions/` ; importer `SessionStreamSeed` directement depuis `useSessionStreamPager`.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "from \"@/components/" app/api` sur le périmètre → les deux routes ci-dessus ; `ls components/sessions` → SessionOutputStream.tsx seul ; `rg -n "components/sessions/" app components hooks` → uniquement session-live (3 fichiers) et tests.

</details>

### #141 — Trois contradictions docs ↔ code : CLAUDE_PATH jamais lu, catégories de nav du README fausses, doc de rationalisation qui nie le post-traitement de build qu'elle livre

**Nature** cassé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `README.md:379`
- `README.md:82`
- `lib/piscine/nav.ts:117`
- `docs/architecture/ui-rationalisation-2026-09-10.md`
- `next.config.ts:81`
- `bin/build-traces.mjs:15`

**Constat**

(1) README.md:379-380 documente `.env.local` `CLAUDE_PATH=/usr/local/bin/claude` « Custom Claude CLI path » ; l'inventaire exhaustif `rg -o "process\.env\.[A-Z_]+" lib app bin proxy.ts instrumentation.ts next.config.ts` ne contient que ALLOWED_ORIGINS, ARIJ_REMOTE_TOKEN, ARIJ_BASE_URL, ARIJ_DB_PATH, OMP_AGENT_DIR, NODE_ENV, NEXT_RUNTIME, VITEST*, et `rg CLAUDE_PATH` hors README ne renvoie rien : un utilisateur qui suit le README règle une variable sans effet. (2) README.md:83 « Agents — Named agents, Sessions, Chat, Usage » et :82 « Work — Tickets, Spec & Memory, QA, Releases » ; lib/piscine/nav.ts (source unique, L117-168) met Chat en pill directe (TopBar.tsx:525) hors catégorie, et la catégorie Work contient aussi « QA checks » (nav.ts:141, /projects/:id/qa). (3) docs/architecture/ui-rationalisation-2026-09-10.md (non commité) affirme « Aucun post-traitement caché du build ni modification de Next n'a été ajouté » à propos de .next/server/instrumentation.js.nft.json, alors que le même diff non commité ajoute next.config.ts:81 `compiler.runAfterProductionCompile: excludeInstrumentationRuntimeFiles` (bin/build-traces.mjs, non suivi) qui réécrit précisément ce manifeste.

**Précision du vérificateur**

Deux contradictions docs ↔ code (la troisième est fausse) : (1) README.md:379-380 documente `CLAUDE_PATH=/usr/local/bin/claude` dans `.env.local`, mais aucune ligne de lib/ app/ bin/ proxy.ts instrumentation.ts next.config.ts ne lit cette variable (ni statiquement ni via `process.env[name]`), et elle n'a jamais été lue dans l'historique git ; le binaire est codé en dur « claude » (lib/claude/spawn.ts:286 et :483, lib/providers/claude-code.ts:22-24, `which claude` dans base-provider.ts:325). Un utilisateur qui suit le README règle une variable sans effet. (2) README.md:82-83 (rédigé 2026-08-31) liste « Work — Tickets, Spec & Memory, QA, Releases » et « Agents — Named agents, Sessions, Chat, Usage » ; lib/piscine/nav.ts (source unique) a depuis 27964d5d (06/09) une cinquième entrée Work `qa-checks` (L141-146, /projects/:id/qa) et, depuis dc83f4b2 (05/09), Chat n'est plus dans Agents (L152-167 = named-agents, sessions, usage ; commentaire L21-31 « Chat [is] NEVER [a] categor[y] ») mais une pill directe `href="/chat"` à components/piscine/TopBar.tsx:524-531. Le point (3) est à retirer : docs/architecture/ui-rationalisation-2026-09-10.md ne contient pas la phrase citée ; elle décrit au contraire explicitement (L65, L109-113) `next.config.ts` + `bin/build-traces.mjs` via `runAfterProductionCompile` (next.config.ts:83) comme un post-traitement du seul manifest `instrumentation.js.nft.json`, ce que fait bien bin/build-traces.mjs:15-36. Recommandation : retirer ou implémenter CLAUDE_PATH ; aligner README:82-83 sur nav.ts (« Work — Tickets, Spec & Memory, QA, QA checks, Releases », « Agents — Named agents, Sessions, Usage », Chat pill directe).

Deux contradictions README ↔ code (préexistantes, non liées au diff non commité) : (1) README.md:378-381 documente `.env.local` `CLAUDE_PATH=/usr/local/bin/claude` « Custom Claude CLI path », mais aucune lecture nulle part — ni statique (`process.env.X`) ni dynamique (bin/arij-mcp.mjs:53, lib/github/device-flow.ts:157) — et le binaire est codé en dur `nodeSpawn("claude", …)` dans lib/claude/spawn.ts:286 et :483, `return "claude"` dans lib/providers/claude-code.ts:23 : un utilisateur qui suit le README règle une variable sans effet. (2) README.md:82-83 décrit les catégories de nav en contradiction avec lib/piscine/nav.ts qu'il désigne L81 comme « single definition » : la catégorie Work (nav.ts:108-150) contient aussi « QA checks » (entry qa-checks L137-143, /projects/:id/qa, libellé Nav.json:11) absent du README ; la catégorie Agents (nav.ts:152-168) ne contient pas Chat, qui est une pill directe `DestinationPill href="/chat"` hors catégorie (components/piscine/TopBar.tsx:524-531, déjà à HEAD). Le point (3) sur docs/architecture/ui-rationalisation-2026-09-10.md est infondé dans l'arbre actuel : la phrase citée n'y figure pas, et le document décrit explicitement `bin/build-traces.mjs` et le hook `runAfterProductionCompile` (L65, L109-113) ; « Aucun fichier de Next n'est modifié » (L113) est exact, le script réécrit un artefact `.next/server/instrumentation.js.nft.json`, pas le paquet next.

**Recommandation**

Retirer le bloc CLAUDE_PATH du README (ou l'implémenter dans le provider claude si c'est voulu) ; aligner README:82-83 sur nav.ts ; corriger le paragraphe « Traçage de l'instrumentation Next » de la doc de rationalisation pour décrire bin/build-traces.mjs avant de commiter.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n CLAUDE_PATH --glob '!node_modules' . → README.md:380 uniquement ; rg -o "process\.env\.[A-Z_]+" lib app bin proxy.ts instrumentation.ts next.config.ts | sort -u → aucune CLAUDE_PATH ; sed -n 152-170 lib/piscine/nav.ts → entrées named-agents, sessions, usage ; rg -n 'href="/chat"' components/piscine/TopBar.tsx:525 ; git status → next.config.ts M, bin/build-traces.mjs ??, doc ?? ; grep « Aucun post-traitement » dans la doc, `runAfterProductionCompile` dans next.config.ts:81.

</details>

### #142 — La porte lint de la CI décrit un mécanisme de baseline qui n'existe plus : suppressions vides, règles en warn, étape d'explication morte

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `.github/workflows/ci.yml:73`
- `.github/workflows/ci.yml:81`
- `package.json:42`
- `eslint.config.mjs:27`
- `eslint-suppressions.json`

**Constat**

.github/workflows/ci.yml:73-76 explique que « ESLint runs against eslint-suppressions.json … Every rule stays at error » et l'étape L81-84 conseille `npm run lint:prune`. Or eslint-suppressions.json vaut `{}` (0 fichier), eslint.config.mjs:27-28 met react-hooks/todo et rule-suppression en "warn" (commentaire L24 : « Warnings, not errors: the gate is __tests__/react-compiler-coverage.test.ts »), et no-unused-vars est aussi en warn (L30). `npm run lint` en CI ne peut donc jamais échouer sur les 130 avertissements mesurés ; l'étape « Explain a suppressions-related lint failure » et le script package.json:42 `lint:prune` n'ont plus d'objet. La vraie porte est un test vitest du job `test`, pas du job `verify`. Ce n'est pas cassé, c'est trompeur : quelqu'un qui lit ci.yml croit à une baseline gelée.

**Précision du vérificateur**

Dérive de documentation dans .github/workflows/ci.yml : le commentaire L73-76 décrit une baseline de suppressions gelée et un « Every rule stays at error » qui ne décrivent plus l'état réel — eslint-suppressions.json vaut `{}` depuis le commit ade2a272 (baseline soldée volontairement) et eslint.config.mjs L27-31 met react-hooks/todo, rule-suppression, no-deriving-state-in-effects et no-unused-vars en "warn", la vraie porte étant __tests__/react-compiler-coverage.test.ts dans le job `test`. Conséquence : l'étape L81-84 « Explain a suppressions-related lint failure » et le script package.json:42 `lint:prune` n'ont plus d'objet tant que la baseline reste vide. CORRECTIONS au finding d'origine : (a) `npm run lint` PEUT toujours échouer — i18n/no-bare-jsx-copy (eslint.config.mjs L52) et les defaults de eslint-config-next restent en `error` ; seules les catégories passées en warn échappent à la porte ; (b) la mesure réelle est 0 erreur / 43 avertissements (40 react-hooks/todo, 3 no-img-element), pas 130 ; (c) le mécanisme de suppressions ESLint reste fonctionnel, il est juste inutilisé. Défaut purement documentaire, sans impact fonctionnel.

**Recommandation**

Réécrire le commentaire ci.yml:73-76 (« warnings tolérés, la porte React Compiler est __tests__/react-compiler-coverage.test.ts »), supprimer l'étape L81-84, le script lint:prune et eslint-suppressions.json ; ou, si une baseline est voulue, remettre les règles en error et régénérer les suppressions. Au passage : le job test exécute bien `npm test` avant `npm audit` (L27-28) — le point « audit avant test » de l'audit du 06/09 est corrigé.

<details><summary>Preuve relevée par l'auditeur</summary>

cat eslint-suppressions.json → `{}` ; rg -n '"warn"' eslint.config.mjs → L27, L28, L30 ; rg -n "suppressions|lint:prune" .github/workflows/ci.yml package.json → ci.yml:73,74,81,84 et package.json:42.

</details>

### #145 — Deux tables d'onglets de « deuxième rangée » codées séparément (settings vs agents), chacune avec un onglet qui quitte son propre layout et fait disparaître la rangée

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** app-shell-bootstrap

**Fichiers**
- `app/settings/layout.tsx:38`
- `components/agents-workshop/WorkshopHeader.tsx:41`
- `app/agents/layout.tsx`
- `app/usage/page.tsx`

**Constat**

app/settings/layout.tsx:38-44 (server component, getTranslations) et components/agents-workshop/WorkshopHeader.tsx:41-45 (client, useTranslations, monté par app/agents/layout.tsx) définissent la même structure `{ href, labelKey, exact? }` mappée vers UnderlineTabNav, avec deux implémentations du même rendu. Chacune contient un onglet hors de son arbre : Settings → /agents (L40, documenté L28-30) et Agents → /usage (L45). Or app/usage n'a pas de layout et ne rend pas WorkshopHeader (`rg -l WorkshopHeader app components` → seulement app/agents/layout.tsx) : cliquer « Usage » dans l'atelier des agents fait disparaître la rangée d'onglets, exactement l'incohérence que le commentaire de settings/layout.tsx assume pour Agents. docs/specs.md:525 décrit pourtant la rangée agents comme « Named agents · Assignments · Prompts · Limits · Usage ».

**Précision du vérificateur**

Deux tables d'onglets de « deuxième rangée » déclarées séparément — `app/settings/layout.tsx:34-44` (server, `getTranslations()`) et `components/agents-workshop/WorkshopHeader.tsx:36-46` (client, `useTranslations()`) — partagent la même forme `{href, labelKey, exact?}` et le même mapping key→label, mais alimentent déjà la même primitive de rendu `components/piscine/UnderlineTabNav.tsx` : la duplication porte sur la table + ~4 lignes de mapping, pas sur le rendu. Chaque table contient un onglet hors de son propre arbre : Settings → `/agents` (L40) et Agents → `/usage` (L45). Seul le second casse la continuité visuelle : `/agents` possède son layout qui monte `WorkshopHeader` (app/agents/layout.tsx:22), tandis que `app/usage/` n'a pas de layout (`find app -name layout.tsx` → seulement layout racine, agents, settings, projects/[projectId]) et `app/usage/page.tsx` ne rend que `<UsageScreen />`. Cliquer « Usage » dans l'atelier fait donc disparaître la rangée d'onglets, alors que `docs/specs.md:524-525` la décrit comme « Named agents · Assignments · Prompts · Limits · Usage ». Correctif utile : rattacher `/usage` sous `/agents/usage` (avec redirect) ou lui donner un layout montant la même rangée ; la factorisation d'un `SecondRowTabs` est secondaire et devra de toute façon se dédoubler server/client.

**Recommandation**

Extraire un `SecondRowTabs` piscine prenant `ReadonlyArray<{href,labelKey,exact}>` (variante server et client partageant la table), et soit déplacer /usage sous /agents/usage (avec redirect), soit retirer l'onglet Usage de WorkshopHeader et le laisser à la nav globale.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n 'href: "/' app/settings/layout.tsx components/agents-workshop/WorkshopHeader.tsx → deux tables parallèles ; rg -l WorkshopHeader app components → app/agents/layout.tsx uniquement ; find app -name layout.tsx → pas de app/usage/layout.tsx.

</details>

### #205 — Docs d'architecture non alignées sur la rationalisation : useKanban « non monté » alors qu'il est supprimé, composants kanban listés qui n'existent plus, plan de cleanup 2026-08-14 à archiver

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:orphan-small-domains-and-docs

**Fichiers**
- `docs/architecture/ticket-state-machine.md:60-62`
- `docs/architecture/ticket-state-machine.md:167`
- `docs/architecture/full-auto-mode.md:196-199`
- `docs/specs.md:630-632`
- `docs/specs.md:849`
- `docs/plans/2026-08-14-cleanup-refactor-plan.md:31`
- `docs/plans/2026-08-14-cleanup-refactor-plan.md:173`

**Constat**

Après la suppression de hooks/useKanban.ts, QuickCapture.tsx, GitSyncBadge.tsx (D dans l'arbre) : (1) ticket-state-machine.md:60-62 et :167 disent que la route POST /epics/reorder a « un client, hooks/useKanban.ts… exercé seulement par les tests » — le hook et ses tests (use-kanban-move/sort/stale) sont supprimés, la route n'a plus aucun client ; (2) full-auto-mode.md:196-199 même phrase (« lived in hooks/useKanban.sortColumnByPriority, and no screen mounts that hook ») — l'autre agent a modifié ce fichier (paragraphe composite parking) sans toucher cette ligne ; (3) specs.md:630-632 liste `QuickCapture` et `GitSyncBadge` comme « ce qui reste » de components/kanban/ — les deux sont supprimés ; l'autre agent a mis à jour specs.md:86 (dnd-kit) mais pas l'arbre §… ; specs.md:849 cite `stream-parser.ts` qui n'a jamais existé (lib/claude/json-parser.ts) ; (4) docs/plans/2026-08-14-cleanup-refactor-plan.md : 41 chemins en backticks vers des fichiers absents (ce sont des items [x] décrivant des suppressions faites) et seulement 2 items ouverts ([ ] l.31 décision arji.json, [ ] l.173 migration chat cutover — encore ouvert d'après l'audit voisin) : c'est un compte-rendu, plus un plan. ticket-state-machine.md:215 (`__tests__/epic-card.test.tsx`, commit 99e2de3) et specs.md:410 (Sidebar « supprimé ») sont des mentions historiques correctes. docs/architecture/ui-rationalisation-2026-09-10.md ne mentionne aucune mise à jour de ces documents.

**Précision du vérificateur**

Dérive documentaire réelle, confirmée : (1) ticket-state-machine.md:59-62 et :167 décrivent `hooks/useKanban.ts` comme le client « non monté » de POST /epics/reorder et disent la route « exercée seulement par les tests » — le hook et ses trois tests use-kanban-* sont supprimés dans l'arbre, la route n'a plus qu'un test de route (__tests__/epics-reorder-route.test.ts) et zéro client produit ; (2) full-auto-mode.md:196-198 répète la même phrase, et le diff de l'autre agent sur ce fichier ne touche que le §382 (paragraphe « composite parks ») ; (3) specs.md:630-632 liste encore `QuickCapture` et `GitSyncBadge` alors que components/kanban/ ne contient plus que BugCreateDialog, EpicCreateDialog, InlineEdit, RefinementButton et RefinementDialog (la recommandation de l'auditeur oublie RefinementDialog.tsx) ; specs.md:849 cite `stream-parser.ts`, fichier jamais créé (git log --diff-filter=A vide), mais c'est un nom de module *proposé* dans une case « mitigation » d'un tableau de risques, pas une référence à du code censé exister — le module réel est lib/claude/json-parser.ts ; (4) docs/plans/2026-08-14-cleanup-refactor-plan.md est bien devenu un compte-rendu (57 items [x], 2 seulement ouverts : l.31 décision arji.json, l.173 retrait de runUnifiedChatCutoverMigrationOnce toujours appelé depuis app/api/projects/[projectId]/conversations/route.ts:42), avec ~36-40 chemins en backticks introuvables — et non 41, le script de l'auditeur comptant quelques faux positifs de tokenisation. docs/architecture/ui-rationalisation-2026-09-10.md ne signale aucune reprise de ces trois documents.

**Recommandation**

Réécrire les trois passages (« route sans aucun client — candidate à la suppression », arbre components/kanban réduit à EpicCreateDialog/BugCreateDialog/InlineEdit/RefinementButton, remplacer stream-parser.ts par lib/claude/json-parser.ts) ; déplacer le plan 2026-08-14 sous docs/plans/archive/ et reporter ses deux items ouverts dans un ticket ou dans le doc de rationalisation.

<details><summary>Preuve relevée par l'auditeur</summary>

`git status --porcelain` → ` D hooks/useKanban.ts`, ` D components/kanban/QuickCapture.tsx`, ` D components/kanban/GitSyncBadge.tsx`, ` D __tests__/use-kanban-*.test.ts` ; script node de résolution des backticks (avec recherche par basename, fichiers D exclus) → ticket-state-machine.md 2 chemins manquants (useKanban ×2), specs.md 2 (Sidebar historique, stream-parser.ts), plan 41 ; `git diff docs/specs.md docs/architecture/full-auto-mode.md` → seules les lignes 86 (dnd-kit) et le paragraphe « composite parks » sont modifiées.

</details>

