# Lot 17 — Portage Piscine des îlots restants

**Difficulté** 3/4 — Difficile
**Findings** 11 (0 fort · 7 moyen · 4 faible ; effort 3 S · 3 M · 5 L)
**Dépendances** Indépendant ; volumineux, prévoir 6 à 8 tickets.

## Décision

Plus aucune surface en grammaire shadcn : les pages story, qa projet, settings projet, git-sync, import, transcription chat, et les composants McpServersSection, RoutinesSettings, components/review sont réécrits en primitives Piscine ou supprimés. La page story autonome est remplacée par une bande d'édition de story dans l'overlay.

## Objectif

Chaque écran : pas d'en-tête propre, état = mot/icône, couleur = stratum ou identité projet, PillButton/Stamp/StrataBand. La page /projects/:id/qa devient une projection (GET /qa/reports sans blobs, sessionStatus, live) recomposée avec les bandes de QaScreen. components/review : props mortes retirées, resolveAll en une requête.

## Démarche suggérée

1. Un ticket par écran ; commencer par la page story (supprime aussi useStoryDetail/CommentThread/StoryDetailPanel/InlineEdit et le test one-click-send-to-dev) et components/review (monté dans l'overlay, donc visible partout).
2. Tenir la liste des 43 importeurs de ui/button et 13 de ui/badge comme check-list de fin (fiche #37).
3. Migrer SettingsLegacy.* vers Settings.mcp.* et supprimer le namespace.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #27 — McpServersSection (783 l.) est la dernière surface réglages en grammaire shadcn, montée au milieu de deux pages Piscine

**Nature** refacto · **Impact** moyen (vérificateur : plutôt moins) · **Effort** L · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `components/settings/McpServersSection.tsx:46-49`
- `components/settings/McpServersSection.tsx:253-284`
- `components/settings/McpServersSection.tsx:566-676`
- `app/settings/pipeline/page.tsx:20-46`
- `app/projects/[projectId]/settings/page.tsx:163`
- `lib/i18n/messages/en/SettingsLegacy.json`

**Constat**

`components/settings/McpServersSection.tsx` est monté par `app/settings/pipeline/page.tsx:44` (scope global) et `app/projects/[projectId]/settings/page.tsx:163` (scope projet). Il est écrit intégralement avec `Button`/`Badge`/`Input` de `components/ui`, un `<select>` et trois `<textarea>` nus stylés à la main (`rounded-md border border-input bg-transparent`, lignes 566-576, 597-604, 668-676…), des `space-y-*` et `rounded border p-2` — rien de `@/components/piscine` (aucun StrataBand/BandHeader/PillButton). Il est aussi le seul consommateur du namespace i18n `SettingsLegacy` (commentaire l.46-49 assume « the OLDER settings surface »). Sur la page Pipeline, il apparaît entre des bandes Piscine et le SettingsFooter, hors du contrat draft/PATCH unique de la page (documenté page.tsx:20-26). Il porte de plus deux `try/finally` (`send` l.253-284, `handleTest` l.336-372) qui font décrocher le React Compiler (10 warnings react-hooks/todo sur ce fichier d'après le lint).

**Précision du vérificateur**

`components/settings/McpServersSection.tsx` (760 lignes, pas 783) est une surface réglages écrite entièrement en grammaire shadcn — `ui/{button,input,badge}` (l.58-60), un `<select>` nu (l.604) et quatre `<textarea>` nus stylés à la main (l.640, 677, 694, 713), zéro import de `@/components/piscine` — et le seul consommateur du namespace i18n `SettingsLegacy` (l.219 ; commentaire l.45-48). Elle est montée à deux endroits : `app/settings/pipeline/page.tsx:44`, page en bandes Piscine, où sa position hors du contrat draft/PATCH est explicitement documentée et justifiée (page.tsx:21-26) ; et `app/projects/[projectId]/settings/page.tsx:163`, page qui n'est PAS Piscine (div `p-6 max-w-4xl space-y-6`, ProjectTokenBudgetSection et RoutinesSettings également en shadcn pur). Ce n'est donc pas la « dernière » surface shadcn des réglages. Le volet React Compiler du finding est caduc : le travail non commité a remplacé les deux `try/finally` par `useScopedMutation` (git diff : deux `-} finally {`, `+useScopedMutation(baseUrl)`), et `npx eslint` sur le fichier ne sort plus aucun warning alors que `react-hooks/todo` est bien actif (eslint.config.mjs:27-29). Reste un travail de cohérence design + migration i18n `SettingsLegacy.*` → `Settings.mcp.*`, sans dette compiler ni anomalie d'architecture.

**Recommandation**

Réécrire la section en bandes Piscine (StrataBand feed + SettingRow/SettingField/PillButton), migrer `SettingsLegacy.*` vers `Settings.mcp.*` et supprimer le namespace, remplacer les deux `finally` par un `setBusy(false)` en fin de chemin comme le font déjà WebhooksBand/OpenAiCard.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n 'McpServersSection' app components` → 2 montages. `rg -l 'useTranslations("SettingsLegacy")'` → uniquement McpServersSection.tsx. Le fichier importe `@/components/ui/button`, `ui/input`, `ui/badge` (l.58-60) et aucun symbole de `@/components/piscine`. CLAUDE.md : « Compose from @/components/piscine ».

</details>

### #37 — Deux systèmes de boutons/badges coexistent : 43 importeurs de ui/button et 13 de ui/badge face à PillButton/Stamp — la carte des surfaces non migrées

**Nature** refacto · **Impact** moyen · **Effort** L · **Statut** confirmé · **Domaine d'audit** settings-piscine-shared-ui

**Fichiers**
- `components/ui/button.tsx`
- `components/ui/badge.tsx`
- `components/piscine/PillButton.tsx`
- `components/piscine/Stamp.tsx`
- `components/review/`
- `components/chat/`
- `components/kanban/`
- `components/import/`
- `app/projects/[projectId]/settings/page.tsx`
- `app/projects/[projectId]/git-sync/page.tsx`
- `app/inbox/page.tsx`

**Constat**

CLAUDE.md prescrit de composer depuis `@/components/piscine` ; pourtant `components/ui/button` a 43 importeurs répartis sur 27 répertoires et `ui/badge` 13, tandis que `PillButton` en a 47. Les répertoires encore en shadcn dessinent la frontière du redesign : components/review (6), components/chat (4), components/kanban (3), components/import (3), components/qa (2), components/night (2), et une page par sous-route projet (`settings`, `git-sync`, `github-issues`, `frictions`, `documents`, `qa`, `stories/[storyId]`, `sessions/chat/[conversationId]`), plus `app/inbox`, `app/projects/new`, `app/projects/import`. Les primitives ui restent en style shadcn d'origine (button.tsx `rounded-md text-sm`, badge.tsx `rounded-full text-xs`) — pas de re-stylage en sosie Piscine, donc pas de violation directe, mais deux vocabulaires visuels sur les mêmes écrans (ex. page Pipeline : PillButton dans les bandes, Button dans McpServersSection).

**Précision du vérificateur**

Chiffres confirmés dans l'arbre de travail tel quel : `rg -l 'ui/button"' app components hooks lib` → 43 fichiers sur 27 répertoires ; `ui/badge"` → 13 ; `rg -l PillButton app components --glob '*.tsx' | grep -v components/piscine` → 47. Les primitives sont bien en style shadcn d'origine (components/ui/button.tsx L8 : `rounded-md text-sm font-medium` ; components/ui/badge.tsx L8 : `rounded-full … text-xs font-medium`), donc pas de re-stylage en sosie Piscine. Aucun composant de components/piscine/ n'importe ui/button ni ui/badge (grep vide) : les deux vocabulaires sont réellement disjoints. Deux imprécisions à corriger : (1) la liste de répertoires est incomplète — elle omet components/shared (3), plus components/story, settings, sessions, routines, github, documents, desk, auto-mode et components/ui (1 chacun) ; (2) sur l'exemple de la page Pipeline (app/settings/pipeline/page.tsx), aucune « bande » n'utilise PillButton — les bandes importées (PipelineBand, VerificationBand, AgentsMemoryBand, GlobalPromptBand) n'en contiennent pas ; le PillButton vient de SettingsFooter (components/settings-piscine/SettingsFooter.tsx), face au `Button` de components/settings/McpServersSection.tsx L58. La cohabitation sur le même écran reste donc vraie, mais par le footer, pas par les bandes. Les namespaces i18n cités existent bien (lib/i18n/messages/{en,fr}/SettingsLegacy.json et ChatLegacy.json, enregistrés dans lib/i18n/messages/index.ts).

**Recommandation**

Tenir cette liste comme backlog de migration par surface (review, chat/UnifiedChatPanel — conservé volontairement —, kanban dialogs, import, pages projet secondaires) ; une fois vide, supprimer ui/button, ui/badge et le namespace i18n `SettingsLegacy`/`ChatLegacy`.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -l 'ui/button"' app components hooks lib | sed -E 's#/[^/]+$##' | sort | uniq -c` → 27 répertoires, 43 fichiers ; `rg -l PillButton app components --glob '*.tsx' | grep -v components/piscine` → 47 fichiers. Importeurs ui : badge 13, dialog 12, dropdown-menu 24, input 15, textarea 14, select 9.

</details>

### #73 — components/routines/RoutinesSettings.tsx (837 l.) est un écran pré-Piscine : titre de page au milieu de la page, Tabs à un seul onglet, couleur-état, config en JSON brut

**Nature** refacto · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** pipeline-routines

**Fichiers**
- `components/routines/RoutinesSettings.tsx:8-18`
- `components/routines/RoutinesSettings.tsx:134-139`
- `components/routines/RoutinesSettings.tsx:432-445`
- `components/routines/RoutinesSettings.tsx:678-688`
- `app/projects/[projectId]/settings/page.tsx:159-163`
- `lib/i18n/messages/en/Routines.json:3`
- `lib/routines/validation.ts:7`

**Constat**

(a) Le composant rend `<h2>{t("page.title")}</h2>` = « Project settings » (Routines.json:3, L678-680) alors qu'il est monté en 2e position de app/projects/[projectId]/settings/page.tsx:159-163, sous ProjectTokenBudgetSection : le titre de page apparaît au milieu de l'écran. (b) `<Tabs defaultValue="routines">` avec un unique TabsTrigger (L678-688), présent dès sa création (commit 5f29b932) — structure sans fonction. (c) Compose des primitives shadcn (Select, Checkbox, Tabs, Textarea, L8-18) et code la couleur d'état dans `statusClass` (L134-139 : text-agent / text-destructive / text-primary selon completed/failed/running), à rebours de CLAUDE.md (« Compose from @/components/piscine », « Colour is the stratum… never state »). (d) La configuration se saisit en JSON brut (Textarea L432-445), y compris `namedAgentId` tapé à la main alors que NamedAgentSelect existe ; `timeOfDay` reste obligatoire pour ci_watch qui ne l'utilise pas (validation.ts:7, hint Routines.json:32 « retained but not used »).

**Précision du vérificateur**

components/routines/RoutinesSettings.tsx (771 l. dans l'arbre de travail, fichier modifié par la rationalisation en cours) est un écran pré-Piscine. (a) Il rend son propre titre de page `<h2>{t("page.title")}</h2>` = « Project settings » (L.623 ; lib/i18n/messages/en/Routines.json:3) alors qu'il est monté en 2e position dans app/projects/[projectId]/settings/page.tsx:159-164, sous ProjectTokenBudgetSection : le titre de page atterrit au milieu de l'écran (seul consommateur du composant). (b) `<Tabs defaultValue="routines">` avec un unique TabsTrigger/TabsContent (L.653-662, 663-767) — structure sans fonction ; elle a été ajoutée non pas à la création (4bfd596e) mais par le commit de durcissement 5f29b932. (c) Il compose des primitives shadcn (Button/Checkbox/Input/Select/Tabs/Textarea, L.10-21) et code la couleur d'état dans `statusClass` (L.158-163 : text-agent / text-destructive / text-primary selon completed/failed/running, appliqué L.309), à rebours de CLAUDE.md ; le barrel components/piscine/index.ts n'expose ni Tabs, ni Select, ni Textarea (StrataBand, BandHeader, SelectPill, CheckMark). (d) La configuration se saisit en JSON brut dans un Textarea (L.400-407, libellé « Configuration (JSON) »), y compris `namedAgentId` tapé à la main alors que components/shared/NamedAgentSelect.tsx existe et sert déjà à ~15 écrans ; `timeOfDay` reste obligatoire à la création pour tous les kinds (lib/routines/validation.ts:7, non optionnel dans createRoutineSchema) y compris ci_watch qui ne l'utilise pas (Routines.json:32 « retained but not used »).

**Recommandation**

Réécrire l'écran en Piscine (StrataBand/BandHeader/SelectPill/CheckMark, état = mot/icône), retirer le Tabs et le titre de page, remplacer le Textarea JSON par des champs typés par kind (namedAgentId via NamedAgentSelect, intervalMinutes/maxDeletedChunks numériques), et ne pas exiger timeOfDay pour ci_watch.

<details><summary>Preuve relevée par l'auditeur</summary>

Lecture intégrale du fichier ; `git show 5f29b932 -- components/routines/RoutinesSettings.tsx | grep TabsTrigger` → un seul trigger dès l'origine ; `rg -n "Tabs|Select|Checkbox|Textarea" components/piscine/index.ts` → pas de Tabs/Select/Textarea Piscine, la barre expose SelectPill/CheckMark/UnderlineTabNav.

</details>

### #100 — /projects/:id/qa est une seconde surface QA pré-Piscine qui lit le statut brut de qa_reports et charge les colonnes blob toutes les 3 s

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/projects/[projectId]/qa/page.tsx:34-40`
- `app/projects/[projectId]/qa/page.tsx:114-116`
- `app/projects/[projectId]/qa/page.tsx:127-147`
- `hooks/useQaReports.ts:25-31`
- `app/api/projects/[projectId]/qa/reports/route.ts:15-20`
- `lib/qa/aggregate.ts:233-262`
- `app/api/qa/findings/route.ts:430-447`

**Constat**

Le screen /qa (QaScreen + lib/qa/aggregate) a été construit avec une discipline documentée : liveness dérivée de la session (isCheckLive, « qa_reports.status a un seul writer, trois chemins le laissent sur running »), colonnes `report_content`/`prompt_used` jamais sélectionnées dans un payload pollé, pas d'en-tête de page, couleur = stratum. La page projet fait l'inverse : `useQaReports` poll `GET /qa/reports` qui fait `db.select().from(qaReports)` complet (reports/route.ts:15-20, donc reportContent + promptUsed de tout l'historique) toutes les 3 s tant que `report.status === "running"` (useQaReports.ts:25 — une ligne échouée avant le boot sweep fait poller à l'infini) ; ses stats (:114-116) et `statusTone` (:34-40) lisent `report.status` brut ; elle rend son propre header h2 + description + boutons shadcn (:127-147) contre la règle CLAUDE.md « no page header of its own », et code l'état en couleur (`text-destructive` failed, `text-primary` running, `bg-foreground text-background` filtre actif). Elle reste pourtant la seule à dessiner un rapport (ReportDetail) et est liée depuis DeskProjectMenu:29, nav.ts:141 et QaCheckRow:60.

**Précision du vérificateur**

Finding confirmé, avec deux précisions de référence.

(a) Numéro de ligne à corriger : le commentaire « TWO COLUMNS OF THIS TABLE ARE NEVER SELECTED … this route is polled every 8 s » est en `app/api/qa/findings/route.ts:456-458`, pas :430-447.

(b) Précision sur le poll infini : `reconcileStrandedQaReports()` (lib/qa/boot-cleanup.ts:62) règle au boot les lignes historiques bloquées sur `running`. Le poll 3 s sans fin concerne donc une ligne échouée PENDANT l'uptime du process courant (redémarrage mid-check, closure de lancement qui rejette, annulation d'un check encore en file) — exactement les trois chemins que documente `lib/qa/aggregate.ts:240-256` —, pas « une ligne échouée avant le boot sweep ».

Le reste est exact et vérifié : reports/route.ts:15-20 fait un `db.select()` sans projection (donc reportContent + promptUsed de tout l'historique) ; useQaReports.ts:25-31 le poll toutes les 3 s via `pollWhen: hasRunningReport` sur `report.status === "running"` (usePolledResource.ts:92 confirme que pollWhen gate le polling) ; page.tsx:34-40 + :218 et :110-116 lisent le statut brut sans isCheckLive/sessionStatus ; page.tsx:117-147 rend bien un h2 + description + boutons shadcn contre la règle CLAUDE.md ; l'état est codé en couleur (:148-155, :167). Et la page reste la seule à monter ReportDetail (aucun autre consommateur dans app/ components/ hooks/ lib/), liée depuis DeskProjectMenu.tsx:29, lib/navigation/nav.ts (entrée `qa-checks`) et QaCheckRow.tsx:60.

**Recommandation**

Projeter GET /qa/reports (exclure reportContent/promptUsed, ajouter sessionStatus via LEFT JOIN et `live` via isCheckLive) ; recomposer la page projet avec les bandes Piscine (QaChecksBand + ReportDetail) sans header ni couleur-état ; ou bien monter `<QaScreen projectId>` sur cette route avec ReportDetail en panneau.

<details><summary>Preuve relevée par l'auditeur</summary>

reports/route.ts:15 `db.select().from(qaReports)` sans projection ; qa/findings :430-436 « TWO COLUMNS OF THIS TABLE ARE NEVER SELECTED … this route is polled every 8 s ». useQaReports.ts:25 `hasRunningReport = … report.status === "running"`. page.tsx:34-40 statusTone. CLAUDE.md : « A screen renders no page header of its own ».

</details>

### #101 — components/review/* est un îlot shadcn pré-Piscine encore monté dans l'overlay ticket (couleur = état, props mortes, resolveAll en N requêtes)

**Nature** refacto · **Impact** moyen (vérificateur : plutôt moins) · **Effort** L · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `components/review/DiffViewer.tsx:41`
- `components/review/DiffViewer.tsx:141-160`
- `components/review/ReviewActions.tsx:21-22`
- `components/review/ReviewActions.tsx:57-58`
- `components/review/ReviewActions.tsx:151-166`
- `components/review/InlineCommentThread.tsx:30-34`
- `hooks/useReviewComments.ts:99-105`
- `lib/workflow/merge-approval.ts:35`
- `components/ticket/TicketOverlay.tsx:442-449`

**Constat**

TicketOverlay.tsx:442-449 monte DiffViewer, qui tire ReviewActions, InlineCommentThread, FileDiffView, DiffLine, UnanchoredFindings (950 l.). Ces fichiers utilisent Badge/Button shadcn et 23 classes de couleur-état (`text-green-500`, `text-red-500`, `text-blue-500`, `bg-green-600 hover:bg-green-700` sur le bouton Merge, `text-amber-500`), contre la règle « colour is the stratum, never state ; filled controls are --action ». ReviewActions déclare projectId/epicId obligatoires et ne les lit jamais (:21-22, eslint no-unused-vars) ; DiffViewer extrait `commentsLoading` sans le rendre (:41). useReviewComments.resolveAll (:99-105) envoie un PATCH séquentiel par commentaire ouvert alors que le serveur possède resolveOpenReviewComments (une UPDATE) sans route pour l'exposer. `canBackToDev` (:57) autorise « Back to dev » sur backlog/todo.

**Précision du vérificateur**

`components/review/` (7 fichiers, 1007 l.) est un îlot shadcn pré-Piscine : 14 imports depuis `components/ui/`, zéro depuis `components/piscine`. Il n'a qu'un consommateur produit, `components/ticket/TicketOverlay.tsx:30` monté aux lignes 447-455. Il viole « colour is the stratum, never state » en 20 endroits, dont le bouton Merge en `bg-green-600 hover:bg-green-700` (`ReviewActions.tsx:171`) au lieu de `--action`, et le cadre bleu piloté par `comment.status` (`InlineCommentThread.tsx:33-34`). `ReviewActions` déclare `projectId`/`epicId` obligatoires (`:21-22`) sans jamais les lire — ESLint ne le voit pas (`npx eslint components/review` : 0 erreur, 0 warning) et il faut un tsc/AST pour le repérer. `useReviewComments.resolveAll` (`hooks/useReviewComments.ts:76-90`) envoie un PATCH par commentaire ouvert alors que `lib/workflow/merge-approval.ts:32` `resolveOpenReviewComments` résout en bloc — cette fonction est bien exposée, mais seulement via les routes `merge`/`resolve-merge`, jamais via un endpoint resolve-all appelable par l'UI. `canBackToDev` (`ReviewActions.tsx:57`) autorise « Back to dev » depuis `backlog`/`todo`/`in_progress` (sous garde `openCount > 0`). En revanche, contrairement au finding d'origine, `commentsLoading` EST rendu (`DiffViewer.tsx:89`), ainsi que `commentsError`/`commentsPending`/`commentsReady`.

**Recommandation**

Reconstruire la vue diff sur les primitives Piscine (Stamp/PillButton/SurfaceCard, `--action` pour Merge), retirer les props mortes, et ajouter un `POST .../review-comments/resolve-all` (ou un PATCH bulk) branché sur resolveOpenReviewComments.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -c 'text-(green|red|blue|amber)-[0-9]+|bg-(green|red|blue|amber)-[0-9]+' components/review → DiffViewer 5, FileDiffView 7, DiffLine 4, ReviewActions 2, InlineCommentThread 2, UnanchoredFindings 1. npx eslint components/review → 3 no-unused-vars (DiffViewer:41, ReviewActions:35-36). rg 'components/review/' app components hooks → seul import : TicketOverlay.tsx:30.

</details>

### #128 — Page story autonome : une seconde fiche ticket pré-Piscine (useStoryDetail, CommentThread, StoryDetailPanel, InlineEdit) qui double l'overlay et n'est atteignable que par un QuietLink

**Nature** doublon · **Impact** moyen · **Effort** L · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `app/projects/[projectId]/stories/[storyId]/page.tsx`
- `components/story/StoryDetailPanel.tsx:40-45,87-117`
- `components/story/CommentThread.tsx`
- `hooks/useStoryDetail.ts:33-62`
- `components/kanban/InlineEdit.tsx`
- `components/ticket/UserStoriesBand.tsx:681-691`
- `lib/i18n/messages/en/ProjectStories.json:4-5`

**Constat**

`/projects/:id/stories/:storyId` est le dernier écran de l'ancien design : shadcn Button/Badge/Select, couleurs brutes `bg-yellow-500/10`/`text-green-500` (STATUS_COLORS), copie « Back to board », Loader2. Il redouble concept par concept l'overlay 6a : useStoryDetail ↔ useEpicDetail, CommentThread ↔ ConversationBand+CommentBubble, AgentActionsBar ↔ AgentsBand, InlineEdit (seul consommateur restant sous components/kanban) ↔ édition supprimée de l'overlay. useStoryDetail porte même deux implémentations du même GET (effet de montage et `loadData`). Sa seule porte d'entrée est le lien « open » de UserStoriesBand.

**Précision du vérificateur**

Finding confirmé sur le fond, avec trois corrections de précision :

1) Références de lignes. `components/ticket/UserStoriesBand.tsx` : le QuietLink « open » est aux lignes 165-175 (`href={`/projects/${projectId}/stories/${story.id}`}`, testId `ticket-story-link`), pas 681-691 ; le commentaire « the row's trailing QuietLink is the only door to it anywhere in the app » est aux lignes 7-9, pas 23-27. `components/story/StoryDetailPanel.tsx` : STATUS_COLORS est aux lignes 38-43 (`in_progress: "bg-yellow-500/10 text-yellow-500"`, `done: "bg-green-500/10 text-green-500"`), le bloc Select+Badge aux lignes ~85-117 (correct).

2) `hooks/useStoryDetail.ts` n'a pas « deux implémentations » du GET : les deux sites d'appel (effet de montage l.56-62 et `loadData` l.46-54) partagent un `applyStory` mémoïsé (l.36-45). C'est une duplication du `fetch(storyUrl)` et du chemin d'erreur, pas deux logiques divergentes.

3) Le coût de suppression est plus élevé que le finding ne le laisse entendre : la page est couverte par plusieurs suites jsdom (`__tests__/story-detail-delete.test.tsx`, `story-detail-approve-merge-warning.test.tsx`, `toast-under-open-dialog.test.tsx`, `toast-surface-uniformity.test.tsx`), à retirer/reporter avec elle.

