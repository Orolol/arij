# Lot 22 — i18n : libellés anglais en dur côté serveur

**Difficulté** 1/4 — Simple — agent peu coûteux
**Findings** 3 (0 fort · 1 moyen · 2 faible ; effort 2 S · 1 M · 0 L)
**Dépendances** Indépendant.

**Statut** fait le 16/09/2026 — détail dans [compte rendu des lots 18, 20-22, 24](implementation-lots-18-20-21-22-24.md).

## Décision

Aucun libellé rendu à l'écran ne naît dans lib/ : describeMergeBlocker, prompt-anatomy, SECTION_LABELS deviennent des clés de catalogue.

## Objectif

Clés Catalogue + rendu traduit dans RegistryRow, le desk, le dialogue de refinement, PromptBarRow et la bande d'estimation.

## Démarche suggérée

1. Suivre le patron TASK_LABEL/GROUP_LABEL de tickets-registry/aggregate.ts.
2. npm run i18n:check.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #85 — Des libellés anglais codés en dur dans lib/ sont rendus tels quels par le registre, le desk et le dialogue de refinement

**Nature** cassé · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** tickets-server

**Fichiers**
- `lib/kanban/merge-readiness.ts:256-271`
- `lib/tickets-registry/aggregate.ts:426`
- `components/tickets-registry/RegistryRow.tsx:199`
- `components/tickets-registry/csv.ts:157`
- `lib/control-desk/aggregate.ts:190-208`
- `components/desk/LiveSessionCard.tsx:121`
- `components/desk/QueuedTile.tsx:74`
- `app/api/projects/[projectId]/sessions/active/route.ts:162-181`
- `lib/refinement/options.ts:301-363`
- `components/kanban/RefinementDialog.tsx:85-100`

**Constat**

Trois tables de copy vivent en dur dans des modules serveur et arrivent à l'écran sans passer par le catalogue : (1) describeMergeBlocker (lib/kanban/merge-readiness.ts:256-271, « Merge conflict — resolve before merging », « No branch to merge »…) est écrit dans RegistryRow.mergeBlockerLine par lib/tickets-registry/aggregate.ts:426 et affiché brut par components/tickets-registry/RegistryRow.tsx:199 et csv.ts:157 ; (2) sessionTitle (lib/control-desk/aggregate.ts:190-208, « Generating release notes », « Building »…) est affiché brut par LiveSessionCard.tsx:121, QueuedTile.tsx:74 et DeskCommandPalette.tsx:116, et la même table est recopiée dans app/api/projects/[projectId]/sessions/active/route.ts:162-181 ; (3) REFINEMENT_ACTIONS label/description (lib/refinement/options.ts:301-363) sont rendus par components/kanban/RefinementDialog.tsx:85-100 alors que le reste du dialogue passe par t(). Le module tickets-registry documente pourtant lui-même la règle (aggregate.ts:61-83, « NO COPY IN THIS TABLE, per lib/i18n/catalogue.ts pattern 3 ») et Desk.json/Registry.json ont déjà des clés `conflict`, `conflictWithMain`, `conflictMarkers`, `task.build`… Un utilisateur en locale fr voit ces phrases en anglais.

**Précision du vérificateur**

Trois tables de copy anglais codées en dur dans lib/ atteignent l'écran sans passer par le catalogue, sur des chemins réels et pré-existants (hors diff non commité) : (1) describeMergeBlocker (lib/kanban/merge-readiness.ts:256-271) → lib/tickets-registry/aggregate.ts:426 → RegistryRow.tsx:199 (monté par RegistryTable.tsx:186) et csv.ts:157, sans t() ; à l'écran ce sont « Changes requested — awaiting a fix » et « No branch to merge » qui sortent bruts (les deux blockers de conflit sont routés vers YOUR TURN, aggregate.ts:373, où Desk.json a déjà `conflictWithMain`/`conflictMarkers`) ; la règle « NO COPY IN THIS TABLE » est écrite dans le même fichier (aggregate.ts:68-71). (2) sessionTitle (lib/control-desk/aggregate.ts:190-208, appelé :238/:258) → route /api/control-desk:200/593 → useControlDesk → WorkingBand.tsx:138/147 → LiveSessionCard.tsx:121, QueuedTile.tsx:74, DeskCommandPalette.tsx:116, tous sans t() ; table recopiée (avec des variantes supplémentaires « Dreaming: … », `Grading: ${title}`) dans app/api/projects/[projectId]/sessions/active/route.ts:161-181, route consommée par useAgentPolling.ts:65, useAgentDispatch.ts:43 et l'outil MCP get_agent_status (board-tools.ts:550). (3) REFINEMENT_ACTIONS label/description sont à lib/refinement/options.ts:19-69 (le fichier fait 104 lignes, pas 301-363) → RefinementDialog.tsx:85-100 `{action.label}`/`{action.description}` sans t() alors que les lignes 78/83 du même composant utilisent t() ; dialogue monté via RefinementButton.tsx:221 depuis TopBar. La table est aussi lue par lib/claude/prompt-sections.ts:287, cas exact du pattern 3 de lib/i18n/catalogue.ts:33-41 (labelKey/descriptionKey). Locale fr sélectionnable (`ui_locale`, lib/settings/writable-keys.ts:76 ; lib/i18n/messages/fr existe).

