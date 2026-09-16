# Lot 24 — Configuration d'agents et workshop

**Difficulté** 2/4 — Moyen
**Findings** 5 (0 fort · 3 moyen · 2 faible ; effort 4 S · 1 M · 0 L)
**Dépendances** Après le lot 02.

**Statut** fait le 16/09/2026 — détail dans [compte rendu des lots 18, 20-22, 24](implementation-lots-18-20-21-22-24.md).

## Décision

Handlers agent-config partagés global/projet (comme lib/mcp/server-routes.ts) ; le prompt de rôle release_notes est lu par la génération de changelog.

## Objectif

lib/agent-config/*-routes.ts paramétrés par scope avec une seule validation, DELETE du prompt global, PUT providers qui refuse un body sans namedAgentId, route stats scindée (reviewBounce seul), resolveAgentPrompt("release_notes") dans la route releases, onglets du workshop qui conservent ?project=.

## Démarche suggérée

1. Après le lot 02 (les routes review-agents disparaissent).
2. Tests de contrat global/projet identiques par construction.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #149 — GET /api/agent-config/stats calcule un agrégat sur toute la table agent_sessions que son unique consommateur jette

**Nature** mort · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `app/api/agent-config/stats/route.ts:20-25`
- `lib/agent-config/stats.ts:66-146`
- `components/agents-workshop/LimitsView.tsx:36-40`
- `components/agents-workshop/LimitsView.tsx:392-406`

**Constat**

La route renvoie { agents: getAgentReliabilityStats(projectId), reviewBounce: getReviewBounceStats(projectId) }. getAgentReliabilityStats est une requête avec CTE + fonctions de fenêtre (ROW_NUMBER/COUNT OVER pour la médiane) sur TOUTES les lignes agent_sessions, sans borne temporelle. Le seul appelant en prod est ReviewBounceCard (LimitsView), qui ne lit que json.data.reviewBounce. L'onglet « Stats » de l'ancienne sheet qui affichait le tableau par agent×provider a disparu (le commentaire de LimitsView le dit) ; les chiffres par agent passent désormais par /api/agent-config/named-agents/{id}/stats. Le calcul est donc exécuté à chaque montage de /agents/limits et à chaque changement de scope, pour rien.

**Précision du vérificateur**

Exact tel qu'énoncé, avec deux précisions. (a) La route ne lit que `projectId` : il n'existe aucun moyen, même dynamique, de demander seulement `reviewBounce` — les deux helpers sont appelés inconditionnellement (`app/api/agent-config/stats/route.ts:16-25`). (b) Le coût est un scan complet non borné de `agent_sessions` en SQL (CTE + `ROW_NUMBER()/COUNT() OVER`, `lib/agent-config/stats.ts:73-127`), exécuté de façon synchrone dans le handler ; ce n'est pas un chargement de table en JS. Le contraste interne est net : `getNamedAgentDispatchReliability` dans le même fichier borne à 30 jours, `getAgentReliabilityStats` ne borne rien et compte délibérément toutes les lignes, y compris `memory_distill` et `dreaming`. Seul consommateur en prod : `ReviewBounceCard` (`components/agents-workshop/LimitsView.tsx:392-410`), qui ne lit que `json.data?.reviewBounce` ; le commentaire de la route sœur `app/api/agent-config/named-agents/[agentId]/stats/route.ts:19` confirme que cette route a été laissée intacte uniquement « because that route is pinned by tests » — le test en question étant `__tests__/agent-config-stats-route.test.ts:46-54`, qui épingle `data.agents`.

**Recommandation**

Soit scinder la route (ou ajouter ?include=) pour ne calculer que reviewBounce quand c'est tout ce qui est demandé, soit supprimer getAgentReliabilityStats et la clé agents (et mettre à jour le test qui l'épingle) puisque plus aucune surface ne l'affiche.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'agent-config/stats' hooks components app hors app/api → LimitsView.tsx:39 (commentaire) et :392 (fetch). LimitsView.tsx:406 : « rows: json.data?.reviewBounce ?? [] » — aucune lecture de .agents. rg 'getAgentReliabilityStats|AgentReliabilityRow' hors tests → uniquement la route et stats.ts. Le test __tests__/agent-config-stats-route.test.ts:46-51 épingle toujours la présence de data.agents.

</details>

### #150 — Le prompt de rôle « Release Notes » est éditable dans l'onglet Prompts mais jamais lu par la génération de changelog

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `app/api/projects/[projectId]/releases/route.ts:126`
- `app/api/projects/[projectId]/releases/route.ts:149-195`
- `components/agents-workshop/PromptsView.tsx:84-105`
- `lib/agent-config/constants.ts:1-23`
- `lib/agent-config/prompts.ts:37-70`

**Constat**

PromptsView rend une ligne éditable pour chacun des 21 AGENT_TYPES, dont release_notes (« Release Notes »). Tous les autres rôles ont au moins un appelant de resolveAgentPrompt(<type>), mais la route des releases construit son prompt à la main à partir du réglage global_prompt et n'appelle jamais resolveAgentPrompt("release_notes"). Un prompt saisi pour ce rôle (global ou projet) est stocké dans agent_prompts et n'a aucun effet, alors que l'affectation d'agent du même rôle, elle, est bien lue (resolveAgentByNamedId("release_notes", …)).

**Précision du vérificateur**

Exact tel quel. Précision utile : l'exclusion de release_notes de PERSONA_AGENT_TYPES (constants.ts:70-100, persona d'agent nommé) est délibérée et documentée, mais elle ne couvre pas le prompt de rôle agent_prompts — les autres rôles exclus de la persona (spec_generation, dreaming, memory_distill, title_generation, import_analysis) lisent bien leur prompt de rôle via resolveAgentPrompt ; release_notes est le seul des 21 rôles dont le prompt stocké n'a aucun lecteur.

Finding exact tel quel. Précision utile : l'exclusion de la *persona* d'agent nommé pour release_notes est volontaire et documentée (lib/agent-config/constants.ts l.70-90, lib/claude/process-manager.ts l.187-195, __tests__/named-agent-persona-dispatch.test.ts l.253-261), mais elle ne couvre pas le *prompt de rôle* stocké dans agent_prompts : celui-ci reste éditable (PromptsView l.91-107, PUT accepté via isAgentType) et n'est lu par aucun code — la route releases (l.126, l.149, l.195) ne consomme que settings.global_prompt.

**Recommandation**

Appeler resolveAgentPrompt("release_notes", projectId) dans la route des releases et l'injecter via systemSection() comme les autres dispatchs, ou retirer release_notes de la liste des rôles éditables dans PromptsView.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'resolveAgentPrompt\(' hors tests → 24 sites couvrant build, ticket_build, team_build, review_* (via REVIEW_TYPE_TO_AGENT_TYPE), grading, refinement, chat, spec_generation, merge, tech_check/e2e_test/failure_digest (qa/check via CHECK_TYPE_TO_AGENT_TYPE), title_generation, import_analysis, memory_distill, dreaming, forensic, spec update/rewrite — aucun avec "release_notes". rg -i 'prompt' releases/route.ts → l.149 lit settings.key = 'global_prompt', l.195 « const prompt = `${globalPrompt ? …}# Task: Generate Release Changelog » ; import de agent-resolution uniquement (l.38), pas de lib/agent-config/prompts.

</details>

### #151 — Routes agent-config global vs projet : handlers copiés-collés, validations divergentes et asymétries de contrat

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `app/api/agent-config/providers/[agentType]/route.ts`
- `app/api/projects/[projectId]/agent-config/providers/[agentType]/route.ts`
- `app/api/agent-config/prompts/[agentType]/route.ts`
- `app/api/projects/[projectId]/agent-config/prompts/[agentType]/route.ts`
- `app/api/agent-config/review-agents/route.ts:20-24`
- `app/api/projects/[projectId]/agent-config/review-agents/route.ts:38-48`
- `app/api/agent-config/review-agents/[agentId]/route.ts`
- `lib/agent-config/review-agents.ts:104-177`
- `hooks/useAgentConfig.ts:140-160`
- `hooks/useAgentConfig.ts:216-244`
- `lib/mcp/server-routes.ts:1-25`

**Constat**

Contrairement aux routes MCP servers (lib/mcp/server-routes.ts factorise global/projet avec un projectId nullable), chaque route agent-config existe en deux copies quasi identiques : providers/[agentType] (PUT+DELETE, ~110 lignes, diff de 52 lignes = uniquement le scope), prompts/[agentType] (diff 86 lignes). Les copies ont divergé : le PUT prompts global valide via updateAgentPromptSchema/validateBody, la copie projet parse le body à la main ; le POST review-agents global valide via createReviewAgentSchema, la copie projet à la main. Le DELETE prompts n'existe qu'en projet : un override global ne peut pas être remis au builtin (useAgentPrompts.resetPrompt renvoie false en scope global). Les PATCH/DELETE review-agents n'existent que sur la route globale et updateCustomReviewAgent/deleteCustomReviewAgent ne filtrent pas le scope : le hook envoie donc les modifications d'un agent projet vers /api/agent-config/review-agents/:id, à l'inverse du principe « scoped by construction » des routes MCP servers.

**Précision du vérificateur**

Finding confirmé dans tous ses éléments factuels. Deux précisions pour éviter de le surévaluer comme bug fonctionnel :

(a) L'absence de DELETE sur le prompt global ne produit pas de bouton mort : components/agents-workshop/PromptsView.tsx:205 ne rend le bouton reset que si `scope === "project" && prompt.source === "project"`. C'est donc une capacité manquante (un override global ne peut être remis au builtin depuis l'UI), pas une action qui échoue en silence.

(b) Le PATCH/DELETE des review agents envoyé sur /api/agent-config/review-agents/:id depuis le scope projet FONCTIONNE (les ids nanoid sont uniques, et PromptsView.tsx:315/352/371 interdit d'éditer un agent hérité `source === "global"` en scope projet). C'est une asymétrie de contrat et une absence de défense en profondeur (rien n'empêche un appel direct de muter/supprimer un agent d'un autre projet via la route « globale »), pas une corruption observable via l'UI.

Le cœur du finding — duplication copiée-collée (diff 52 lignes / 111 pour providers, 86 pour prompts), validation zod d'un côté et parsing manuel de l'autre sur les deux paires (prompts PUT, review-agents POST), DELETE prompt uniquement en projet, PATCH/DELETE review-agents uniquement en global et sans filtre de scope dans lib/agent-config/review-agents.ts:104-177 — est vérifié tel quel, y compris le contre-exemple lib/mcp/server-routes.ts dont l'en-tête documente la factorisation par scope.

**Recommandation**

Extraire des handlers partagés (lib/agent-config/*-routes.ts) paramétrés par scope: 'global' | projectId, comme lib/mcp/server-routes.ts, avec une seule validation zod ; ajouter DELETE sur le prompt global (reset au builtin) ; déplacer PATCH/DELETE des review agents sous chaque scope avec filtre de scope dans la lib.

<details><summary>Preuve relevée par l'auditeur</summary>

diff providers/[agentType] global vs projet → 52 lignes sur ~110 ; diff prompts/[agentType] → 86 lignes. prompts global PUT : validateBody(updateAgentPromptSchema) ; projet PUT : « const body = await request.json().catch(() => ({})); const systemPrompt = typeof body.systemPrompt === 'string' … ». Aucun `export async function DELETE` dans app/api/agent-config/prompts/[agentType]/route.ts ; useAgentConfig.ts:142 « if (scope !== 'project' || !projectId) return false ». useAgentConfig.ts:221 et :234 : fetch(`/api/agent-config/review-agents/${agentId}`) quel que soit le scope ; review-agents.ts:110-116 select WHERE id = agentId sans condition de scope.

</details>

### #154 — PUT agent-config/providers/[agentType] accepte un body {provider} sans namedAgentId et écrit une ligne que la résolution ignore par design

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt plus) · **Effort** S · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `app/api/agent-config/providers/[agentType]/route.ts:20-45`
- `app/api/projects/[projectId]/agent-config/providers/[agentType]/route.ts:33-58`
- `lib/agent-config/agent-resolution.ts:504-507`
- `lib/agent-config/agent-resolution.ts:726-747`
- `hooks/useAgentConfig.ts:170-192`

**Constat**

Les deux copies du PUT acceptent soit namedAgentId, soit un `provider` nu (isAgentProvider), et insèrent alors une ligne agent_provider_defaults avec namedAgentId null. Mais agent-resolution.ts documente que « Legacy rows that only contain a raw provider are deliberately ignored » et resolveFromRow renvoie null pour ces lignes ; listGlobalAgentProviders/listMergedProjectAgentProviders les rendent comme source « builtin ». Aucun client n'envoie ce body (assignAgent n'envoie que namedAgentId ou DELETE). C'est une surface d'API vivante dont le seul effet est d'écrire une ligne morte — et de faire passer la colonne `provider` copiée depuis l'agent nommé pour une donnée, alors que la résolution relit toujours namedAgents.provider.

**Précision du vérificateur**

Les deux copies du PUT agent-config/providers/[agentType] (global :26-45, projet :39-58) acceptent un `provider` nu sans namedAgentId et écrivent une ligne agent_provider_defaults avec namedAgentId null, que agent-resolution.ts ignore par design (commentaire :504-506, resolveFromRow:743-746 → null) et que listGlobal/listMergedProjectAgentProviders rendent comme « builtin ». L'UI (useAgentConfig.assignAgent:170-184) n'envoie jamais ce body. En revanche un client réel existe et croit que ça marche : e2e/fixtures/arij-project.ts:419-423 `pinProjectAgents` envoie `{ provider: "claude-code" }` pour build/review_feature/refinement afin de rendre les journeys build-review-merge.spec.ts et refinement-merge-discard-create.spec.ts indépendantes de l'assignation globale de la machine — pin écrit 3 jours après le commit 35ff922 qui a rendu ces lignes inertes, donc no-op depuis sa naissance : la résolution retombe sur le rôle global, exactement le cas que le fixture documente vouloir neutraliser. Les tests unitaires agent-config-providers-routes.test.ts:69-88,158-178 figent ce chemin mort. Correctif : exiger namedAgentId dans le PUT (400 sinon), faire pointer le fixture e2e sur un agent nommé claude-code (ou créer le pin via namedAgentId), réécrire les deux tests, et cesser d'écrire/lire la colonne `provider` de agent_provider_defaults.

Les deux PUT agent-config/providers/[agentType] (global l.20-45, projet l.33-58) acceptent un body `{ provider }` nu et écrivent une ligne agent_provider_defaults avec namedAgentId null, que resolveFromRow (agent-resolution.ts:726-747) ignore par design et que les listers (l.156-260) rendent comme « builtin ». La colonne `provider` de la table n'est lue nulle part (5 selects non consommés dans agent-resolution.ts). Le seul client UI (hooks/useAgentConfig.ts:170-184) n'envoie que `{ namedAgentId }` ou DELETE. Contrairement à l'énoncé initial, un client réel utilise bien ce body : e2e/fixtures/arij-project.ts:419-423 `pinProjectAgents` envoie `{ provider: "claude-code" }` (appelé par e2e/build-review-merge.spec.ts:21 et e2e/refinement-merge-discard-create.spec.ts:31) précisément pour neutraliser une assignation globale vers un autre CLI — ce que la résolution rend impossible (cf. __tests__/agent-config-providers-resolver.test.ts:17). Le pin est un no-op depuis sa création (9f2dc5f2, 28/08, postérieur à 35ff9223, 25/08) : sur une machine dont le rôle `build` global pointe vers un autre CLI, ces deux journeys e2e atteignent le stub d'un autre provider. Correction : exiger namedAgentId dans le PUT, cesser d'écrire/lire la colonne provider (ou la retirer par migration manuelle), et faire pinner la fixture e2e via un namedAgentId.

**Recommandation**

Exiger namedAgentId dans le schéma du PUT (400 sinon) et cesser d'écrire/lire la colonne provider de agent_provider_defaults, ou la supprimer par migration manuelle.

<details><summary>Preuve relevée par l'auditeur</summary>

providers/[agentType]/route.ts:40 « } else if (!isAgentProvider(provider)) { … 400 } » puis insert avec namedAgentId null. agent-resolution.ts:743-746 « A legacy CLI-only default (or a deleted agent) is not an assignment … return null ». useAgentConfig.ts:178-184 : body JSON.stringify({ namedAgentId }) ou method DELETE, jamais { provider }. rg 'agent-config/providers' components hooks app hors app/api → uniquement useAgentConfig.ts.

</details>

### #155 — Les onglets du workshop perdent le scope ?project= : ScopeSwitcher et la pastille Frictions disparaissent au changement d'onglet

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `components/agents-workshop/WorkshopHeader.tsx:37-45`
- `components/piscine/UnderlineTabNav.tsx:44-70`
- `components/agents-workshop/ScopeSwitcher.tsx:27`
- `components/agents-workshop/FrictionsPill.tsx:30-59`
- `components/agents-workshop/WhereHeWorksBand.tsx:124`
- `app/agents/assignments/page.tsx`

**Constat**

Le scope projet du workshop n'existe que par le paramètre ?project= (les pages serveur le lisent dans searchParams, ScopeSwitcher et FrictionsPill s'en servent). Or WorkshopHeader construit ses cinq onglets avec des href statiques (/agents, /agents/assignments, …) et UnderlineTabNav rend item.href tel quel. Un utilisateur arrivé sur /agents?project=X (ex. depuis le desk) qui clique « Assignments » ou « Prompts » atterrit en scope global sans switch ni pastille, alors que WhereHeWorksBand, elle, prend soin de propager le paramètre dans son lien « all roles ».

**Précision du vérificateur**

Le scope projet du workshop n'existe que par `?project=` (pages serveur app/agents/*/page.tsx → prop projectId ; ScopeSwitcher.tsx:29 et FrictionsPill.tsx:60 rendent null sans lui). WorkshopHeader.tsx:41-45 construit ses onglets avec des href statiques et UnderlineTabNav.tsx:59 rend `item.href` tel quel, donc tout changement d'onglet depuis `/agents/*?project=X` retombe en scope global (switch et pastille disparaissent). Portée réduite par rapport au finding initial : aucun lien in-app (desk, TopBar : nav.ts:160 `href: "/agents"` statique) ne produit `/agents?project=` ; le scope n'est atteint que par URL saisie/marquée, puis par le seul lien scoped du workshop, WhereHeWorksBand.tsx:124 vers `/agents/assignments?project=`. Correctif suggéré inchangé : réinjecter le paramètre dans les href des onglets /agents/* (pas /usage).

Les onglets du workshop (components/agents-workshop/WorkshopHeader.tsx:41-45, rendus par UnderlineTabNav.tsx:59 sans query) perdent bien `?project=` : les quatre pages serveur app/agents/**/page.tsx ne dérivent le scope que de searchParams, ScopeSwitcher.tsx:29 et FrictionsPill.tsx:60 disparaissent donc au changement d'onglet, et seul WhereHeWorksBand.tsx:124 propage le paramètre. En revanche aucun chemin de l'UI ne mène à /agents?project= (entrée nav lib/piscine/nav.ts:160 sans `forProject`, settings/layout.tsx:40 et qa/RubricBand.tsx:50 statiques ; aucun router.push) : le scope n'est atteignable que par URL manuelle, et ce comportement date du commit d'origine cd6fedec, pas de la rationalisation. Correction : injecter le paramètre dans les href des onglets du workshop (hors /usage) et, pour donner un point d'entrée réel, ajouter un `forProject` à l'entrée nav « named-agents » et le scope au lien de RubricBand.

**Recommandation**

Dans WorkshopHeader, lire ?project= (via useSearchParams sous Suspense, ou via une prop du layout) et le réinjecter dans les href des onglets du workshop (pas /usage).

<details><summary>Preuve relevée par l'auditeur</summary>

WorkshopHeader.tsx:41-45 : TABS = [{ href: '/agents' }, { href: '/agents/assignments' }, { href: '/agents/prompts' }, { href: '/agents/limits' }, { href: '/usage' }] ; UnderlineTabNav.tsx:56 <Link href={item.href}> sans ajout de query. ScopeSwitcher.tsx:27 « if (!projectId) return null » ; FrictionsPill.tsx:59 « if (!projectId || openCount === null) return null ». WhereHeWorksBand.tsx:124 href={projectId ? `/agents/assignments?project=${encodeURIComponent(projectId)}` : '/agents/assignments'}.

</details>