Tout le reste est vérifié : les 6 fichiers existent et ne sont pas supprimés dans l'arbre (`git status --porcelain` ne liste rien pour `components/story/`, `hooks/useStoryDetail.ts`, `components/kanban/InlineEdit.tsx`, ni la route `app/projects/[projectId]/stories/[storyId]/`) ; `StoryDetailPanel.tsx:6` est bien le seul import restant de `components/kanban/InlineEdit` (l'autre occurrence, `components/ticket/TicketDescriptionCard.tsx:11`, n'est qu'un commentaire) ; `useStoryDetail` n'est consommé que par cette page ; imports shadcn : `page.tsx:12` Button, `StoryDetailPanel.tsx:5` Badge et `:13` Select, `CommentThread.tsx:5` Button ; `Loader2` à `page.tsx:16,104` ; « Back to board » à `lib/i18n/messages/en/ProjectStories.json:4` rendu à `page.tsx:117` ; les contreparties Piscine existent bien (`hooks/useEpicDetail.ts`, `components/ticket/{ConversationBand,CommentBubble,AgentsBand}.tsx`). Aucune autre porte d'entrée : la seule autre référence à l'URL `/projects/.../stories/...` dans `app/ components/ hooks/ lib/` est ce QuietLink (aucun `router.push` vers ce chemin).

