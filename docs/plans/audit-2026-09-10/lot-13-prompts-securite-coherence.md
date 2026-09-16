# Lot 13 — Couche prompts : neutralisation, doublons, cohérence des règles

**Statut : réalisé le 16/09/2026.** Voir le [compte rendu d’implémentation et de validation](implementation-lots-12-13-16.md).
Les constats ci-dessous conservent l’état relevé pendant l’audit.

**Difficulté** 2/4 — Moyen
**Findings** 11 (1 fort · 7 moyen · 3 faible ; effort 8 S · 3 M · 0 L)
**Dépendances** Le point 212/220 est partagé avec le lot 16 : une seule règle, décidée ici.

## Décision

Tout texte écrit par un agent (corps de ticket, findings, flux de session) passe par neutralizeControlMarkup ; un bloc de prompt n'existe qu'une fois.

## Objectif

ticketBodySection/userStoriesSection neutralisés dans les 7 builders, buildReviewFeedbackSection unique et plafonnée, fenceAgentOutput dans forensic, MCP_EXEMPT_AGENT_TYPES étendu (forensic, spec_generation) et section « Arij tools » conditionnée à un ticket, allowlist claude-code alignée sur ce que le prompt annonce (ou prompt qui annonce les cinq outils), préfixe provider dans les deux prompts qui codent mcp__arij__, une seule règle pour le poids des findings en seconde opinion, blocs préambule/Epic Context/Final Verdict factorisés, vocabulaire du board retiré, review de story qui lit epic.type, budget de tokens par défaut seedé.

## Démarche suggérée

1. Tests de fencing existants (prompt-builder-fencing, prompt-untrusted-content) : ajouter les cas ticket body / findings / forensic en rouge d'abord.
2. Factoriser dans lib/claude/prompts/shared.ts ; supprimer buildReviewFeedback de dispatch-prompt.ts.
3. Aligner readSecondOpinionState sur blockingFindingSeverity (cf. lot 16) et réécrire la phrase du prompt.
4. Seed d'un budget global (ex. 30 k) ; cap distinct pour la mémoire.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #206 — Le corps du ticket (titre, description, stories, critères) est le seul canal agent-écrit jamais neutralisé dans les prompts

**Nature** risque · **Impact** fort · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/prompts/implementation.ts:137`
- `lib/claude/prompts/implementation.ts:297-310`
- `lib/claude/prompts/review.ts:59-72`
- `lib/claude/prompts/review.ts:172-184`
- `lib/claude/prompts/review.ts:247`
- `lib/claude/prompt-sections.ts:104-108`
- `lib/claude/prompt-sections.ts:470-505`
- `lib/mcp/create-bug.ts:253`
- `app/api/mcp/create-planning-ticket/route.ts:173`
- `app/api/mcp/merge-tickets/route.ts:269`

**Constat**

lib/claude/untrusted.ts neutralise et clôture la spec, la mémoire, les documents, les commentaires et l'historique de chat, mais aucun builder ne passe le texte du ticket par neutralizeControlMarkup : epic.description est poussé brut dans buildBuildPrompt, buildTicketBuildPrompt, buildMergeResolutionPrompt, buildReviewPrompt, buildGradingPrompt, buildEpicReviewPrompt et buildSecondOpinionPrompt, et userStoriesSection / existingEpicsSection / la rubrique de grading rendent titres, descriptions et critères tels quels. Or ces champs sont écrits par des agents (create_bug, create_planning_ticket, merge_tickets title/description, create_ticket/update_ticket du chat, finalisation d'epic, import arji.json) et grep ne montre aucune neutralisation à l'écriture hors lib/claude. Un <system-directive> déposé dans une description de ticket arrive donc intact dans une session build en code mode, non surveillée.

**Précision du vérificateur**

lib/claude/untrusted.ts neutralise et clôture la spec, la mémoire, les documents, les commentaires et l'historique de chat, mais aucun builder ne passe le corps du ticket par neutralizeControlMarkup : epic.title/description sont poussés bruts dans NEUF builders — buildTeamBuildPrompt (implementation.ts:62-63), buildBuildPrompt (137), buildCiFixPrompt (218), buildTicketBuildPrompt (297-310, avec story.description et acceptanceCriteria), buildMergeResolutionPrompt (356), buildReviewPrompt (review.ts:59-72), buildGradingPrompt (173-184, rubrique « verbatim »), buildEpicReviewPrompt (247) et buildSecondOpinionPrompt (355) — et userStoriesSection (prompt-sections.ts:484-497) / existingEpicsSection (106) rendent titres, descriptions et critères tels quels ; pushPromptPart (collector.ts) n'applique rien. Ces champs sont écrits par des agents sans neutralisation à l'écriture (lib/mcp/create-bug.ts:253 → app/api/mcp/create-bug/route.ts:47 ; create-planning-ticket/route.ts:169-177 ; merge-tickets/route.ts:268-270 ; create-ticket/update-ticket ; import arji.json), et aucun passage global du prompt assemblé n'existe (grep hors lib/claude → 0). Un <system-directive> déposé dans une description de ticket arrive donc intact dans les sessions build, review et grading. L'en-tête de untrusted.ts ne liste pas le ticket parmi les champs agent-écrits. Nuance : quelques autres chaînes courtes restent brutes aussi (doc.name, noms de checks CI, project.name), donc « le seul canal » est légèrement excessif ; le ticket est en revanche le seul canal *long et prose* non neutralisé.

lib/claude/untrusted.ts neutralise/clôture spec, mémoire, documents, commentaires, historique de chat et usage_hint, et le prompt de Refinement neutralise aussi les tickets (refinement.ts:224 oneLine), mais les sept builders d'exécution — buildBuildPrompt, buildTicketBuildPrompt, buildMergeResolutionPrompt, buildReviewPrompt, buildGradingPrompt, buildEpicReviewPrompt, buildSecondOpinionPrompt — poussent epic.title/description, story.title/description/acceptanceCriteria (et userStoriesSection / existingEpicsSection / la rubrique « verbatim » de grading) sans neutralizeControlMarkup. Ces builders sont câblés en production sur des EpicRow/UserStoryRow lus bruts en base (lib/pipeline/stage-code.ts, stage-review.ts, lib/tokens/dispatch-prompt.ts, resolve-merge route, lib/auto-mode/second-opinion.ts), et les champs sont écrits sans filtrage par des agents (create_bug, create_planning_ticket, merge_tickets, create_ticket/update_ticket MCP, import arji.json). Un <system-directive> dans une description de ticket arrive donc intact dans les sessions build/review/grade. L'en-tête de untrusted.ts ne mentionne pas le ticket et aucun test ne couvre ce champ.

**Recommandation**

Faire passer titre/description/critères par neutralizeControlMarkup dans un helper unique (ex. ticketBodySection(epic) / userStoriesSection) et l'utiliser dans les 7 builders ; mettre à jour l'en-tête de untrusted.ts qui ne liste pas le ticket parmi les champs agent-écrits.

<details><summary>Preuve relevée par l'auditeur</summary>

`grep -rn "neutralizeControlMarkup|fenceOnly|fenceAgentOutput" app lib | grep -v lib/claude/` → 0 résultat : la neutralisation n'existe que dans la couche prompt. Dans cette couche, `push("ticket", `${epic.description.trim()}\n`)` (implementation.ts:137, 297 ; review.ts:59, 172, 247) et `lines.push(`${prefix}**${us.title}**`)` / `lines.push(`  ${us.description.trim()}`)` (prompt-sections.ts:484-497) n'appellent ni neutralizeControlMarkup ni fenceOnly, alors que descriptionSection (142-145), chatHistorySection (123) et commentHistorySection (582) le font pour le même type de contenu. Écrivains agent vérifiés : create-bug.ts:253 `description: input.description`, create-planning-ticket/route.ts:173, merge-tickets/route.ts:269 `.set({ title: newTitle, description: newDescription })`.

</details>

### #207 — Le bloc « Code Review Feedback » existe en deux copies, l'une plafonnée (pipeline) l'autre non (route manuelle), et les findings/évidences de grading agent-écrits ne sont ni neutralisés ni bornés

**Nature** doublon · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/tokens/dispatch-prompt.ts:120-141`
- `lib/tokens/dispatch-prompt.ts:237-255`
- `lib/pipeline/stage-prompt.ts:37-91`
- `lib/pipeline/stage-prompt.ts:110-168`
- `lib/grading/report.ts:114-133`
- `lib/pipeline/stage-code.ts:107-125`
- `app/api/projects/[projectId]/epics/[epicId]/build/route.ts:196`

