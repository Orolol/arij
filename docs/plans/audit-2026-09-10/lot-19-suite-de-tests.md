# Lot 19 — Suite de tests : harnais partagés, attentes temporisées, doublons

**Difficulté** 2/4 — Moyen
**Findings** 12 (0 fort · 6 moyen · 6 faible ; effort 2 S · 9 M · 1 L)
**Dépendances** Indépendant, mais à faire après les lots qui suppriment des modules (01, 02, 04, 10, 17) pour ne pas consolider des tests voués à disparaître.

**Statut** fait le 11/09/2026 — 9/12 findings traités, 3 différés avec raison
(voir plus bas). Sur l'arbre `45e96387` + rationalisation UI non commitée.

*Mesures* : appels à `flushBackground()` **114 → 0** ; `claudeEnvelope`
**8 → 1** ; `createFakeChild` **7 → 1** ; `class MockEventSource` **8 → 1** ;
blocs `vi.mock("@/lib/db")` recopiés **26 → 6** (les 6 restants tiennent un
holder direct, pas le harnais) ; cartes de schéma factices **12 → 6** ;
harnais de migration `tempDbPath` **6 → 1**, `withDb` **9 → 6** (les 5 restants
portent l'`initDb` de leur suite) ; mocks `next/navigation` à la main
**66 → 54**, dont **12** passés au harnais. Sept harnais neufs dans
`__tests__/helpers/`.

- **#160** (fait) — les 114 appels et leurs 14 définitions locales ont disparu.
  La racine du problème n'était pas la durée mais le contrat : `settled` est
  désormais exposé par les quatre dispatches qui ne le renvoyaient pas
  (`dispatchDreamingSession`, `dispatchMemoryDistillSession`,
  `dispatchSpecUpdateSession`, `dispatchSpecAutoRewriteSession`) et par les trois
  déclencheurs (`maybeDreamAfterNightRun`, `maybeAutoDistillAfterSessionTerminal`,
  `maybeAutoRewriteSpecAfterRelease`) ; il résout APRÈS le hook terminal et ne
  rejette jamais — `dispatchBackgroundSession` l'avait déjà. Là où il n'y a pas
  de poignée (la fermeture d'une route, le filet de sécurité du scheduler), le
  test attend l'effet observable via `waitForBackground(effect, label)` de
  `helpers/background.ts`, qui nomme ce qu'il attend au lieu de dormir.
- **#164** (fait) — les deux `vi.mock` morts sont supprimés. Surtout, un
  test-gardien mécanique, `__tests__/vi-mock-specifiers-resolve.test.ts`,
  résout chaque `vi.mock("@/…")` sur disque (lignes de commentaire exclues,
  `VIRTUAL` vide) : un `vi.mock` dont le module n'est jamais importé est ignoré
  SILENCIEUSEMENT par vitest, donc le test reste vert et la garde n'existe pas.
  Il a immédiatement attrapé un troisième cas, écrit entre-temps par un autre
  lot (`@/lib/claude/logger`, module supprimé).
- **#163** (fait) — `lib/kanban/filters.ts`, `lib/kanban/reorder.ts` et leurs
  deux tests supprimés ; la phrase de `CLAUDE.md` sur `lib/kanban/` ne cite plus
  « filters ». Le contrat normatif de `epics.position` que `reorder.ts` portait
  (et que deux commentaires citaient) est relogé dans l'en-tête de
  `lib/workflow/reorder.ts`, le module qui l'écrit réellement.
- **#158** (fait pour l'essentiel) — `liveDbModule(holder, extras?)` remplace
  les 8 lignes du bloc `testDb` + getters recopiées dans **24** fichiers ;
  il lit le holder à chaque accès, donc échanger l'instance dans `beforeEach`
  continue de marcher. Les **6** cartes de schéma factices qui étaient
  purement inutiles sont supprimées (schéma réel + chaîne mockée : prouvé vert).
  Les **6** restantes sont CONSERVÉES : leurs tests s'appuient dessus
  (leur recorder indexe des objets de table JSON-stringifiés, ou leur mock
  `drizzle-orm` expose `sql`/`count` qu'ils inspectent) — les migrer demanderait
  de réécrire leurs assertions, ce que le finding ne demande pas.
- **#159** (fait en partie) — `helpers/provider-fixtures.ts` (une seule
  `claudeEnvelope(text, { costUsd })`, la clé `total_cost_usd` n'étant ajoutée
  que si elle est fournie, ce que le code en aval distingue) et
  `helpers/fake-child.ts` (l'UNION des 7 fausses ChildProcess, qui avaient
  divergé : cinq exposaient `pid`/`exitCode`/`signalCode`, deux non ; trois
  pouvaient pousser du stderr, quatre non). Les `seedProject` ×29 restent
  locaux : leurs corps vont de 3 à 34 lignes et sèment souvent epics/stories/
  sessions en plus — le vérificateur du finding le notait déjà, et les fondre
  dans un helper à options produirait un cadre plus long que les copies.
- **#167** (fait en partie) — `helpers/next-navigation-mock.ts` (toute la
  surface : cinq méthodes de routeur, les trois hooks, `redirect`/`notFound`
  qui LÈVENT) et `helpers/event-source-mock.ts` (l'union du stub de 6 lignes et
  de la variante de la page mémoire, plus `instances`/`emitEvent`).
  **12** fichiers de mocks de navigation et **8** copies d'`EventSource`
  migrés. Les 54 mocks de navigation restants déclarent une à deux clés et
  sont plus courts que l'appel au harnais : les convertir ajouterait des lignes.
  Les 8 fichiers qui font encore `new NextRequest(...)` n'ont pas été migrés
  (`mockNextRequest` n'ajoute rien qu'un alias).
- **#161** (fait en partie) — `helpers/migration.ts` : `tempDir`, `tempDbPath`,
  `withDb`, `withMigratedDb`, `cleanupTempDirs`, `tableNames`, `columnNames`,
  `indexList`, `indexColumns`, `appliedMigrationTimestamps`,
  `MIGRATIONS_FOLDER`. Six suites migrées, neuf copies supprimées.
  `__tests__/migrations-journal.test.ts` porte désormais une fois les
  invariants GLOBAUX (le `when` strictement croissant le long du journal, `idx`
  = position, pas de doublon de tag ni de `when`, chaque tag a son `.sql`, les
  snapshots figés à 0013, chaque entrée de `POST_BASELINE_COLUMN_MIGRATIONS`
  référence un `when` réel) et les copies correspondantes ont été retirées de
  trois suites ; chaque suite de migration garde ce qu'elle seule peut dire
  (le DDL, les colonnes, les données préservées, l'idempotence).
- **#166** (fait en partie) — `react-compiler-namespaced-hooks` importe
  `sourceFiles` du helper au lieu de sa copie locale (qui ne filtrait pas les
  `.test.*`, divergence qui n'était voulue nulle part), et
  `topbar-react-compiler-bail` construit son ESLint par `createEslint()`
  partagé. `topbar-react-compiler-bail` N'EST PAS fusionné dans le balayage :
  le fichier dit maintenant pourquoi — ce qu'il ajoute, ce sont deux assertions
  SOURCE qu'aucune sonde ne peut faire (`"use no memo"`, un `eslint-disable`
  global, tous deux invisibles aux règles sur 7.0.1).
- **#168** (fait) — `helpers/temp-git-repo.ts` : `makeRepository`,
  `makeRepositoryWithGitHubRemote`, `makeBareRepository` (avec `remote: ""`
  pour le cas « pas de remote », qui est un fixture légitime), `makePlainDirectory`,
  `makeMissingPath`, `makeTempRoot`, `git`, `gitOutput`. `makePlainDirectory`
  LÈVE si le répertoire est dans un dépôt : c'était le piège recopié dans trois
  fixtures, où une assertion « pas un dépôt » devient vraie pour une raison que
  le test ne nomme pas. Quatre suites migrées.

**Différé, avec raison** :

- **#162** (harnais ticket-overlay / UnifiedChatPanel / chat-stream) — les trois
  familles vivent dans les fichiers qu'un autre lot réécrit en ce moment
  (`components/ticket/*`, chat) : figer leurs 13 `vi.mock` pendant que la liste
  change produirait exactement la dette que le lot supprime. À reprendre quand
  ces surfaces sont stables.
- **#165** (assertions de tokens responsive) — le vérificateur du finding a
  montré que « les moitiés unitaires se rabattent sur des tokens » ne vaut que
  pour 4 fichiers sur 9 : les cinq autres portent du comportement et de l'a11y
  sans équivalent e2e (12 `it` pour desk-mobile-layout, 9 pour qa-mobile-layout,
  9 pour top-bar). Supprimer les assertions de tokens fait gagner quelques
  dizaines de lignes, pas 1 500 ; les fichiers entiers, eux, couvrent autre
  chose. À traiter avec la fixture e2e commune (`e2e/fixtures/viewports.ts`),
  qui est le vrai gain et n'existe pas encore.
- **#169** (un fichier de test par module, régression en `describe`) — 36 à 68
  fichiers concernés selon le périmètre, et les familles visées
  (`tickets-registry-*`, `chat-*`, `sessions-list-*`) sont précisément celles
  que les lots 08/09/10 remanient. Consolider maintenant, c'est déplacer des
  fichiers deux fois. À faire une fois ces lots rendus.
- **#166**, volet « sortir les gardes lint-shaped du chemin chaud de vitest » —
  non fait : ces suites sont la SEULE chose qui exécute ces règles (aucun job CI
  ne les lance, et `npm run lint` applique le baseline de suppressions dans la
  CLI, pas dans la classe `ESLint`). Les déplacer sans le job CI équivalent
  supprimerait la garde. Le finding le dit lui-même : « ne rien supprimer sans
  remplacement ».

## Décision

Un harnais par famille dans __tests__/helpers ; plus aucun setTimeout d'attente dans les tests de dispatch ; l'e2e est le contrat de layout, l'unitaire garde le comportement/a11y.

## Objectif

mockDbModule(testDb), helpers/seed.ts, helpers/fake-child.ts, helpers/migration.ts + un migrations-journal.test.ts table-driven, harnais ticket-overlay / unified-chat / chat-stream, remplacement des 113 flushBackground par l'attente de la promesse de fond ou vi.waitFor, réduction des tests responsive unitaires, fusion des tests not-a-repository, suppression des deux vi.mock morts, regroupement des méta-tests, consolidation des 50 fichiers à 1-2 tests.

## Démarche suggérée

1. Commencer par flushBackground (source de flakes) : exposer la promesse de fond via un hook de test dans dispatchBackgroundSession.
2. Puis les harnais (gain de lignes le plus visible), en gardant la suite verte à chaque étape (npm run test:changed).
3. Chiffrer avant/après (lignes, durée).

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #158 — Le harnais `vi.mock("@/lib/db")` est recopié à la main dans 38 fichiers, dont 12 avec des cartes de colonnes factices que le helper interdit lui-même

**Nature** gras de tests · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/helpers/db-mock.ts:1-60`
- `__tests__/usage-route.test.ts:1-20`
- `__tests__/refinement-mcp-routes.test.ts:35-50`
- `__tests__/epics-route.test.ts:27-70`
- `__tests__/project-patch-default-branch.test.ts:14-28`
- `__tests__/build-route.test.ts`
- `__tests__/auto-merge-agent.test.ts`
- `__tests__/epic-lifecycle-status.test.ts`
- `__tests__/transition-service.test.ts`
- `__tests__/agent-launch-concurrency-routes.test.ts`
- `__tests__/sessions-resumable-route.test.ts`

**Constat**

`__tests__/helpers/db-mock.ts` (313 l., importé par 170 fichiers) existe précisément pour remplacer deux motifs recopiés ; ils survivent pourtant. (a) 26 fichiers portent le même bloc `const testDb = vi.hoisted(...)` + `vi.mock("@/lib/db", () => ({ get db() {...}, get sqlite() {...} }))` (10 lignes identiques, ex. usage-route.test.ts:1-20, refinement-mcp-routes.test.ts:35-50, refinement-merge-discard-create.test.ts:44-60). (b) 12 fichiers (4 210 lignes au total) mockent encore `@/lib/db/schema` avec une carte `{ id: "id", projectId: "projectId", ... }` écrite à la main (epics-route.test.ts:27-70, project-patch-default-branch.test.ts:14-28, build-route, auto-merge-agent, epic-lifecycle-status, transition-service, …) — exactement le motif dont l'en-tête de db-mock.ts (lignes 5-9) dit « fake maps let column renames pass tests while breaking prod ». Un renommage de colonne dans lib/db/schema.ts passe vert dans ces 12 fichiers.

**Précision du vérificateur**

Le harnais `vi.mock("@/lib/db")` est recopié à la main dans 39 fichiers de test (pas 38), dont 12 avec des cartes de colonnes factices que le helper interdit lui-même. `__tests__/helpers/db-mock.ts` (311 l., importé par 172 fichiers) existe pour remplacer ces deux motifs ; ils survivent. (a) **27** fichiers (pas 26) portent le bloc `const testDb = vi.hoisted(...)` + `vi.mock("@/lib/db", () => ({ get db() {...}, get sqlite() {...} }))` — 19 d'entre eux octet pour octet identiques (usage-route.test.ts:5-20, refinement-mcp-routes.test.ts:35-50, refinement-merge-discard-create.test.ts:45-60), les 8 autres le même corps de getters à une const intercalée près ou réduit au seul `get db()`. (b) **12** fichiers de test (4 210 lignes au total — le 13e hit du grep est le commentaire d'en-tête de db-mock.ts lui-même) mockent encore `@/lib/db/schema` avec une carte `{ id: "id", … }` écrite à la main : process-manager, build-route:88, ticket-activity-integration:52, projects-route:41, sessions-resumable-route:59, agent-concurrency-helper:15, epic-lifecycle-status:117, auto-merge-agent:78, project-patch-default-branch:14-27, transition-service:37, agent-launch-concurrency-routes:69, epics-route (carte l.24-90, branchée l.214) — exactement le motif dont l'en-tête de db-mock.ts (l.7-10, pas 5-9) dit « fake maps let column renames pass tests while breaking prod ». Comme `@/lib/db` y est aussi un chain mock qui ignore ses arguments, un renommage de colonne dans `lib/db/schema.ts` passe vert dans ces 12 fichiers. `dbModuleMock()` est à la l.231 et `actualDbSchema()` à la l.255 (pas 233/257) ; `lib/db/test-utils.ts` (50 l.) n'exporte bien que `createTestDb()` (l.44).

**Recommandation**

Ajouter `mockDbModule(testDb)` à côté de `createTestDb()` dans `lib/db/test-utils.ts` (ou `helpers/db-mock.ts`) et remplacer les 26 blocs ; migrer les 12 cartes factices vers `actualDbSchema()` selon la recette déjà écrite dans db-mock.ts (section B). Gain ≈ 500-800 lignes et suppression d'un faux-vert structurel sur les renommages de colonnes.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -l 'get db\(\)' __tests__ --glob '*.test.*' | wc -l` → 26 ; `rg -l 'vi\.mock\("@/lib/db/schema",\s*\(\)\s*=>\s*\(\{' __tests__` → 12 fichiers, 4 210 lignes ; db-mock.ts exporte déjà `dbModuleMock()`, `actualDbSchema()` (lignes 233, 257) ; `lib/db/test-utils.ts` (50 l.) ne fournit que `createTestDb()`.

</details>

### #159 — Aucun seeding partagé : seedProject ×30, seedSession ×16, seedEpic ×14, createFakeChild ×8, claudeEnvelope ×8 — corps quasi identiques

**Nature** gras de tests · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/dreaming-route.test.ts`
- `__tests__/memory-route.test.ts`
- `__tests__/night-run-engine.test.ts`
- `__tests__/spec-update-dispatch.test.ts:26-45`
- `__tests__/memory-distill-dispatch.test.ts:37-55`
- `__tests__/providers.test.ts`
- `__tests__/agy-provider.test.ts`
- `__tests__/pipeline-stages-dispatch.test.ts`
- `lib/db/test-utils.ts`

**Constat**

`createTestDb()` est mutualisé (145 fichiers) mais tout ce qui vient après est réécrit localement. `seedProject` est défini dans 30 fichiers ; dreaming-route.test.ts et memory-route.test.ts ne diffèrent que par le préfixe d'id (`proj-dream-route-` / `proj-mem-route-`). `claudeEnvelope` (`JSON.stringify({type:"result",subtype:"success",result})`) est copié dans 8 fichiers de dispatch, dont un seul ajoute `total_cost_usd`. `createFakeChild` (fausse ChildProcess avec stdout/stderr/on/kill/emitStdout/emitClose) est copié dans 8 tests de providers avec des variantes qui divergent silencieusement (providers.test.ts a pid/exitCode/signalCode, agy-provider.test.ts non). Le mock `processManager` des 6 tests de dispatch (spec-update, memory-distill, dreaming, pipeline-forensic, spec-auto-rewrite, dispatch-background-session) est le même bloc de 9 lignes.

**Précision du vérificateur**

Aucun seeding partagé au-delà de `createTestDb()` : `lib/db/test-utils.ts` n'exporte que la création de base, et `__tests__/helpers/` (9 fichiers existants) ne contient ni seed, ni fausse ChildProcess, ni enveloppe Claude. `seedProject` est redéfini localement dans 30 fichiers, `seedSession` dans 16, `seedEpic` dans 14 — mais les corps ne sont pas « quasi identiques » : ils vont de 3 lignes (dashboard-summary-route) à 34 (agent-scheduler-routes) et sèment souvent epics/stories/sessions en plus ; c'est le noyau « compteur d'id + insert projects » qui est répété. Le cas exact cité est vrai : dreaming-route.test.ts et memory-route.test.ts ont un seedProject de 6 lignes strictement identique sauf le préfixe d'id. `claudeEnvelope` est copié dans 8 fichiers sous deux formes ; contrairement au finding, ce sont TROIS fichiers (dispatch-background-session, dreaming-dispatch, memory-distill-dispatch) qui portent la variante `total_cost_usd`, pas un seul. `createFakeChild` est copié dans 8 fichiers qui ne sont pas tous des tests de providers (claude-spawn-logging, mcp-injection, named-agent-options-spawn, oversized-prompt-transport inclus) ; la divergence pid/exitCode/signalCode entre providers.test.ts et agy-provider.test.ts est réelle mais délibérée et commentée (« Real ChildProcess fields the kill path reads »), agy et pi n'exerçant aucun chemin kill — ce n'est donc pas une divergence silencieuse. Le mock `processManager` de 9 lignes est identique dans 5 fichiers seulement (spec-update-dispatch:26-34, memory-distill-dispatch:37-45, dreaming-dispatch:31-39, pipeline-forensic-dispatch:30-38, spec-auto-rewrite-dispatch:29-37) ; le 6e cité, dispatch-background-session.test.ts:48-59, est un mock différent et plus riche. Gain de mutualisation réel mais nettement inférieur aux ~1 000 lignes annoncées.

**Recommandation**

Créer `__tests__/helpers/seed.ts` (seedProject/seedEpic/seedStory/seedSession avec options et compteur d'id), `helpers/fake-child.ts` (une seule fausse ChildProcess complète) et `helpers/claude-envelope.ts` (+ `mockProcessManager()`), puis migrer fichier par fichier. Gain ≈ 1 000 lignes ; surtout, un changement de forme de ligne (colonne NOT NULL ajoutée) ne demandera plus 30 éditions.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -l '^(async )?function seedProject\b' __tests__ | wc -l` → 30 ; seedSession → 16 ; seedEpic → 14 ; `awk '/function seedProject/,/^}/'` sur dreaming-route et memory-route : corps identiques au préfixe près ; `awk '/function claudeEnvelope/,/^}/'` sur spec-update-dispatch / pipeline-stages-dispatch : même corps ; createFakeChild : providers.test.ts vs agy-provider.test.ts diffèrent (pid/exitCode/signalCode présents d'un côté seulement).

</details>

### #160 — 113 appels à `flushBackground()` = deux `setTimeout(25)` réels chacun : 5,6 s de sommeil incompressible et des attentes temporisées de la même famille que le flake refinement-button

**Nature** risque · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/spec-update-dispatch.test.ts`
- `__tests__/dreaming-dispatch.test.ts`
- `__tests__/memory-distill-dispatch.test.ts`
- `__tests__/pipeline-forensic-dispatch.test.ts`
- `__tests__/build-route.test.ts`
- `__tests__/epic-lifecycle-status.test.ts:281-282`
- `__tests__/session-status-integration.test.ts`
- `__tests__/mcp-server-probe.test.ts:150-167`
- `__tests__/refinement-button.test.tsx:168-200`

**Constat**

14 fichiers définissent le même `async function flushBackground() { await sleep(25); await sleep(25); }` et l'appellent 113 fois : ≥ 5 650 ms de mur par run rien que pour ces attentes, et une hypothèse implicite « 50 ms suffisent pour que le dispatch en arrière-plan ait écrit » — c'est exactement le raisonnement qui a produit le flake de refinement-button (budget de 10 ms). 45 autres sommeils réels ≥ 10 ms existent (session-status-integration ×5 à 50 ms, epic-lifecycle-status ×2 à 100 ms, documents-upload-platform-body-cap 200 ms, mcp-server-probe 300 ms + `expect(elapsed).toBeLessThan(8000)`). À noter : le flake refinement-button lui-même est CORRIGÉ dans l'arbre de travail non commité (diff : le `delayMs: 10` est remplacé par un deferred `confirmDispatch()` que le test résout) — à commettre.

**Précision du vérificateur**

14 fichiers de __tests__ définissent chacun leur propre `flushBackground()` à base de setTimeout réels (aucun fake timer) : 9 en 25+25 ms, build-route 50+50, epic-lifecycle-status 100+100 (l.280-283), pipeline-start-run et pipeline-onterminal 4×10, night-batch-route 4×20, build-route-dag 5×20. 113 appels au total, soit 7 620 ms de sommeil cumulé (1 800 ms rien que dans epic-lifecycle-status, 1 400 dans dreaming-dispatch) — coût cumulé, pas mur, la suite tournant sur 4 workers. Chaque appel suppose que le travail lancé en arrière-plan par la route/le dispatch (ex. POST build route puis lecture de la base, epic-lifecycle-status:320-325) a fini dans ce délai fixe : même famille que le flake refinement-button (budget 10 ms, 5/12 sous charge). 21 autres sommeils fixes ≥ 10 ms existent hors de ces fichiers (session-status-integration ×5 à 50 ms l.80-170, documents-upload-platform-body-cap:385 à 200 ms, mcp-server-probe:166 à 300 ms + `expect(elapsed).toBeLessThan(8000)` l.161). Le fix refinement-button (deferred `confirmDispatch()` à la place de `delayMs: 10`) est présent dans le diff non commité et reste à commettre. Recommandation inchangée : exposer/retourner la promesse du travail en arrière-plan ou `vi.waitFor` sur l'effet observable, helper centralisé.

14 fichiers de tests définissent chacun un `flushBackground()` local à base de `setTimeout` réels (9 en 25+25 ms, 2 en 4×10, 1 en 4×20, 1 en 5×20, 1 en 50+50, 1 en 100+100) appelé 113 fois : 7 620 ms d'attente inactive cumulée (sérielle par fichier, répartie sur 4 workers vitest, donc pas 7,6 s de mur de suite ; epic-lifecycle-status 1,8 s et dreaming-dispatch 1,4 s à eux seuls). 22 autres sommeils réels ≥ 10 ms existent (session-status-integration ×5 à 50 ms, documents-upload-platform-body-cap 200 ms, mcp-server-probe 300 ms + `expect(elapsed).toBeLessThan(8000)`, refinement-button.test.tsx:476 à 100 ms). Contrairement à refinement-button, ces sommeils ne sont pas en course contre un timer : le process-manager est mocké « completed » immédiat et la chaîne d'arrière-plan est purement micro-tâches, donc le risque de flake est faible ; le coût est du temps perdu et une duplication. `dispatchBackgroundSession` expose déjà `settled` (lib/agent-sessions/dispatch-background-session.ts:221-232) — il suffit que dreaming/spec-update/memory-distill le propagent pour que les tests l'attendent. Le fix refinement-button (deferred à la place de `delayMs: 10`) est bien présent, non commité.

**Recommandation**

Faire retourner (ou exposer via un hook de test) la promesse du travail en arrière-plan et l'attendre, ou utiliser `vi.waitFor` sur l'effet observable (ligne en base) à la place d'un sommeil fixe ; centraliser dans `helpers/background.ts`. Commettre le fix de refinement-button.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -c 'await flushBackground\(\)' __tests__ | awk` → 113 appels ; `awk '/function flushBackground/,/^}/'` identique dans spec-update-dispatch, dreaming-dispatch, memory-distill-dispatch, pipeline-forensic-dispatch ; `rg -n 'setTimeout\([a-z]*, ?[0-9]{2,}\)' __tests__ | wc -l` → 45 ; `git diff __tests__/refinement-button.test.tsx` montre le remplacement de `delayMs: 10` par un deferred.

</details>

### #161 — 12 tests de migration (3 378 lignes) recopient mot pour mot le même harnais et les mêmes 4 invariants de journal

**Nature** gras de tests · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/core-table-indexes-migration.test.ts:1-70`
- `__tests__/project-clone-source-migration.test.ts:1-70`
- `__tests__/agent-session-review-verdict-migration.test.ts:95-130`
- `__tests__/notification-message-migration.test.ts:95-130`
- `__tests__/desk-dismissal-migration.test.ts:53`
- `__tests__/named-agent-escalation-removal.test.ts:50`
- `__tests__/agent-session-estimated-tokens-migration.test.ts:37`
- `__tests__/db-init.test.ts`
- `__tests__/db-init-foreign-keys.test.ts`

**Constat**

Chaque test de migration recopie le bloc `MIGRATIONS_FOLDER` + lecture de `meta/_journal.json` + `tempDbPath()` + `withDb()` + `columnNames()` (vérifié identique entre core-table-indexes-migration et project-clone-source-migration), puis ré-asserte les mêmes invariants génériques sous des titres identiques : « is a hand-written journal migration with a unique increasing timestamp » (3 fichiers), « leaves the drizzle-kit snapshots untouched (generate must not be run) » (3), « is listed in POST_BASELINE_COLUMN_MIGRATIONS » (2), « mirrors the column in lib/db/schema.ts » (2), « applies cleanly on an existing database that predates it » (2). L'invariant « le journal est croissant et les snapshots figés à 0013 » est global, pas par migration : le tester N fois n'ajoute rien.

**Précision du vérificateur**

Le harnais de test des migrations est bien dupliqué, mais le périmètre est plus étroit qu'annoncé : 10 fichiers par migration (2 212 lignes), et non 12 fichiers / 3 378 lignes — le compte `rg -l MIGRATIONS_FOLDER` englobe `__tests__/db-init.test.ts` (572 l.), qui est le propriétaire légitime des invariants globaux, et `__tests__/mcp-servers-crud.test.ts` (594 l.), un test CRUD sans harnais. La duplication n'est pas universelle : `function tempDbPath` apparaît dans 6/12 fichiers, `function withDb` dans 9/12, `function columnNames` dans 5/12 ; `epic-done-story-repair-migration.test.ts` n'en définit aucune. `__tests__/db-init-foreign-keys.test.ts`, cité dans la liste, ne contient aucune occurrence de MIGRATIONS_FOLDER ; en revanche `agent-sessions-epic-cost-index-migration.test.ts`, `named-agent-options-migration.test.ts` et `epic-done-story-repair-migration.test.ts` en contiennent et sont omis. Le cœur du finding est renforcé par une preuve que l'auditeur n'avance pas : `__tests__/db-init.test.ts:452-478` (« orders migrations by a strictly increasing `when` », « gives every migration a unique tag, timestamp and file ») et `:541` (« keeps the journal and the migration files in step ») couvrent déjà globalement les invariants que chaque fichier de migration re-teste ; les corps des trois tests « leaves the drizzle-kit snapshots untouched » sont identiques au littéral de tag près, commentaire compris. Le gain « ≈ 1 000 lignes » n'est étayé par aucun calcul (45 % du périmètre réel).

**Recommandation**

`helpers/migration.ts` (tempDbPath/withDb/columnNames/readJournal/applyUpTo) + un unique `migrations-journal.test.ts` table-driven pour les invariants globaux (idx/when croissants, snapshots intacts, POST_BASELINE cohérent, colonnes miroir du schéma) ; chaque fichier de migration ne garde que ses assertions propres (index créés, données préservées). Gain ≈ 1 000 lignes.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -l MIGRATIONS_FOLDER __tests__ | wc -l` → 12, 3 378 lignes ; `diff <(sed -n 1,70p core-table-indexes-migration.test.ts) <(sed -n 1,70p project-clone-source-migration.test.ts)` : seules les constantes MIGRATION_TAG/NEW_COLUMNS diffèrent ; extraction des titres partagés (scratchpad titles.mjs) liste les 5 titres ci-dessus.

</details>

### #162 — Trois familles de tests de composants portent plus de 50 % de préambule de mocks identique : ticket-overlay (9 fichiers), UnifiedChatPanel (8), chat/stream route (4)

**Nature** gras de tests · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/ticket-overlay.test.tsx:1-227`
- `__tests__/ticket-overlay-git.test.tsx:1-213`
- `__tests__/ticket-overlay-capabilities.test.tsx:1-204`
- `__tests__/ticket-verify-band.test.tsx:1-239`
- `__tests__/unified-chat-panel-shell.test.tsx:1-122`
- `__tests__/chat-concurrency.test.tsx:1-93`
- `__tests__/chat-stream-route.test.ts:1-110`
- `__tests__/chat-stream-route-openai.test.ts:1-152`
- `__tests__/chat-stream-route-openai-tools.test.ts:1-263`
- `hooks/useTicketOverlayData.ts:40-50`

**Constat**

ticket-overlay-* + ticket-verify-band : 3 216 lignes, dont ≈ 1 665 avant le premier `describe`/`it` (204/511, 213/591, 217/265, 227/523, 239/377…) ; 7 des 9 fichiers déclarent le même bloc de 13 `vi.mock` (`@/hooks/useEpicDetail`, `useEpicPr`, `useGitHubConfig`, `useProjectEvents`, `useTicketComments`, `@/components/review/DiffViewer`, `@/lib/agent-sessions/session-list`…) et un `renderSubject()` local. UnifiedChatPanel : 8 fichiers (3 285 l.) avec le même jeu de 8 mocks (MessageInput, MessageList, QuestionCards, useChat, useConversations, useEpicCreate, useProvidersAvailable, next/navigation), préambules 81 à 197 lignes. chat-stream-route × 4 : 2 814 lignes sur une seule route, préambules 110/152/263/132 avec les mêmes 7-9 mocks. Un changement de la liste de hooks de `useTicketOverlayData.ts` demande 7 éditions synchrones.

**Précision du vérificateur**

Duplication de préambule de mocks avérée dans trois familles de tests, mais le seuil « > 50 % » ne vaut que pour ticket-overlay. Mesuré : (1) ticket-overlay* + ticket-verify-band, hors ticket-overlay-derive.test.ts (525 l., aucun mock, logique pure) = 9 fichiers / 3 238 l., dont 1 665 l. avant le premier test (51 %) ; 4 fichiers (ticket-overlay, -git, -mark-read, ticket-verify-band) déclarent exactement le même bloc de 13 vi.mock et 2 autres (-capabilities, -pipeline-dispatch) en sont des sur-ensembles stricts — soit 6 fichiers, pas 7 ; -verification-data n'en partage que 9, -unresolved-project 4, -session-paging 0. 8 des 9 définissent un renderSubject()/renderOverlayData() local. (2) UnifiedChatPanel : 8 fichiers le rendent réellement (chat-concurrency, chat-provider-toggle, epic-action-busy-state, new-conversation-dropdown, unified-chat-epic-workspace, -mobile-persist, -open-race, -shell) = 3 309 l., préambules 82→197, soit 30 % — pas plus de 50 % ; 7 mocks strictement communs aux 8. (3) chat-stream-route ×4 = 2 813 l., préambules 110/152/262/132 = 23 % ; 7 mocks communs, listes identiques entre -openai et -openai-tools. Les préambules ne sont pas identiques ligne à ligne (diff overlay/git : 174 lignes divergentes sur ~300) : le tronc réellement dupliqué est le bloc vi.hoisted + vi.mock (~50 l. par fichier overlay), le reste (fixtures, renderSubject) diverge. Le couplage est réel : hooks/useTicketOverlayData.ts:39-52 importe les 11 hooks + findUnifiedSession que ces fichiers remockent, donc un ajout de hook demande 6 éditions synchrones. Le gain annoncé de ~2 500 lignes est surestimé : vi.mock est hoisté par fichier et ne peut pas migrer dans un helper importé ; un harnais dans __tests__/helpers/ (aucun n'existe pour ces familles) factoriserait les factories, les fixtures et le render, soit un ordre de grandeur de 600 à 900 lignes.

**Recommandation**

Un harnais par famille dans `__tests__/helpers/` : `ticket-overlay-harness.tsx` (mocks + `renderOverlay(overrides)` + `mockState`), `unified-chat-harness.tsx`, `chat-stream-harness.ts`. Gain ≈ 2 500 lignes ; les fichiers ne gardent que leurs scénarios.

<details><summary>Preuve relevée par l'auditeur</summary>

Pour chaque fichier : `rg -n '^(describe|it)\(' f | head -1` (ligne du premier test) vs `wc -l` ; `rg -o 'vi\.mock\("[^"]+"' f | sort` : listes identiques entre ticket-overlay, ticket-overlay-git, ticket-overlay-mark-read, ticket-verify-band ; entre unified-chat-panel-shell et chat-concurrency ; entre chat-stream-route-openai et -openai-tools.

</details>

### #165 — 9 tests unitaires « responsive/mobile » (3 209 l.) épinglent des classes Tailwind littérales, doublés par 7 specs e2e (3 873 l.) qui mesurent les pixels des mêmes écrans

**Nature** gras de tests · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/chat-page-responsive.test.tsx:425-480`
- `__tests__/desk-composer-agent-name.test.tsx:1-30`
- `__tests__/desk-composer-agent-name.test.tsx:130-200`
- `__tests__/desk-mobile-layout.test.tsx`
- `__tests__/top-bar-responsive.test.tsx`
- `__tests__/tickets-registry-responsive.test.tsx`
- `e2e/desk-mobile-layout.spec.ts`
- `e2e/chat-mobile-layout.spec.ts`
- `e2e/qa-findings-responsive.spec.ts`
- `e2e/desk-working-band-mobile.spec.ts`

**Constat**

Chaque écran responsive a deux fichiers de même nom : `e2e/desk-mobile-layout.spec.ts` (693 l., 5 tests, 5 viewports) / `__tests__/desk-mobile-layout.test.tsx` (562 l., 12 its), idem desk-working-band-mobile, desk-composer-agent-name, tickets-registry-responsive, top-bar-responsive, chat-mobile-layout/chat-page-responsive, qa-findings-responsive/qa-mobile-layout. Les moitiés unitaires reconnaissent elles-mêmes que « jsdom has no layout engine » (desk-composer-agent-name.test.tsx:23-29) et se rabattent sur des assertions de tokens : `expect(tokens).toContain("max-w-[45%]")`, `"@min-[…]:max-w-[30cqw]"`, `"basis-[calc(100%-29px)]"`, `"min-h-[58px]"`, `not.toContain("sm:basis-0")` (chat-page-responsive:429-470, desk-composer-agent-name:130-190). Tout restyle sans changement de comportement rougit ces tests ; le contrat réel (largeur du champ, absence d'overflow) n'est tenu que par l'e2e. Les 3 tests « agent pill » sont en outre copiés à l'identique entre chat-page-responsive (438-473) et desk-composer-agent-name (141-195) pour deux composers différents. 25 tests e2e pour 3 873 lignes (155 l./test) : les boucles de viewports et les mesures sont elles aussi recopiées d'un spec à l'autre.

**Précision du vérificateur**

Réel mais très surévalué. Ce qui est vérifié : (1) les fichiers existent, aucun n'est supprimé dans l'arbre (`git status --porcelain` ne montre que ` M __tests__/chat-page-responsive.test.tsx`, ` M __tests__/unified-chat-panel-mobile-persist.test.tsx`, ` M e2e/desk-working-band-mobile.spec.ts`) ; (2) les assertions de tokens Tailwind littérales citées existent bien, aux lignes indiquées à ±10 près : `__tests__/desk-composer-agent-name.test.tsx:132-133` (`max-w-[45%]`, `@min-[…]:max-w-[30cqw]`), `:178` (`min-h-[58px]`), `:185` (`basis-[calc(100%-29px)]`), `:190` (`not.toContain("sm:basis-0")`), et leurs jumelles `__tests__/chat-page-responsive.test.tsx:434-435, 469-474` ; (3) trois titres de `it` sont bien identiques entre les deux fichiers.

Corrections de fond :
- « Les moitiés unitaires se rabattent sur des assertions de tokens » n'est vrai que pour 4 fichiers sur 9. Comptages réels de `classTokens|toHaveClass|className` (helper inclus) : chat-page-responsive 11, tickets-registry-responsive 10, top-bar-responsive 7, desk-composer-agent-name 6 — mais desk-mobile-layout 2 pour 562 l. et 12 `it` (une seule assertion de classe réelle, `:527 min-h-[168px]`, plus un `max-lg:flex-[` à `:283` et un `max-lg:min-h-[` à `:558`), qa-mobile-layout 2, desk-working-band-mobile 1. Les `it` de ces trois-là portent sur le comportement/a11y (« keeps every coral control named and enabled », « still opens a ticket from a chip »…), pas sur des classes.
- « Copiés à l'identique » est faux : `diff -u` des deux blocs « agent pill » (chat-page-responsive:421-484, 64 l. / desk-composer-agent-name:118-206, 89 l.) donne 95 lignes divergentes sur 153. Les composants sous test sont différents (`@/components/desk/DeskComposer` vs `@/components/chat-page/ChatComposer`), le DOM aussi (le test chat remonte via `parentElement?.parentElement`), et la version desk ajoute des assertions de bande (`flex-wrap`, `@container`, `min-h-[58px]`) absentes de la version chat. Seuls les titres et 4-5 `expect` coïncident.
- Chiffres inexacts : les 7 specs e2e font 3 773 l. (pas 3 873) et portent 22 `test(` (pas 25) — desk-mobile-layout 5, desk-working-band-mobile 4, top-bar-responsive 4, chat-mobile-layout 3, qa-findings-responsive 3, tickets-registry-responsive 2, desk-composer-agent-name 1. La métrique « 155 l./test » est trompeuse : 30 % de ces fichiers sont commentaire ou vide (1 119/3 773 ; 302/682 pour chat-mobile-layout, soit 44 %), l'essentiel du reste étant les helpers de seed et de mesure propres à chaque écran, pas des tests.
- « Les boucles de viewports sont recopiées » : les 4 constantes `VIEWPORTS` diffèrent réellement de contenu et de forme (chat-mobile-layout 5 entrées avec `stacked`, tickets-registry 4 avec `shape`, desk-composer-agent-name 4 nues, plus un second `LONG_LABEL_VIEWPORTS` à 6 entrées), chacune justifiée par un commentaire renvoyant aux critères du ticket.
- « Doublons » : la division du travail est explicite et documentée dans les en-têtes — `desk-composer-agent-name.test.tsx:26-29` (« jsdom has no layout engine … The pixels are in `e2e/desk-composer-agent-name.spec.ts` ») et `e2e/chat-mobile-layout.spec.ts:9-15` (« This is the half of the fix that `__tests__/chat-page-responsive.test.tsx` cannot do »). L'unitaire n'assure aucun pixel, l'e2e n'assure aucun token : c'est complémentaire, pas redondant. Le vrai grief tenable est la fragilité au restyle des ~30 assertions de tokens des 4 fichiers concernés.
- Gain annoncé irréaliste : supprimer toutes les assertions de tokens retire quelques dizaines de lignes, pas 1 500. Atteindre 1 500 l. supposerait de supprimer des fichiers entiers dont la majorité du contenu est du commentaire de mesure et de la couverture comportementale/a11y sans équivalent e2e (12 `it` desk-mobile-layout, 9 qa-mobile-layout, 9 top-bar-responsive).

**Recommandation**

Faire de l'e2e le contrat de layout (garder une fixture commune `e2e/fixtures/viewports.ts` + helpers de mesure) ; réduire les moitiés unitaires aux assertions de comportement/a11y (noms dans l'arbre, états disabled, wrap des groupes) et supprimer les assertions de tokens ; factoriser le trio « agent pill » en un helper partagé. Gain ≈ 1 500 lignes unitaires et disparition d'une classe entière de faux rouges.

<details><summary>Preuve relevée par l'auditeur</summary>

Paires de même basename e2e/unit : 8 (desk-composer-agent-name, desk-mobile-layout, desk-working-band-mobile, github-device-flow, i18n-review-regressions, refinement-merge-discard-create, tickets-registry-responsive, top-bar-responsive) ; comptage `classTokens|toHaveClass|className` : chat-page-responsive 11, tickets-registry-responsive 10, top-bar-responsive 7 ; titres partagés (titles.mjs) : « lets the agent pill yield… », « hands the field its own row… », « keeps the whole name in the accessibility tree… » dans les deux fichiers.

</details>

### #163 — `lib/kanban/filters.ts` et `lib/kanban/reorder.ts` n'ont plus aucun consommateur produit ; seuls leurs deux tests les importent

**Nature** mort · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `lib/kanban/filters.ts`
- `lib/kanban/reorder.ts`
- `__tests__/kanban-filters.test.tsx`
- `__tests__/kanban-review-reorder.test.ts`
- `components/desk/ReadyToLandBand.tsx:28`
- `lib/control-desk/aggregate.ts:550`
- `CLAUDE.md`

**Constat**

CLAUDE.md affirme que `lib/kanban/` est « live logic … filters ». C'est vrai pour queue, merge-readiness, awaiting-reply, build-work, unread-ai, activity-feed, status-transitions — faux pour filters.ts (103 l. : KanbanFilters, countActiveFilters, epicMatchesFilters, parseStoredFilters, filtersStorageKey) et reorder.ts (75 l. : persistedColumnOrder). Aucun import dans app/ components/ hooks/ lib/ ; les seules mentions hors tests sont deux commentaires (ReadyToLandBand.tsx:28, control-desk/aggregate.ts:550). Les deux modules étaient consommés par `hooks/useKanban.ts` et le board, supprimés par la rationalisation (D dans git status). `__tests__/kanban-filters.test.tsx` (104 l.) et `__tests__/kanban-review-reorder.test.ts` (73 l.) testent donc du code mort.

**Précision du vérificateur**

Confirmé dans l'arbre de travail : `lib/kanban/filters.ts` (103 l.) et `lib/kanban/reorder.ts` (75 l.) n'ont plus aucun consommateur produit — aucun import dans app/, components/, hooks/, lib/, bin/, scripts/, aucun import dynamique, pas d'index.ts dans lib/kanban/ donc pas de ré-export. Les seules mentions hors tests sont deux commentaires en prose (components/desk/ReadyToLandBand.tsx:28, lib/control-desk/aggregate.ts:550) et de la prose historique dans arji.json. Seuls __tests__/kanban-filters.test.tsx (104 l.) et __tests__/kanban-review-reorder.test.ts (73 l.) les importent. La phrase de CLAUDE.md (l.49-50) liste bien « filters » parmi la « live logic » de lib/kanban/, ce qui est faux.

Trois précisions à ajouter :
1. `filtersStorageKey` / `arij.kanban-board.filters.<projectId>` n'est lu par personne (`rg 'kanban-board' app components hooks lib` → seulement filters.ts). L'en-tête de __tests__/kanban-filters.test.tsx affirme pourtant que c'est « the parser for the payload the desk still reads » : cette justification est fausse, et c'est un argument de plus pour la suppression, pas contre.
2. La conservation est délibérée, pas un oubli : filters.ts et reorder.ts ne sont **pas** modifiés par la rationalisation non commitée (`git status` les laisse intacts), et l'en-tête de filters.ts dit déjà « the pure half of the retired kanban FilterBar … The bar itself is gone with the board ». Seul __tests__/kanban-review-reorder.test.ts a été touché : réduit de 273 à 73 lignes (les cas traversant `useKanban.moveEpic`, supprimé, ont été retirés). L'auteur a donc émondé le test tout en gardant le module.
3. reorder.ts n'est pas mort documentairement : ReadyToLandBand.tsx:28 et aggregate.ts:550 le citent comme la définition normative du contrat `epics.position` qu'ils s'interdisent explicitement d'écrire. Le supprimer sèchement laisserait deux commentaires vivants pointant dans le vide — il faut soit reloger cette prose, soit garder le module comme documentation exécutable.

**Recommandation**

Supprimer les deux modules et leurs deux tests (355 lignes) ; corriger la phrase de CLAUDE.md sur lib/kanban (retirer « filters »). Si le tri Review doit revivre dans le registre, réimporter reorder.ts à ce moment-là.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'kanban/filters|kanban/reorder|from "./filters"|from "./reorder"' --glob '!__tests__' .` → uniquement 2 commentaires + arji.json ; pour chaque export (`persistedColumnOrder`, `countActiveFilters`, `epicMatchesFilters`, `parseStoredFilters`, `filtersStorageKey`) : `rg -l '\bNOM\b' app components hooks lib` → 0 hors le fichier de définition ; `ls lib/kanban` : pas d'index.ts.

</details>

### #164 — Deux `vi.mock` pointent vers des modules inexistants et mentent silencieusement

**Nature** cassé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/ticket-deep-link-consumption.test.tsx:159`
- `__tests__/project-patch-default-branch.test.ts:30`
- `app/api/projects/[projectId]/route.ts:5`
- `app/api/projects/[projectId]/route.ts:100`
- `lib/sync/export.ts:223-229`

**Constat**

(1) `__tests__/ticket-deep-link-consumption.test.tsx:159` mocke `@/components/monitor/AgentMonitor` ; `components/monitor/` n'existe pas (retiré au commit 7fefa179 avec ses 3 tests). (2) `__tests__/project-patch-default-branch.test.ts:30` mocke `@/lib/export/arji-json` (`tryExportArjiJson`) ; ce chemin n'a jamais existé, la route importe `@/lib/sync/export` (route.ts:5) et appelle le vrai `tryExportArjiJson` (route.ts:100). Le test reste vert uniquement parce que `tryExportArjiJson` sort immédiatement sous `process.env.VITEST` (lib/sync/export.ts:227) — la garde du test n'est pas celle qu'il croit poser. Vitest ignore un `vi.mock` dont le module n'est jamais importé, donc rien ne rougit.

**Précision du vérificateur**

(1) `__tests__/ticket-deep-link-consumption.test.tsx:159` mocke `@/components/monitor/AgentMonitor`, supprimé au commit 7fefa179 (31/08) avec `components/monitor/AgentMonitor.tsx` et 4 tests (agent-monitor, agent-monitor-wave-indicator, night-run-monitor-chip, pipeline-monitor-chip) ; aucun consommateur restant, le mock est inerte. (2) `__tests__/project-patch-default-branch.test.ts:30` mocke `@/lib/export/arji-json`, chemin qui n'a existé dans aucune branche (`git log --all` vide) — erreur présente dès la création du test (be617165). La route (`app/api/projects/[projectId]/route.ts:5,100`) importe et appelle le vrai `tryExportArjiJson` de `@/lib/sync/export`, qui ne fait rien uniquement grâce à la garde `process.env.VITEST` (`lib/sync/export.ts:227`). Le test ne fait aucune assertion sur le mock, donc rien ne rougit. Recommandation inchangée : retirer la ligne 159, mocker `@/lib/sync/export` (ou documenter la garde VITEST), ajouter un test-garde résolvant chaque spécificateur `vi.mock("@/…")` sur disque.

Le finding est exact tel quel. Précision : la garde `process.env.VITEST` de `lib/sync/export.ts` existait déjà au commit be617165 qui a introduit le test, le mock `@/lib/export/arji-json` a donc été mort dès sa création (jamais un chemin réel). Impact limité à l'hygiène des tests : aucun code produit n'est concerné.

**Recommandation**

Supprimer la ligne 159 ; dans project-patch-default-branch, mocker `@/lib/sync/export` (ou retirer le mock et documenter que la garde VITEST suffit). Ajouter un test-garde générique qui résout chaque spécificateur `vi.mock("@/…")` sur disque (le scan de l'inventaire le fait en 20 lignes).

<details><summary>Preuve relevée par l'auditeur</summary>

`ls components/monitor` → No such file ; `ls lib/export` → No such file ; `rg -n tryExportArjiJson app/api/projects/[projectId]/route.ts` → import depuis @/lib/sync/export ; `git show --stat 7fefa179 | rg monitor` → suppression de agent-monitor.test.tsx, agent-monitor-wave-indicator.test.tsx, night-run-monitor-chip.test.tsx.

</details>

### #166 — ≈ 4 400 lignes de « tests » sont en réalité des linters du dépôt exécutés dans vitest (React Compiler via ESLint, focus-ring, conventions e2e), avec des scanners dupliqués et un sous-ensemble redondant

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/react-compiler-coverage.test.ts:36-50`
- `__tests__/react-compiler-coverage.test.ts:140-150`
- `__tests__/react-compiler-namespaced-hooks.test.ts:195-206`
- `__tests__/topbar-react-compiler-bail.test.ts`
- `__tests__/helpers/react-compiler-probe.ts:366`
- `__tests__/focus-ring-paints.test.tsx`
- `__tests__/focus-ring-undeclared.test.tsx`
- `__tests__/focus-ring-scan.test.ts`
- `__tests__/focus-ring-color.test.ts`
- `__tests__/e2e-workspace-scope-counts.test.ts:50,312`
- `__tests__/e2e-refinement-clock-sync.test.ts`

**Constat**

react-compiler-coverage (355 l.) parcourt tout app/components/hooks/lib en `beforeAll` et lance ESLint sur chaque fichier candidat ; react-compiler-namespaced-hooks (415 l.) refait la même marche avec sa propre copie de `sourceFiles()` (lignes 195-206) alors que `helpers/react-compiler-probe.ts:366` l'exporte ; topbar-react-compiler-bail (161 l.) ne teste que TopBar.tsx, que namespaced-hooks liste déjà (ligne 256). Famille focus-ring : 5 fichiers unitaires (1 729 l.) + 2 helpers (class-list-scan 642, tailwind-outline 558) + 2 e2e (357), chacun documentant qu'il comble un trou du précédent. e2e-workspace-scope-counts (464 l.) et e2e-refinement-clock-sync (135 l.) parsent les specs Playwright avec le compilateur TS pour imposer des conventions. Ce sont des garde-fous utiles, mais ils tournent à chaque `npm test` (marche + ESLint complet), et l'en-tête de react-compiler-coverage (l. 41-45) annonce encore « 79 of the 485 functions … in 77 files » alors que KNOWN_BAILED compte 30 entrées.

**Précision du vérificateur**

≈ 4 100 lignes de « tests » (hors helpers partagés) sont des linters du dépôt exécutés par vitest à chaque `npm test`. `react-compiler-coverage.test.ts` (294 l. dans l'arbre, pas 355) marche app/components/hooks/lib en `beforeAll` (l. 82-90) puis lance un `eslint.lintText` par fichier candidat ; `react-compiler-namespaced-hooks.test.ts` (415 l.) refait la marche avec sa propre copie de `sourceFiles()` (l. 195-206) alors que `helpers/react-compiler-probe.ts:365` l'exporte (et les deux divergent : le helper exclut les `.test.*`/`.d.ts`, la copie non) ; `topbar-react-compiler-bail.test.ts` (161 l.) ne couvre que TopBar, déjà probé par coverage (l. 115) — sauf son assertion source sur `"use no memo"`, unique. Famille focus-ring : 4 fichiers `focus-ring-*` (1 350 l.) + `chat-thread-pane-focus-ring` (379) + 2 e2e (357). `e2e-workspace-scope-counts` (464) et `e2e-refinement-clock-sync` (134) parsent les specs Playwright avec le compilateur TS pour imposer des conventions. CORRECTIONS : `KNOWN_BAILED` est VIDE dans l'arbre de travail (l. 74 ; 34 entrées à HEAD, soldées par le diff non commité), donc le grief « en-tête 79/485/77 vs 30 entrées » est infondé — et l'en-tête (l. 41-45) est écrit au passé (« The original probe found »), c'est un historique, pas un état courant. Les helpers `class-list-scan.ts` (642) et `tailwind-outline.ts` (558) ne sont pas propres à focus-ring : ils servent aussi `dialog-description-coverage.test.ts:35` et `story-detail-panel-labels.test.tsx:10`, donc on ne peut pas les déplacer avec la famille.

**Recommandation**

Sortir les garde-fous « lint-shaped » du chemin chaud de vitest : règles ESLint custom ou `scripts/check-*.mjs` appelés par un job CI dédié (ils n'ont pas besoin de jsdom ni de 4 workers). Fusionner topbar-react-compiler-bail dans namespaced-hooks, faire importer `sourceFiles` du helper, mettre l'en-tête à jour. Ne rien supprimer sans remplacement : ce sont les seules gardes de ces régressions.

<details><summary>Preuve relevée par l'auditeur</summary>

`wc -l` des familles : react-compiler 931 + helper 549 ; focus-ring 1 729 + helpers 1 200 + e2e 357 ; `rg -n 'react-compiler-probe|^function sourceFiles' react-compiler-namespaced-hooks.test.ts` → pas d'import du helper, définition locale l.195 ; `rg -n TopBar react-compiler-namespaced-hooks.test.ts` → l.256 ; `sed -n 36,50p react-compiler-coverage.test.ts` → chiffres 79/485/77 ; `rg -c '^  "' react-compiler-coverage.test.ts` → 30.

</details>

### #167 — Helpers partagés contournés : mocks next/navigation à la main dans 66 fichiers, MockEventSource copié 11 fois, constructeurs de NextRequest locaux dans 14 fichiers

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/helpers/app-router-url.ts`
- `__tests__/helpers/db-mock.ts:281-309`
- `__tests__/helpers/upload-request.ts`
- `__tests__/kanban-build-toolbar.test.tsx:1-30`
- `__tests__/ticket-deep-link-consumption.test.tsx`
- `__tests__/night-run-page-wiring.test.tsx`
- `__tests__/support/toast-contract.tsx`
- `__tests__/frictions-page.test.tsx`
- `__tests__/qa-check-dispatch.test.tsx`

**Constat**

`__tests__/helpers/` + `support/` totalisent 2 788 lignes, mais leur surface est mal connue : `app-router-url.ts` (le seul stand-in fidèle d'`useSearchParams`) a 3 importeurs alors que 66 fichiers mockent `next/navigation` à la main (useRouter 44, useParams 43, useSearchParams 15, usePathname 11 occurrences) ; `class MockEventSource {...}` est recopié dans 11 tests de pages (kanban-build-toolbar, ticket-deep-link-consumption, night-run-page-wiring, spec-page-memory-panel…) ; 14 fichiers définissent un `mockRequest`/`makeRequest` local et 14 font `new NextRequest(` à la main alors que `mockNextRequest`/`mockJsonRequest`/`mockRouteContext` existent — dans `helpers/db-mock.ts:281-309`, et non dans `upload-request.ts` comme l'inventaire l'affirmait (upload-request n'exporte que des helpers de taille de body). `support/toast-contract.tsx` et `toast-fixtures.ts` n'ont qu'un importeur chacun. Précision sur l'inventaire : les 10 `installFetch` locaux ne sont PAS interchangeables (ce sont des dispatchers par route : frictions-page, qa-check-dispatch, session-detail-page diffèrent) — faux positif à ne pas reprendre tel quel.

**Précision du vérificateur**

Duplication réelle mais modeste dans `__tests__/`, très en deçà du gain annoncé. Faits vérifiés : `class MockEventSource` est recopié **8 fois** (pas 11) — 7 stubs identiques de 6 lignes (ticket-deep-link-consumption, kanban-ticket-details-selection, night-run-page-wiring, kanban-build-toolbar, kanban-build-toolbar-dag, project-desk-create-dialogs, project-desk-control-rows-mobile) + une variante de 16 lignes dans spec-page-memory-panel ; `project-events-project-guard.test.tsx:31` définit un `SpyEventSource` distinct, à ne pas compter. 8 fichiers gardent le fake de requête par cast `as unknown as NextRequest` alors que `mockNextRequest`/`mockJsonRequest`/`mockRouteContext` existent en `__tests__/helpers/db-mock.ts:279-309` — mais ces helpers sont déjà la convention dominante (135 fichiers les importent), donc il s'agit de stragglers, pas d'un contournement généralisé. `__tests__/helpers/upload-request.ts` n'exporte effectivement que des helpers de taille de corps : la correction d'inventaire de l'auditeur est juste. 67 fichiers mockent `next/navigation` à la main, mais seuls 16 touchent `useSearchParams`, seul périmètre couvert par `helpers/app-router-url.ts` (3 importeurs) ; ces mocks font 1 à 3 lignes taillées par test, un helper partagé n'y gagne pas de lignes. `support/toast-contract.tsx` et `support/toast-fixtures.ts` n'ont qu'un importeur commun. Gain réaliste ≈ 100 lignes (52 de MockEventSource, ~40 de fakes de requête), pas 700 ; la valeur est la cohérence, pas le volume.

**Recommandation**

`helpers/next-navigation-mock.ts` (routeur + params + searchParams paramétrables), `helpers/event-source-mock.ts`, déplacer les constructeurs de requête de db-mock.ts vers `helpers/request.ts` ; un README `__tests__/helpers/README.md` listant la surface. Gain ≈ 700 lignes, et un seul endroit à adapter au prochain changement de next/navigation.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -l 'vi\.mock("next/navigation"' __tests__ | wc -l` → 66 vs `rg -l helpers/app-router-url` → 3 ; `rg -l 'class MockEventSource|EventSource = ' __tests__` → 11 ; `rg -n '^export' helpers/upload-request.ts` → aucun mockNextRequest ; `rg -l 'new NextRequest\(' __tests__` → 14 ; `awk '/function installFetch/,/^}/'` sur 3 fichiers : corps différents.

</details>

### #168 — Les routes git « not-a-repository » sont testées trois fois avec le même titre, la même fixture `git init` et un quatrième fichier de convention de statuts par-dessus

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/github-detect-not-a-repository.test.ts`
- `__tests__/worktrees-route-not-a-repository.test.ts`
- `__tests__/git-sync-routes-not-a-repository.test.ts`
- `__tests__/git-github-route-status-convention.test.ts:733`
- `__tests__/refinement-mcp-routes.test.ts:215-282`
- `__tests__/refinement-merge-discard-create.test.ts:341-414`
- `__tests__/mcp-e2e.test.ts:205-386`
- `__tests__/arij-mcp-shim.test.ts:289-592`

**Constat**

github-detect-not-a-repository (494 l., 22 its, 7 `git init`), worktrees-route-not-a-repository (259 l., 8 its, 6 `git init`) et git-sync-routes-not-a-repository (320 l., 8 its, 5 `git init`) portent les mêmes titres : « answers 400 with GIT_REPO_NOT_A_REPOSITORY instead of 500 » (4 occurrences), « answers 400 with GIT_REPO_PATH_MISSING when the directory is gone » (3), « still answers 200 for a bare repository » (2), chacun avec son propre dépôt temporaire ; git-github-route-status-convention (989 l.) re-balaye les mêmes routes pour la convention 400/500. Même schéma pour les routes MCP de refinement : refinement-mcp-routes et refinement-merge-discard-create re-testent chacun « %s rejects a missing token with 401 », « %s refuses a call with no justification », « %s refuses a blank justification », « refuses a ticket from another project » dans leur propre bloc `availability`, et mcp-e2e recouvre 3 tests d'arij-mcp-shim (identification du serveur, mapping {error,code} → isError, outils inconnus).

**Précision du vérificateur**

Duplication réelle mais plus étroite qu'annoncé : deux fichiers seulement, github-detect-not-a-repository.test.ts (l.166, 181, 218, 248) et worktrees-route-not-a-repository.test.ts (l.164, 179, 213, 223, 235), portent des titres identiques mot pour mot (« answers 400 with GIT_REPO_NOT_A_REPOSITORY instead of 500 », « … GIT_REPO_PATH_MISSING when the directory is gone », « still answers 200 for a bare repository ») avec chacun sa propre fixture `git init` recopiée (initRepo + garde « pas dans un dépôt » + `--bare`), code aussi recopié dans git-github-route-status-convention.test.ts:658/698 et trois autres fichiers, alors qu'aucun `__tests__/helpers/temp-git-repo.ts` n'existe. git-sync-routes-not-a-repository.test.ts:202-243 est à retirer du finding : il est déjà table-driven sur ROUTES. git-github-route-status-convention.test.ts est aussi à retirer comme doublon : c'est une garde d'exhaustivité dérivée de l'arbre de routes (l.759/777/793) qui échoue sur toute nouvelle route git/github non classée, et son mock db adressé par table (l.48-55) est incompatible avec le mock en file des autres. mcp-e2e.test.ts est à retirer entièrement : son en-tête l.8-12 déclare le recouvrement comme délibéré (client SDK officiel vs client JSON-RPC fait main d'arij-mcp-shim). Côté refinement, le doublon est avéré : le bloc `availability` de refinement-mcp-routes.test.ts:215-267 et refinement-merge-discard-create.test.ts:341-408 répète les quatre mêmes `it.each` sur des tables d'outils disjointes (5 vs 3), plus `refuses a ticket from another project` (l.390 / l.461) ; une fusion doit conserver le cas propre `%s rejects a build session with 403 REFINEMENT_ONLY` (l.370-386). Gain réaliste : la fixture git partagée et ~2×4 assertions, soit un ordre de grandeur de 150-250 lignes, pas 800.

**Recommandation**

Un `git-routes-not-a-repository.test.ts` table-driven sur [detect, worktrees, git/status, git/pull, git/push] avec une seule fixture de dépôt temporaire (`helpers/temp-git-repo.ts`) ; un `refinement-availability.test.ts` unique piloté par la liste des 8 outils. Gain ≈ 800 lignes.

<details><summary>Preuve relevée par l'auditeur</summary>

Titres partagés extraits par scratchpad/titles.mjs (55 titres présents dans ≥ 2 fichiers, ceux-ci en tête) ; `rg -c 'git.*init|execFileSync("git"'` → 7/6/5/7 par fichier ; describes des deux fichiers refinement listés ; describes mcp-e2e vs arij-mcp-shim comparés.

</details>

### #169 — 50 fichiers de test ne contiennent qu'un ou deux tests (4 528 lignes), et les familles éclatées atteignent 10 à 21 fichiers par module

**Nature** gras de tests · **Impact** faible (vérificateur : plutôt moins) · **Effort** L · **Statut** confirmé · **Domaine d'audit** tests-suite

**Fichiers**
- `__tests__/workflow-approval-regressions.test.ts`
- `__tests__/merge-gate-query-shape.test.ts`
- `__tests__/epic-merge-story-cascade.test.ts`
- `__tests__/agent-mentions-do-not-block-runs.test.ts`
- `__tests__/epic-build-concurrency.test.ts`
- `__tests__/tickets-registry-hook.test.tsx`
- `__tests__/tickets-registry-sort.test.ts`
- `__tests__/tickets-registry-url-params.test.ts`

**Constat**

19 fichiers n'ont qu'un seul `it` et 31 en ont deux ; le préambule (mocks, seeds, helpers) y pèse plus que l'assertion : workflow-approval-regressions 253 l./2 its, merge-gate-query-shape 219/2, epic-merge-story-cascade 196/1, agent-mentions-do-not-block-runs 194/2 avec 17 `vi.mock`, epic-build-concurrency 183/2 avec 15 mocks. À l'autre bout, `lib/control-desk/types` est importé par 21 fichiers de test, `lib/claude/prompt-builder` par 20, `lib/agent-sessions/lifecycle` par 18 ; la famille tickets-registry-* compte 10 fichiers dont tickets-registry-hook (26 l.), tickets-registry-sort (21 l.), tickets-registry-url-params (111 l.). Le motif « un ticket = un fichier de test » (les en-têtes commencent par « B-arij-NNN — ») produit des fichiers-régression qui ne sont jamais refondus dans le test du module.

**Précision du vérificateur**

Le fond est exact, trois chiffres sont à corriger. (1) Le décompte « 50 fichiers ≤ 2 tests / 4 528 lignes / 19 à un seul test » dépend du périmètre : sur les seuls `__tests__` suivis et présents, j'obtiens 36 fichiers ≤ 2 tests pour 3 337 lignes (15 à un seul `it`) ; en incluant `e2e/` et les tests colocalisés, 68 fichiers pour 7 455 lignes (26 à un seul). Le total de tests (7 659 sur 651 fichiers `__tests__`, 7 927 sur 725 tous périmètres) confirme l'ordre de grandeur annoncé. (2) `lib/agent-sessions/lifecycle` n'est pas « importé par 18 fichiers de test » : 7 l'importent réellement (`from "@/lib/agent-sessions/lifecycle"`), 20 le `vi.mock`, 37 le mentionnent — le couplage est plus fort que dit, mais par mock, pas par import. (3) La route `epics/[epicId]/build/route` est touchée par 11 fichiers de test, pas 9. Tout le reste est vérifié au fichier près : les 8 fichiers cités existent (aucun supprimé par la rationalisation UI), leurs tailles sont exactes à ±1 ligne, les 17 et 15 `vi.mock` sont exacts, la famille `tickets-registry-*` compte bien 10 fichiers, et 21 fichiers portent un en-tête `B-arij-NNN — …`. Nature du finding : dette d'organisation des tests, sans impact de correction ni de couverture — la refonte proposée (fusionner les fichiers-régression en `describe` dans le test du module) est un chantier à risque de perte d'isolation des mocks, à traiter famille par famille, pas en bloc.

**Recommandation**

Règle de rangement : un fichier par module produit (ou par route), les tickets-régression deviennent un `describe("B-arij-NNN …")` dans ce fichier. Commencer par les familles où un harnais partagé existe déjà (build route ×9, tickets-registry ×10, sessions-list ×5). Gain ≈ 2 000 lignes de préambule ; surtout, un seul endroit où chercher les tests d'un module.

<details><summary>Preuve relevée par l'auditeur</summary>

scratchpad/perfile.json (comptage `it(`/`test(` par fichier, 7 623 tests sur 710 fichiers) : 50 fichiers ≤ 2 tests = 4 528 lignes, 19 à 1 test ; `rg -c '^vi\.mock\('` : agent-mentions-do-not-block-runs 17, epic-build-concurrency 15 ; 9 fichiers importent `epics/[epicId]/build/route` (352+528+1046+193+787+240+395+369+183 lignes, mocks 8 à 20 chacun).

</details>


## Annexe — inventaire de la suite de tests

INVENTAIRE DE LA SUITE DE TESTS — arbre de travail tel quel (main, rationalisation UI non commitée), 10/09/2026.

## Volumétrie mesurée
- `__tests__/` : **674 fichiers `*.test.ts|tsx|mjs` sur disque**, **199 326 lignes** (10 fichiers de plus sont marqués `D` par la rationalisation UI et exclus de tout ce qui suit). + 9 helpers partagés dans `__tests__/helpers/`.
- `e2e/` : **35 `*.spec.ts`** = **8 108 lignes**, plus 4 fixtures `.ts` (1 026 lignes). Le brief annonçait 686 et 39 : 674 = 684 − 10 supprimés ; 39 = 35 specs + 4 fixtures.
- Total tests (674 + 35 + fixtures) = **709 fichiers / 206 487 lignes**.
- Produit non supprimé sous `lib/` + `components/` + `hooks/` : **655 fichiers / 134 282 lignes**. Ratio global test/produit ≈ **1,53** (206 k / 134 k).

## (1) Les 40 plus gros fichiers de test
```
2277  __tests__/auto-mode-engine.test.ts
1758  __tests__/mcp-routes.test.ts
1665  __tests__/db-schema.test.ts
1470  __tests__/pipeline-stages-dispatch.test.ts
1449  __tests__/auto-mode-select.test.ts
1374  __tests__/night-run-e2e.test.ts
1373  __tests__/auto-mode-merge.test.ts
1190  __tests__/auto-mode-e2e.test.ts
1128  __tests__/refinement-merge-discard-create.test.ts
1093  __tests__/top-bar.test.tsx
1083  __tests__/unified-chat-epic-workspace.test.tsx
1049  __tests__/dreaming-collector.test.ts
1047  __tests__/pipeline-e2e.test.ts
1013  __tests__/pipeline-runner-stages.test.ts
1012  __tests__/chat-stream-route.test.ts
 990  __tests__/git-github-route-status-convention.test.ts
 973  __tests__/dreaming-dispatch.test.ts
 972  __tests__/spec-page-memory-panel.test.tsx
 958  __tests__/prompt-builder-fencing.test.ts
 949  __tests__/usage-live-cards.test.tsx
 941  __tests__/merge-readiness-blocking-findings.test.ts
 933  __tests__/session-chunk-retention.test.ts
 893  __tests__/usage-report.test.ts
 874  __tests__/chat-stream-route-openai.test.ts
 870  __tests__/mcp-injection.test.ts
 865  __tests__/persistent-chat-runner.test.ts
 864  __tests__/refinement-report.test.ts
 864  __tests__/usage-page.test.tsx
 864  __tests__/pipeline-runner.test.ts
 848  __tests__/night-run-engine.test.ts
 825  __tests__/refinement-mcp-routes.test.ts
 801  __tests__/import-page-github-flow.test.tsx
 788  __tests__/epic-lifecycle-status.test.ts
 783  __tests__/pipeline-findings.test.ts
 760  __tests__/review-unverifiable-gate.test.ts
 734  __tests__/arij-mcp-shim.test.ts
 728  __tests__/dispatch-background-session.test.ts
 726  __tests__/notifications-create.test.ts
 694  __tests__/arij-actions.test.ts
 694  __tests__/mcp-servers-settings-ui.test.tsx
```
Ces 40 fichiers = 38 262 lignes, soit **19 % de la suite** pour 5,9 % des fichiers.
Côté e2e, top 5 : desk-mobile-layout 693, chat-mobile-layout 682, qa-findings-responsive 656, desk-working-band-mobile 620, top-bar-responsive 431 — les 4 plus gros sont tous des specs « responsive/mobile », 2 651 lignes soit 33 % du corpus e2e.

## (2) Tests dont la cible n'existe plus
Aucun fichier de test survivant n'importe un module supprimé par la rationalisation UI : l'agent a bien supprimé les 10 tests correspondants (`use-kanban-*`, `use-notifications`, `dependency-editor`, `kanban-quick-capture`, `kanban-selection`, `clone-lifecycle-source-badge`, `project-friction-settings-link`, `user-story-quick-actions-errors`).
Restent **2 `vi.mock` morts**, antérieurs à la rationalisation, qui pointent vers des chemins inexistants (vitest ignore silencieusement un `vi.mock` dont personne n'importe le module — ils ne cassent rien, ils mentent) :
- `__tests__/ticket-deep-link-consumption.test.tsx:159` → `@/components/monitor/AgentMonitor` ; `components/monitor/` n'existe pas, supprimé au commit 7fefa179 « relocate the two surviving pre-redesign bars, then remove them ».
- `__tests__/project-patch-default-branch.test.ts:30` → `@/lib/export/arji-json` (mock de `tryExportArjiJson`) ; `lib/export/` n'a jamais existé dans l'historique git, le vrai module est `lib/sync/arji-json.ts`. Ce mock est donc inopérant depuis toujours et le test PATCH tourne avec le vrai export.
Une seule autre mention résiduelle d'un module supprimé, et c'est un commentaire, pas du code : `__tests__/refinement-report.test.ts:601` (« hooks/useNotifications.ts has no consumer »).

## (3) Tests désactivés
**Zéro.** Recherche de `describe/it/test.skip|.only|.todo|.fixme|.skipIf|.runIf|.failing`, `xit`, `xdescribe`, `xtest` sur les 709 fichiers : une seule occurrence, et c'est une chaîne de caractères dans un garde-fou (`__tests__/e2e-workspace-scope-counts.test.ts:243`, `if (name === "test" || name === "test.only" || name === "test.skip")`). Aucun test parqué dans la suite.

## (4) Modules couverts par ≥ 4 fichiers de test
**111 modules**. Les trois premiers sont de l'infrastructure, pas de la fragmentation : `@/lib/db/schema` (148 fichiers), `@/lib/db/test-utils` (142, c'est `createTestDb()`), `@/lib/db` (106).
Les 108 autres, par nombre de fichiers de test :

21 `@/lib/control-desk/types` — desk-mobile-layout, tickets-registry-responsive, chat-thread-pane-focus-ring, chat-page-composer, desk-actions, control-desk-route, use-control-desk-stale-refresh, agent-select-pill, desk-composer-agent-name, control-desk-aggregate, desk-working-band-mobile, top-bar, desk-ready-to-land, desk-dismissal, chat-page-responsive, desk-your-turn, desk-strata-balance, desk-working-band, desk-up-next, chat-ticket-bindings, desk-composer-project-target
20 `@/lib/claude/prompt-builder` — refinement-prompt, auto-mode-second-opinion, prompt-builder-fencing, ci-autofix-prompt, ticket-image-prompt, prompt-bug-red-green, spec-update-dispatch, prompt-sections, team-build-prompt, token-estimation-automated-dispatches, failure-digest-prompt, memory-distill-prompt, prompt-visual-proof, prompt-untrusted-content, prompt-builder-agent-prompts, prompt-builder-agent-config, prompt-comment-history, dreaming-prompt, prompt-builder-snapshots, token-estimator
18 `@/lib/agent-sessions/lifecycle` — automatic-transition-invariants, session-chunk-retention, session-terminal-hooks, session-prompt-write-cap, session-failure-lifecycle, auto-mode-e2e, agent-scheduler, session-lifecycle, token-estimation-automated-dispatches, pipeline-e2e, dispatch-background-session, session-usage-persistence, session-failure-end-to-end, session-status-machine, resolve-session-output, session-prompt-backfill, session-outcome-persistence, token-estimator
16 `@/lib/providers/types` — chat-stream-route-mcp, codex-provider-developer-instructions, mcp-extra-servers-injection, cli-tool-channel, codex-spawn-developer-instructions, omp-version-gate, agy-provider, mcp-e2e, providers, named-agent-options-spawn, oversized-prompt-transport, omp-user-config-not-displaced, pi-providers, mcp-injection-lifecycle, db-schema-named-agents, mcp-injection
16 `@/lib/control-desk/aggregate` — desk-mobile-layout, tickets-registry-refinement, qa-findings-runs, tickets-registry-table, tickets-registry-aggregate, qa-findings-band, qa-findings-verdicts, control-desk-aggregate, qa-mobile-layout, desk-working-band-mobile, desk-ready-to-land, desk-dismissal, desk-your-turn, tickets-registry-url-state, desk-working-band, desk-up-next
16 `@/lib/agent-config/constants` — agents-workshop-editor, agents-workshop-cli-options, refinement-dispatch, agent-select-pill, named-agent-options-persistence, provider-registry-single-source, default-chat-mode, named-agents-routes, full-auto-dispatch-agent, provider-options-registry, dispatch-background-session, resume-capability, grading-agent-dispatch, dispatch-reliability, db-schema-named-agents, assignment-agent-sub-label
15 `@/lib/claude/process-manager` — process-manager, session-status-integration, refinement-dispatch, composite-dispatch-argv-stub, spec-update-dispatch, full-auto-dispatch-agent, pipeline-e2e, named-agent-persona-dispatch, grading-agent-dispatch, dreaming-dispatch, pipeline-grading-composite, bug-image-pipeline-dispatch, mcp-injection-lifecycle, pipeline-stages-dispatch, memory-distill-dispatch
14 `@/lib/utils/nanoid` — mcp-create-bug, arij-actions, refinement-report, activity-api, refinement-mcp-routes, report-friction-mcp, workflow-log, mcp-chat-routes, mcp-routes, refinement-reorder-core, refinement-merge-discard-create, epics-route-atomicity, review-unanchored-findings, epic-activity-route
13 `@/lib/mcp/token-store` — mcp-create-bug, mcp-token-store, review-unverifiable-gate, cli-tool-channel, refinement-mcp-routes, report-friction-mcp, refinement-action-permissions, mcp-chat-routes, mcp-routes, refinement-merge-discard-create, mcp-injection-lifecycle, chat-stream-route-openai-tools, mcp-outcome-precedence
13 `@/lib/db/init` — db-init-foreign-keys, db-init, agent-sessions-epic-cost-index-migration, refinement-actions-migration, desk-dismissal-migration, core-table-indexes-migration, named-agent-escalation-removal, release-rejection-git-side-effects, agent-session-estimated-tokens-migration, project-clone-source-migration, notification-message-migration, named-agent-options-migration, agent-session-review-verdict-migration
13 `@/lib/i18n/catalogue` — chat-page-composer, agents-workshop-cli-options, spec-anatomy-formatters, tickets-registry-aggregate, night-run-summary-dialog, provider-options-registry, ticket-overlay-derive, tickets-registry-csv, i18n-review-regressions, releases-derive, night-run-e2e, i18n-catalogue, ticket-overlay
13 `@/lib/pipeline/constants` — session-chunk-retention, pipeline-start-run, pipeline-activity-feed, pipeline-registry, pipeline-settings-section, pipeline-e2e, i18n-review-regressions, night-run-e2e, pipeline-onterminal, pipeline-runner, pipeline-regression-gate, pipeline-runner-stages, pipeline-deterministic-verification
12 `@/lib/qa/types` — qa-findings-hook, qa-findings-route, qa-findings-runs, qa-checks-route, qa-check-dispatch, qa-findings-band, qa-findings-verdicts, qa-mobile-layout, render-time-state-resets, qa-dismiss-dialog-description, qa-findings-aggregate, qa-findings-actions
11 `@/lib/agent-config/agent-resolution` — composite-agents-crud, agent-config-providers-resolver, named-agents-crud, refinement-dispatch, composite-dispatch-argv-stub, pipeline-e2e, pipeline-forensic-dispatch, review-provider-segregation, pipeline-stages-dispatch, legacy-fallback-named-agents, composite-route-boundaries
11 `@/lib/agent-sessions/chunks` — session-detail-pagination, session-resource-lifecycle, session-chunk-pagination, session-output-stream, session-watchdog, dreaming-collector, pipeline-forensic-dispatch, session-chunk-write-cap, session-chunks, session-chunk-dedupe, session-detail-arij-actions
11 `@/lib/git/remote` — project-github-detect-route, github-detect-not-a-repository, github-repo-input-parsing, project-worktrees-route, git-sync-routes-no-remote, github-remote-parsing, github-remote-grammar-parity, git-remote-availability-real-repo, git-option-injection, project-git-sync-routes, git-remote-availability
10 `@/lib/claude/prompt-sections` — refinement-prompt, ticket-image-prompt, prompt-sections, named-agent-persona-dispatch, memory-distill-prompt, mcp-extra-servers-prompt, prompt-anatomy-route, qa-findings-aggregate, bug-image-pipeline-dispatch, mcp-injection
10 `@/lib/claude/mcp-injection` — refinement-prompt, mcp-extra-servers-injection, cli-tool-channel, agy-provider, provider-registry-single-source, mcp-e2e, mcp-server-probe, review-channel-wiring, mcp-injection, review-gate-consistency
10 `@/lib/auto-mode/constants` — auto-mode-route, control-desk-route, auto-mode-engine, merge-failure-reasons, auto-mode-e2e, full-auto-dispatch-agent, board-merge-readiness-route, auto-mode-constants, full-auto-agent-settings, auto-mode-merge
10 `@/lib/night/constants` — night-settings, night-run-summary-dialog, desk-wave-run-chips, night-run-engine, night-run-stop-route, night-run-e2e, settings-draft-save, auto-mode-constants, night-run-dialog, use-night-run-detail
9 `@/lib/git/manager` — worktree-manager, git-clone-service, session-files-route, agent-scheduler-routes, grading-agent-dispatch, git-option-injection, git-merge-integrity, merge-marker-guard, git-merge-worktree
9 `@/lib/auto-mode/registry` — auto-mode-route, auto-mode-engine, auto-mode-e2e, auto-mode-select, board-merge-readiness-route, merge-readiness-blocking-findings, merge-gate-query-shape, auto-merge-agent, auto-mode-merge
9 `@/lib/dependencies/scheduler` — dependencies-buildable-guard, wave-runner-abort, night-batch-route, night-run-summary-dialog, night-run-engine, dag-scheduler, night-run-e2e, night-summary, wave-runner
9 `@/app/api/projects/[projectId]/epics/[epicId]/build/route` — epic-build-asked-question, agent-scheduler-routes, pipeline-e2e, agent-mentions-do-not-block-runs, epic-lifecycle-status, bug-image-agent-dispatch, pipeline-build-route-flag, agent-launch-concurrency-routes, epic-build-concurrency
8 `@/app/api/projects/[projectId]/epics/route` — mcp-create-bug, frictions-api, board-merge-readiness-route, ticket-read-model-chronology, merge-readiness-blocking-findings, merge-gate-query-shape, epics-route-atomicity, epics-route
8 `@/components/chat/UnifiedChatPanel` — unified-chat-epic-workspace, unified-chat-panel-mobile-persist, epic-button-not-blocked-by-chat, new-conversation-dropdown, unified-chat-panel-open-race, chat-provider-toggle, unified-chat-panel-shell, chat-concurrency
8 `@/lib/providers/codex` — codex-provider-developer-instructions, mcp-extra-servers-injection, provider-extract-result-contract, codex-spawn-developer-instructions, providers, named-agent-options-spawn, oversized-prompt-transport, mcp-injection
8 `@/lib/i18n/translator` — tickets-registry-aggregate, night-run-summary-dialog, ticket-overlay-derive, tickets-registry-csv, top-bar, night-run-e2e, qa-findings-aggregate, assignment-agent-sub-label
8 `@/lib/pipeline/runner` — pipeline-start-run, auto-mode-review-evidence, pipeline-runner, pipeline-regression-gate, pipeline-grading-composite, pipeline-runner-stages, pipeline-grading, pipeline-deterministic-verification
8 `@/app/api/projects/[projectId]/build/route` — build-route, night-batch-route, bug-image-team-dispatch, agent-scheduler-routes, night-run-e2e, build-route-dag, pipeline-build-route-flag, agent-launch-concurrency-routes
8 `@/lib/documents/memory-constants` — spec-page-memory-panel, memory-doc, memory-distill-prompt, memory-route, dreaming-dispatch, memory-auto-distill, memory-distill-dispatch, dreaming-prompt
7 `@/app/projects/[projectId]/page` — kanban-ticket-details-selection, ticket-deep-link-consumption, night-run-page-wiring, kanban-build-toolbar, kanban-build-toolbar-dag, project-desk-create-dialogs, project-desk-control-rows-mobile
7 `@/lib/claude/spawn` — claude-spawn-logging, chat-page-thread, providers, named-agent-options-spawn, oversized-prompt-transport, composite-persistent-chat, mcp-injection
7 `@/app/api/projects/[projectId]/sessions/[sessionId]/route` — qa-report-terminal-writes, session-detail-pagination, session-route-lifecycle, session-route-registry-cancel, agent-scheduler-routes, session-route-project-scope, session-detail-arij-actions
7 `@/lib/github/client` — github-config-route-contract, github-client, github-device-flow-route-transport, github-issues-not-configured, github-device-flow-credential-lifecycle, github-device-flow-persistence, github-device-flow-routes
7 `@/lib/providers` — mcp-extra-servers-injection, composite-dispatch-argv-stub, agy-provider, provider-registry-single-source, providers, composite-persistent-chat, pi-providers
7 `@/lib/tickets-registry/types` — tickets-registry-refinement, tickets-registry-responsive, tickets-registry-table, tickets-registry-route, tickets-registry-csv, tickets-registry-sort, tickets-registry-url-state
7 `@/lib/types/usage` — usage-report, usage-route, usage-page, usage-quota-cache, usage-screen, usage-dashboard-aggregate, usage-live-cards
7 `@/lib/auto-mode/select` — review-unverifiable-gate, auto-mode-engine, auto-mode-select, board-merge-readiness-route, merge-readiness-blocking-findings, merge-gate-query-shape, review-gate-consistency
7 `@/lib/projects/workspace-constants` — clone-lifecycle-guards, settings-route, projects-root-settings-section, settings-draft-save, projects-route-post, projects-workspace-gitignore, github-import-docs
7 `@/lib/night/registry` — night-batch-route, auto-mode-e2e, night-run-engine, auto-mode-select, night-run-stop-route, night-run-e2e, night-summary
7 `@/lib/git/clone` — git-clone-service, clone-lifecycle-resume, clone-lifecycle-clone-route, git-option-injection, clone-lifecycle-reuse-flow, git-clone-command, git-clone-redaction
6 `@/app/api/projects/[projectId]/chat/stream/route` — chat-stream-route-mcp, chat-stream-route-openai, chat-stream-route, composite-persistent-chat, chat-stream-route-openai-tools, composite-route-boundaries
6 `@/lib/agents/scheduler` — qa-report-terminal-writes, agent-scheduler, pipeline-e2e, dispatch-background-session, pipeline-grading-composite, wave-runner
6 `@/app/api/settings/route` — github-config-route-contract, github-device-flow-credential-lifecycle, settings-route, github-settings-redaction, settings-key-allowlist, github-device-flow-routes
6 `@/lib/notifications/create` — auto-mode-second-opinion, agent-mentions-do-not-block-runs, notifications-create, session-failure-end-to-end, night-summary, webhooks-emit-points
6 `@/hooks/useConversations` — chat-thread-pane-focus-ring, agent-select-pill, chat-hook-state, chat-workspace-header-agent-select, chat-unified-agent-api-select, chat-page-responsive
6 `@/components/ticket/TicketOverlay` — ticket-overlay-pipeline-dispatch, ticket-overlay-git, ticket-overlay-mark-read, ticket-verify-band, ticket-overlay-capabilities, ticket-overlay
6 `@/lib/providers/oh-my-pi` — provider-extract-result-contract, omp-version-gate, named-agent-options-spawn, oversized-prompt-transport, omp-user-config-not-displaced, pi-providers
6 `@/lib/webhooks/send` — webhooks-release-emit, night-run-engine, night-run-e2e, webhooks-send, night-summary, webhooks-emit-points
6 `@/lib/pipeline/forensic` — session-chunk-retention, pipeline-e2e, night-run-e2e, dreaming-collector, pipeline-forensic-dispatch, telescope-collector
6 `@/lib/agent-sessions/prompt-cap` — session-chunk-retention, session-prompt-write-cap, session-detail-page, resolve-session-output, mcp-injection-lifecycle, session-prompt-backfill
6 `@/lib/types/kanban` — tickets-registry-aggregate, kanban-queue, workflow-engine, ticket-overlay-derive, tickets-registry-csv, i18n-review-regressions
6 `@/app/settings/page` — night-settings, projects-root-settings-section, usage-settings-section, settings-draft-save, full-auto-agent-settings, prompt-budget-settings
5 `@/lib/refinement/constants` — refinement-prompt, arij-mcp-shim, refinement-dispatch, refinement-report, refinement-merge-discard-create
5 `@/lib/events/bus` — events-route-teardown, ticket-overlay-verification-data, epic-verify-route, mcp-routes, event-bus
5 `@/lib/mcp/servers` — mcp-extra-servers-injection, mcp-server-probe, mcp-extra-servers-prompt, mcp-servers-crud, mcp-user-global-sync
5 `@/components/shared/AgentActionsBar` — pipeline-dispatch-checkbox, agent-dispatch-dialog-notice, grading-manual-action, epic-actions-done-status, story-actions
5 `@/lib/github/device-flow` — github-device-flow-route-transport, github-device-flow-credential-lifecycle, github-device-flow-persistence, github-device-flow, github-device-flow-routes
5 `@/app/api/auth/github/device/start/route` — github-device-flow-route-transport, github-device-flow-credential-lifecycle, github-device-flow-persistence, git-github-route-status-convention, github-device-flow-routes
5 `@/app/api/auth/github/device/poll/route` — mêmes 5 fichiers que start/route
5 `@/lib/validation/schemas` — projects-clone-route, clone-lifecycle-provenance, validation-schemas, manual-epic-form, epic-json-parsing
5 `@/lib/workflow/automatic-transitions` — automatic-transition-invariants, review-unverifiable-gate, build-route, epic-cascade-partial-failure, epic-cascade-activity
5 `@/hooks/useChat` — chat-thread-pane-focus-ring, chat-page-thread, chat-hook-state, chat-page-epic-card, chat-page-responsive
5 `@/lib/kanban/activity-feed` — comment-bubble, markdown-preview, pipeline-activity-feed, ticket-overlay-derive, epic-activity-feed
5 `@/lib/verify/regression-report` — comment-bubble, regression-report, verify-gate, pipeline-regression-gate, ticket-comment-content
5 `@/lib/workflow/log` — arij-actions, activity-api, workflow-log, pipeline-grading-composite, epic-activity-route
5 `@/app/projects/[projectId]/sessions/page` — focus-ring-undeclared, mobile-viewport-overflow, sessions-page-project-switch-race, sessions-page-pagination-sort, sessions-page-queued
5 `@/lib/i18n/format` — spec-anatomy-formatters, tickets-registry-aggregate, chat-page-rail, desk-your-turn, i18n-format
5 `@/lib/tokens/estimator` — spec-anatomy-formatters, spec-page-memory-panel, memory-doc, prompt-anatomy-route, token-estimator
5 `@/lib/uploads/image-attachments` — image-attachment-rules, chat-upload-platform-body-cap, chat-upload-route-limits, chat-upload-size-boundary, bug-create-route-validation
5 `@/components/piscine/TopBar` — inbox-sidebar-badge, top-bar-responsive, focus-ring-paints, top-bar, usage-rail-link
5 `@/lib/auto-mode/engine` — auto-mode-dispatch-guard, auto-mode-engine, auto-mode-e2e, full-auto-dispatch-agent, auto-mode-review-evidence
5 `@/lib/pipeline/findings` — review-unverifiable-gate, auto-mode-engine, review-channel-wiring, pipeline-findings, review-gate-consistency
5 `@/lib/pipeline` — pipeline-start-run, pipeline-e2e, night-run-e2e, pipeline-onterminal, pipeline-build-route-flag
5 `@/lib/agents/dag-batch-registry` — dag-batch-registry, night-batch-route, night-run-engine, auto-mode-select, night-run-e2e
5 `@/app/api/projects/[projectId]/epics/[epicId]/merge/route` — epic-merge-story-cascade, review-approval, auto-merge-agent, epic-cascade-activity, workflow-approval-regressions
5 `@/lib/workflow/memory-distill` — memory-route, pipeline-forensic-dispatch, dreaming-dispatch, memory-auto-distill, memory-distill-dispatch
4 `@/lib/documents/mentions` — documents-mentions, comments-mention-validation-routes, spec-write-atomicity, document-image-path-containment
4 `@/lib/agent-config/named-agents` — composite-agents-crud, named-agents-crud, composite-dispatch-argv-stub, named-agent-options-persistence
4 `@/app/api/projects/[projectId]/route` — clone-lifecycle-delete-route, github-config-route-contract, project-route-github-owner-repo, project-patch-default-branch
4 `@/lib/github/device-flow-store` — github-device-flow-route-transport, github-device-flow-credential-lifecycle, github-device-flow-persistence, github-device-flow-routes
4 `@/app/projects/[projectId]/git-sync/page` — git-sync-page, git-sync-page-no-remote, toast-surface-uniformity, git-sync-page-labels
4 `@/lib/git/diff` — worktree-diff, git-option-injection, diff-parser, review-unanchored-findings
4 `@/lib/usage/codex-snapshot` — usage-report, usage-route, usage-quota-cache, usage-codex-rate-limits
4 `@/lib/agents/scheduler-constants` — auto-mode-route, agents-workshop-limits-load, agent-scheduler, night-run-e2e
4 `@/app/api/projects/[projectId]/sessions/route` — sessions-list-response-budget, sessions-list-route, sessions-list-pagination, sessions-list-heavy-columns
4 `@/lib/agent-sessions/latest-failure` — sessions-list-response-budget, latest-failure, ticket-read-model-chronology, retry-resume-agent
4 `@/lib/verify/regression-constants` — regression-report, pipeline-settings-section, verify-gate, regression-check
4 `@/lib/dependencies/validation` — dependencies-api, epic-dependencies-api, dependencies-buildable-guard, dependencies-validation
4 `@/lib/workflow/merge-failure` — tickets-registry-route, control-desk-route, merge-failure-reasons, board-merge-readiness-route
4 `@/lib/agent-sessions/terminal-hooks` — session-terminal-hooks, auto-mode-e2e, auto-mode-instrumentation, session-failure-end-to-end
4 `@/app/settings/integrations/page` — settings-openai-section, settings-github-device-flow-ui, settings-codex-key, settings-webhooks-section
4 `@/app/projects/[projectId]/stories/[storyId]/page` — toast-under-open-dialog, story-detail-delete, story-detail-approve-merge-warning, toast-surface-uniformity
4 `@/lib/verify/verify-constants` — ticket-overlay-verification-data, verify-settings, pipeline-settings-section, ticket-verify-band
4 `@/app/api/projects/[projectId]/chat/upload/route` — bug-image-round-trip, chat-upload-platform-body-cap, chat-upload-route-limits, chat-upload-size-boundary
4 `@/app/api/projects/[projectId]/conversations/[conversationId]/route` — conversations-route, conversation-get-route, composite-persistent-chat, composite-route-boundaries
4 `@/app/api/projects/[projectId]/git/push/route`, `/git/pull/route`, `/git/status/route` (3 modules, mêmes 4 fichiers chacun) — git-sync-routes-no-remote, git-github-route-status-convention, git-sync-routes-not-a-repository, project-git-sync-routes
4 `@/lib/chat/persistent-runner` — omp-version-gate, composite-persistent-chat, omp-user-config-not-displaced, persistent-chat-runner
4 `@/components/shared/NamedAgentSelect` — named-agent-select-clear, named-agent-select-reliability, composite-select-availability, named-agent-select-loading
4 `@/lib/claude/json-parser` — session-usage-extraction, epic-lifecycle-status, resolve-session-output, json-parser
4 `@/lib/claude/resolve-session-output` — session-usage-extraction, session-outcome-classification, resolve-session-output, mcp-outcome-precedence
4 `@/lib/workflow/agent-question` — auto-mode-e2e, pipeline-e2e, night-run-e2e, agent-question-workflow
4 `@/proxy` — remote-access-credential, proxy-boundary, documents-upload-platform-body-cap, next-config-dev-origins
4 `@/lib/documents/memory` — memory-doc, memory-route, dreaming-dispatch, memory-distill-dispatch
4 `@/lib/pipeline/stages` — pipeline-e2e, pipeline-grading-composite, bug-image-pipeline-dispatch, pipeline-stages-dispatch

Familles de noms les plus étalées (préfixe à deux segments) : auto-mode-* 11 fichiers, tickets-registry-* 10, ticket-overlay-* 9, named-agent-* 8, qa-findings-* 7, clone-lifecycle-* 7, agent-config-* 7, night-run-* 6, sessions-list-/github-device-/git-sync-/chat-page-/bug-create-/agents-workshop-* 5 chacun.

## (5) Helpers de test dupliqués
Il existe un helper partagé (`lib/db/test-utils.ts` → `createTestDb()`, utilisé par 142 fichiers) et 9 helpers dans `__tests__/helpers/` (app-router-url, class-list-scan, db-mock, dropdown-menu-mock, legacy-chunks, mock-fetch, react-compiler-probe, tailwind-outline, upload-request). **Le seeding, lui, n'est pas mutualisé** : 119 noms de fonctions sont redéfinis dans ≥3 fichiers. Les significatifs, par nombre de fichiers distincts :
- **`seedProject` — 30 fichiers** : refinement-dispatch, github-sync-log-deleted-project, github-detect-not-a-repository, auto-mode-engine, spec-update-dispatch, worktrees-route-not-a-repository, git-github-route-status-convention, night-run-engine, auto-mode-select, full-auto-dispatch-agent, agent-scheduler-routes, board-merge-readiness-route, release-rejection-git-side-effects, git-sync-routes-not-a-repository, night-run-stop-route, dashboard-summary-route, review-comments, dispatch-background-session, night-run-e2e, dreaming-collector, memory-route, pipeline-forensic-dispatch, dreaming-dispatch, bug-image-pipeline-dispatch, project-prs-route, dreaming-route, telescope-collector, night-summary, memory-distill-dispatch, spec-update-route. Corps quasi identiques ; ex. `dreaming-route.test.ts` et `memory-route.test.ts` ne diffèrent que par le préfixe d'id (`proj-dream-route-` vs `proj-mem-route-`).
- **`seedSession` — 16** : usage-report, sessions-list-response-budget, usage-route, session-chunk-retention, session-terminal-hooks, boot-cleanup, inbox-api, dashboard-summary-route, session-watchdog, usage-dashboard-aggregate, epic-verify-route, dreaming-collector, sessions-active-route-projection, session-chunks, telescope-collector, session-prompt-backfill
- **`seedEpic` — 14** : automatic-transition-invariants, dependencies-buildable-guard, epic-build-asked-question, release-rejection-git-side-effects, arji-json-export-query-budget, inbox-api, dashboard-summary-route, epic-cascade-partial-failure, review-comments, usage-dashboard-aggregate, night-run-e2e, grading-agent-dispatch, epic-cascade-activity, night-summary
- **`flushBackground` — 14** : pipeline-start-run, spec-update-dispatch, build-route, night-batch-route, epic-build-asked-question, dispatch-background-session, pipeline-forensic-dispatch, dreaming-dispatch, pipeline-onterminal, build-route-dag, epic-lifecycle-status, spec-auto-rewrite-dispatch, pipeline-build-route-flag, memory-distill-dispatch
- **`installFetch` — 10** : github-device-flow-route-transport, use-control-desk-stale-refresh, auto-mode-dialog, frictions-page, qa-check-dispatch, spec-update-dialog, named-agent-select-reliability, import-page-github-flow, session-detail-page, qa-findings-actions — alors que `__tests__/helpers/mock-fetch.ts` existe déjà (`mockFetchSequence`).
- **`withDb` — 10**, **`tempDbPath` — 7**, **`columnNames` — 5** : famille des 11 tests de migration (db-init, db-init-foreign-keys, agent-sessions-epic-cost-index-migration, desk-dismissal-migration, core-table-indexes-migration, named-agent-escalation-removal, agent-session-estimated-tokens-migration, project-clone-source-migration, notification-message-migration, named-agent-options-migration, agent-session-review-verdict-migration). Copier-coller verbatim du bloc `MIGRATIONS_FOLDER` / lecture de `meta/_journal.json` / `tempDbPath()` / `withDb()` / `columnNames()` — vérifié mot pour mot entre `core-table-indexes-migration.test.ts` et `project-clone-source-migration.test.ts`.
- **`createFakeChild` — 8** : codex-provider-developer-instructions, claude-spawn-logging, agy-provider, providers, named-agent-options-spawn, oversized-prompt-transport, pi-providers, mcp-injection
- **`claudeEnvelope` — 8** : spec-update-dispatch, pipeline-e2e, dispatch-background-session, pipeline-forensic-dispatch, dreaming-dispatch, spec-auto-rewrite-dispatch, pipeline-stages-dispatch, memory-distill-dispatch
- **`jsonResponse` — 8** : mcp-create-bug, github-device-flow, use-control-desk-stale-refresh, chat-board-tools, mcp-chat-routes, session-detail-page, routines-settings, spec-page-update-feedback
- **`mockFetch` — 8** : desk-actions, mcp-servers-settings-ui, scan-project-dialog, bug-create-dialog-attachments, usage-screen, project-desk-create-dialogs, settings-draft-save, night-run-dialog
- **`renderBand` — 8** : qa-findings-runs, repo-strata-band, qa-findings-band, desk-ready-to-land, desk-your-turn, spec-suggestion-band, desk-working-band, desk-up-next
- **`renderDialog` — 8** : bug-create-dialog, scan-project-dialog, bug-create-dialog-labels, qa-check-dialog-labels, bug-create-dialog-attachments, qa-dismiss-dialog-description, night-run-dialog, epic-create-dialog
- **`renderSubject` — 7** : les 7 tests `ticket-overlay-*` / `ticket-verify-band`
- **`mockRequest` — 7** : build-route, build-route-dag, auto-merge-agent, epic-lifecycle-status, batch-selection, agent-launch-concurrency-routes, epic-build-concurrency — alors que `__tests__/helpers/upload-request.ts` fournit déjà `mockNextRequest` / `mockJsonRequest` / `mockRouteContext`.
- Autres ≥5 : `addEpic` 6, `addStory` 5, `addSession` 5, `makeRequest` 5, `mockSettings` 5, `hasBaseUtility` 6, `settle` 6, `baseOptions` 5.

## (6) Exclusions vitest et KNOWN_BAILED
`vitest.config.ts` : `include: ["**/*.test.{ts,tsx,mjs}"]`, `maxWorkers: 4`, `environment: "jsdom"`, `setupFiles: ["./vitest.setup.ts"]`.
`exclude` (5 entrées) : `**/node_modules/**`, `**/.next/**`, `.claude/**`, `projects/**`, `data/**` — commentées comme des arbres étrangers portant leurs propres copies de tests. `coverage.exclude` : `node_modules/`, `.next/`, `**/*.config.{ts,mts,mjs}`, `vitest.setup.ts`.
Conséquence directe : les `*.spec.ts` (les 35 e2e) ne sont pas dans `include`, donc jamais joués par vitest — voulu (Playwright), mais c'est aussi le piège « porte red→green » de la mémoire projet.
`KNOWN_BAILED` (`__tests__/react-compiler-coverage.test.ts:74`) : **30 entrées**, réparties app 5 / components 14 / hooks 11. Les 30 fichiers cibles existent tous dans l'arbre (aucune entrée périmée par la rationalisation UI). Liste : app/projects/[projectId]/frictions/page.tsx#ProjectFrictionsPage, .../git-sync/page.tsx#GitSyncPage, .../github-issues/page.tsx#GitHubIssuesPage, .../layout.tsx#ProjectShell, .../spec/page.tsx#SpecPage, components/auto-mode/AutoModeDialog.tsx#AutoModeDialog, components/chat-page/ChatPageView.tsx#ChatWorkspace, components/documents/ScanProjectDialog.tsx#ScanProjectDialog, components/github/GitHubConnectBanner.tsx#GitHubConnectBanner, components/kanban/EpicCreateDialog.tsx#EpicCreateDialog, components/night/NightRunDialog.tsx#NightRunDialog, components/qa/ReportDetail.tsx#ReportDetail, components/qa/StartQaCheckDialog.tsx#StartQaCheckDialog, components/routines/RoutinesSettings.tsx#RoutineEditor, components/routines/RoutinesSettings.tsx#RoutinesWorkspace, components/session-live/useSessionStreamPager.ts#useSessionStreamPager, components/settings/McpServersSection.tsx#McpServersWorkspace, components/shared/AgentActionsBar.tsx#AgentActionsBar, components/spec/MemoryPanel.tsx#MemoryPanel, hooks/useChat.ts#useChat, hooks/useDiff.ts#useDiff, hooks/useEpicDependencies.ts#useEpicDependencies, hooks/useEpicPr.ts#useEpicPr, hooks/useGitHubConfig.ts#useGitHubConfig, hooks/useGitStatus.ts#useGitStatus, hooks/useProjects.ts#useProjects, hooks/useQaReports.ts#useQaReports, hooks/useReviewComments.ts#useReviewComments, hooks/useUsage.ts#useUsage, hooks/useWorktrees.ts#useWorktrees.
Le commentaire d'en-tête du même fichier (lignes 40-45) annonce encore « 79 of the 485 functions … were dark, in 77 files » : chiffre d'une mesure ancienne, la liste effective en compte 30. Le commentaire est périmé, pas le test.

## (7) Ratio lignes de test / lignes produit par sous-répertoire
Attribution : chaque fichier de test est rattaché au sous-répertoire le plus cité parmi ses imports `@/…` et ses `vi.mock` (infra `@/lib/db*` et `@/lib/utils/nanoid` neutralisés). 596 des 709 fichiers ont pu être rattachés ; 113 (25 781 lignes) ne référencent que `app/`, `@/proxy` ou rien de `lib|components|hooks`.
```
sous-rep                 prodLOC  prodFic  testLOC  testFic  ratio
lib/converters                58        3      984        3   16.97
lib/sync                     599        3     2860        9    4.77
lib/types                    519        4     2277        3    4.39
lib/activity-registry         66        1      280        1    4.24
lib/events                   210        2      824        4    3.92
lib/projects                 794        8     2321       11    2.92
components/chat             1360        7     3904       12    2.87
lib/security                 161        1      441        2    2.74
lib/agent-config            3499       13     9479       30    2.71
lib/planning                 140        1      379        3    2.71
lib/claude                  6619       11    17592       52    2.66
lib/i18n                     848        9     2211        9    2.61
hooks                       6129       45    15602       61    2.55
lib/webhooks                 215        1      528        3    2.46
lib/agent-sessions          5579       31    13429       44    2.41
components/sessions          147        1      343        1    2.33
lib/git                     3337       12     7618       32    2.28
lib/github                  2101        9     4689       20    2.23
lib/control-desk            1066        3     2364        8    2.22
lib/settings                 151        1      329        2    2.18
lib/uploads                  838        6     1656        9    1.98
lib/night                   1325        4     2614        6    1.97
lib/mcp                     3294       13     6391       11    1.94
lib/workflow                6311       20    11715       27    1.86
lib/verify                  1739        9     3029       10    1.74
lib/dependencies            1053        4     1804        9    1.71
lib/refinement              1817        7     3000        4    1.65
lib/qa                      1107        4     1774        4    1.60
lib/epics                    199        1      309        1    1.55
lib/usage                   2131        6     3255        7    1.53
lib/auto-mode               5728        8     8629       11    1.51
lib/tickets-registry         866        4     1292        4    1.49
lib/providers               3278       12     4725       14    1.44
lib/codex                     14        1       20        1    1.43
components/kanban           1439        5     1931        7    1.34
lib/tokens                   856        5     1053        3    1.23
lib/validation               607        6      724        5    1.19
lib/kanban                  1134        8     1324        9    1.17
lib/pipeline                6469       29     7449       16    1.15
components/github            480        3      518        3    1.08
lib/chat                    2682       10     2818        9    1.05
components/shared           2432       14     2469       14    1.02
lib/openai                   708        2      713        3    1.01
components/spec             2160       11     2174        9    1.01
components/verify            120        1      118        1    0.98
components/ui               1398       16     1367        4    0.98
components/settings          784        1      694        1    0.89
lib/utils                    121        5      105        2    0.87
components/documents         881        4      716        4    0.81
lib/agents                  1129        8      917        4    0.81
lib/api                      168        2      130        1    0.77
lib/epic-parsing             443        1      333        1    0.75
components/auto-mode         531        2      394        1    0.74
components/story             348        2      258        2    0.74
components/qa               3277       20     2311        9    0.71
components/tickets-registry 2065        9     1424        5    0.69
lib/documents               1358       12      930        5    0.68
components/desk             3799       15     2584       10    0.68
components/chat-page        2976       20     1885        7    0.63
lib/routines                2633       11     1650        6    0.63
lib/telescope                943        2      582        1    0.62
lib/notifications           1282        1      726        1    0.57
components/night            1057        3      500        1    0.47
components/routines          838        1      313        1    0.37
components/import            354        5      117        2    0.33
components/agents-workshop  4376       25     1161        7    0.27
components/review            957        7      233        2    0.24
components/notifications     256        2       52        1    0.20
components/session-live     2688       15      382        3    0.14
lib/grading                  482        2       57        1    0.12
components/piscine          4179       30      380        2    0.09
components/releases         1293        9       97        1    0.08
components/ticket           3162       17      196        2    0.06
components/settings-piscine 3608       23       96        1    0.03
lib/db                      1780        6        0        0    0.00
lib/frictions                 61        2        0        0    0.00
lib/inbox                     25        1        0        0    0.00
lib/markdown                 101        2        0        0    0.00
lib/navigation                56        1        0        0    0.00
lib/piscine                  603        2        0        0    0.00
lib/review                    99        2        0        0    0.00
components/ThemeProvider      17        1        0        0    0.00
components/usage            1769        9        0        0    0.00
TOTAL                     134282      655   180706      596
```
Contre-mesure indépendante de l'attribution — nombre de fichiers de test qui *mentionnent* le sous-répertoire (import ou mock). Sous-répertoires produits jamais mentionnés une seule fois : **lib/inbox (1 fic./25 l.), lib/navigation (1/56), lib/review (2/99), components/usage (9/1769)**. Les trois premiers sont minuscules ; `components/usage` (1 769 lignes) est le seul volume réel — mais il est bien exercé indirectement, `usage-page.test.tsx` et `usage-screen.test.tsx` passent par `@/app/usage/page`. Aucun sous-répertoire produit n'est donc réellement sans couverture.
Sous-répertoires à faible mention directe (≤3 fichiers de test) : components/monitor (1, module inexistant — cf. §2), components/settings (1), components/settings-piscine (1), components/sessions (1), components/ThemeProvider (1), components/verify (1), components/routines (1), lib/markdown (1), lib/frictions (1), lib/export (1, inexistant), lib/codex (2), components/notifications (2), components/releases (2), components/import (2), lib/security (2), lib/settings (2), lib/epic-parsing (2), lib/grading (2), lib/api (3), lib/epics (3), components/session-live (3), lib/converters (3), lib/piscine (3).