**Recommandation**

Décider du sort des stories : soit une bande d'édition de story dans l'overlay (titre/AC/statut via la route PATCH existante) et suppression de la page + components/story + InlineEdit + useStoryDetail, soit re-skin de la page en Piscine en réutilisant ConversationBand/AgentsBand.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n "kanban/InlineEdit" app components` → StoryDetailPanel.tsx:6 seulement (plus un commentaire dans TicketDescriptionCard). `rg -n useStoryDetail app components hooks` → la page story uniquement. `rg -n "@/components/ui/(button|badge|select)" components/story app/projects/[projectId]/stories` → 4 imports. UserStoriesBand.tsx:23-27 : « the row's trailing QuietLink is the only door to it anywhere in the app ».

</details>

### #129 — Changer le statut d'une story depuis StoryDetailPanel avale le refus du workflow : `updateStory` ne lit que `data.data`

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `hooks/useStoryDetail.ts:64-79`
- `app/api/projects/[projectId]/stories/[storyId]/route.ts:50-75`
- `components/story/StoryDetailPanel.tsx:87-101`

**Constat**

La route PATCH `/stories/:storyId` refuse une transition invalide avec `{ error }` 400 (via applyStoryTransition). Côté client `useStoryDetail.updateStory` fait `const data = await res.json(); if (data.data) setStory(...)` : ni `res.ok` ni `data.error` ne sont examinés, rien n'est relancé, aucun état d'erreur n'existe dans le hook. Le Select revient silencieusement à l'ancienne valeur et l'utilisateur n'a aucune explication. Même chemin pour title/description/acceptanceCriteria (erreurs de validation zod).

**Précision du vérificateur**

Changer le statut d'une story depuis StoryDetailPanel avale le refus du workflow. Route PATCH app/api/projects/[projectId]/stories/[storyId]/route.ts:72-74 renvoie `{ error }` 400 quand applyStoryTransition refuse (matrice STORY_TRANSITIONS lib/workflow/engine.ts:34-41 : depuis « todo », seul « in_progress » est permis, alors que le Select de components/story/StoryDetailPanel.tsx:87-101 propose les quatre statuts). Côté client hooks/useStoryDetail.ts:77-95 (`updateStory`) fait `const data = await res.json(); if (data.data) setStory(...)` sans examiner `res.ok` ni `data.error`, ne renvoie rien et ne touche pas l'état `error` du hook ; la page app/projects/[projectId]/stories/[storyId]/page.tsx:168-171 passe `updateStory` directement en `onUpdate`, son ToastStack ne sert qu'à la suppression et aux actions agent. Le Select contrôlé revient donc à l'ancienne valeur sans explication. Même chemin pour title/description/acceptanceCriteria (400 « Validation failed » de lib/validation/validate.ts:19-26). Aucun test ne couvre ce chemin (updateStory est mocké en vi.fn() partout). Correctif : aligner sur useEpicDetail.updateEpic (hooks/useEpicDetail.ts:137-161) qui renvoie `{ ok, error }`, et afficher l'erreur via `raise` dans la page.

Changer le statut (ou title/description/acceptanceCriteria) d'une story depuis StoryDetailPanel avale le refus serveur. hooks/useStoryDetail.ts:77-95 (`updateStory`) ne lit que `data.data` — ni `res.ok`, ni `data.error`, aucun retour, aucun try/catch (un fetch rejeté devient un rejet de promesse non géré depuis `onValueChange`). La route PATCH app/api/projects/[projectId]/stories/[storyId]/route.ts:72-74 renvoie `{ error }` 400 pour toute transition hors `STORY_TRANSITIONS` (lib/workflow/engine.ts:34-41 : todo→review, todo→done, review→todo, done→todo interdits ; gardes :147-158 sur in_progress avec session active) et pour les erreurs zod (:53-54), alors que le Select de components/story/StoryDetailPanel.tsx:87-101 propose les 4 statuts sans filtrage. Chemin réel : TicketOverlay (monté sur /, /projects/:id, /tickets, /qa, /chat) → UserStoriesBand.tsx:166-176 → page stories/[storyId]/page.tsx:168-171 qui passe `updateStory` tel quel et n'exploite pas son ToastStack (:202) pour ce cas, contrairement à la suppression (:86-87). Modèle à suivre : useEpicDetail.updateEpic (:137-161) renvoie `{ ok, error }`.

**Recommandation**

Faire renvoyer `{ ok, error }` par updateStory comme `useEpicDetail.updateEpic` (:137-161) et afficher l'erreur dans la page (toast stack déjà présent).

<details><summary>Preuve relevée par l'auditeur</summary>

useStoryDetail.ts:74-78 : `const data = await res.json(); if (data.data) { setStory(...) }` — pas de branche error. route.ts:72-74 : `if (!result.valid) return NextResponse.json({ error: result.error }, { status: 400 });`.

</details>

### #68 — Les surfaces git/import n'ont pas été portées sur Piscine : shadcn brut, couleur = état, 22 useState dans GitSyncPage

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** L · **Statut** confirmé · **Domaine d'audit** git-github-projects

**Fichiers**
- `app/projects/import/page.tsx:7`
- `app/projects/import/page.tsx:583`
- `components/import/ImportPreview.tsx:60-65`
- `components/github/GitHubConnectBanner.tsx:5`
- `components/github/GitHubConnectBanner.tsx:138`
- `app/projects/[projectId]/git-sync/page.tsx:7-8`
- `app/projects/[projectId]/git-sync/page.tsx:131-181`
- `app/projects/[projectId]/github-issues/page.tsx:6-8`

**Constat**

app/projects/import/page.tsx, components/import/*, components/github/GitHubConnectBanner.tsx, app/projects/[projectId]/git-sync/page.tsx et github-issues/page.tsx composent directement Button/Input/Card/Badge de components/ui avec des tailles en px codées, contrairement à la règle « Compose from @/components/piscine ». ImportPreview.tsx:60-65 mappe le statut sur bg-green-500/bg-yellow-500/bg-blue-500 et import/page.tsx:583,593 utilise bg-blue-500/10 — palette Tailwind brute et couleur-état, doublement contraire à CLAUDE.md. GitSyncPage porte 22 useState dans un seul composant (record du dépôt d'après l'inventaire), dont une machine d'état d'erreur maison (l.169-179).

**Précision du vérificateur**

Les surfaces git/import composent directement shadcn au lieu du barrel Piscine : app/projects/import/page.tsx:7, components/import/ImportPreview.tsx:5-9, app/projects/[projectId]/git-sync/page.tsx:8-9, app/projects/[projectId]/github-issues/page.tsx:7-9 ; dans ces cinq répertoires seul components/github/RepoStrataBand.tsx:7 importe @/components/piscine. Violation nette de « colour is never state » : ImportPreview.tsx:60-65 mappe done/in_progress/todo sur bg-green-500/bg-yellow-500/bg-blue-500, et app/projects/import/page.tsx:583 et 593 rendent deux bandeaux en bg-blue-500/10 text-blue-400. git-sync/page.tsx concentre 24 `= useState` (et non 22), record mesuré du dépôt devant RoutinesSettings (18) et projects/[projectId]/page.tsx (17). Corrections à apporter au finding : GitHubConnectBanner.tsx ne fait que 116 lignes (les références :5 et :138 sont fausses ; son import shadcn est en l.9) et n'emploie que des tokens sémantiques — pas de palette brute ni de couleur-état ; le grief « tailles en px codées » ne distingue rien (222 fichiers de app/+components/ contiennent des valeurs `[Npx]`, dont RepoStrataBand lui-même) ; et la « machine d'état d'erreur maison » (git-sync/page.tsx:171-179, pas 169-179) est un correctif documenté qui fusionne deux useState divergents, pas un symptôme.

**Recommandation**

Si /projects/import est conservé (finding précédent), le refondre en StrataBand/PillButton/Stamp avec l'état en mot ; découper GitSyncPage en hooks (useGitSyncStatus, usePullPush) et réutiliser useGitStatus/useWorktrees au lieu de dupliquer leurs états.

<details><summary>Preuve relevée par l'auditeur</summary>

Lecture des fichiers : imports `@/components/ui/button|input|card|badge` ; ImportPreview.tsx:61 `done: "bg-green-500/10 text-green-500"`. CLAUDE.md §Piscine : « Colour is the stratum … never state », « Compose from @/components/piscine. Do not re-style a shadcn primitive ». Seul RepoStrataBand.tsx (l.7) utilise le barrel piscine.

</details>

### #118 — La page de transcription chat (sessions/chat/[conversationId]) reste hors Piscine et affiche des valeurs d'enum brutes comme copie

**Nature** refacto · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx:8-12,64-70,168-190`