Trois tables de copy anglais en dur dans lib/ arrivent à l'écran sans passer par le catalogue : (1) describeMergeBlocker (lib/kanban/merge-readiness.ts:256-271) écrit RegistryRow.mergeBlockerLine (lib/tickets-registry/aggregate.ts:426), rendu brut par components/tickets-registry/RegistryRow.tsx:199 et csv.ts:157 — mais seulement pour « Changes requested — awaiting a fix » et « No branch to merge » : les deux blockers conflit sont routés en your_turn (aggregate.ts:371-373) et rendus via t("Registry.state.conflict") (RegistryRow.tsx:115-118). Le même agrégat reçoit pourtant un ActivityCopy localisé par la route et documente « NO COPY IN THIS TABLE » (aggregate.ts:69-72). (2) sessionTitle (lib/control-desk/aggregate.ts:190-208, « Generating release notes », « Building »…) alimente DeskSession.title (l.238, 258) sans aucune locale dans lib/control-desk ni app/api/control-desk/route.ts ; rendu brut par LiveSessionCard.tsx:121, QueuedTile.tsx:74, DeskCommandPalette.tsx:116 dès qu'une session n'a ni story ni epic (passes projet : release, memory, refinement, QA). La même table est dupliquée dans app/api/projects/[projectId]/sessions/active/route.ts:153-181 (buildDbActivityLabel), dont le champ `label` n'est toutefois rendu par aucun composant (seul l'outil MCP get_agent_status le relaie). (3) REFINEMENT_ACTIONS label/description (lib/refinement/options.ts:11-73, pas 301-363 — le fichier fait 104 lignes) sont rendus par components/kanban/RefinementDialog.tsx:96 et :98 sans t(), alors que le reste du dialogue passe par useTranslations("Kanban") ; lib/claude/prompt-sections.ts:287-289 ne consomme que `tools`, donc keyer label/description est sans effet sur le prompt. Aucune clé de catalogue n'existe pour ces phrases (rg sur lib/i18n/messages/en). Un utilisateur en locale fr voit ces phrases en anglais.

**Recommandation**

Faire porter à ces trois tables des clés de catalogue (comme TASK_LABEL/GROUP_LABEL dans tickets-registry/aggregate.ts et USER_STORY_STATUS_LABELS) : describeMergeBlocker → `mergeBlockerKey`, sessionTitle → `titleKey` résolu dans le composant, REFINEMENT_ACTIONS → labelKey/descriptionKey ; supprimer la copie de sessions/active/route.ts en faisant importer inferTaskType/sessionTitle depuis lib/control-desk/aggregate.ts.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n '"[A-Z][a-z]+ [a-z][^"]*"' lib/control-desk lib/kanban lib/tickets-registry` → aggregate.ts:195-203 et merge-readiness.ts:261-267. `rg -n 'Generating release notes|Distilling|Refining the board' app/api lib` → sessions/active/route.ts:162,170,181 (copie). RefinementDialog.tsx:96-98 `<span className="font-medium">{action.label}</span>` sans t(). lib/i18n/messages/fr/Desk.json et fr/Registry.json existent ; en/Desk.json:66-67 `conflictWithMain`, `conflictMarkers`.

</details>

### #115 — prompt-anatomy fabrique de la copie anglaise hors catalogue (rôles et annotations) rendue telle quelle par la bande

**Nature** à moitié câblé · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/api/projects/[projectId]/prompt-anatomy/route.ts:52-63,255-264`
- `components/spec/PromptBarRow.tsx:40-58,84-92`

**Constat**

La route génère des libellés d'affichage en dur : rôles `"SESSION"`, `"BUG FIX"`, `"BUILD"`, `"REVIEW"`, `"MERGE FIX"`, `"CHAT & SPEC"` (prompt-anatomy/route.ts:52-63) et annotations `"epic + N story/stories"`, `"review rubric"` (:257-264). `PromptBarRow.tsx:56-58` (`t("anatomy.role", { role: row.role })`) et :86-89 les injectent sans traduction. Toute la page /spec est par ailleurs 100 % catalogue. Le tooltip de ligne (:44-49) affiche `sampledAt` en ISO brut au lieu de `formatDateTime`.

**Précision du vérificateur**

La route prompt-anatomy (route.ts:51-63, 259, 262) fabrique des libellés d'affichage anglais en dur (rôles "SESSION"/"BUILD"/"BUG FIX"/"REVIEW"/"MERGE FIX"/"CHAT & SPEC" + fallback `toUpperCase()` du type d'agent ; annotations "epic + N story/stories", "review rubric"). PromptBarRow.tsx:52 et :79-82 les injectent dans des clés qui ne sont que des gabarits d'interpolation (`"· {role}"`, `"{tokens} — {annotation}"`), donc jamais traduits ; fr/Spec.json ne porte d'ailleurs aucune clé anatomy.role/segment/rowTitle/legend et le deep-merge de catalogue.ts:140 renvoie l'anglais. Chemin réel : /projects/:id/spec → SpecWorkspace:274 → PromptAnatomyBand:69 (fetch) → :126 PromptBarRow. Le tooltip (:37-44) affiche `sampledAt` brut — non pas ISO mais le CURRENT_TIMESTAMP SQLite « YYYY-MM-DD HH:MM:SS » de agent_sessions.created_at — alors que `formatDateTime` (lib/i18n/format.ts:203) est déjà utilisé par MemoryPanel.tsx:559. check-keys ne peut pas le détecter (0 manquante). Les littéraux sont épinglés par prompt-anatomy-route.test.ts:222-249,368,381,396 et prompt-anatomy-band.test.tsx:36-65,146, à adapter avec le correctif.