**Constat**

lib/pipeline/stage-prompt.ts porte buildReviewFeedbackSection avec les caps FINDINGS_LIST_MAX=80 / FINDING_BODY_MAX_CHARS=1200 ajoutés après le prompt de 4,9 Mo du 26/08, et son commentaire dit reproduire « le byte-pattern de la route build ». lib/tokens/dispatch-prompt.ts réimplémente buildReviewFeedback sans aucun cap et c'est cette copie que la route manuelle epics/[epicId]/build et prompt-estimate utilisent. Les corps de findings (écrits par submit_findings, donc par un agent) et les champs criterion/evidence/summary de buildGradingFixSection (écrits par submit_grading, jusqu'à 100 × 4000 caractères) sont interpolés bruts dans un prompt de fix non surveillé, sans neutralizeControlMarkup ni fence, contrairement à la doctrine d'untrusted.ts pour les « evidence » d'agent.

**Précision du vérificateur**

Le constat tient, avec deux précisions : (1) les deux blocs ne sont pas strictement byte-identiques — la version pipeline ajoute la ligne `_[N older open finding(s) omitted …]_` quand le cap mord ; le reste (en-tête, regroupement par fichier, `- **Line N**: body`) est bien identique. (2) Les corps de findings sont bornés à 2000 caractères *par soumission* par le schéma MCP `submit_findings` (bin/arij-mcp.mjs:319-321, maxItems: 50) ; ce qui est non borné dans la copie dispatch-prompt, c'est le **cumul** des lignes reviewComments ouvertes de l'épic à travers les cycles (aucun FINDINGS_LIST_MAX, aucune troncature défensive contre une insertion hors-MCP via app/api/projects/[projectId]/epics/[epicId]/review-comments/route.ts:46). Le reste — copie non plafonnée utilisée par la route manuelle live, absence de neutralizeControlMarkup/fence sur rc.body et sur criterion/evidence/summary du grading — est exact.

**Recommandation**

Supprimer buildReviewFeedback de dispatch-prompt.ts et importer buildReviewFeedbackSection de stage-prompt.ts ; y ajouter neutralizeControlMarkup sur rc.body ; borner et neutraliser criterion/evidence/summary dans buildGradingFixSection.

<details><summary>Preuve relevée par l'auditeur</summary>

dispatch-prompt.ts:120-141 `function buildReviewFeedback(...)` : même en-tête « ## Code Review Feedback… Address each one », regroupement par fichier identique, mais `parts.push(`- **Line ${comment.lineNumber}**: ${comment.body}`)` sans cap ni troncature ; stage-prompt.ts:37-38 `FINDING_BODY_MAX_CHARS = 1_200; FINDINGS_LIST_MAX = 80` et findingBodyLine tronque. Appelants : `grep -rn assembleEpicBuildPrompt app lib` → epics/[epicId]/build/route.ts:196 et prompt-estimate/route.ts:98 (copie non plafonnée) ; stage-code.ts:107 utilise buildReviewFeedbackSection (plafonnée). grading/report.ts:124-126 `lines.push(`- **Evidence / gap:** ${entry.evidence}`)` sans neutralisation ; submit_grading accepte 100 entrées × 4000 chars (bin/arij-mcp.mjs:348-374).

</details>

### #208 — Le prompt forensic injecte les queues de flux d'une session morte dans une fence ``` fixe, sans neutralisation