**Constat**

`sessions/chat/[conversationId]/page.tsx` est le seul écran du périmètre encore composé de `Card`/`Badge`/`Button` shadcn bruts (imports :8-12) avec des classes de couleur d'état (`text-agent`, `text-destructive`, :175-186 — « colour is never state » dans CLAUDE.md) ; il rend `{meta.type}` et `{meta.status}` (valeurs de colonne `epic`/`generating`/`error`) directement comme texte (:168-190), alors que la liste des sessions traduit ces mêmes états (`rows.generating`, `rows.chat`). Deux appels `fetch` (`/conversations/:id` et `/chat?conversationId=`) polled à 3 s via `useSessionPolling` pendant `generating`, sans lien vers la page chat qui sait déjà afficher cette conversation.

**Précision du vérificateur**

`app/projects/[projectId]/sessions/chat/[conversationId]/page.tsx` reste hors Piscine : imports shadcn bruts `Badge`/`Button`/`Card` (:8-10) et couleur utilisée comme état (:163-170, `text-agent border-agent-border` si `generating`, `text-destructive` si `error`), ce que CLAUDE.md interdit (« colour is the stratum or the project identity — never state »). Surtout, la page affiche des valeurs de colonne non traduites comme copie utilisateur : `{meta.type}` (:158, `brainstorm|epic`) et `{meta.status}` (:172, `active|generating|generated|error`) — cf. `lib/db/schema.ts:161-163` — alors que la liste des sessions traduit exactement ces états (`app/projects/[projectId]/sessions/page.tsx:1027`, `t("rows.generating")` / `t("rows.chat")`). Deux `fetch` (:74-77) sont pollés à 3 s tant que `status === "generating"` (:106) et la page n'offre aucun lien vers `/chat?conversation=`, qui couvre déjà ce parcours (`app/chat/page.tsx:23-31`). Correctifs à la formulation d'origine : les lignes du bloc de rendu sont :154-190 (et non :168-190), et ce n'est PAS le seul écran encore en shadcn brut — `app/projects/[projectId]/frictions/page.tsx:24-26` importe aussi Badge/Button/Card.