La route GET /api/projects/[projectId]/prompt-anatomy fabrique de la copie d'affichage anglaise hors catalogue : rôles `SESSION`/`BUG FIX`/`BUILD`/`REVIEW`/`MERGE FIX`/`CHAT & SPEC`/`<type>.toUpperCase()` (route.ts:50-63) et annotations `epic + N story/stories` (:265) et `review rubric` (:268), sans jamais lire la requête ni passer par `translatorFor(resolveUiLocaleForRequest(...))` comme l'exige lib/i18n/catalogue.ts:74-77 et comme le font app/api/tickets/route.ts et app/api/qa/findings/route.ts. Les mêmes libellés existent déjà au catalogue (en/AgentsWorkshop.json:133-137) et le pluriel ICU a un précédent (en/Chat.json:41). components/spec/PromptBarRow.tsx:52 (`t("anatomy.role", { role: row.role })`) et :78-83 (`t("anatomy.segment", { tokens, annotation })`) les interpolent tels quels dans des gabarits « · {role} » / « {tokens} — {annotation} » (en/Spec.json:50-52, absents de fr/Spec.json). Le tooltip :37-44 interpole `row.sampledAt` = `agent_sessions.created_at` brut (`CURRENT_TIMESTAMP` SQLite « YYYY-MM-DD HH:MM:SS » UTC, pas ISO, sans fuseau) là où MemoryPanel.tsx:559,631 du même dossier utilise `formatDateTime`. Les tests prompt-anatomy-route.test.ts:222-250,368,381 et prompt-anatomy-band.test.tsx:36-65,146 épinglent ces chaînes anglaises. Nuance : les kickers majuscules ne sont traduits nulle part (fr/AgentsWorkshop.json sans bloc `tiles`, fr/Spec.json sans `legend`), l'impact fr réel porte surtout sur les deux annotations en prose et le tooltip.

**Recommandation**

Renvoyer des identifiants (`role: "bug_fix"`, `annotation: { kind: "stories", count }`) et résoudre les mots via le catalogue dans PromptBarRow ; formater `sampledAt` avec `formatDateTime`.

<details><summary>Preuve relevée par l'auditeur</summary>

route.ts:56 `return epicType === "bug" ? "BUG FIX" : "BUILD";` ; :259 `annotations.ticket = \`epic + ${stories} ${stories === 1 ? "story" : "stories"}\`` ; PromptBarRow.tsx:57 `{t("anatomy.role", { role: row.role })}`.

