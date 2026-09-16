# Lot 02 — Retrait des agents de review personnalisés

**Difficulté** 1/4 — Simple — agent peu coûteux
**Findings** 1 (1 fort · 0 moyen · 0 faible ; effort 0 S · 0 M · 1 L)
**Dépendances** Aucune. À faire avant le lot 22 (routes agent-config).

**Statut** fait le 11/09/2026 — retrait complet exécuté. Détail :

- Supprimés : `lib/agent-config/review-agents.ts`, les trois routes
  (`app/api/agent-config/review-agents/**`,
  `app/api/projects/[projectId]/agent-config/review-agents/**`), le hook
  `useReviewAgents`, la bande UI entière de `PromptsView.tsx`
  (`ReviewAgentsBand`, `CustomReviewAgentRow`, `NewReviewAgentForm`), le
  paramètre `CustomReviewAgentPrompt` de `buildReviewPrompt` et sa branche,
  `CUSTOM_REVIEW_AGENT_PREFIX`, `DEFAULT_REVIEW_AGENT_PROMPT`, les schémas zod
  `create/updateReviewAgentSchema` et `CustomReviewAgentRecord`.
- Migration `0059_drop_custom_review_agents.sql` + entrée `_journal.json`, et la
  table sort de `lib/db/schema.ts`.
- Le chip « + N règles projet » de la QA (`QaRubric.projectRuleCount`,
  `RubricChips`, la requête `COUNT(*)` sur `custom_review_agents`) tombe avec la
  chaîne : plus aucune donnée à compter.
- i18n : les clés `AgentsWorkshop.prompts.review*` et `Qa.rubric.projectRules`
  retirées (catalogue à 0 orpheline après coup).
- Tests : `agent-config-review-agents-routes.test.ts` supprimé ; les cas
  « custom » de `prompt-builder-fencing`, `prompt-builder-agent-config`,
  `prompt-builder-snapshots` (snapshot obsolète) et
  `agents-workshop-prompts-state` retirés ; `composite-agents-crud` réécrit
  pour passer par `updateNamedAgent` (voir plus bas).

**Écarts assumés** : la recommandation « soit brancher, soit retirer » a été
tranchée en retrait (décision produit du 11/09), donc la seconde branche est
appliquée intégralement. Effet de bord mécanique : `setCompositeMembers`
n'avait plus qu'un test comme importeur une fois la bande supprimée ; il est
retiré et son test de réordonnancement passe par `updateNamedAgent`, le
véritable chemin d'écriture.

## Décision