**Recommandation**

Passer par les primitives Piscine (Stamp/IdentityChip/Mono), résoudre `type`/`status` via des tables de clés, ou rediriger vers `/chat?conversation=` si la page chat couvre déjà ce parcours.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:170 `{meta.type}` ; :182 `{meta.status}` dans un `<Badge>` avec `isGenerating ? "text-agent border-agent-border" : meta.status === "error" ? "text-destructive …"`.

</details>

### #130 — Le bouton « Send to dev » de CommentThread n'existe plus qu'en test : le seul consommateur produit ne passe jamais `onSendToDev`

**Nature** gras de tests · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** tickets-client

**Fichiers**
- `components/story/CommentThread.tsx:19-23,148-166`
- `app/projects/[projectId]/stories/[storyId]/page.tsx:539-544`
- `__tests__/one-click-send-to-dev.test.tsx`

**Constat**

CommentThread rend un second bouton (Hammer) uniquement si `onSendToDev` est fourni. La page story, seul consommateur, appelle `<CommentThread projectId comments loading onAddComment />` sans cette prop. La branche (props `onSendToDev`, `sendToDevDisabled`, `sendToDevLoading` et le JSX l.148-166) est maintenue vivante par __tests__/one-click-send-to-dev.test.tsx qui la teste directement.