**Nature** risque · **Impact** moyen (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/pipeline/forensic-prompt.ts:52-58`
- `lib/pipeline/forensic-prompt.ts:83-86`
- `lib/pipeline/forensic.ts:268-278`
- `lib/claude/untrusted.ts:33-43`
- `lib/claude/prompts/verification.ts:22-35`

**Constat**

forensic-prompt.ts encadre l'erreur persistée, 8000 caractères de flux raw et 4000 de flux output de la session morte dans un bloc ``` de longueur fixe, sans neutralizeControlMarkup. C'est exactement la classe de contenu (« recorded agent session output ») que untrusted.ts décrit et que verification.ts, memory.ts, review.ts et qa.ts traitent avec fenceAgentOutput (fence dynamique + escape des balises d'impersonation). Une session dont la sortie contient un bloc ``` ou un <system-directive> ferme la fence et le reste de la queue est lu comme prompt ; le diagnostic produit est ensuite posté en commentaire de ticket et repris par la digest Dreaming.

**Précision du vérificateur**

forensic-prompt.ts:52-58 (`evidenceBlock`) encadre l'erreur persistée, jusqu'à 8000 caractères du flux `raw` (stream-json --verbose, tool_results inclus donc contenu du dépôt), 4000 du flux `output` et le dernier texte de la session morte dans une fence ``` fixe, sans `neutralizeControlMarkup` ni fence dynamique — forensic.ts:154-169/268-278 passe les chunks bruts. C'est la classe de contenu que untrusted.ts:33-43 réserve à `fenceAgentOutput`, et que verification.ts:32-35, memory.ts:71/161, review.ts:380, qa.ts:217 traitent ainsi. Un bloc ``` dans la queue ferme la fence et le reste est lu comme prompt ; un `<system-directive>` n'est pas escapé. Atténuations existantes : la session forensic est en plan mode (lecture seule, forensic.ts:300, spawn.ts:125-147) donc l'injection ne peut que fausser le texte du diagnostic ; ce diagnostic est ensuite neutralisé quand il est réinjecté en commentaire (prompt-sections.ts:582) et fencé dans la digest Dreaming (memory.ts:161) — la propagation est sémantique, pas une nouvelle rupture de fence. Fix : `fenceAgentOutput(body)` dans evidenceBlock et mise à jour de __tests__/pipeline-forensic-prompt.test.ts:84-98 qui épingle la fence fixe.

**Recommandation**

Remplacer evidenceBlock par fenceAgentOutput(body) (ou fenceOnly + notice) et supprimer l'import de la fence fixe.

<details><summary>Preuve relevée par l'auditeur</summary>

forensic-prompt.ts:52-58 `function evidenceBlock(heading, body) { … return `### ${heading}\n\n\`\`\`\n${trimmed}\n\`\`\`\n`; }` ; `grep -n "neutralize|fence" lib/pipeline/forensic.ts` → aucun résultat, readChunkTail passe les chunks bruts (forensic.ts:268-278). À comparer avec verification.ts:32-35 qui appelle neutralizeControlMarkup puis verificationOutputFence pour la même classe de sortie de commande. Plafonds FORENSIC_RAW_TAIL_MAX_CHARS=8000 / OUTPUT=4000 (lib/pipeline/constants.ts:359-362).

</details>

### #209 — La section « Arij tools » est ajoutée à des sessions sans ticket ou en plan mode (forensic, tech_check, e2e_test, spec_generation) et contredit leur contrat de sortie

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/process-manager.ts:270-275`
- `lib/claude/process-manager.ts:332-337`
- `lib/workflow/dreaming-constants.ts:54-60`
- `lib/claude/prompt-sections.ts:309-323`
- `lib/pipeline/forensic.ts:300`
- `lib/pipeline/forensic-prompt.ts:94-96`
- `lib/mcp/http-auth.ts:86-96`
- `bin/arij-mcp.mjs:70-77`
- `lib/workflow/spec-update.ts:26,182-186`
- `lib/agent-config/constants.ts:84-88`

**Constat**

processManager.start() n'exempte de l'injection MCP que memory_distill, dreaming et failure_digest (MCP_EXEMPT_AGENT_TYPES). Le forensic tourne en plan mode, sans epicId, avec un prompt qui dit « Do NOT ask the user a question » et « Respond with exactly these three markdown sections and nothing else » ; la base montre 13 sessions forensic injectées dont le prompt se termine par la section générique « get_ticket to re-read current ticket state… update_ticket_status to move the ticket… ask_question when you are blocked on the user ». tech_check/e2e_test (7 sessions, aucune n'a d'epic) reçoivent la même section alors que get_ticket/post_comment/update_ticket_status/ask_question sans ticket_id répondent 400 MISSING_TICKET ; les descriptions du shim promettent pourtant « Defaults to the epic this session was launched for ». spec_update/spec_auto_rewrite (agent_type spec_generation, plan mode, réponse entière persistée comme spec) ne sont pas exemptés non plus, ce que lib/agent-config/constants.ts:87-88 reconnaît.

**Précision du vérificateur**

Confirmé tel quel. Précision : forensic (13 sessions injectées, plan mode, sans epicId) et tech_check/e2e_test (6/7 injectées, mode "code", sans epicId) sont observés en base avec la section générique en queue de prompt ; pour spec_generation (spec_update/spec_auto_rewrite) l'exposition est démontrée par le code (non exempté, plan mode, sans epicId, passe par processManager.start sans garde sur le mode), la seule session en base datant d'avant la colonne mcp_channel.

processManager.start() n'exempte de l'injection MCP que memory_distill, dreaming et failure_digest. Le forensic (plan mode, sans epicId, contrat « exactly these three markdown sections and nothing else », « Do NOT ask the user a question ») reçoit en fin de prompt la section générique « Arij tools » (13 sessions injectées en base, dernière le 2026-09-10) ; tech_check/e2e_test (mode code, 7/7 sans epic, 6 injectées) reçoivent la même section alors que get_ticket/post_comment/update_ticket_status/ask_question/submit_findings/submit_grading répondent 400 MISSING_TICKET sans ticket_id — seuls create_bug, report_friction, attach_artifact, list_tickets restent utilisables, et le shim promet « Defaults to the epic this session was launched for ». spec_update et spec_auto_rewrite (agent_type spec_generation, plan mode, réponse persistée comme spec via dispatchBackgroundSession) suivent le même chemin non exempté, ce que constants.ts:84-88 reconnaît ; aucune session spec_generation injectée n'est encore en base (la seule est antérieure à l'injection), et la route generate-spec (spawnClaude direct) n'est pas concernée. Le test __tests__/mcp-injection.test.ts:660-672 verrouille forensic comme non exempt sous l'étiquette « ticket-scoped », qui est fausse pour lui.

**Recommandation**

Étendre MCP_EXEMPT_AGENT_TYPES à forensic et spec_generation (rédacteurs de document, plan mode) ; pour tech_check/e2e_test, rendre arijToolsSection dépendante de la présence d'un epicId (variante « board-scoped » comme pour refinement) plutôt que du seul agentType.

<details><summary>Preuve relevée par l'auditeur</summary>

Base (lecture seule) : `SELECT agent_type, mode, mcp_channel, COUNT(*)` → forensic plan/injected = 13 (dernier 2026-09-10) ; prompt forensic le plus récent : « - Do NOT ask the user a question … Respond with exactly these three markdown sections and nothing else … ## Arij tools … ask_question when you are blocked on the user ». tech_check/e2e_test : `epic_id IS NULL` pour 7/7 sessions, mcp_channel injected pour 6. dreaming-constants.ts:54-60 : `MCP_EXEMPT_AGENT_TYPES = [...MEMORY_WRITER_AGENT_TYPES, "failure_digest"]`. http-auth.ts:86-96 : `const targetId = ticketId ?? record.epicId; if (!targetId) return 400 MISSING_TICKET`.

</details>

### #210 — Toolset injecté ≠ toolset annoncé : les sessions build/review/grading/merge reçoivent cinq outils de refinement que leur prompt ne cite jamais et que les routes acceptent

**Nature** à moitié câblé · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/mcp-injection.ts:73-100`
- `lib/claude/mcp-injection.ts:216-264`
- `lib/mcp/refinement.ts:97-101`
- `app/api/mcp/set-priority/route.ts:46-47`
- `bin/arij-mcp.mjs:900-901`
- `lib/claude/prompt-sections.ts:309-323`

