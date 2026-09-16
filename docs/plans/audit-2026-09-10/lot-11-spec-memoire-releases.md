# Lot 11 — Spec, mémoire (dreaming/distill) et releases

**Difficulté** 3/4 — Difficile
**Findings** 16 (4 fort · 7 moyen · 5 faible ; effort 12 S · 4 M · 0 L)
**Dépendances** Le point 109 (releases) après le lot 06. Le point 193 (codex en plan mode) est dans le lot 14.

## Décision

commitGeneratedSpec est le seul écrivain de projects.spec ; writeProjectMemoryGuarded le seul écrivain de la mémoire (PUT compris) ; les releases ne bloquent plus la requête HTTP.

## Objectif

Corriger les quatre bugs de mémoire (distill sur une ligne, rêve rejeté invisible, restore sans recul du cutoff, PUT sans garde), fusionner les trois écrivains de spec dans lib/workflow/spec-writers.ts, faire passer spec-auto-rewrite par commitGeneratedSpec, rendre le publish de release atteignable (pushedAt seulement au publish ou colonne publishedAt), dispatcher le changelog en arrière-plan, exposer titre/changelog éditables, dédoublonner l'entrée activity-registry du run de release.

## Démarche suggérée

1. Tests rouges d'abord pour 12/106 (conflit de spec), 184 (résumé multi-lignes), 105 (draft ≠ published).
2. spec-writers.ts : sanitize, pending-guard, board-state, écriture unique ; generate-spec envoie conversationId et l'agent, filtre par conversation, renvoie epicsCreated.
3. dreaming : validation dans evaluate → success:false + error ; événement « dream discarded » rendu par MemoryPanel ; restore remet le cutoff.
4. PUT /memory : expectedPrevious + 409 ; MemoryPanel désactive Save sur conflit.
5. releases : dispatchBackgroundSession (dépend du lot 06) ou au minimum timeout ; champs titre/changelog dans l'UI.
6. Retirer les 3 notifications mémoire (déjà couvertes par le lot 01) et le deep-link #memory-panel ; nettoyer les commentaires memory: null.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #105 — Le flux « publier la release GitHub » est inatteignable : une draft créée par la route est classée « published »

**Nature** cassé · **Impact** fort · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/api/projects/[projectId]/releases/route.ts:427-430`
- `app/api/projects/[projectId]/releases/route.ts:455-467`
- `components/releases/derive.ts:47-62`
- `app/projects/[projectId]/releases/page.tsx:294-298`
- `components/releases/NextReleaseBand.tsx:288-300`
- `components/releases/ReleaseHistory.tsx:104-113`
- `hooks/useReleasePublish.ts`
- `app/api/projects/[projectId]/releases/[releaseId]/publish/route.ts`
- `__tests__/releases-history.test.tsx:113-122`

**Constat**

`POST /releases` écrit `pushedAt` au moment même où il crée la draft GitHub (route.ts:429 puis :464), alors que `releaseState()` définit `published` = `githubReleaseId && pushedAt` et `draft` = `githubReleaseId` sans `pushedAt` (derive.ts:56-62, commentaire : « pushedAt is stamped at creation as well as at publish — the two-field test is the only thing separating a pushed draft from a published release »). Conséquence : toute release créée avec « GitHub draft » coché est immédiatement « published » côté UI ; `canPublish` (page.tsx:294-298, exige `releaseState === "draft"`) n'est jamais vrai, le bouton Publish (NextReleaseBand.tsx:288-300) et le stamp « GH DRAFT » (ReleaseHistory.tsx:108-112) ne s'affichent jamais. `POST /releases/[releaseId]/publish`, `hooks/useReleasePublish.ts` et le stamp draft sont donc du code vivant mais jamais atteint depuis l'app. Les tests pinnent une fixture (`githubReleaseId: 9, pushedAt: null`, releases-history.test.tsx:113-122) que le serveur ne produit jamais. Le bug précède la refonte Piscine (state porté « verbatim », commit 99e2de34 ; `pushedAt` à la création introduit par 612bd401/05f1c154).

**Précision du vérificateur**

`POST /api/projects/[projectId]/releases` stampe `pushedAt` (route.ts:429) dans la même séquence que `githubReleaseId` (route.ts:427) dès la création de la draft GitHub, et les insère ensemble (route.ts:462-464). `releaseState()` (components/releases/derive.ts:58-63) classe "published" = `githubReleaseId && pushedAt`, "draft" = `githubReleaseId` seul ; aucun autre écrivain de la table `releases` n'existe (seuls route.ts:452 et publish/route.ts:86). L'état "draft" est donc inatteignable pour toute ligne produite par l'app : une release créée avec « GitHub draft » est immédiatement affichée « published ». Conséquences vérifiées : `canPublish` (app/projects/[projectId]/releases/page.tsx:302-306, exige `releaseState === "draft"`) est toujours faux ; le bouton `release-publish-button` (components/releases/NextReleaseBand.tsx:277-291) et le stamp `history.githubDraft` (components/releases/ReleaseHistory.tsx:115-119) ne sont jamais rendus ; `hooks/useReleasePublish.ts` et `POST …/releases/[releaseId]/publish` (qui, lui, lit correctement `draft` depuis l'API GitHub) sont du code vivant jamais atteint depuis l'UI. La fixture `DRAFT` (`githubReleaseId: 9, pushedAt: null`, __tests__/releases-history.test.tsx:113-124) décrit un état que le serveur ne produit jamais. Le commentaire de derive.ts:47-50 documente l'inverse de ce que le code fait. Bug antérieur à la refonte Piscine (99e2de34 porte le même test ; stamp à la création introduit par 612bd401/05f1c154).

`POST /api/projects/[projectId]/releases` (route.ts:414-429) stampe `pushedAt` dans le même bloc que `createDraftRelease` — même si le push de tag a échoué — et l'insère à la ligne 464, alors que `releaseState()` (components/releases/derive.ts:58-63) ne renvoie `draft` que si `githubReleaseId` est posé SANS `pushedAt`. Les seuls écrivains de la table sont cette route et `publish/route.ts:86`, donc aucune ligne « draft » n'existe jamais en base. Conséquence : `canPublish` (page.tsx:302-306) est toujours faux, le bouton Publish (NextReleaseBand.tsx:277-290, testid `release-publish-button`) et le stamp GitHub draft (ReleaseHistory.tsx:117-118) ne s'affichent jamais ; `hooks/useReleasePublish.ts` (seul appelant de `/publish`, importé uniquement par page.tsx:27) est du code vivant mais inatteignable depuis l'UI — la route `/publish` reste seulement appelable en HTTP direct. Bug antérieur à la refonte Piscine (même `releaseState` dans `99e2de34^`, `pushedAt` à la création introduit par 612bd401/05f1c154). Les tests (releases-history.test.tsx:113-122 et :323, releases-derive.test.ts:224) pinnent une fixture `githubReleaseId: 9, pushedAt: null` que le serveur ne produit jamais ; github-release-lifecycle.test.ts:174 n'assert rien sur `pushedAt`.

**Recommandation**

Ne stamper `pushedAt` qu'au publish (ou ajouter une colonne `publishedAt` distincte, ou lire `draft` depuis l'API GitHub) et faire dériver `releaseState` de cette vérité ; corriger les fixtures des tests pour refléter ce que la route écrit réellement ; ajouter un test de bout en bout création-draft → bouton Publish visible.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n pushedAt lib app components hooks` → seuls écrivains : releases/route.ts:388/429/464 (création, `pushedAt = new Date().toISOString()` juste après `createDraftRelease`) et publish/route.ts:87. derive.ts:58 `if (release.githubReleaseId !== null && release.pushedAt !== null) return "published"`. `git show 99e2de34^:app/projects/[projectId]/releases/page.tsx` ligne 58 : même test deux champs dans l'ancienne page.

</details>

### #106 — La réécriture automatique de spec (après release) écrase les éditions concurrentes : elle contourne la comparaison introduite par la rationalisation