**Précision du vérificateur**

`components/story/CommentThread.tsx` porte trois props optionnelles (`onSendToDev`, `sendToDevDisabled`, `sendToDevLoading`, l.20-24) et un bouton Hammer conditionnel (l.149-164, `data-testid="send-to-dev-button"`). Son unique consommateur produit, `app/projects/[projectId]/stories/[storyId]/page.tsx` l.192-197 (et non 539-544 : le fichier fait 215 lignes), rend `<CommentThread projectId comments loading onAddComment />` sans ces props ; la branche est donc morte en production. Attention, la page contient bien un `onSendToDev` (l.145-146) mais sur `AgentActionsBar`, une prop homonyme à 4 arguments — la preuve « 0 résultat pour rg onSendToDev sur la page » est fausse. Seul `__tests__/one-click-send-to-dev.test.tsx` (5 rendus directs) exerce la branche ; aucun spec e2e. Le retrait rendrait aussi orpheline la clé i18n `Story.comments.sendToDev` (lib/i18n/messages/en/Story.json:8).

**Recommandation**

Retirer les trois props et le bouton de CommentThread ainsi que le test dédié, ou brancher réellement `sendToDev` de useAgentDispatch depuis la page.

<details><summary>Preuve relevée par l'auditeur</summary>

`rg -n onSendToDev app/projects/[projectId]/stories/[storyId]/page.tsx` → 0 résultat ; `rg -n "story/CommentThread" app components` → la page story uniquement (les autres hits sont des `vi.mock`).