Décision produit du 11/09 : retrait complet (table custom_review_agents, 3 routes, hook useReviewAgents, bande UI de l'onglet Prompts, constantes CUSTOM_REVIEW_AGENT_PREFIX, type CustomReviewAgentPrompt de buildReviewPrompt).

## Objectif

Retirer toute la chaîne, sans laisser de paramètre optionnel mort dans buildReviewPrompt.

## Démarche suggérée

1. Supprimer lib/agent-config/review-agents.ts, les routes global + projet, le hook, ReviewAgentsBand/CustomReviewAgentRow/NewReviewAgentForm dans PromptsView.tsx, les clés i18n.
2. Migration manuelle DROP TABLE custom_review_agents + journal.
3. Retirer le paramètre CustomReviewAgentPrompt de buildReviewPrompt et le préfixe.
4. Supprimer les tests dédiés ; npm run i18n:check ; npm test.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #147 — Agents de review personnalisés : CRUD complet, UI complète, aucun dispatcher ne les lance jamais

**Nature** à moitié câblé · **Impact** fort · **Effort** L · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `lib/agent-config/review-agents.ts`
- `app/api/agent-config/review-agents/route.ts`
- `app/api/agent-config/review-agents/[agentId]/route.ts`
- `app/api/projects/[projectId]/agent-config/review-agents/route.ts`
- `hooks/useAgentConfig.ts:194-246`
- `components/agents-workshop/PromptsView.tsx:262-536`
- `lib/claude/prompt-builder.ts:1343-1357`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:99-105`
- `lib/chat/conversation-agent.ts:6`
- `app/api/qa/findings/route.ts:526-532`

**Constat**

La table custom_review_agents a deux jeux de routes (global + projet), un hook (useReviewAgents) et une bande entière de l'onglet Prompts (« Review agents — the four built-in reviews, plus your own », formulaire d'ajout, éditeur nom/prompt/suppression par agent). Mais aucun chemin de dispatch ne lit jamais customReviewAgents.systemPrompt : la route de review n'accepte que les 4 ReviewType builtin (VALID_REVIEW_TYPES), buildReviewPrompt accepte bien un CustomReviewAgentPrompt mais aucun appelant ne construit cette forme, et CUSTOM_REVIEW_AGENT_PREFIX n'a aucun usage. Le seul lecteur en prod est le compteur « + N règles projet » de la QA. L'historique git confirme qu'il n'y a jamais eu de dispatcher (cea9f7ae n'a ajouté que le CRUD). L'utilisateur crée donc des reviewers qui ne tournent jamais. Le champ isEnabled est accepté par PATCH mais aucun contrôle UI ne l'expose (CustomReviewAgentRow ne gère que name/systemPrompt).

**Précision du vérificateur**

Agents de review personnalisés : CRUD complet (lib/agent-config/review-agents.ts + 3 routes), hook useReviewAgents (hooks/useAgentConfig.ts:194-246), bande UI ReviewAgentsBand/CustomReviewAgentRow/NewReviewAgentForm (components/agents-workshop/PromptsView.tsx:262+, libellé « the four built-in reviews, plus your own »), mais aucun dispatcher ne lit jamais customReviewAgents.systemPrompt. buildReviewPrompt accepte `ReviewType | CustomReviewAgentPrompt` (dans l'arbre de travail : lib/claude/prompts/review.ts:36-44 et types.ts:140-143 ; à HEAD : lib/claude/prompt-builder.ts:1343-1357) et gère la branche custom (review.ts:75-84), mais ses deux seuls appelants prod passent un builtin : lib/tokens/dispatch-prompt.ts:410 (reviewType, indexé en :405 dans REVIEW_TYPE_TO_AGENT_TYPE, donc builtin uniquement) et lib/pipeline/stage-review.ts:94 (PIPELINE_REVIEW_TYPE="code_review"). Les routes de dispatch epics/[epicId]/review/route.ts:67-72,99-105, stories/[storyId]/review/route.ts:57,95 et prompt-estimate/route.ts:38,115 rejettent en 400 tout reviewType hors des 4 builtin. CUSTOM_REVIEW_AGENT_PREFIX (lib/chat/conversation-agent.ts:6) n'a plus aucun usage (consommateurs retirés en f0242187). Seul lecteur prod : le COUNT(*) de app/api/qa/findings/route.ts:526-532 (chip « + N règles projet »). git log -S 'customReviewAgents.systemPrompt' vide ; cea9f7ae n'a ajouté que le CRUD. isEnabled est accepté par PATCH et par updateAgent du hook mais CustomReviewAgentRow ne gère que name/systemPrompt (onUpdate typé `{ name?; systemPrompt? }`), donc aucun contrôle UI ne l'expose.

Agents de review personnalisés : CRUD complet (3 routes + lib/agent-config/review-agents.ts), hook useReviewAgents (hooks/useAgentConfig.ts:194-246) et bande UI ReviewAgentsBand atteignable via /agents/prompts (app/agents/prompts/page.tsx, onglet WorkshopHeader.tsx:43, lien RubricBand.tsx:50) promettant « the four built-in reviews, plus your own » (lib/i18n/messages/en/AgentsWorkshop.json:171). Mais aucun chemin de dispatch ne lit jamais customReviewAgents.systemPrompt : les routes de review epic (epics/[epicId]/review/route.ts:67-72,99-105), story (stories/[storyId]/review/route.ts:57-62,95) et prompt-estimate (:38) n'acceptent que les 4 ReviewType builtin, ReviewTypesPicker.tsx:12-37 ne propose que ces 4 ; buildReviewPrompt (défini lib/claude/prompts/review.ts:36-41, ré-exporté par prompt-builder.ts:69 — pas aux lignes 1343-1357 citées, le fichier fait 91 lignes) accepte un CustomReviewAgentPrompt mais seuls dispatch-prompt.ts:410 et stage-review.ts:94 l'appellent, avec un builtin ; la seule construction de {name, systemPrompt} est dans __tests__/prompt-builder-fencing.test.ts. CUSTOM_REVIEW_AGENT_PREFIX (lib/chat/conversation-agent.ts:6) est orphelin depuis que f0242187 a retiré ses deux helpers, eux-mêmes jamais consommés depuis 36d2498b. Le seul lecteur prod de la table est le COUNT(*) isEnabled=1 du chip « + N règles projet » (app/api/qa/findings/route.ts:526-533). isEnabled est accepté par PATCH ([agentId]/route.ts:17-22) mais aucun contrôle UI ne l'expose (0 occurrence dans PromptsView.tsx). Historique : jamais de dispatcher (git log -S sur listMergedCustomReviewAgents → cea9f7ae CRUD seul).

**Recommandation**

Trancher : soit brancher réellement les agents custom dans le dispatch de review (accepter un id custom dans reviewTypes, résoudre son systemPrompt via buildReviewPrompt(…, {name, systemPrompt}) et dans stage-review pour le pipeline), soit retirer la bande UI, le hook useReviewAgents, les 3 routes et la lib, en gardant seulement ce dont la QA a besoin (ou en supprimant aussi le chip). Dans tous les cas cesser d'afficher un formulaire qui promet « plus your own ».

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'customReviewAgents|CustomReviewAgent|listMergedCustomReviewAgents' hors tests → uniquement les routes CRUD, le hook, PromptsView, schema.ts et app/api/qa/findings/route.ts:528 (COUNT(*) WHERE isEnabled=1 pour le chip QaRubric.projectRuleCount). rg 'CUSTOM_REVIEW_AGENT_PREFIX' → 1 seule occurrence (sa déclaration). rg des appelants de buildReviewPrompt → lib/tokens/dispatch-prompt.ts:410 et lib/pipeline/stage-review.ts:94 passent tous deux un ReviewType builtin (reviewType / PIPELINE_REVIEW_TYPE), jamais un {name, systemPrompt}. review/route.ts:99 refuse tout reviewType hors VALID_REVIEW_TYPES. git log -S 'customReviewAgents.systemPrompt' → vide ; git log -S 'listMergedCustomReviewAgents' → premier commit cea9f7ae « add custom review agent CRUD APIs », sans dispatcher.

</details>