**Nature** cassé · **Impact** fort (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `lib/workflow/spec-auto-rewrite.ts:330-355`
- `lib/workflow/spec-update.ts:200-215`
- `lib/projects/spec-write.ts:29-45`
- `app/api/projects/[projectId]/route.ts:65`
- `app/projects/[projectId]/spec/page.tsx:126-128`

**Constat**

La rationalisation annonce « comparaison avec la spec utilisée par le prompt avant écriture ; une édition concurrente provoque un conflit ». C'est vrai pour `lib/workflow/spec-update.ts:206-210` (`commitGeneratedSpec(projectId, project.spec, …)` → `ProjectSpecChangedError`) et pour generate-spec. Mais `lib/workflow/spec-auto-rewrite.ts:344-347` fait `db.update(projects).set({ spec: output, updatedAt })` sans aucune comparaison avec `project.spec` capturé au dispatch (:308). Un utilisateur qui sauvegarde sa spec pendant la minute où l'agent tourne (PATCH `/api/projects/[id]` accepte `spec` sans garde, route.ts:65 ; le blocage n'est que côté client `updateStatus === "running"`, spec/page.tsx:127) voit son texte remplacé sans conflit ni proposition sauvegardée. Le fichier n'est pas touché par l'arbre de travail (absent de `git status`).

**Précision du vérificateur**

La réécriture automatique de spec après release contourne la comparaison introduite par la rationalisation. `lib/workflow/spec-auto-rewrite.ts` capture `project.spec` pour le prompt (:283) puis, dans `onTerminal` (:314-317), écrit `db.update(projects).set({ spec: output, updatedAt: completedAt })` sans relire ni comparer la spec courante, alors que le flux manuel (`lib/workflow/spec-update.ts:203`, diff non commité) et generate-spec passent désormais par `commitGeneratedSpec` → `ProjectSpecChangedError` (`lib/projects/spec-write.ts:38-41`). C'est le seul écrivain direct de `projects.spec` restant hors tests. PATCH `/api/projects/[projectId]` (route.ts:95) accepte `spec` sans garde serveur ; le seul verrou est côté client dans `components/spec/SpecWorkspace.tsx:90/218` (`updateStatus === "running"`), alimenté par un fetch unique au montage (:77-84), donc inopérant pour un utilisateur déjà sur la page quand la release déclenche la réécriture. Une sauvegarde utilisateur pendant la session auto est écrasée sans conflit ni proposition. Aucun test de conflit dans `__tests__/spec-auto-rewrite-*.test.ts`.

La réécriture automatique de spec après release (`lib/workflow/spec-auto-rewrite.ts:315-318`, fichier non touché par l'arbre de travail) écrit `projects.spec` par `db.update` direct sans comparer avec la spec capturée au dispatch (:241-244, passée au prompt :282), contrairement à `spec-update.ts:203` et `generate-spec/route.ts:138` qui passent par `commitGeneratedSpec` (`lib/projects/spec-write.ts:30-41`, nouveau fichier untracked) et lèvent `ProjectSpecChangedError`. Le doc de rationalisation (§ Écriture de spec, ligne 48) promet la comparaison sans exclure ce chemin. Le PATCH `/api/projects/[id]` accepte `spec` sans garde serveur (`route.ts:95`) ; le seul blocage est client, dans `components/spec/SpecWorkspace.tsx:90,218` (et non `spec/page.tsx:127`, réduit à 9 lignes par la rationalisation). Ce blocage couvre bien la session auto-rewrite (même `agentType` « spec_generation » lu par `GET /spec/update`) mais seulement au montage de la page : un onglet Spec ouvert avant la release, ou un appel API direct, peut sauvegarder pendant la course et voir son texte remplacé sans conflit ni proposition. Exposition limitée : réglage `spec_auto_rewrite` off par défaut, déclencheur unique = POST releases (`releases/route.ts:504`). Aucun test de conflit dans `__tests__/spec-auto-rewrite-*.test.ts`.

**Recommandation**

Faire passer `onTerminal` de spec-auto-rewrite par `commitGeneratedSpec(projectId, project.spec, { spec: output }, { updatedAt })` et, en cas de `ProjectSpecChangedError`, `saveConflictingSpecProposal` comme generate-spec ; ajouter un test de conflit. Optionnel : refuser côté serveur un PATCH `spec` pendant une session `spec_generation` pendante (409).

<details><summary>Preuve relevée par l'auditeur</summary>

spec-auto-rewrite.ts:344 `db.update(projects).set({ spec: output, updatedAt: completedAt }).where(eq(projects.id, input.projectId)).run();` — aucun import de `commitGeneratedSpec`/`ProjectSpecChangedError` dans ce fichier (`rg commitGeneratedSpec lib/workflow` → spec-update.ts seulement). `rg -ln "ProjectSpecChangedError|commitGeneratedSpec" __tests__/spec-auto-rewrite-*.test.ts` → vide.

</details>

### #184 — Le distill lit une seule LIGNE de la session source alors que le collecteur de dreaming documente ce choix comme faux

**Nature** cassé · **Impact** fort · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `lib/workflow/memory-distill.ts:461-470`
- `lib/workflow/dreaming-collector.ts:405-430`
- `lib/agent-sessions/chunks.ts:660-671`
- `lib/agent-sessions/last-text.ts:9-18`

**Constat**

`loadSourceSessionContext` (memory-distill.ts:461-470) prend `agent_sessions.last_non_empty_text` en premier, puis le fichier de logs, et tronque la TÊTE à 2 000 caractères. Or cette colonne est alimentée par `extractLastNonEmptyText(input.content)` à chaque chunk output/response (chunks.ts:660-671), qui renvoie la dernière ligne non vide (last-text.ts:9-18). Le collecteur de dreaming, écrit plus tard, dit explicitement que cet ordre « collapsed a whole review report to one line » et lit `readChunkTail(id, 'response'|'output', 4000)` d'abord (dreaming-collector.ts:405-430). Le prompt de distillation (« ### Session Result ») reçoit donc en pratique une ligne, et l'auto-distill de chaque build vert (instrumentation.ts:99) dépense une session d'agent pour ré-écrire la mémoire à partir de cette ligne. Le cas 'logs file' ne rattrape rien : `extractLastNonEmptyTextFromLogs` renvoie aussi une seule entrée.

**Précision du vérificateur**

`loadSourceSessionContext` (lib/workflow/memory-distill.ts:470-482) prend `agent_sessions.last_non_empty_text` en premier, puis le fichier de logs, et tronque la tête à 2 000 caractères. Cette colonne ne contient jamais plus qu'une ligne : chunks.ts:666 (`extractLastNonEmptyText`), backfill.ts:40-45 et chunk-prune.ts:230-238 y écrivent tous la dernière ligne non vide, alors que le chunk `output`/`response` source est le texte final entier (process-manager.ts:696, codex.ts:371). Le fallback fichier renvoie aussi une seule entrée. Le collecteur de dreaming (dreaming-collector.ts, non suivi, :420-446) documente ce choix comme faux et lit `readChunkTail(…, 4000)` d'abord. Le prompt `### Session Result` (lib/claude/prompts/memory.ts:65-71) reçoit donc une ligne, pour le distill manuel (route memory/distill:88) comme pour l'auto-distill (instrumentation.ts:99) — ce dernier seulement quand le setting `memory_auto_distill` est activé (DEFAULT OFF, memory-distill.ts:87-98) et pour les sessions build non couvertes par un dream de night-run.

**Recommandation**

Réutiliser `resolveFinalText` du collecteur (l'exporter) dans `loadSourceSessionContext`, avec `tailText` plutôt que `slice(0, …)` ; un test rouge : une session dont le dernier chunk est un rapport multi-lignes doit produire un résumé de plus d'une ligne.

<details><summary>Preuve relevée par l'auditeur</summary>

memory-distill.ts:461 `let resultSummary = session.lastNonEmptyText ?? null;` … `resultSummary.slice(0, MEMORY_DISTILL_SUMMARY_MAX_CHARS)` (tête). dreaming-collector.ts:389-397 docblock : « Preferring it collapsed a whole review report to one line » puis boucle `for (const streamType of ['response','output']) readChunkTail(...)`. chunks.ts:666 `extractLastNonEmptyText(input.content)` → last-text.ts:9 « Extract the last non-empty line ».

</details>

### #185 — Un rêve rejeté (structure invalide, mémoire modifiée) est invisible : ligne de session « success », aucun événement, aucune notification, seulement console.warn

**Nature** à moitié câblé · **Impact** fort (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `lib/workflow/dreaming.ts:314-352`
- `lib/agent-sessions/dispatch-background-session.ts:383-402`
- `lib/workflow/spec-update.ts:196-215`
- `components/spec/MemoryPanel.tsx:334-340`

**Constat**

`dispatchDreamingSession` ne passe pas de hook `evaluate` à `dispatchBackgroundSession` ; `markSessionTerminal` est donc écrit avec `success: !!result.success` AVANT `onTerminal` (dispatch-background-session.ts:383-402). Quand `validateDreamedMemoryStructure` refuse le document (dreaming.ts:314-325) ou que `ProjectMemoryChangedError` est levée (:341-352), la fonction fait `console.warn`/`console.info` puis `return` : pas de `memory:changed`, pas de notification, cutoff inchangé, mais la ligne agent_sessions reste `status=completed, success=1, outcome=answered`. L'utilisateur qui a cliqué « Dream » a été redirigé sur la page de session (MemoryPanel.tsx:339) et y voit une session réussie, tandis que le panneau mémoire ne bouge pas. spec-update.ts:196-215 fait l'inverse pour le même helper : `evaluate` marque la ligne `success:false` avec la raison quand le document n'a pas été remplacé — c'est exactement la règle que le docblock de dispatch-background-session énonce (« the row must not claim success over an unchanged document »).

**Précision du vérificateur**

Vrai mais à requalifier : un rêve rejeté (structure invalide, dreaming.ts:313-325 ; mémoire éditée pendant le run, :345-351 ; même chose pour le distill, memory-distill.ts:646-651) laisse la ligne agent_sessions en status=completed/success=1/outcome=answered/error=null parce que dispatchDreamingSession ne fournit pas d'`evaluate` (dispatch-background-session.ts:375-395 écrit le verdict par défaut avant onTerminal). Aucun `memory:changed`, cutoff inchangé, aucune notification — seulement console.warn/info ; un `session:completed` est toutefois émis (:282-291). L'utilisateur redirigé par MemoryPanel.tsx:339 voit une session sans erreur (LiveSessionScreen.tsx:117-147 n'affiche rien sans `session.error`). Mais cette posture est délibérée et épinglée : dreaming-dispatch.test.ts:402-437/:763-800 et memory-distill-dispatch.test.ts:309-345 affirment explicitement outcome=answered, status=completed et zéro notification (« The run itself is a success — its output stays readable on the session row »). Le défaut réel est l'absence de tout signal utilisateur du rejet (pas d'`error` sur la ligne, pas de notification « dream discarded »), en contraste avec spec-update.ts:196-215 qui marque success:false — pas un demi-câblage oublié ; le remède doit modifier les tests qui pinnent le comportement actuel.

**Recommandation**

Déplacer la validation/sanitisation dans `evaluate` (comme spec-update) pour que la ligne de session porte `success:false` + `error: structure.reason` ; émettre un événement (ou une notification) « dream discarded » que MemoryPanel affiche via `message`. Même traitement pour le distill sur `ProjectMemoryChangedError`.

<details><summary>Preuve relevée par l'auditeur</summary>

grep `evaluate:` dans lib/ → spec-update.ts:196, grading/dispatch.ts:285, second-opinion.ts:451, refinement/dispatch.ts:235 ; absent de dreaming.ts et memory-distill.ts. dreaming.ts:318 `console.warn(... discarded ... did not match the required structure ...); return;`.

</details>

### #12 — spec-auto-rewrite écrit `projects.spec` en brut et contourne la protection anti-écrasement de commitGeneratedSpec

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** auto-mode-night-workflow

**Fichiers**
- `lib/workflow/spec-auto-rewrite.ts:302-330`
- `lib/workflow/spec-update.ts:195-212`
- `lib/projects/spec-write.ts:30-45`
- `lib/workflow/spec-auto-rewrite.ts:72-87`
- `lib/workflow/spec-update.ts:58-90`
- `docs/architecture/ui-rationalisation-2026-09-10.md:47`

**Constat**

La rationalisation du 10/09 annonce (section « Écriture de spec ») qu'une édition concurrente de la spec provoque un conflit au lieu d'être écrasée, via `commitGeneratedSpec` qui compare la spec courante à celle du prompt dans une transaction. Le flux manuel (lib/workflow/spec-update.ts) l'utilise. Le flux automatique déclenché par une release (lib/workflow/spec-auto-rewrite.ts) fait toujours `db.update(projects).set({ spec: output })` sans comparaison : un utilisateur qui édite la spec pendant la session `spec_generation` de la release voit son édition écrasée silencieusement. Le module est par ailleurs un quasi-doublon de spec-update.ts : deux `sanitize*Spec` (regex légèrement différentes), deux gardes « spec_generation pending » (`hasPendingSpecGeneration` vs `hasPendingSpecUpdate`/`getPendingSpecUpdateSession`), deux chargeurs d'état du board (`loadBoardState` vs les trois selects inline passés à `buildProjectStateSection`).

**Précision du vérificateur**

La rationalisation du 10/09 (docs/architecture/ui-rationalisation-2026-09-10.md:47) annonce qu'une édition concurrente de la spec provoque un conflit au lieu d'être écrasée, via commitGeneratedSpec (lib/projects/spec-write.ts:30-45, comparaison current.spec vs expectedSpec en transaction, l.41). Le flux manuel l'utilise (lib/workflow/spec-update.ts:203, dans `evaluate`). Le flux automatique déclenché par une release (app/api/projects/[projectId]/releases/route.ts:504 → lib/workflow/spec-auto-rewrite.ts) écrit toujours en brut : spec-auto-rewrite.ts:315-318 `db.update(projects).set({ spec: output, updatedAt: completedAt })…run()` dans onTerminal, sans import de commitGeneratedSpec/ProjectSpecChangedError. La fenêtre est réelle : le prompt capture project.spec au dispatch (l.290-296) alors que la session peut rester queued ; PATCH /api/projects/:id (app/api/projects/[projectId]/route.ts:95-97) accepte `spec` sans garde pending ; components/spec/SpecWorkspace.tsx:72-83 ne lit GET /spec/update qu'au montage, donc une page Spec déjà ouverte n'apprend jamais la session auto et handleSave (l.87) laisse partir le PATCH, écrasé ensuite silencieusement. Feature gated par le setting spec_auto_rewrite, OFF par défaut. Le module est un quasi-doublon de spec-update.ts : sanitizeRewrittenSpec (l.185, regex sans \r?\n ni fin tolérante) vs sanitizeUpdatedSpec (spec-update.ts:80-83) ; hasPendingSpecGeneration (l.72-86) vs getPendingSpecUpdateSession/hasPendingSpecUpdate (spec-update.ts:59-79, même requête) ; loadBoardState (l.193-235) vs trois selects inline (spec-update.ts:~140-171, avec orderBy). Corrections de citations : app/projects/[projectId]/spec/page.tsx ne fait plus que 9 lignes (état déplacé dans SpecWorkspace) ; la recommandation doit s'aligner sur app/api/projects/[projectId]/generate-spec/route.ts:138-142 (commitGeneratedSpec + saveConflictingSpecProposal), pas sur dreaming.ts qui ne gère pas ce conflit. Aucun test __tests__/spec-auto-rewrite-*.test.ts ne couvre l'édition concurrente.

Le flux automatique de réécriture de spec (opt-in via le réglage `spec_auto_rewrite`, déclenché par POST /api/projects/:id/releases → maybeAutoRewriteSpecAfterRelease, app/api/projects/[projectId]/releases/route.ts:504) persiste le résultat par `db.update(projects).set({ spec: output, updatedAt })` sans comparaison avec la spec capturée au prompt (lib/workflow/spec-auto-rewrite.ts:315-318, `project.spec` capturé l.282 puis ignoré), alors que le flux manuel passe par `commitGeneratedSpec` (lib/workflow/spec-update.ts:203, lib/projects/spec-write.ts:38-41) et que docs/architecture/ui-rationalisation-2026-09-10.md:47 promet un conflit à la place de l'écrasement. Chemin concurrent réel : l'éditeur (components/spec/SpecWorkspace.tsx:93-96) sauvegarde via PATCH /api/projects/:id qui écrit `spec` en brut sans garde pending ni 409 (app/api/projects/[projectId]/route.ts:95-97) ; le gel de l'éditeur n'est évalué qu'une fois au montage (SpecWorkspace.tsx:70-83), donc une page déjà ouverte lors de la release reste éditable et l'édition sauvegardée pendant la session est écrasée en silence. Absence aussi de `evaluate` : un échec d'écriture (l.319-322) laisse la session en succès. Quasi-doublon de spec-update.ts confirmé : sanitizeRewrittenSpec (l.185, regex sans \r?\n ni lazy) vs sanitizeUpdatedSpec (spec-update.ts:85) ; hasPendingSpecGeneration (l.74-87) vs getPendingSpecUpdateSession/hasPendingSpecUpdate (spec-update.ts:59-79) ; loadBoardState (l.194-231) vs selects inline (spec-update.ts:145-172). Aucun test de spec-auto-rewrite ne référence commitGeneratedSpec/ProjectSpecChangedError. Corrections : la ligne 344 n'existe pas ; route.ts:65 → 95-97 ; spec/page.tsx:126-128 n'existe pas (9 lignes) ; la route PATCH et lib/sync/import.ts:43-50 écrivent aussi la spec en brut (écritures utilisateur) ; dreaming.ts ne gère pas ProjectSpecChangedError — le seul gestionnaire est app/api/projects/[projectId]/generate-spec/route.ts:142 (saveConflictingSpecProposal), et spec-update.ts renvoie un verdict d'échec via evaluate.

**Recommandation**

Faire passer spec-auto-rewrite par `commitGeneratedSpec(projectId, project.spec, { spec: output })` avec le `project.spec` capturé au moment du prompt, et traiter ProjectSpecChangedError comme le fait dreaming.ts (journaliser, ne pas écraser). Fusionner ensuite les deux modules : une seule fonction `dispatchSpecGenerationSession({ instruction | release })`, un seul sanitize, une seule garde pending.

<details><summary>Preuve relevée par l'auditeur</summary>

spec-auto-rewrite.ts:315-318 `db.update(projects).set({ spec: output, updatedAt: completedAt }).where(eq(projects.id, input.projectId)).run();` ; spec-update.ts:203 `commitGeneratedSpec(input.projectId, project.spec, { spec: output }, { updatedAt: completedAt })` ; spec-write.ts:38 `if ((current.spec ?? "") !== (expectedSpec ?? "")) throw new ProjectSpecChangedError();`. `rg 'db\.update\(projects\)' lib` → seul écrivain de spec hors commitGeneratedSpec : spec-auto-rewrite.ts:315. Doublons : sanitizeRewrittenSpec (l.196) vs sanitizeUpdatedSpec (spec-update.ts:80, regex `\r?\n` tolérante), hasPendingSpecGeneration (l.72) vs hasPendingSpecUpdate (spec-update.ts:76).

</details>

### #107 — Trois écrivains de spec avec helpers dupliqués et divergents (generate-spec, spec/update, spec-auto-rewrite)

**Nature** doublon · **Impact** moyen (vérificateur : plutôt plus) · **Effort** M · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `lib/workflow/spec-update.ts:24,80-98,143-171`
- `lib/workflow/spec-auto-rewrite.ts:52,72-85,189-234,344-347`
- `app/api/projects/[projectId]/generate-spec/route.ts`

**Constat**

Le même concept est implémenté trois fois : (1) `generate-spec/route.ts` — synchrone, `spawnClaude` direct, pas de ligne `agent_sessions` (seul `activityRegistry`), historique de chat ; (2) `spec-update.ts` — `dispatchBackgroundSession` + `commitGeneratedSpec` ; (3) `spec-auto-rewrite.ts` — `dispatchBackgroundSession` + `db.update` direct. Entre (2) et (3) : `sanitizeUpdatedSpec` (spec-update.ts:88-98, regex `^```[a-zA-Z0-9_-]*\r?\n…`) vs `sanitizeRewrittenSpec` (spec-auto-rewrite.ts:189-196, regex `^```[a-zA-Z]*\n…` — ne gère ni CRLF ni `json5`/`md-x`), `hasPendingSpecUpdate` (spec-update.ts:80-82) vs `hasPendingSpecGeneration` (spec-auto-rewrite.ts:72-85, même requête SQL), constante `SPEC_UPDATE_AGENT_TYPE` vs `SPEC_REWRITE_AGENT_TYPE` (même valeur), et le chargement de l'état du board : spec-update.ts:143-171 ordonne epics/stories par `position`, `loadBoardState` (spec-auto-rewrite.ts:198-234) ne les ordonne pas — les deux prompts ne voient pas le même ordre.

**Précision du vérificateur**

Deux (et non trois) chemins d'écriture divergents subsistent dans l'arbre de travail : `generate-spec/route.ts` (l.13,138) et `lib/workflow/spec-update.ts` (l.21,203) passent tous deux par le nouveau `lib/projects/spec-write.ts#commitGeneratedSpec` (untracked, issu de la rationalisation), tandis que `lib/workflow/spec-auto-rewrite.ts:315-318` écrit encore `db.update(projects).set({ spec })` en direct — sans le contrôle d'écriture concurrente `expectedSpec`/`ProjectSpecChangedError` de commitGeneratedSpec, donc il écrase une spec éditée pendant le run. Les helpers dupliqués restent : `sanitizeUpdatedSpec` (spec-update.ts:85-96, regex tolérante CRLF/`[a-zA-Z0-9_-]`, non gourmande) vs `sanitizeRewrittenSpec` (spec-auto-rewrite.ts:185-192, `^```[a-zA-Z]*\n([\s\S]*)\n```$` : ni CRLF ni `json5`/`md-x`) ; `hasPendingSpecUpdate` (spec-update.ts:79-82) vs `hasPendingSpecGeneration` (spec-auto-rewrite.ts:71-86), même requête sur le même agentType "spec_generation" (constantes SPEC_UPDATE_AGENT_TYPE:25 / SPEC_REWRITE_AGENT_TYPE:52, même valeur) ; état du board ordonné par `position` côté spec-update (l.143-171) mais pas dans `loadBoardState` (spec-auto-rewrite.ts:194-243). Et generate-spec reste synchrone (`spawnClaude` l.114, `activityRegistry` l.86/155, aucune ligne `agent_sessions`), donc invisible dans /sessions.

**Recommandation**

Extraire un module `lib/workflow/spec-writers.ts` (sanitize unique, pending-guard unique, board-state unique, écriture via `commitGeneratedSpec`) consommé par les deux dispatchs ; envisager de faire passer generate-spec par `dispatchBackgroundSession` pour qu'il ait une ligne de session visible dans /sessions.

<details><summary>Preuve relevée par l'auditeur</summary>

Lecture intégrale des trois fichiers ; `rg -n "function sanitize" lib/workflow` → deux fonctions ; `rg -n "inArray(agentSessions.status, \[\"queued\", \"running\"\])" lib/workflow` → spec-update.ts:73 et spec-auto-rewrite.ts:80.

</details>

### #108 — « Générer la spec » depuis le chat ignore la conversation courante et n'a ni retour de succès ni paramètre d'agent

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `hooks/useSpecGeneration.ts:28-43`
- `app/api/projects/[projectId]/generate-spec/route.ts:30-50`
- `components/chat-page/ChatPageView.tsx:666-679`
- `hooks/useChatWorkspace.ts:24-60`
- `lib/db/schema.ts:178`

**Constat**

Le bouton (ChatPageView.tsx:666-679, gardé par `isBrainstorm` et `hasUserMessage` de la conversation ACTIVE) appelle `useSpecGeneration` qui fait `POST /generate-spec` sans corps (useSpecGeneration.ts:30). La route lit les 30 derniers `chatMessages` du PROJET entier (generate-spec/route.ts:44-50, `where(eq(chatMessages.projectId, projectId))`) alors que `chat_messages.conversation_id` existe (schema.ts:178) : la spec est générée depuis un mélange de conversations, pas depuis celle où l'utilisateur a cliqué. Le parsing `body.namedAgentId` (route.ts:30-38) n'a aucun appelant qui l'envoie. En succès le hook ne fait que `router.refresh()` (useSpecGeneration.ts:43) : aucun message, aucune navigation vers /spec, alors que la route a aussi créé des epics et passé le projet en `specifying`.

**Précision du vérificateur**

Le bouton « Generate Spec & Plan » est atteignable depuis deux surfaces montées (/chat via ChatPageView.tsx:666-677 et /projects/:id via UnifiedChatPanel.tsx:240-247 → ChatWorkspaceHeader.tsx:170-188), toutes deux gardées par `isBrainstorm`/`hasUserMessage` de la conversation active (useChatWorkspace.ts:22-30,57-60,80). Le seul appelant de la route, useSpecGeneration.ts:30, POSTe sans corps ; la route lit les 30 derniers `chat_messages` du projet entier (route.ts:44-51) alors que `conversation_id` existe (schema.ts:178) et que la route chat sait filtrer dessus. Le parsing `body.namedAgentId` (route.ts:29-37) est mort — et l'était déjà à HEAD, où le hook envoyait `{ provider }`, clé jamais lue. En succès le hook ne fait que `router.refresh()` (l.41) : `epicsCreated` n'est consommé par personne, aucun toast ni lien vers /spec, contrairement au chemin voisin « toward the spec » (ChatPageView.tsx:638-640). Le test spec-generation-state.test.ts:22 épingle l'appel sans corps, et les tests des surfaces chat mockent le hook : aucun test ne couvre le câblage réel.

« Générer la spec » depuis le chat (deux boutons : components/chat-page/ChatPageView.tsx:665-677 et components/chat/ChatWorkspaceHeader.tsx:171-189 via UnifiedChatPanel.tsx:241-244, tous deux gardés par `isBrainstorm`/`hasUserMessage` de la conversation ACTIVE dans hooks/useChatWorkspace.ts:22-30,57-60,72) appelle hooks/useSpecGeneration.ts:30 qui fait `POST /generate-spec` sans corps. La route (app/api/projects/[projectId]/generate-spec/route.ts:44-51, code de février 2026) lit les 30 derniers `chat_messages` du PROJET entier, sans filtrer sur `conversation_id` (lib/db/schema.ts:178, renseigné par chat/route.ts:111-120 et chat/stream/route.ts:263-272) : la spec est produite depuis un mélange de conversations (brainstorm, epic_creation, chat…), pas depuis celle où l'utilisateur a cliqué. Le parsing `body.namedAgentId` (route.ts:29-37) n'a aucun émetteur produit — le diff non commité a volontairement retiré le paramètre côté client (« The server resolves… »), le parsing serveur est resté. En succès le hook ne fait que `router.refresh()` (useSpecGeneration.ts:41) et jette `{ data: { spec, epicsCreated } }` (route.ts:140) : aucun message, aucune notification, aucune navigation vers /spec, alors que la route a écrit spec + epics et passé le projet en `specifying` (route.ts:138). Les erreurs, elles, sont bien affichées (useChatWorkspace.ts:74 → ChatThread.tsx:124-130).

**Recommandation**

Envoyer `conversationId` (et l'agent choisi) dans le corps ; filtrer `chatMessages` par conversation ; retourner et afficher `epicsCreated`/le lien vers /spec. Sinon retirer le parsing `namedAgentId` mort.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "generate-spec" app components hooks lib` → un seul appel client, `fetch(\`/api/projects/${projectId}/generate-spec\`, { method: "POST" })` sans body. Route : `.from(chatMessages).where(eq(chatMessages.projectId, projectId)).orderBy(desc(createdAt)).limit(30)`.

</details>

### #109 — POST /releases garde la requête HTTP ouverte pendant tout le run de l'agent changelog (sans timeout) et duplique le cycle de vie de session

**Nature** risque · **Impact** moyen (vérificateur : plutôt plus) · **Effort** M · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/api/projects/[projectId]/releases/route.ts:96-120,244-315,334-487`
- `lib/agent-sessions/wait-for-completion.ts:15-40`
- `lib/agent-sessions/dispatch-background-session.ts:123,240`

**Constat**

La route enchaîne à la main `createQueuedSession` → `markSessionRunning` → `processManager.start` → `waitForProcessCompletion(sessionId, 1200)` → `fs.writeFileSync(logs)` → `markSessionTerminal` (route.ts:244-315), ce que `dispatchBackgroundSession` encapsule déjà pour spec-update, spec-auto-rewrite et memory-distill. `waitForProcessCompletion` n'a « No timeout » (wait-for-completion.ts:23-27) : le POST bloque jusqu'à la fin du CLI, le bouton reste en `pending`, et un rafraîchissement de page perd le résultat. Second effet : la validation « epic done » (:104-120) précède un run de plusieurs minutes ; la branche, le commit CHANGELOG, le tag et la draft GitHub (:334-435) sont créés AVANT la transaction finale (:455-487) qui peut lever `Failed to transition epic` si un statut a bougé entre-temps — c'est exactement la fenêtre que B-arij-239 voulait fermer, réouverte par la durée du run.

**Précision du vérificateur**

POST /api/projects/:id/releases garde la requête ouverte pendant tout le run de l'agent changelog : cycle de vie manuel (:251-309) et `await waitForProcessCompletion(sessionId, 1200)` (:281) sans timeout (wait-for-completion.ts:27,39-43) ; le client (releases/page.tsx:173-224) reste en `creating` sans abort, et comme la route ignore `request.signal`, un refresh perd le toast et les `githubErrors` mais pas la release, écrite en fin de run. Le passage à `dispatchBackgroundSession` demande d'y ajouter la reprise de session (`resumeSessionId`, :222-244) que le dispatcher ne supporte pas (cliSessionId frappé inconditionnellement :257, exclu du type `spawn` :180-183). Second effet, plus grave que décrit : la validation « done » (:113-123) précède un run de plusieurs minutes, la branche, le commit CHANGELOG, le tag et la draft GitHub (:358-446) sont créés avant la transaction (:451-489), et celle-ci n'attrape PAS un statut qui a bougé — `fromStatus` vient de `selectedEpics` chargé à :86, `buildTransitionContext` ne relit pas `epics.status`, aucune garde engine ne refuse done→released pour system/release, l'update est sans prédicat de statut. Un epic rouvert pendant le run est écrasé silencieusement en "released" (état sans sortie), contrairement à ce qu'affirme le message du commit 39cd93ac (B-arij-239). Correctif : relire le statut des epics juste avant les effets git et dans la transaction (ou prédicat `status = 'done'` sur l'update), et/ou dispatcher la génération en arrière-plan avec la release créée sur le changelog de repli.

POST /api/projects/:id/releases (app/api/projects/[projectId]/releases/route.ts:250-290) gère à la main le cycle de vie de session (createQueuedSession → markSessionRunning → processManager.start → waitForProcessCompletion(sessionId, 1200) → writeFileSync → markSessionTerminal) que dispatchBackgroundSession encapsule déjà pour spec-update, spec-auto-rewrite, memory-distill et dreaming. waitForProcessCompletion n'a pas de timeout (lib/agent-sessions/wait-for-completion.ts:23-27), la route n'exporte pas de maxDuration et ne lit pas request.signal : le seul appelant, handleCreateRelease dans app/projects/[projectId]/releases/page.tsx:174-233, garde le bouton release-create-button en `pending` (NextReleaseBand.tsx:313-315) pendant toute la durée du CLI. Un rafraîchissement ne perd pas la release (la route continue, la ligne est insérée à la fin, la session release_notes reste visible dans sessions/active) mais perd le toast et l'état `creating`, ce qui permet une seconde soumission de la même version : aucune unicité sur releases.version (schema.ts:461), la branche release/v<version> existante est réutilisée (lib/git/release.ts:28-33), l'échec du tag est avalé (:378-380) → doublon de release avec gitTag null. Second effet, corrigé : la validation « epic done » (:104-120) précède un run de plusieurs minutes, puis branche/commit CHANGELOG (:358), tag (:372-377), push + draft GitHub (:406-420) sont créés avant la transaction finale (:451-487) ; mais comme applyTransition/buildTransitionContext ne relisent jamais epics.status et valident contre le fromStatus « done » lu à :86-90, un statut modifié pendant le run ne déclenche PAS « Failed to transition epic » — il est écrasé silencieusement par `released` (transition-service.ts:213-215). La fenêtre que B-arij-239 fermait (validation avant effets git) est bien réouverte par la durée du run, avec écrasure silencieuse plutôt qu'erreur.

**Recommandation**

Soit dispatcher la génération de changelog en arrière-plan (`dispatchBackgroundSession`, release créée avec le changelog de repli puis mis à jour à la fin), soit au minimum re-vérifier le statut des epics juste avant les effets git et déplacer branche/tag/GitHub après la transaction.

<details><summary>Preuve relevée par l'auditeur</summary>

route.ts:277 `const info = await waitForProcessCompletion(sessionId, 1200);` ; wait-for-completion.ts:23 « No timeout: the loop runs as long as the session reports 'running' » ; `rg -n dispatchBackgroundSession lib/workflow` → spec-update, spec-auto-rewrite, memory-distill, dreaming, mais pas releases.

</details>

### #186 — Restaurer le snapshot pré-rêve ne recule pas le cutoff : les sessions du rêve annulé ne seront plus jamais relues

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `app/api/projects/[projectId]/memory/restore/route.ts:45-66`
- `lib/workflow/dreaming.ts:372-384`
- `lib/workflow/dreaming-settings.ts:27-59`
- `lib/workflow/dreaming-constants.ts:143-156`

**Constat**

`recordDreamCutoff` n'a qu'un écrivain (dreaming.ts:376-384, après un remplacement réussi) et sert de borne inférieure de la fenêtre suivante (dreaming-settings.ts:27-40 → resolveDreamWindow). POST /memory/restore (restore/route.ts:51-54) remet le texte pré-rêve via `saveProjectMemory` mais ne touche pas `dreaming_last_cutoff:<id>`. Après un restore, la mémoire est celle d'AVANT le rêve tandis que la fenêtre est celle d'APRÈS : les ≤30 sessions que ce rêve avait digérées sont marquées « apprises » sans que rien n'en subsiste. Le docblock de dreaming-constants.ts:143-152 promet pourtant que la présence du cutoff « means the evidence up to that instant really is inside the stored memory » — ce n'est plus vrai dès qu'on restaure.

**Précision du vérificateur**

Confirmé tel quel. Ajout : `dreaming_last_cutoff` est dans SERVER_MANAGED_SETTING_KEYS (lib/settings/writable-keys.ts:119-122) et il n'y a ni DELETE settings ni champ cutoff dans la ligne d'archive (lib/documents/memory.ts:289-333) — après un restore, aucun chemin applicatif ne permet de reculer la fenêtre ; les sessions digérées par le rêve annulé sont perdues jusqu'à suppression du projet ou édition manuelle de la base.

**Recommandation**

Au restore, effacer (ou remettre à la valeur précédente, à mémoriser dans la ligne d'archive) `dreaming_last_cutoff:<id>` ; ou stocker le cutoff précédent avec le snapshot et le restaurer avec lui.

<details><summary>Preuve relevée par l'auditeur</summary>

grep `recordDreamCutoff` hors tests → uniquement dreaming.ts:378. restore/route.ts n'importe rien de dreaming-settings ; il n'écrit que documents + memory_provenance.

</details>

### #187 — La clé par projet `dreaming_after_night_run:<id>` est résolue, autorisée et nettoyée mais jamais écrite par aucune surface

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `lib/workflow/dreaming-settings.ts:82-91`
- `lib/settings/writable-keys.ts:99`
- `lib/projects/project-settings-keys.ts:47`
- `components/settings-piscine/NightRunsBand.tsx:103-112`
- `components/settings-piscine/settings-fields.ts:404-408`

**Constat**

`isDreamingAfterNightRunEnabled` lit d'abord `dreaming_after_night_run:<projectId>` (dreaming-settings.ts:82-91), writable-keys.ts:99 l'autorise en scopé, project-settings-keys.ts:47 la supprime à la suppression du projet, et deux tests (dreaming-dispatch.test.ts:938,951) couvrent l'override. Mais le seul écrivain UI est NightRunsBand.tsx:103-112 qui écrit la clé GLOBALE (`draft.set(DREAMING_AFTER_NIGHT_RUN_SETTING_KEY, …)`) ; le NightRunDialog n'a aucun contrôle « dream » (grep vide). Même motif que les paliers `night_circuit_breaker:<id>` déjà retenus, sur une clé différente. Accessoirement, le lecteur client de `memory_auto_distill` (settings-fields.ts:404-408 : `stored === true || stored === "true"`) n'a pas la passe JSON.parse que `parseDreamingAfterNightRunSetting` (dreaming-constants.ts:98-116) et `parseMemoryAutoDistillSetting` (memory-constants.ts) appliquent côté serveur : une valeur double-encodée `'"true"'` s'afficherait OFF alors que le serveur la résout ON.

**Précision du vérificateur**

La clé par projet `dreaming_after_night_run:<id>` est résolue en priorité (lib/workflow/dreaming-settings.ts:82-91), acceptée en scopé par PATCH /api/settings (lib/settings/writable-keys.ts:99), nettoyée à la suppression du projet (lib/projects/project-settings-keys.ts:47) et testée (__tests__/dreaming-dispatch.test.ts:938-955), mais aucune surface (UI, route projet, MCP) ne l'écrit : le seul écrivain est le toggle global de NightRunsBand.tsx:103-112 ; NightRunDialog et la page settings projet n'ont aucun contrôle « dream ». Seul un PATCH /api/settings fait à la main peut la poser. Même motif que `night_circuit_breaker:<id>` / `night_cost_cap_usd:<id>`. En revanche, la remarque accessoire sur le lecteur client de `memory_auto_distill` est fausse : GET /api/settings fait déjà une passe JSON.parse (app/api/settings/route.ts:22-28,67), donc `'"true"'` en base est lu ON par le client comme par le serveur.

**Recommandation**

Soit exposer l'override dans les réglages projet / le NightRunDialog (comme le cap de coût), soit retirer la clé scopée du résolveur, de writable-keys et du cleanup pour ne garder qu'une clé globale.

<details><summary>Preuve relevée par l'auditeur</summary>

grep `dreamingAfterNightRunSettingKey|dreaming_after_night_run:` hors tests → dreaming-constants.ts (définition), dreaming-settings.ts:84 (lecture), project-settings-keys.ts:47 (cleanup). Aucun `draft.set(dreamingAfterNightRunSettingKey(...))` dans components/.

</details>

### #188 — PUT /memory ignore la garde optimiste que la lib fournit : le panneau signale le conflit mais laisse écraser un rêve fraîchement posé, sans snapshot

**Nature** risque · **Impact** moyen (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `app/api/projects/[projectId]/memory/route.ts:75-99`
- `components/spec/MemoryPanel.tsx:196-203,452-468,685-694`
- `lib/documents/memory.ts:172-190`

**Constat**

`writeProjectMemoryGuarded` offre `expectedPrevious` (lib/documents/memory.ts:172-190) et les deux écrivains agents l'utilisent. La route PUT appelle `saveProjectMemory` nu (memory/route.ts:99) et n'accepte aucun `expectedPrevious` dans son schéma zod (:75-83). Côté panneau, `backgroundUpdateConflict` est calculé et affiché (MemoryPanel.tsx:200-202, 452-468) mais le bouton Save n'est désactivé que pour `overCap || !dirty || pendingWriter` (:689) : un utilisateur qui édite pendant qu'un rêve/distill se termine peut cliquer Save et remplacer le document rêvé par son brouillon. Les écritures manuelles n'archivent pas (`saveProjectMemory` sans `archiveProjectMemory`), donc le texte rêvé est perdu, alors que la lib a précisément été conçue pour que « the human edit wins » dans l'autre sens.

**Précision du vérificateur**

PUT /memory écrit sans `expectedPrevious` et sans archive (route.ts:99, schéma :75-83), et le bouton Save du panneau reste actif sous `backgroundUpdateConflict` (MemoryPanel.tsx:689). Mais c'est un choix assumé et testé (« You can review and save them, or click Discard », Spec.json:84 ; spec-page-memory-panel.test.tsx:399), l'écrasement n'est possible qu'après que le rêve a terminé et que le bandeau est affiché (Save bloqué tant que `pendingWriter`), et la sortie rêvée reste lisible sur la page de session. Le coût réel, non relevé : après un Save manuel post-rêve, l'archive ne contient que le snapshot pré-rêve (Restore ne rend pas le rêve) et le curseur de rêve a déjà avancé (dreaming.ts:377-383), donc un nouveau rêve ne relit pas ces sessions. Amélioration UX possible (un « recharger » ou un snapshot du texte rêvé avant l'écriture manuelle), pas un défaut de garde.

**Recommandation**

Faire porter `expectedPrevious` (ou `updatedAt`) par le PUT et répondre 409 sur `ProjectMemoryChangedError` ; côté panneau, désactiver Save tant que `backgroundUpdateConflict` est vrai et proposer « recharger ».

<details><summary>Preuve relevée par l'auditeur</summary>

memory/route.ts:99 `const { doc } = saveProjectMemory(projectId, validated.data.content);` ; schéma `putMemorySchema = z.object({ content: … })` sans version. MemoryPanel.tsx:689 `disabled={saving || restoring || dreaming || overCap || !dirty || !!pendingWriter}`.

</details>

### #117 — Champs de release que l'UI ne peut plus renseigner : titre figé à "" et changelog non éditable, alors que l'API les accepte

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/projects/[projectId]/releases/page.tsx:71-76,196-209`
- `components/releases/ChangelogCard.tsx:20-30`
- `app/api/projects/[projectId]/releases/route.ts:70-76,322,404-409`
- `lib/validation/schemas.ts`

**Constat**

La page fixe `const title = ""` (releases/page.tsx:71-76 : « The redesign draws no title field ») tout en envoyant `title: title.trim() || undefined` au POST (:203) ; `createReleaseSchema` et la route acceptent toujours `title`, qui ne peut donc plus jamais être non-null depuis l'app (il sert pourtant au titre GitHub `v${version} — ${title}` route.ts:407-409 et au H1 du changelog de repli :322). `ChangelogCard` est en lecture seule faute de route PATCH (ChangelogCard.tsx:23-28), alors que la carte de composition annonce un changelog « généré » que l'utilisateur ne peut corriger avant la création du tag/draft. Le flux « composer une release » a donc perdu deux entrées de l'ancien dialogue sans remplacement.

**Précision du vérificateur**

Le champ « titre » de release n'est plus renseignable depuis l'UI : app/projects/[projectId]/releases/page.tsx:76 fige `const title = ""` (commentaire :72-75 « The redesign draws no title field ») et l'envoie à :182 comme `title.trim() || undefined`, donc toujours `undefined`. Seul producteur du POST /api/projects/:id/releases dans le code (aucun chemin MCP, routine ou bin), alors que createReleaseSchema (lib/validation/schemas.ts:285) et la route consomment toujours `title` : H1 du changelog de repli (route.ts:327), titre du draft GitHub `v${version} — ${title}` (:417-419), colonne DB (:457), titre d'activité (:497). L'ancien dialogue (99e2de34^) avait un Input « Title » ; la nouvelle UI n'affiche par ailleurs jamais `release.title`. En revanche le changelog n'a JAMAIS été éditable (l'ancien dialogue ne proposait que le choix de l'agent et un rendu lecture seule), la carte de composition affiche « CHANGELOG — GÉNÉRÉ À LA CRÉATION » et une prévisualisation du repli serveur, et le changelog réel est produit par l'agent pendant le POST : l'absence de PATCH est un choix documenté (ChangelogCard.tsx:23-28), pas une régression. Une seule entrée perdue, le titre ; recommandation : soit un contrôle titre, soit retirer `title` du schéma, du prompt et de la route pour aligner le contrat.

Le champ « titre » de release a été retiré de l'UI par le commit 99e2de34 (rebuild Piscine) sans retrait côté contrat : page.tsx:72-76 fige `const title = ""` et l'envoie (:186) à un POST dont le schéma (schemas.ts:285) et la route (route.ts:77) l'acceptent encore et l'exploitent pour le H1 du changelog de repli (:327), le titre du draft GitHub `v${version} — ${title}` (:417-424), la colonne `releases.title` (:457) et `ticketTitle` (:497). Depuis l'app, ce titre est donc définitivement null et le draft GitHub s'appelle toujours `v${version}`. En revanche, le changelog n'a rien perdu : l'ancien dialogue ne l'éditait pas non plus (MarkdownContent en lecture seule, aucun PATCH avant comme après), la carte l'annonce comme « GÉNÉRÉ À LA CRÉATION » et non « éditable », et tag + draft naissent dans le même POST que la génération, donc aucune fenêtre d'édition n'a jamais existé. Reco : réintroduire un contrôle titre (GhostInputPill est exporté par components/piscine/index.ts:69) ou retirer `title` du schéma/route ; le PATCH changelog est une évolution, pas une réparation.

**Recommandation**

Soit réintroduire un champ titre (GhostInputPill dans le VersionPill/en-tête) et un PATCH changelog avant publication, soit retirer `title` du schéma et du prompt pour que le contrat reflète l'UI.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:76 `const title = "";` ; ChangelogCard.tsx:23 « READ-ONLY, deliberately. createReleaseSchema has no changelog field and … there is no PATCH » ; `ls app/api/projects/[projectId]/releases/[releaseId]` → publish/ seulement.

</details>

### #190 — MemoryPanel ne rend pas `exists`, `maxChars`, `archive.content` (≤ 40 Ko servi à chaque GET/refetch), ni `dispatched`/`sessionsAnalyzed` du rêve ; `namedAgentId` accepté par les routes n'est envoyé par aucune UI

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `components/spec/MemoryPanel.tsx:56-67,187-206,323-341,551-610`
- `app/api/projects/[projectId]/memory/route.ts:55-65`
- `app/api/projects/[projectId]/memory/dream/route.ts:14-16,73-79`
- `app/projects/[projectId]/sessions/[sessionId]/page.tsx:178-182`
- `components/chat-page/chat-context-tokens.ts:133`

**Constat**

GET /memory renvoie `exists`, `maxChars`, `archive.content` (memory/route.ts:55-65) ; le panneau déclare ces champs (MemoryPanel.tsx:56-67) mais ne lit que content/updatedAt/provenance/archive.updatedAt/pendingWriter ; la barre d'archive (:551-610) affiche seulement la date et n'offre aucun aperçu du snapshot avant restauration, alors que son texte complet est transmis à chaque `memory:changed`, `session:*` et `pollTick` (:234-267). chat-context-tokens.ts:133 relit la même enveloppe pour un comptage de tokens et reçoit aussi l'archive. POST /memory/dream renvoie `dispatched` et `sessionsAnalyzed` (dream/route.ts:73-79) ; le panneau n'utilise que `sessionId` et `reason` (:335-337), et interpole la raison anglaise du serveur (« no new sessions since the last dream », dreaming-policy.ts:33) dans la phrase traduite `memory.nothingToDreamReason`. Les deux routes acceptent `namedAgentId` (dream/route.ts:14-16, distill/route.ts:21-25) avec tests de pass-through, mais MemoryPanel poste `{}` (:327) et la page session poste `{ sourceSessionId }` (sessions/[sessionId]/page.tsx:181) : le choix d'agent pour les deux écrivains mémoire n'est atteignable que via Agent Config.

**Précision du vérificateur**

GET/PUT /memory et POST /memory/restore servent `exists` et `maxChars` (memory/route.ts:58-66, :115-121 ; restore/route.ts:69-73) que MemoryPanel ne lit jamais (seulement typés :58, :60 ; `applyEnvelope` :187-206 ignore les deux ; le cap est calculé localement depuis PROJECT_MEMORY_MAX_TOKENS :23, :167-170) — seuls des tests les consomment. `archive.content` (≤ 40 000 chars via enforceMemoryCap, memory.ts:298) est transmis à chaque GET — montage, `memory:changed`, `session:*` d'un writer mémoire (:234-262), et `pollTick` uniquement en repli SSE déconnecté toutes les 10 s (useProjectEvents.ts:19, :130-135) — alors que la barre d'archive (:551-610) n'affiche que `archive.updatedAt` et que la restauration relit l'archive côté serveur (restore/route.ts:46-55). chat-context-tokens.ts:133 relit la même enveloppe une fois par projet (non pollé) pour n'utiliser que `content`. POST /memory/dream renvoie `dispatched` et `sessionsAnalyzed` (dream/route.ts:73-79) ; `handleDream` (:317-341) n'utilise que `sessionId`/`reason` et interpole la phrase anglaise du serveur (dreaming-policy.ts:33) dans `memory.nothingToDreamReason` — clé qui n'a pas de version fr (fr/Spec.json:39-41 ne traduit que `memory.helper`), donc l'incohérence de langue est latente. `namedAgentId` est accepté par les deux routes (dream/route.ts:14-17, distill/route.ts:21-26, tests de pass-through dreaming-route.test.ts:97-103 et memory-distill-dispatch.test.ts:196-215) mais envoyé par aucun client : MemoryPanel poste `{}` (:327), la page session `{ sourceSessionId }` (:181), et ni le trigger night-run (dreaming.ts:131-135) ni l'auto-distill (memory-distill.ts:353-356) ne le passent ; le choix d'agent retombe toujours sur `resolveAgent(agentType, projectId)` (agent-resolution.ts:633-641), c'est-à-dire Agent Config.

**Recommandation**

Retirer `exists`/`maxChars` de l'enveloppe, ne servir `archive.content` que sur demande (aperçu du snapshot ou route dédiée), afficher `sessionsAnalyzed` dans le message de succès, traduire `reason` par un code plutôt qu'une phrase, et soit brancher AgentSelectPill sur les deux boutons soit retirer `namedAgentId` des schémas.

<details><summary>Preuve relevée par l'auditeur</summary>

grep `exists|maxChars|sessionsAnalyzed|dispatched` dans MemoryPanel.tsx → seules les clés i18n `memory.archive.exists*` ; `archive.content` n'apparaît qu'en type. MemoryPanel.tsx:327 `body: JSON.stringify({})`.

</details>

### #191 — Doublons entre les deux écrivains mémoire : sanitize identique, bloc « Output Format » + HARD LIMIT recopié, trois `readSettingValue`, deux parseurs booléens, upsert à la main

**Nature** doublon · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `lib/workflow/memory-distill.ts:486-494`
- `lib/workflow/dreaming-policy.ts:73-82`
- `lib/claude/prompts/memory.ts:84-95,193-204`
- `lib/workflow/dreaming-settings.ts:46-59,63-74`
- `lib/pipeline/index.ts:76`
- `lib/night/run.ts:98`

**Constat**

`sanitizeDistilledMemory` (memory-distill.ts:486-494) et `sanitizeDreamedMemory` (dreaming-policy.ts:73-82) ont un corps octet pour octet identique (même regex de fence). Dans lib/claude/prompts/memory.ts, la phrase « Your ENTIRE response must be ONLY the new memory document body » est aux lignes 91 et 200 du MÊME fichier : les 5 lignes du bloc Output Format et la ligne HARD LIMIT (tokens/chars) sont dupliquées entre `buildMemoryDistillPrompt` et `buildDreamingPrompt` — ce n'est pas « deux fichiers ». `readSettingValue` est réécrit dans dreaming-settings.ts:63, lib/pipeline/index.ts:76 et lib/night/run.ts:98, et `isMemoryAutoDistillEnabled` (memory-distill.ts:87-98) refait le même select inline ; `parseDreamingAfterNightRunSetting` (tri-state) et `parseMemoryAutoDistillSetting` (bi-state) sont la même fonction à un `false` près. `recordDreamCutoff` (dreaming-settings.ts:46-59) fait select→update/insert quand `recordMemoryWriteProvenance` (memory-provenance.ts:73-86) utilise `onConflictDoUpdate` sur la même table.

**Précision du vérificateur**

Vrai sur le fond, quelques références à corriger. Corps de sanitize identique octet pour octet, JSDoc compris : `lib/workflow/memory-distill.ts:498-505` (`sanitizeDistilledMemory`) et `lib/workflow/dreaming-policy.ts:77-84` (`sanitizeDreamedMemory`) — et non 486-494 / 73-82. Le bloc « ### Output Format » (5 lignes) et la ligne HARD LIMIT sont bien dupliqués DANS le même fichier `lib/claude/prompts/memory.ts` (:91 et :200), entre `buildMemoryDistillPrompt` et `buildDreamingPrompt`. Trois `readSettingValue` locaux (`lib/pipeline/index.ts:76`, `lib/workflow/dreaming-settings.ts:63`, `lib/night/run.ts:98`), plus le même select réécrit inline dans `isMemoryAutoDistillEnabled` (`lib/workflow/memory-distill.ts:87-98`). Les deux parseurs booléens ne sont pas où l'auditeur les place : `parseDreamingAfterNightRunSetting` est en `lib/workflow/dreaming-constants.ts:99-118` (tri-state) et `parseMemoryAutoDistillSetting` en `lib/documents/memory-constants.ts:114-126` (bi-state), même corps à la gestion du `false` près. Enfin `recordDreamCutoff` (`lib/workflow/dreaming-settings.ts:43-60`) fait un upsert manuel select→update/insert — non atomique — là où `recordMemoryWriteProvenance` (`lib/documents/memory-provenance.ts:67-83`, et non memory-provenance.ts:73-86) utilise `onConflictDoUpdate` sur la même table `settings`.

**Recommandation**

Un `sanitizeMemoryDocument` unique dans lib/documents/memory.ts ; un helper `memoryOutputContract()` partagé dans prompts/memory.ts ; un `readSetting(key)` dans lib/settings avec parseur booléen tri-state commun ; `recordDreamCutoff` en `onConflictDoUpdate`.

<details><summary>Preuve relevée par l'auditeur</summary>

grep `ENTIRE response must be ONLY the new memory document body` → prompts/memory.ts:91 et :200 (et un test). grep `function readSettingValue` → 3 fichiers lib. Corps de sanitize* : `trimmed.match(/^```[a-zA-Z]*\n([\s\S]*)\n```$/)` dans les deux.

</details>

### #192 — L'extraction dreaming.ts → collector/policy/settings est propre, mais memory-distill.ts remonte encore par la façade et les re-exports ne servent qu'aux tests ; commentaires `memory: null` périmés

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `lib/workflow/memory-distill.ts:60`
- `lib/workflow/dreaming.ts:70-74,196-198`
- `lib/claude/prompt-builder.ts:78-81`
- `lib/settings/writable-keys.ts:123-124`

**Constat**

Le diff non commité de dreaming.ts est une pure suppression (−726 l.) : aucun corps dupliqué ne subsiste entre dreaming.ts (418 l.) et dreaming-collector.ts ; collector (accès DB : candidats, libellés, findings, forensic, texte final) et digest (fonctions pures : fenêtre, rendu, validation, budget équitable) sont deux étapes distinctes, pas deux collecteurs. Restes : (1) memory-distill.ts:60 importe `isDreamingAfterNightRunEnabled` depuis `./dreaming` — ce qui charge dispatch, prompt-builder, notifications et le bus — alors que dreaming-settings.ts existe pour cela ; (2) les 5 lignes de re-export de dreaming.ts:70-74 (`selectDreamCandidates`, `evaluateDreamGuards`, `findLastDreamCutoff`, `sanitizeDreamedMemory`, …) n'ont aucun consommateur produit hors cet import — seuls dreaming-collector.test.ts:42 et dreaming-dispatch.test.ts:83 les utilisent, aucun test n'importe les sous-modules ; (3) dreaming.ts:196-198 et memory-distill.ts:568-570 passent `{ ...project, memory: null }` « pour stopper l'injection du builder », mais `buildDreamingPrompt`/`buildMemoryDistillPrompt` sont exportés nus par prompt-builder.ts:78-81 (hors `withStoredProjectMemory`) et ne lisent jamais `project.memory` : le spread est un no-op et le commentaire décrit l'ancien prompt-builder monolithique. (4) writable-keys.ts:123-124 documente `memory_provenance` comme « written … to detect a manual edit made mid-dream » : faux, la détection passe par `expectedPrevious` (memory.ts:172-190) ; la provenance n'est qu'un affichage.

**Précision du vérificateur**

Extraction dreaming.ts → collector/policy/settings/digest confirmée propre (aucun corps dupliqué ; le diff est de 22 insertions / 747 suppressions, pas 55/2 340). Restent trois miettes d'hygiène, sans aucun impact de comportement :
(1) lib/workflow/memory-distill.ts:60 importe `isDreamingAfterNightRunEnabled` depuis `./dreaming` au lieu de `./dreaming-settings` (l.82). Le coût allégué est cependant nul : memory-distill importe déjà directement dispatch-background-session (l.39), prompt-builder (l.42), notifications/create (l.55), events/emit (l.57) et events/bus (l.58), et il n'existe aucun cycle.
(2) Les re-exports de façade sont en dreaming.ts:73-77 (pas 70-74) ; hors ce seul import produit, seuls __tests__/dreaming-collector.test.ts:38-41 et __tests__/dreaming-dispatch.test.ts:76-82 les consomment.
(3) Les spreads `{ ...project, memory: null }` sont en dreaming.ts:230-232 et memory-distill.ts:554-556 (pas 196-198 / 568-570). Ils sont bien inertes — prompt-builder.ts:77-80 ré-exporte les deux builders nus, hors `withStoredProjectMemory`, et prompts/memory.ts ne lit jamais `project.memory` — mais le commentaire ne décrit PAS un ancien builder monolithique : la vérification de df9fb29a (dreaming) et bb7d0a89 (distill) montre que ni `memorySection` ni `withProjectMemory` n'ont jamais été appliqués à ces deux prompts. Le spread reste néanmoins une convention défensive documentée (prompts/memory.ts:105-109) : le retirer rendrait une future ré-enveloppe silencieusement dupliquante.
(4) Le commentaire de writable-keys.ts:123-124 est bien faux (la détection d'édition mid-dream passe par `expectedPrevious`, lib/documents/memory.ts:170-200 ; la provenance n'est qu'un affichage servi à MemoryPanel), mais sans portée : `SERVER_MANAGED_SETTING_KEYS` n'est lu par aucun code d'exécution — seul le test de couverture l'importe — et la clé réelle est de toute façon préfixée `memory_provenance:<projectId>`.

**Recommandation**

Importer depuis `./dreaming-settings` dans memory-distill.ts, faire pointer les tests vers les sous-modules et supprimer les re-exports, retirer les spreads `memory: null` et corriger le commentaire de writable-keys.

<details><summary>Preuve relevée par l'auditeur</summary>

`git diff lib/workflow/dreaming.ts` : 55 insertions (imports + re-exports) / 2 340 suppressions déplacées ; grep `from "@/lib/workflow/dreaming"` hors tests → dream/route.ts (dispatchDreamingSession), night/run.ts (maybeDreamAfterNightRun), memory-distill.ts (isDreamingAfterNightRunEnabled). grep `project.memory` dans prompts/memory.ts → 0.

</details>

### #202 — Un run de release apparaît deux fois dans /sessions/active : ligne agent_sessions `release_notes` + entrée activity-registry `release`

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:orphan-small-domains-and-docs

**Fichiers**
- `app/api/projects/[projectId]/releases/route.ts:134-142`
- `app/api/projects/[projectId]/releases/route.ts:251-266`
- `app/api/projects/[projectId]/sessions/active/route.ts:96-99`
- `app/api/projects/[projectId]/sessions/active/route.ts:285-303`
- `lib/activity-registry.ts:1-8`

**Constat**

POST /releases enregistre une activité éphémère dans activityRegistry (type "release", label « Generating Changelog: v… ») ET crée une vraie ligne agent_sessions (createQueuedSession + markSessionRunning, agentType "release_notes"). GET /sessions/active classe la ligne DB en type "release" (label « Generating release notes ») puis concatène les entrées du registre sans dédoublonnage : `[...dbActivities, ...registryActivities]`. Pendant toute la génération du changelog, les consommateurs (useAgentPolling → page projet, useAgentDispatch) reçoivent deux activités pour un seul process, l'une `cancellable: true` (DB), l'autre `cancellable: false` (pas de `kill` fourni au register). Le registre a été conçu pour les activités « NOT tracked in the DB agent_sessions table » (son en-tête) ; la release n'en fait plus partie.

**Précision du vérificateur**

La double comptabilisation est réelle : `app/api/projects/[projectId]/releases/route.ts:132-142` enregistre une activité registre `type: "release"` et `:251-266` crée en plus une vraie ligne `agent_sessions` `agentType: "release_notes"`, l'`unregister` n'arrivant qu'en `finally` (:313) après la fin du process ; `app/api/projects/[projectId]/sessions/active/route.ts:303` concatène `[...dbActivities, ...registryActivities]` sans dédoublonnage, et classe la ligne DB en `"release"` (:98-99, label :161-162). L'en-tête de `lib/activity-registry.ts:1-2` qui annonce des activités « NOT tracked in the DB agent_sessions table » tout en citant « releases » est donc faux.

Correction sur l'impact : les consommateurs cités ne voient pas tous le doublon. `hooks/useAgentDispatch.ts:45-52` filtre par `epicId`/`userStoryId` — la session release n'en a aucun, les deux entrées sont écartées. `app/projects/[projectId]/page.tsx:244-258` n'utilise `activities` que pour détecter des disparitions d'id (aucune liste rendue) et le lookup de l'id registre disparu ne renvoie rien, donc aucun faux toast. Le doublon est réellement observable dans `lib/chat/board-tools.ts:549-566` / `app/api/mcp/get-agent-status/route.ts`, qui rapporte `count: 2` et deux libellés pour un seul process, dont un id fantôme non annulable et non interrogeable via `/sessions/:id`. C'est une incohérence de modèle de données réelle mais transitoire et sans effet UI visible aujourd'hui.

**Recommandation**

Supprimer l'enregistrement registry dans la route releases (la ligne DB suffit et est annulable), ou dédoublonner par id de session dans /sessions/active. Mettre à jour l'en-tête de lib/activity-registry.ts (« chat, spec generation » seulement).

<details><summary>Preuve relevée par l'auditeur</summary>

releases/route.ts:136 `activityRegistry.register({ …type: "release"… })` puis :251 `createQueuedSession({ …agentType: "release_notes"… })` ; sessions/active/route.ts:96-99 `if (row.agentType === "release_notes") return "release"` ; :303 `data: [...dbActivities, ...registryActivities]` sans filtre.

</details>

## État au 11/09/2026 — livré

Branche `feature/lot-11-spec-memoire-releases` (worktree
`.arij-worktrees/lot-14-providers-spawn`), commit `c694ab94`, au-dessus des lots
14 et 07 (écriture). Trois sous-lots en parallèle, chacun revu par un agent
adverse puis corrigé.

Fait : #12/#106, #107, #108 (spec) ; #184, #185, #186, #187, #188, #190, #191,
#192 (mémoire) ; #105, #109, #117, #202 (releases).

Non fait, volontairement :
- #189 (notifications mémoire) : relève du lot 01, qui retire les notifications.
- #190 : afficher `sessionsAnalyzed` après un rêve — le panneau redirige vers la
  session au lancement, le message ne serait jamais vu. Choix UX à trancher.
- #191 : blocs « Output Format » dupliqués dans les prompts et `readSettingValue`
  de pipeline/night — hors périmètre (lot 13 pour les prompts).
- #108 : aucune surface n'envoie `namedAgentId` (pas de sélecteur d'agent de spec
  dans le chat, et l'agent du chat n'est pas celui de la spec).

À faire au merge :
- `lib/projects/spec-write.ts` est identique octet pour octet à celui de la
  rationalisation : aucun conflit.
- Renuméroter `0057_release_published_at.sql` en `0061_…` (idx 60), la
  rationalisation portant 0057–0060 non commités ; le `when` est déjà au-dessus.
  Mettre à jour `MIGRATION_TAG` dans `__tests__/releases-published-at-migration.test.ts`.
- `lib/workflow/dreaming-settings.ts` existe aussi (non suivi) dans la
  rationalisation : fusion manuelle — celle-ci retire la clé scopée et ajoute
  `clearDreamCutoff`.

Validation : suite vitest verte sauf `documents-upload-platform-body-cap`
(environnement), tsc 0, eslint 0 erreur, i18n 0 écart.