</details>

### #204 — La page /projects/:id/settings est une juxtaposition de trois îlots pré-Piscine et charge toute la table settings pour deux clés

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:orphan-small-domains-and-docs

**Fichiers**
- `app/projects/[projectId]/settings/page.tsx:6-9`
- `app/projects/[projectId]/settings/page.tsx:28-46`
- `app/projects/[projectId]/settings/page.tsx:95-100`
- `app/projects/[projectId]/settings/page.tsx:156-166`
- `app/api/settings/route.ts:31-84`

**Constat**

ProjectSettingsPage compose ProjectTokenBudgetSection (shadcn Input/Button, `<h2>` propre, message d'état en texte), RoutinesSettings (837 l., déjà relevé) et McpServersSection (783 l., déjà relevé). La section budget fait `fetch("/api/settings")` — GET sans projection qui sérialise et masque chaque ligne de la table (PAT, webhooks, `dreaming_last_cutoff`, `memory_provenance`, `mcp_user_global_sync`…) — pour n'en lire que `prompt_token_budget:<id>` et `prompt_token_budget`. Ce motif « toute la table pour une clé » est répété dans 11 fichiers (useAutoModeArmed, usePipelineDispatchDefault, useGitHubConfig, MonthlyCapTile, NightRunDialog, LimitsView, OpenAiCard, GitHubCard, useSettingsDraft, integrations/page, settings/page projet). La page n'a aucun élément Piscine.

**Précision du vérificateur**

Vrai sur le fond, avec trois imprécisions à corriger.

Confirmé :
- `app/projects/[projectId]/settings/page.tsx:154-166` est bien une juxtaposition de trois blocs sans aucun élément Piscine : `ProjectTokenBudgetSection` (local), `RoutinesSettings`, `McpServersSection`. `grep -n piscine` sur le fichier ne renvoie rien, et ni `components/routines/RoutinesSettings.tsx` ni `components/settings/McpServersSection.tsx` n'importent `@/components/piscine`.
- La section budget importe bien shadcn (`:8` `@/components/ui/button`, `:9` `@/components/ui/input`), porte un `<h2 className="text-lg font-semibold">` propre (`:98`) et affiche son état en `<p>` texte (`:142-149`).
- `:29` `fetch("/api/settings")` sans projection, puis `:37-43` lecture de deux clés seulement (`promptTokenBudgetSettingKey(projectId)` et `PROMPT_TOKEN_BUDGET_GLOBAL_SETTING_KEY`).
- `app/api/settings/route.ts:31` `db.select().from(settings).all()` : aucun filtre, aucun paramètre `keys`/`prefix` (`grep -n "keys\|searchParams\|prefix"` ne trouve que le message d'erreur du PATCH).
- Le motif est bien répété dans exactement 11 fichiers hors tests : `app/projects/[projectId]/settings/page.tsx`, `app/settings/integrations/page.tsx`, `components/agents-workshop/LimitsView.tsx`, `components/night/NightRunDialog.tsx`, `components/settings-piscine/GitHubCard.tsx`, `components/settings-piscine/OpenAiCard.tsx`, `components/settings-piscine/useSettingsDraft.ts`, `components/usage/MonthlyCapTile.tsx`, `hooks/useAutoModeArmed.ts`, `hooks/useGitHubConfig.ts`, `hooks/usePipelineDispatchDefault.ts`. Aucun `useSettingValue` n'existe.

À corriger :
1. Longueurs périmées : dans l'arbre TEL QUEL, `RoutinesSettings.tsx` fait 771 lignes et `McpServersSection.tsx` 760 (les deux sont modifiés `M` par la rationalisation), pas 837 et 783.
2. Le mot « masque » est trompeur : le GET *redacte* justement les secrets — PAT (`route.ts:34-46` → `{hasToken}`), clé OpenAI (`:48-52`), `webhook_url:*` (`:56-63` → `{hasUrl}`). Il n'y a donc pas de fuite de credentials ; le surcoût est un couplage/sur-transfert (`dreaming_last_cutoff`, `memory_provenance:*`, `mcp_user_global_sync` partent en clair), pas un problème de sécurité.
3. La charge réelle est négligeable localement : la table `settings` de `data/arij.db` contient 23 lignes pour 347 octets de valeurs cumulées. Le grief est architectural (pas de projection, pas de hook partagé), pas de performance.
4. La recommandation cite `OptionRow`, qui n'existe pas : le baril `components/piscine/index.ts` n'exporte pas ce nom (il expose `SurfaceCard`, `PillButton`, `FieldKicker`, `GhostInputPill`, `SegmentedControl`…).

**Recommandation**

Ajouter `?keys=a,b` (ou un GET par préfixe) à /api/settings et un hook `useSettingValue(key)` partagé ; porter la section budget sur OptionRow/PillButton Piscine et retirer son `<h2>`.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:7-9 imports `@/components/ui/button`, `@/components/ui/input` ; :29 `fetch("/api/settings")` puis :37-43 lecture de deux clés ; `grep -rln '"/api/settings"' components app hooks | grep -v __tests__` → 11 fichiers ; settings/route.ts:31 `db.select().from(settings).all()` sans filtre.

</details>