**Constat**

allowedToolNamesForAgentType ne retire que update_ticket_status pour refinement et réserve merge/discard/create_planning à refinement ; set_priority, reorder_tickets, add_dependency, remove_dependency et promote_ticket restent dans l'allowlist claude-code de toute session « agent », et leurs routes n'exigent qu'un token non-chat (requireAgentSessionToken). Aucun prompt de build/review/grading ne mentionne ces outils (arijToolsSection en cite six), mais une session build peut re-prioriser, ré-ordonner ou renvoyer en Backlog n'importe quel ticket planning du projet. Le shim ne filtre pas par type d'agent : `TOOLS = AGENT_TOOLS`, donc les sessions codex/omp/agy voient les 17 outils, y compris merge_tickets/discard_ticket/create_planning_ticket qui répondent 403.

**Précision du vérificateur**

Exact sur le fond : allowedToolNamesForAgentType (mcp-injection.ts:216-264) ne retire aux sessions build/review/grading/merge que merge_tickets/discard_ticket/create_planning_ticket ; set_priority, reorder_tickets, add_dependency, remove_dependency et promote_ticket restent dans leur allowlist claude-code, leurs routes n'exigent que requireAgentSessionToken (refuse seulement agentType "chat", refinement.ts:97-108), et le prompt de base (prompt-sections.ts:310-323) ne les nomme jamais. Le shim (arij-mcp.mjs:862, pas 900) ne reçoit aucun ARIJ_MCP_AGENT_TYPE et expose les 17 AGENT_TOOLS à codex/omp/agy, dont les 3 exclusifs qui répondent 403. Précisions : c'est un choix documenté et testé (refinement.ts:113-116 « could also legitimately be asked about » ; refinement-prompt.test.ts:255-264 nomme déjà ce « pre-existing gap » du prompt ; mcp-injection.test.ts:268-270 épingle l'allowlist build), et la portée est bornée par resolveRefinementTicket (projet du token + colonnes backlog/todo seulement, 409 sinon), par l'obligation de `question` pour toute rétrogradation en Backlog et par un `reason` journalisé à chaque appel. Écart réel : outils offerts sans être annoncés, et tools/list du shim non aligné sur l'allowlist pour les providers non-claude.

Vrai, mais c'est un choix documenté plutôt qu'un trou d'autorisation : `lib/mcp/refinement.ts:116-118` assume qu'une session build/review puisse retoucher priorité, arêtes et colonne planning, et le test `refinement-action-permissions.test.ts:155-158` épingle qu'un token build passe sur set_priority. Ce qui reste vrai et non annoncé : (1) le prompt de base d'`arijToolsSection` (`prompt-sections.ts:309-322`) ne cite jamais set_priority/reorder_tickets/add_dependency/remove_dependency/promote_ticket alors que `process-manager.ts:325-337` les met dans `--allowedTools` (claude-code, via `spawn.ts:148`) de toute session non exempte ; (2) les routes correspondantes n'exigent qu'un token non-chat (`requireAgentSessionToken`, `refinement.ts:101`), mais restent bornées à Backlog/To do par `resolveRefinementTicket` et la démotion exige `question` ; (3) le shim (`bin/arij-mcp.mjs:67,862-863` — pas 900-901) ne lit que `ARIJ_MCP_TOOLSET`, et codex/omp/agy ne consomment pas `allowedToolNames` (`providers/codex.ts:128-145`), donc `tools/list` y expose les 17 outils, dont trois qui répondent 403 REFINEMENT_ONLY, sans que leur description (`:564,609`) le dise. Correction de lignes : `set-priority/route.ts:40-41` (pas 46-47).

**Recommandation**

Soit retirer ces cinq outils de l'allowlist hors refinement (AGENT_TYPE_EXCLUSIVE_TOOL_NAMES) et faire des routes une garde requireRefinementSessionToken, soit les annoncer explicitement dans arijToolsSection ; transmettre ARIJ_MCP_AGENT_TYPE au shim pour que tools/list reflète l'allowlist sur codex/omp/agy.

<details><summary>Preuve relevée par l'auditeur</summary>

mcp-injection.ts:246-264 : allowedToolNamesForAgentType("build") = ARIJ_MCP_AGENT_TOOLS moins withheld[build] (vide) moins les 3 exclusifs → inclut set_priority, reorder_tickets, add_dependency, remove_dependency, promote_ticket. `for r in set-priority reorder-tickets add-dependency remove-dependency promote-ticket; grep -o requireAgentSessionToken|requireRefinementSessionToken` → uniquement requireAgentSessionToken (refinement.ts:97-101 : `if (auth.agentType !== "chat") return null`). arij-mcp.mjs:900 `const TOOLS = TOOLSET === "chat" ? CHAT_TOOLS : AGENT_TOOLS;` sans filtre agentType. arijToolsSection base (prompt-sections.ts:309-323) ne nomme que get_ticket, post_comment, create_bug, update_ticket_status, ask_question, report_friction.

</details>

### #211 — Deux prompts codent en dur la graphie claude « mcp__arij__ » alors que la seconde opinion cible par construction un provider différent (omp/agy)

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/prompts/review.ts:197`
- `lib/claude/prompts/review.ts:384-388`
- `lib/claude/prompt-sections.ts:272-285`
- `lib/claude/mcp-injection.ts:120-134`
- `lib/auto-mode/second-opinion.ts:279-289`
- `lib/auto-mode/second-opinion.ts:379-387`
- `lib/claude/process-manager.ts:334-336`

**Constat**

buildGradingPrompt impose « you MUST call mcp__arij__submit_grading » et buildSecondOpinionPrompt « Call mcp__arij__submit_findings exactly once », tandis que la section « Arij tools » ajoutée ensuite par processManager reçoit arijMcpToolPrefix(provider) (mcp__arij_ pour oh-my-pi, nom nu pour agy). pickSecondOpinionProvider choisit précisément un provider différent du builder et du reviewer, et structuredToolsAvailable est vrai pour omp/agy (providerSupportsMcp) : le prompt final contient alors deux graphies dont l'une désigne un outil inexistant, et c'est celle marquée « MUST ».

**Précision du vérificateur**

buildGradingPrompt (lib/claude/prompts/review.ts:197) et buildSecondOpinionPrompt (review.ts:386) codent en dur la graphie claude/codex « mcp__arij__submit_grading » / « mcp__arij__submit_findings » sans recevoir le préfixe provider, alors que process-manager.ts:333-336 appende ensuite arijToolsSection(…, arijMcpToolPrefix(provider)) qui annonce « MCP tools named mcp__arij_* » (oh-my-pi) ou des noms nus (agy) et nomme submit_findings/submit_grading en nom nu. Dès que la seconde opinion (pick = premier provider disponible hors builder et reviewer dans [claude-code, codex, oh-my-pi, agy], donc oh-my-pi dès que claude-code et codex sont déjà pris ou indisponibles) ou un agent grading configuré tombe sur oh-my-pi/agy, structuredToolsAvailable est vrai (providerSupportsMcp) et le prompt final porte deux graphies dont celle marquée « MUST » désigne un outil inexistant. Aucune réécriture en aval ; les tests (prompt-builder-snapshots.test.ts:222, auto-mode-second-opinion.test.ts:618) pinnent la graphie claude sans variante provider.

buildGradingPrompt (review.ts:197) et buildSecondOpinionPrompt (review.ts:386) codent en dur la graphie claude/codex mcp__arij__submit_grading / mcp__arij__submit_findings, alors que processManager (process-manager.ts:334-336) appende ensuite une section « Arij tools » et une allowlist dans la graphie du provider (mcp__arij_* pour oh-my-pi, nom nu pour agy). Deux chemins réels y mènent : (1) la seconde opinion Full Auto (engine.ts:1253 → second-opinion.ts:351-387), dont le picker choisit par construction un provider différent du builder et du reviewer parmi claude-code/codex/oh-my-pi/agy et passe structuredToolsAvailable=true pour omp/agy ; (2) le grading de pipeline (stage-grading.ts → dispatch-prompt.ts:453), dont le provider est l'agent grading configuré, éventuellement redirigé par la ségrégation vers omp/agy. Sur ces providers le prompt porte alors deux graphies dont celle marquée « MUST » désigne un outil inexistant. Dormant en production : 0 session grading/review_second_opinion en base, full_auto_second_opinion désactivé (défaut false). Deux tests épinglent la graphie fautive (prompt-builder-snapshots.test.ts:222, auto-mode-second-opinion.test.ts:618) et devront suivre le fix.

**Recommandation**

Passer le prefix provider aux deux builders (comme arijToolsSection) ou retirer la mention nominative et laisser la section « Arij tools » nommer l'outil dans la bonne graphie.

<details><summary>Preuve relevée par l'auditeur</summary>

review.ts:197 « you **MUST call** `mcp__arij__submit_grading` exactly once » ; review.ts:386 « 3. Call `mcp__arij__submit_findings` exactly once » ; mcp-injection.ts:130-134 `if (provider === "agy") return ""; const separator = provider === "oh-my-pi" ? "_" : "__"` ; second-opinion.ts:279-289 `pickAlternativeReviewProvider(builderProvider, [reviewerProvider])` ; second-opinion.ts:386 passe `isMcpToolsEnabled() && providerSupportsMcp(provider)` (vrai pour oh-my-pi et agy, MCP_CAPABLE_PROVIDERS:371-376). Aucune session review_second_opinion ni grading en base : non observé en production, prouvé par le code.

</details>

### #212 — Trois règles contradictoires sur le poids des findings dans la seconde opinion : le prompt dit « le verdict décide », la section outils dit « critical/major bloquent », le code rejette au moindre finding ouvert

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/prompts/review.ts:386`
- `lib/claude/prompt-sections.ts:342-357`
- `lib/auto-mode/second-opinion.ts:170-180`
- `lib/auto-mode/second-opinion.ts:255-266`
- `lib/pipeline/findings.ts:44-51`

**Constat**

buildSecondOpinionPrompt demande « approved… with an empty findings array; keep non-blocking suggestions in the summary — the verdict, not the findings list, is what decides ». La section « Arij tools » ajoutée à la même session (agentType review_second_opinion commence par review_) dit qu'un verdict approved accompagné d'un [critical]/[major] vaut changes requested. readSecondOpinionState, lui, compte tous les review_comments ouverts de la session sans regarder la sévérité et rejette dès qu'il y en a un, y compris minor/info — alors que la règle du pipeline ordinaire (findings.ts) ne bloque que critical/major. Un reviewer qui suit le prompt mais file un minor anchoré met l'epic en boucle « rejected ».

**Précision du vérificateur**

La seconde opinion applique trois règles incompatibles sur le poids des findings : le prompt (lib/claude/prompts/review.ts:386, fichier non suivi, ex-prompt-builder.ts:1783) dit que seul le verdict décide ; la section « Arij tools » concaténée à la même session (prompt-sections.ts:342-357 via process-manager.ts:332-336, car `review_second_opinion` commence par `review_`) dit que seuls [critical]/[major] contredisent un approved ; readSecondOpinionState (second-opinion.ts:171-181, 255-266) rejette dès qu'un review_comment de la session est ouvert, minor/info inclus — comportement épinglé par __tests__/auto-mode-second-opinion.test.ts:300-320. Le commentaire qui le justifie (« merge selector and workflow completion guard treat every open finding as blocking ») est périmé : select.ts:326 utilise `blocksMergeSql` (severity-aware, blocking-findings.ts:22-27) et la garde workflow est supprimée (context.ts:45-47). Conséquence réelle : pas une boucle mais un parcage de l'epic avec notification (engine.ts:1093-1130 `parkRejectedSecondOpinion`), uniquement avec un provider MCP.

**Recommandation**

Aligner readSecondOpinionState sur la règle critical/major de findings.ts (ou l'inverse) et réécrire la phrase du prompt de seconde opinion pour décrire la règle réellement appliquée.

<details><summary>Preuve relevée par l'auditeur</summary>

second-opinion.ts:170-180 `openFindingCount` filtre seulement `agentSessionId` et `status = "open"` ; 255-266 « treat every open finding as blocking, irrespective of its advisory severity label … if (verdict === "changes requested" || blocking > 0) return rejected ». findings.ts:49-51 : « A finding BLOCKS when … prefixed [critical] or [major]. minor/info-only reviews pass ». prompt-sections.ts:348-350 : « an 'approved' verdict filed alongside a [critical] or [major] finding still counts as changes requested ».

</details>

### #216 — Taille effective mesurée : 25-30 k tokens par build/review dont 70-80 % de spec + mémoire, et aucun budget configuré — checkPromptTokenBudget est inerte

**Nature** risque · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/tokens/budget.ts:25-49`
- `lib/tokens/budget.ts:57-68`
- `lib/documents/memory-constants.ts:62-78`
- `lib/claude/prompt-sections.ts:147-170`
- `lib/claude/prompts/implementation.ts:176-207`
- `lib/claude/prompts/qa.ts:17-20`
- `lib/claude/prompts/refinement.ts:38-41`

**Constat**

Sur le projet Arij, la spec fait 40 629 caractères et la mémoire 40 000 (exactement au plafond PROJECT_MEMORY_MAX_CHARS, relevé de 12 000 à 40 000). Les prompts build et review reconstruits aujourd'hui avec les vrais tickets font 99-117 k caractères (24 800-29 200 tokens estimés) et 101-120 k pour la review ; spec + mémoire représentent 69-81 % de chacun, avant persona et section outils. Les prompts stockés récents confirment : p50 build 87,7 k, review_code 96,4 k, refinement 126 k (plafonné à 128 KiB : 40,8 k de spec + 40,3 k de mémoire + 39 k de snapshot), tech_check/e2e_test 62-89 k, 19 prompts ont atteint le plafond de stockage. La table settings ne contient aucune clé prompt_token_budget, donc resolvePromptTokenBudget renvoie null et checkPromptTokenBudget retourne toujours budgetExceeded=false : le mécanisme de budget de lib/tokens/budget.ts n'a jamais alerté sur cette installation. Seul le prompt CI fix borne la spec (16 KB) ; tech_check, e2e_test, refinement et merge reçoivent la spec et la mémoire entières.

**Précision du vérificateur**

Confirmé avec une précision : sur le projet Arij, spec = 40 629 caractères et mémoire = 40 000 (plafond PROJECT_MEMORY_MAX_CHARS passé de 12 000 à 10 000 tokens × 4 dans 89bc5ddf ; le memory_archive à 12 000 en garde la trace). Prompts stockés depuis le 27/08 (projet Arij) : build n=580 p50 87 743 car. max 126 799 (34 755 tokens estimés), review_code n=197 p50 96 582, refinement n=10 p50 126 387, tech_check 89 423, e2e_test p50 62 079 ; 19 prompts ont atteint le plafond de stockage de 124 KiB. La ventilation estimated_prompt_breakdown stockée à la dispatch donne spec+mémoire à 95 % (p50) du total estimé pour build, 84 % pour review_code, 91 % pour ticket_build (hors persona/outils). Aucune clé prompt_token_budget en base et aucune valeur par défaut dans budget-settings.ts : resolvePromptTokenBudget renvoie null et checkPromptTokenBudget (budget.ts:62) retourne toujours budgetExceeded=false. Précision : ce mécanisme n'est consommé que par la route prompt-estimate → PromptTokenEstimateView (bande d'affichage) ; aucun chemin de dispatch ne le consulte, donc même un budget configuré n'aurait jamais borné ni bloqué un prompt. Seul buildCiFixPrompt borne la spec (16 KB) ; build, ticket_build, review, grading, tech_check, e2e_test, failure_digest, refinement, merge et spec-update reçoivent spec et mémoire entières via specSection/memorySection qui ne tronquent rien.

Sur Arij, spec = 40 629 chars et mémoire = 40 000 chars (cap PROJECT_MEMORY_MAX_CHARS = 10 000 tokens × 4, rebasé de 12 000 chars) ; prompts stockés récents : build p50 87,7 k (n=580, max 126,8 k), review_code p50 96,4 k, refinement p50 126,4 k, merge p50 61 k, e2e_test 62 k, tech_check 89 k ; 19 prompts plafonnés (build 7, review_code 7, refinement 4, review_feature 1). Aucune clé prompt_token_budget en base, donc resolvePromptTokenBudget renvoie null et checkPromptTokenBudget retourne toujours budgetExceeded=false. Précision de câblage : checkPromptTokenBudget n'a qu'un seul consommateur, la route POST prompt-estimate, appelée uniquement par PromptTokenEstimateView dans AgentDispatchDialog (AgentActionsBar, SendToDevDialog) — une bannière consultative dans le dialog de dispatch manuel. Les routes build/review, le pipeline (stage-session), grading et tout l'auto-mode stockent estimatedPromptTokens sans jamais le comparer à un budget ; même un budget seedé ne signalerait donc rien sur les sessions automatiques, qui constituent l'essentiel du volume. Seul buildCiFixPrompt borne la spec (16 KB) ; tech_check, e2e_test, refinement, merge, specification reçoivent spec et mémoire entières.

**Recommandation**

Seed d'un budget global par défaut (ex. 30 k) pour que la bande d'estimation signale ; plafonner specSection par builder (le CI fix le fait déjà) et donner à la mémoire un cap distinct pour les sessions non-build (tech_check, e2e_test, refinement, merge) ; envisager un résumé de spec pour les sessions de review.

<details><summary>Preuve relevée par l'auditeur</summary>

Script tsx en lecture seule (scratchpad/measure-prompts.ts) appelant buildBuildPrompt/buildEpicReviewPrompt sur E-arij-267/155/156/126 : buildChars 116 746 / 112 753 / 113 866 / 99 046, reviewChars 120 526 / 115 383 / 116 500 / 101 680, specMemoryShare 69-81 %. SQL : `SELECT LENGTH(spec)` = 40 629, `LENGTH(markdown_content) WHERE kind='memory'` = 40 000 ; `SELECT key FROM settings WHERE key LIKE 'prompt_token_budget%'` → 0 ligne ; `SELECT COUNT(*) WHERE prompt LIKE '%prompt capped by Arij%'` → 19 ; distribution récente (≥ 2026-08-27) : build n=580 p50 87 743 max 126 799 (est. 34 755 tokens), review_code n=199 p50 96 407, refinement n=10 p50 126 387. budget.ts:62 `if (!budget || budget <= 0 || estimatedTokens <= budget) return { budgetExceeded: false }`.

</details>

### #213 — Après l'éclatement, les builders recopient encore les mêmes blocs : préambule projet ×10, « Epic Context » ×8, « Final Verdict » ×5, « Additional Instructions » ×3 (dont deux traitements différents)

**Nature** refacto · **Impact** faible · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/prompts/implementation.ts:127-131`
- `lib/claude/prompts/implementation.ts:134-138`
- `lib/claude/prompts/implementation.ts:294-298`
- `lib/claude/prompts/implementation.ts:353-357`
- `lib/claude/prompts/review.ts:49-60`
- `lib/claude/prompts/review.ts:105-108`
- `lib/claude/prompts/review.ts:126-129`
- `lib/claude/prompts/review.ts:281-284`
- `lib/claude/prompts/review.ts:299-302`
- `lib/claude/prompts/review.ts:321-324`
- `lib/claude/prompts/qa.ts:23`
- `lib/claude/prompts/qa.ts:98`
- `lib/claude/prompts/qa.ts:193`
- `lib/claude/prompts/refinement.ts:152-157`
- `lib/claude/prompt-sections.ts:237-249`
- `lib/claude/prompts/implementation.ts:171-176`
- `lib/providers/codex.ts:13-14`

**Constat**

L'éclatement de prompt-builder.ts en prompts/* a déplacé le texte sans le factoriser. Le préambule systemSection/projectHeader/specSection/memorySection/documentsSection est écrit à la main dans 10 builders alors que projectContextSections existe (utilisé seulement par conversation.ts et la seconde opinion) — parce que le collector de sections ne peut pas traverser le composite. Le bloc « ## Epic Context / ### titre / description » est copié 8 fois, « **IMPORTANT — Final Verdict:** … MUST end with exactly one of these lines » 5 fois avec deux vocabulaires (Approved/Changes Requested ×3, Feature Complete/Not Complete ×2, Bug Fixed ×1), les triades d'instructions review ×2. « Additional Instructions » (prompt QA saisi par l'utilisateur) est interpolé brut 3 fois dans qa.ts, alors que le même concept dans refinement.ts est neutralisé et fencé. Le commentaire justifiant CI_FIX_MAX_SPEC_BYTES par le plafond argv de codex est périmé : codex passe désormais les gros prompts par stdin.

**Précision du vérificateur**

La duplication est réelle mais les comptes sont à corriger. Le préambule (systemSection/projectHeader/specSection/memorySection/[documentsSection]) est réécrit à la main dans 17 fonctions builder (et non 10) — implementation ×5, review ×3, qa ×3, specification ×3, memory ×2, refinement ×1 — alors que projectContextSections (prompt-sections.ts:237-249) n'est appelé que par conversation.ts (23, 121, 155) et review.ts:352 ; l'excuse du collector ne vaut que pour implementation/review, les autres n'en passent aucun. Les préambules recopiés ne sont d'ailleurs pas identiques (description et documents inclus ou non), donc le composite doit devenir paramétrable, pas seulement collector-aware. Le bloc en-tête d'epic (heading + `### ${epic.title}` + description) est recopié 7 fois sous 6 en-têtes différents — « ## Epic Context » littéral n'apparaît que 3 fois, pas 8. « **IMPORTANT — Final Verdict:** … MUST end with exactly one of these lines » est bien copié 5 fois dans review.ts (105, 126, 281, 299, 321), mais avec la ventilation Approved/Changes Requested ×2, Feature Complete ×2, Bug Fixed ×1 (et non Approved ×3). ticketImagesSection est appelé 5 fois. « ## Additional Instructions » : confirmé, le prompt QA saisi par l'utilisateur (customPrompt du corps de requête, app/api/projects/[projectId]/qa/check/route.ts:104) est interpolé brut 3 fois dans qa.ts (23, 98, 193), alors que refinement.ts:157 neutralise et fence le même concept. Le commentaire de CI_FIX_MAX_SPEC_BYTES dans implementation.ts est bien périmé : codex.ts:13-14 documente le passage par stdin au-delà du plafond argv.

**Recommandation**

Faire de projectContextSections une fonction qui accepte le collector (push par clé) et l'utiliser partout ; extraire epicContextSection(epic, heading) et un helper finalVerdictSection(vocabulary) ; un seul additionalInstructionsSection neutralisé/fencé partagé par QA et refinement ; corriger le commentaire de CI_FIX_MAX_SPEC_BYTES.

<details><summary>Preuve relevée par l'auditeur</summary>

`grep -c "IMPORTANT — Final Verdict" lib/claude/prompts/review.ts` → 5 ; `grep -rn "Additional Instructions" lib/claude/prompts/*.ts` → qa.ts:23, 98, 193 (`parts.push(`## Additional Instructions\n\n${customPrompt.trim()}\n`)`) contre refinement.ts:157 `fenceOnly(neutralizeControlMarkup(options.instructions.trim()))` ; `grep -rn "ticketImagesSection(" lib/claude/prompts` → 5 ; projectContextSections appelé seulement dans conversation.ts (23, 121, 156) et review.ts:352. implementation.ts:173-174 « Codex passes the prompt as a single argv element against a 128 KB MAX_ARG_STRLEN » vs codex.ts:13-14 « a prompt past the argv cap is passed as the `-` positional and piped on stdin ».

</details>

### #214 — Vocabulaire du board disparu dans le texte lu par les agents : « column-move channel », « Target board column », « the same one drag-and-drop writes », « kanban board »

**Nature** refacto · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/prompt-sections.ts:301-302`
- `lib/claude/prompt-sections.ts:345`
- `bin/arij-mcp.mjs:112`
- `bin/arij-mcp.mjs:432`
- `bin/arij-mcp.mjs:536`
- `bin/arij-mcp.mjs:709-716`
- `bin/arij-mcp.mjs:757`
- `bin/arij-mcp.mjs:805`
- `lib/claude/prompts/refinement.ts:43-46`
- `lib/workflow/engine.ts:4`

**Constat**

Le desk a remplacé les colonnes et le drag-and-drop a été retiré (dnd-kit supprimé dans la rationalisation), mais les textes agent-facing décrivent toujours un kanban : la branche refinement d'arijToolsSection parle de « column-move channel » / « Column moves are disabled for this pass », la branche review de « the ticket's next column », le shim MCP décrit set_priority/promote_ticket/update_ticket_status avec « Target board column », reorder_tickets avec « Position is the board's single ordering source, the same one drag-and-drop writes », list_tickets avec « Arij kanban board », et le prompt de refinement annonce « refine the Backlog and To do columns ». Le commentaire d'en-tête du moteur de transitions cite encore « UI drag-and-drop ». Les statuts restent des données valides ; c'est la métaphore visuelle qui n'existe plus.

**Précision du vérificateur**

Exact sur le fond et sur toutes les citations. À compléter : dans `bin/arij-mcp.mjs`, le vocabulaire « column » touche aussi les lignes 395, 448, 528, 658, 797 et 845 (pas seulement 112/432/536/709-716/757/805), soit 13 occurrences au total. À noter également que `lib/claude/prompts/refinement.ts` est un fichier NON SUIVI (`??`) créé par la rationalisation UI elle-même : le « refine the Backlog and To do columns » y est donc réintroduit dans du code neuf, pas seulement hérité. Portée réelle : purement rédactionnelle (descriptions d'outils MCP + sections de prompt + un commentaire d'en-tête) ; aucun contrat de données n'est en cause, les identifiants de statut restent valides.

**Recommandation**

Remplacer « column » par « status/stratum » et supprimer la référence au drag-and-drop dans les descriptions d'outils ; garder les noms de statut (backlog, todo, …) qui sont le contrat réel.

<details><summary>Preuve relevée par l'auditeur</summary>

prompt-sections.ts:301-302 `? "promote_ticket is your column-move channel; …" : "Column moves are disabled for this pass. "` ; 345 « its verdict decides the ticket's next column » ; arij-mcp.mjs:432 « Position is the board's single ordering source, the same one drag-and-drop writes » ; :709 « on this project's Arij kanban board » ; :112/:536/:805 « Target board column. » ; refinement.ts:43 « ## Your Task: refine the Backlog and To do columns ». CLAUDE.md : « those statuses are data, they are just no longer drawn as columns » ; docs/architecture/ui-rationalisation-2026-09-10.md : dnd-kit retiré.

</details>

### #217 — La review au niveau story ignore epic.type : 32 stories de bugs sont revues avec la checklist feature, sans le libellé ni la checklist bug

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:prompt-layer

**Fichiers**
- `lib/claude/prompts/review.ts:36-138`
- `lib/claude/prompts/review.ts:232-264`
- `lib/pipeline/stage-review.ts`
- `app/api/projects/[projectId]/stories/[storyId]/review/route.ts:174`

**Constat**

buildEpicReviewPrompt adapte l'en-tête (« Bug Under Review »), retire la section stories, choisit BUG_REVIEW_CHECKLIST pour feature_review et ajoute « This is a BUG FIX review » quand epic.type === "bug". buildReviewPrompt (scope story, utilisé par stage-review.ts et la route stories/[storyId]/review) ne lit jamais epic.type : une story d'un epic bug reçoit REVIEW_CHECKLISTS.feature_review et les instructions « feature completeness review ». La base contient 32 user_stories rattachées à des epics de type bug, ce cas n'est donc pas théorique.

**Précision du vérificateur**

buildReviewPrompt (lib/claude/prompts/review.ts:36-138, scope story, atteint via stage-review.ts:94 et assembleStoryReviewPrompt → route stories/[storyId]/review:174) ne lit pas epic.type : une story d'un epic bug recevrait REVIEW_CHECKLISTS.feature_review et le libellé « feature completeness review » au lieu de BUG_REVIEW_CHECKLIST / « Bug Under Review » que buildEpicReviewPrompt applique. Le cas est atteignable (32 stories sous 12 epics bug, aucun garde de type sur le chemin story) mais latent : la base ne contient aucune session de review story-scoped (0 sur 307, 0 prompt « Ticket Under Review ») et les 148 reviews des epics bug sont toutes passées par le builder epic avec l'en-tête bug. Trou préexistant à HEAD, pas introduit par la rationalisation.

buildReviewPrompt (scope story) ignore epic.type : une story d'un epic bug recevrait REVIEW_CHECKLISTS[reviewType] et les instructions « feature completeness review », sans le libellé « Bug Under Review » ni la note « This is a BUG FIX review », alors que buildEpicReviewPrompt les applique. Le chemin est réellement câblé sans garde sur le type : page story (UserStoriesBand → AgentActionsBar kind story → POST /stories/:id/review → assembleStoryReviewPrompt), étape review du pipeline en scope story (stage-review.ts:94, code_review), et auto-mode qui sélectionne des stories sous n'importe quel epic. Les 32 stories sous 12 epics bug existent et sont toutes `done` (donc acceptées par la route), mais aucune session review n'a jamais été rattachée à une story (0 sur 307 sessions review ; les 148 reviews d'epics bug sont toutes passées par la route epic, bug-aware) : l'exposition est latente, pas mesurée. L'overlay ticket dispatche en kind epic et n'est pas concerné.

**Recommandation**

Factoriser la sélection checklist/libellé (isBug × reviewType) dans un helper partagé par les deux builders de review.

<details><summary>Preuve relevée par l'auditeur</summary>

`grep -n "isBug" lib/claude/prompts/review.ts` → uniquement lignes 232-315 (buildEpicReviewPrompt) ; buildReviewPrompt (36-138) ne référence ni epic.type ni BUG_REVIEW_CHECKLIST. SQL lecture seule : `SELECT COUNT(*) FROM user_stories us JOIN epics e ON e.id=us.epic_id WHERE e.type='bug'` → 32.

</details>