</details>

### #182 — SECTION_LABELS (anglais en dur) traverse l'API et s'affiche dans une phrase traduite

**Nature** risque · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/tokens/estimator.ts:66-75`
- `lib/tokens/estimator.ts:203-211`
- `lib/tokens/budget.ts:57-76`
- `app/api/projects/[projectId]/prompt-estimate/route.ts:253`
- `components/shared/PromptTokenEstimateView.tsx:307-320`
- `lib/i18n/messages/en/Shared.json:103`

**Constat**

lib/tokens/estimator.ts:66-75 fixe des libellés anglais (« Project Specification », « Comment History »…) que findLargestContextSection (175-212, ligne 208) copie dans `largestSection.label` ; budget.ts:57-76 le relaie, prompt-estimate/route.ts:253 le sert au client, et PromptTokenEstimateView.tsx:311-313 l'injecte dans `t.rich("promptEstimate.budgetWarning.largest", { label })` (Shared.json:103 : « Largest section is <strong>{label}</strong> »). Le commentaire :310 (« `label` is the estimator's section name, not copy ») est faux : c'est du texte utilisateur, hors catalogue, non traduit. SECTION_LABELS n'a d'ailleurs aucun consommateur hors de son fichier.

**Précision du vérificateur**

lib/tokens/estimator.ts:66-75 fixe des libellés anglais (SECTION_LABELS) que findLargestContextSection copie dans `largestSection.label` (:208) ; budget.ts:70-74 et prompt-estimate/route.ts:253 les servent au client, et PromptTokenEstimateView.tsx:312 les injecte dans `t.rich("promptEstimate.budgetWarning.largest", { label })` (en/Shared.json:103) sous un commentaire (:310) qui les déclare à tort « not copy ». C'est une violation de la règle 3 de lib/i18n/catalogue.ts (table de libellés → clés de catalogue résolues au rendu) : ces libellés sont non traduisibles et hors du scan de clés. SECTION_LABELS n'a aucun consommateur hors estimator.ts (seul le barrel lib/tokens/index.ts le ré-exporte). Impact actuel limité : fr/Shared.json n'existe pas, donc tout le namespace Shared se rend en anglais en fr (deep-merge catalogue.ts:140) et aucune phrase mixte n'est visible aujourd'hui ; le défaut se matérialisera dès que Shared sera seedé en français. Correctif : ne transporter que `key` et résoudre côté vue via une table key→TranslationKey (les huit clés `promptEstimate.breakdown.*` existent déjà comme modèle).

lib/tokens/estimator.ts:66-75 fixe des libellés anglais (SECTION_LABELS, sans autre consommateur que estimator.ts:208) que findLargestContextSection copie dans `largestSection.label` ; budget.ts:70-74 puis prompt-estimate/route.ts:253 le servent au client, et PromptTokenEstimateView.tsx:312 l'injecte dans `t.rich("promptEstimate.budgetWarning.largest", { label })` (Shared.json:103). Le commentaire :310 (« not copy ») est trompeur : c'est du texte affiché à l'utilisateur, hors catalogue, invisible à check-keys. Chemin réel : AgentDispatchDialog.tsx:125 (via AgentActionsBar, TicketOverlay, SendToDevDialog, SpecUpdateDialog), uniquement lorsque `prompt_token_budget` est configuré et dépassé. Nuance : `lib/i18n/messages/fr/Shared.json` n'existe pas et catalogue.ts retombe sur l'anglais, donc aucune phrase mixte n'est visible aujourd'hui — le défaut est latent et se matérialisera à la traduction du namespace Shared. Correctif : ne transporter que `key` et résoudre côté vue via une table key→TranslationKey (pattern 3 de catalogue.ts) ; les clés `promptEstimate.breakdown.*` existent mais portent un « : » final, prévoir des clés dédiées.

**Recommandation**

Ne transporter que `key` dans LargestContextSection et traduire côté vue via une table key→clé de catalogue (les huit clés existent déjà comme PromptContextSectionKey) ; supprimer SECTION_LABELS.

<details><summary>Preuve relevée par l'auditeur</summary>

estimator.ts:208 `label: SECTION_LABELS[maxKey] ?? maxKey` ; PromptTokenEstimateView.tsx:312 `label: largestSection.label` ; scan exports : SECTION_LABELS prod=0 hors fichier.

</details>

