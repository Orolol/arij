# Lot 16 — Review, QA, findings et verdicts

**Statut : réalisé le 16/09/2026.** Voir le [compte rendu d’implémentation et de validation](implementation-lots-12-13-16.md).
Les constats ci-dessous conservent l’état relevé pendant l’audit.

**Difficulté** 3/4 — Difficile
**Findings** 17 (2 fort · 8 moyen · 7 faible ; effort 11 S · 6 M · 0 L)
**Dépendances** La règle de poids des findings est décidée avec le lot 13 (212/220).

**Repris du lot 04** (fait le 11/09) : le volet « champs de
`PipelineReviewAssessment` » du finding #224 est laissé ici — le runner ne lit
que `blocking` / `blockingCount` / `unverifiable`, les quatre autres
(`agentCommentCount`, `usedProseFallback`, `verdictSource`, `structuredVerdict`)
sont construits par `stage-review.ts` et jamais relus. À trancher avec la règle
de poids des findings partagée avec le lot 13 (soit réduire le type, soit
tracer `verdictSource` dans l'activity log, ce que son commentaire promet).

## Décision

lib/review/verdict.ts et lib/review/finding-severity.ts sont les seules sources : un parseProseVerdict unique, un seul comptage des findings bloquants. Statut `dismissed` réel pour les findings QA.

## Objectif

Findings prose ingérés sur tous les chemins (pipeline, Full Auto, routes manuelles) ; routes review manuelles qui présentent les findings antérieurs [RC:id] et l'évidence de vérification ; submit_findings/submit_grading refusés aux sessions qui ne sont pas des reviewers ; gate seconde opinion aligné sur critical/major ; review-comments scopée au projet et statut validé ; grading asked_question notifié via handleAskedQuestionOutcome ; GET /grading rend « ungraded » sur rapport malformé ; prompts QA éditables/supprimables ; migration `dismissed` + dismissed_reason ; un seul pilote d'applicabilité de la vérification déterministe ; forensic atteignable hors pipeline ; enums de sévérité/verdict non recopiés.

## Démarche suggérée

1. parseProseVerdict + tests sur les vocabulaires des prompts (Approved / Changes Requested / Feature Complete / Not Complete / Bug Fixed).
2. Déplacer ingestProseFindings dans finalizeReviewSession (commun pipeline/Full Auto) et resolveReviewVerdict côté routes.
3. Migration manuelle review_comments.status += dismissed, colonne dismissed_reason ; prompts prior-findings lisent dismissed.
4. Garde d'agentType sur submit-findings/submit-grading.
5. planEpicVerification partagé stage-verification/POST verify ; renommer lib/pipeline/verify.ts (collision de nom).

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #218 — La récupération des findings prose (parse-review-report → ingestProseFindings) n'est atteinte que par le runner pipeline : Full Auto et les routes review manuelles ne l'appellent jamais

**Nature** à moitié câblé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/pipeline/findings.ts:774`
- `lib/pipeline/findings.ts:941-1000`
- `lib/pipeline/stage-review.ts:144-168`
- `lib/pipeline/runner-stage-review.ts:44-66`
- `lib/pipeline/index.ts:257`
- `lib/auto-mode/engine.ts:240-364`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:331-346`
- `app/api/projects/[projectId]/stories/[storyId]/review/route.ts:329-340`

**Constat**

parse-review-report.ts existe pour réparer le cas « reviewer sans MCP (codex) : review_comments reste vide, le builder suivant repart sans findings » (en-tête du module, E-arij-096). Mais ingestProseFindings n'a qu'un appelant, assessReviewOutcome (findings.ts:976), dont l'unique appelant produit est assessPipelineReview (stage-review.ts:152), exposé par driver.assessReview et consommé seulement par runner-stage-review.ts via index.ts:257. Full Auto construit le même driver (engine.ts:240) mais n'utilise que checkGuards / compositeMemberCount / launchStage (engine.ts:252-364) ; les routes review epic/story passent par resolveReviewVerdict (review/route.ts:340, stories/…/review/route.ts:333) qui n'ingère rien. Sur ces deux chemins, un reviewer codex produit toujours zéro ligne review_comments : le fix suivant est dispatché sans findings et le reviewer suivant redécouvre un jeu de Majors — exactement la boucle décrite comme réparée. Corollaire : le commentaire de runner-stage-review.ts:55-60 (« those rows carry agent_session_id NULL ») est périmé depuis findings.ts:837/980 (les lignes récupérées portent le sessionId), donc la branche `unverifiable && blockingCount > 0` qu'il décrit n'est plus atteignable.

**Précision du vérificateur**

ingestProseFindings (findings.ts:774) n'a qu'un appelant, assessReviewOutcome (findings.ts:976), lui-même appelé uniquement par assessPipelineReview (stage-review.ts:152) → driver.assessReview → runner-stage-review.ts:26 via index.ts:257. Full Auto (engine.ts:240-364) ne consomme que checkGuards/compositeMemberCount/launchStage ; sa review se termine dans finalizeReviewSession (stage-session.ts:200 → stage-review.ts:170) qui n'ingère rien. Les routes review epic (route.ts:340) et story (route.ts:339) passent par resolveReviewVerdict, qui n'écrit aucune ligne. Sur ces chemins, un reviewer codex (MCP jamais démarré sous codex exec) laisse review_comments vide et le builder suivant (stage-code.ts:106-107) repart sans findings — la boucle E-arij-096 reste ouverte hors pipeline ; le commit d'origine bf358289 n'a jamais câblé que findings.ts. Le commentaire runner-stage-review.ts:55-60 est périmé depuis 8e997329 (les lignes récupérées portent agentSessionId, findings.ts:837/980, et readReviewChannelState les compte comme preuve de canal) ; le cas « unverifiable avec findings » ne subsiste que si les lignes bloquantes de la fenêtre viennent d'une autre session.

La récupération prose (parseReviewReport → ingestProseFindings) n'a qu'une chaîne d'appel : assessReviewOutcome (findings.ts:976) → assessPipelineReview (stage-review.ts:152) → driver.assessReview (stages.ts:217) → runner pipeline (index.ts:257, runner-stage-review.ts:26). Full Auto (engine.ts n'utilise que checkGuards/compositeMemberCount/launchStage), finalizeReviewSession (commun aux deux chemins) et les routes review epic/story (resolveReviewVerdict) n'ingèrent jamais. Conséquence à nuancer selon le canal : pour un reviewer réellement sans MCP (provider `pi`, réglage mcp_tools_enabled=false, ou mcpChannel=unavailable) le verdict prose « changes requested » renvoie le ticket en in_progress et le builder suivant est dispatché avec zéro review_comments — la boucle E-arij-096. Pour codex (désormais dans MCP_CAPABLE_PROVIDERS avec approbations contournées) ou claude qui n'appelle pas submit_findings, la session est jugée unverifiable : pas de fix sans findings, mais le rapport prose est jeté et la review refaite (jusqu'à 3 fois) alors que le pipeline l'aurait récupéré. Corollaire partiel : le commentaire runner-stage-review.ts:54-60 (et pipeline-runner.test.ts:199-201) est périmé — les lignes récupérées portent le sessionId (findings.ts:837) — mais la branche `unverifiable && blockingCount > 0` reste atteignable quand la fenêtre contient déjà des lignes d'une autre session (l'ingestion est alors sautée).

**Recommandation**

Déplacer l'ingestion prose dans finalizeReviewSession (stage-review.ts:170, commun au pipeline et à Full Auto) ou dans resolveReviewVerdict côté routes, avec la fenêtre readSessionFindingsWindow ; supprimer le commentaire périmé de runner-stage-review.ts. Ajouter un test qui dispatch une review via le driver Full Auto avec un rapport prose et vérifie les lignes review_comments.

<details><summary>Preuve relevée par l'auditeur</summary>

grep -rn ingestProseFindings lib app → définition findings.ts:774, appel unique findings.ts:976 (dans assessReviewOutcome), commentaire runner-stage-review.ts:55. grep assessReviewOutcome( → seul appel stage-review.ts:152. grep 'driver\.' lib/auto-mode/engine.ts → checkGuards:252, compositeMemberCount:349, launchStage:364 — jamais assessReview. Les routes review importent resolveReviewVerdict/collectBlockingFindings/resolvePriorFindingsFromProse (review/route.ts:53-57) mais pas assessReviewOutcome.

</details>

### #219 — Six lecteurs du verdict de review, trois d'entre eux lisent la prose avec des règles incompatibles : le même rapport est « changes requested » pour le workflow, « Approved » pour Dreaming, « sans verdict » pour /qa et « review propre » pour le gate de merge

**Nature** cassé · **Impact** fort (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/pipeline/findings.ts:743-756`
- `lib/auto-mode/second-opinion.ts:43-46`
- `lib/auto-mode/second-opinion.ts:120-168`
- `lib/workflow/dreaming-digest.ts:146-153`
- `lib/qa/aggregate.ts:490-510`
- `lib/workflow/review-freshness.ts:110-135`
- `lib/pipeline/findings.ts:531-573`
- `lib/auto-mode/select.ts:585-598`
- `lib/claude/prompts/review.ts:106-129`
- `lib/review/verdict.ts:1-37`

**Constat**

Réponse à (a). Lecteurs distincts : (1) findings.ts isNegativeProseVerdict:749 — substring sur TOUT le rapport lowercased ('changes requested' | 'not complete' | 'partially complete') ; (2) second-opinion.ts PROSE_VERDICT_RE:45 — uniquement la DERNIÈRE ligne, forme exacte, vocabulaire Approved/Changes Requested seulement, et STRUCTURED_VERDICT_RE:43 relit le verdict structuré dans ticket_comments (« **Review findings (…)** ») au lieu de la colonne agent_sessions.review_verdict que submit-findings écrit ; (3) dreaming-digest.ts extractReviewVerdict:146-150 — premier « **Overall Verdict: X** », chaîne brute ; (4) qa/aggregate.ts deriveVerdicts:490-510 — colonne seule, enum recopié à la main, prose ignorée (« noStructuredVerdict ») ; (5) review-freshness.ts isCleanReviewSql + findings.ts cleanReviewVerdictSql:531 — un verdict NULL sur provider sans canal est CLEAN, la prose est « deliberately NOT parsed » (select.ts:591) ; (6) blocking-findings.ts / collectBlockingFindings par préfixe de body. Cas concret : un reviewer codex écrit « **Overall Verdict: Approved** » mais son rapport contient « the migration is not complete » → (1) bascule le ticket en in_progress « [verdict source: prose] » (stage-review.ts:320, review/route.ts:369) ; le même instant (5) l'enregistre comme review propre (lastCleanReviewAt), (4) affiche « sans verdict structuré », (3) résume « Approved ». Inversement, « Overall Verdict: Changes Requested » suivi d'une ligne de politesse → (2) renvoie null → gate « retry » et re-dispatch, alors que (1) est négatif. Les vocabulaires feature_review (« Feature Complete / Not Complete », prompts/review.ts:106-108,300-302) ne sont connus que de (1).

**Précision du vérificateur**

Six lecteurs du verdict de review avec des règles de prose incompatibles et aucun parseur partagé dans lib/review/verdict.ts : findings.ts (substring sur tout le rapport, seul à connaître « Not/Partially Complete »), second-opinion.ts (dernière ligne exacte, vocabulaire Approved/Changes Requested, relit le miroir ticket_comments plutôt que la colonne écrite par la même route), dreaming-digest.ts (première ligne Overall Verdict brute), qa/aggregate.ts (enum recopié à la main, prose ignorée), cleanReviewVerdictSql/review-freshness (NULL sans canal = clean, règle documentée comme délibérée et testée), blocking-findings (préfixe). MAIS le cas concret est faux : codex est MCP-capable (mcp-injection.ts:371) et toutes ses sessions review en base sont mcp_channel='injected' → un verdict NULL est « unverifiable » (pas de bascule in_progress, pas clean, QA « unverifiable ») et (1)/(4)/(5) concordent. La divergence workflow ↔ gate de merge ↔ /qa n'est atteignable que toggle MCP désactivé ou injection échouée (0 ligne en base) ; second-opinion ne lit jamais la même session que le workflow (retry = re-dispatch, pas verdict inversé) ; seule la lecture Dreaming (« Approved » sur un rapport contenant « not complete ») diverge réellement sur une session ordinaire, et c'est un digest informatif. Dette de cohérence réelle, pas un cassage observable dans l'état courant.

Quatre lecteurs de prose sans parseur partagé (findings.ts:749 substring sur tout le rapport ; second-opinion.ts:45 dernière ligne exacte ; dreaming-digest.ts:150 premier match brut ; qa/aggregate.ts:490 colonne seule, enum recopié), plus le gate SQL (cleanReviewVerdictSql/isCleanReviewSql) qui tient un verdict NULL sans canal pour propre. Tous atteints (pipeline + route review, engine Full Auto, Dreaming, /qa, CTE de fraîcheur). MAIS : (2) second-opinion ne lit que `review_second_opinion`, population disjointe des reviews ordinaires, avec son propre prompt qui mandate uniquement Approved/…/Changes Requested en dernière ligne — la « contradiction (1) vs (2) sur le même rapport » n'existe pas, et le retry hors dernière ligne est épinglé comme voulu par test. Le cas « codex » n'est pas atteignable par défaut : codex est MCP-capable et process-manager enregistre `injected`, donc un verdict NULL est UNVERIFIABLE pour (1), (4) et (5) ; la divergence décrite exige la voie sans canal (MCP tools désactivé, injection en échec, ou lignes récupérées par ingestProseFindings). La divergence (5) est délibérée et ne mord que sur un retour manuel en review sans changement de code. Le vrai défaut restant : le scan substring de tout le rapport en (1) (« not complete » n'importe où bascule un « Overall Verdict: Feature Complete » en changes requested) et l'absence de parseur unique dans lib/review/verdict.ts.

**Recommandation**

Ajouter à lib/review/verdict.ts un unique `parseProseVerdict(report): StructuredReviewVerdict | null` (dernière ligne « Overall Verdict », tous les vocabulaires mandatés par les prompts, y compris Feature Complete/Not Complete/Bug Fixed) et le faire consommer par findings.ts, second-opinion.ts, dreaming-digest.ts et deriveVerdicts ; faire lire à second-opinion la colonne review_verdict plutôt que le commentaire miroir ; faire tester isStructuredReviewVerdict dans qa/aggregate au lieu de l'enum recopié.

<details><summary>Preuve relevée par l'auditeur</summary>

grep -rn -i 'changes requested|Final Verdict|Overall Verdict' lib app (hors findings.ts/verdict.ts) → second-opinion.ts:44-46,139,165,259 ; dreaming-digest.ts:150 ; qa/aggregate.ts:491-501 ; review-freshness.ts:135,141 ; prompts/review.ts:105-129,281-324,390-392. findings.ts:749-756 : `output.toLowerCase()` + `.includes(substring)` sur la sortie entière. second-opinion.ts:160 : `comment.content.trim().split(/\r?\n/).at(-1)` puis PROSE_VERDICT_RE anchoré ^…$. lib/review/verdict.ts n'exporte aucun parseur de prose bien qu'il se déclare « the shared reading » du vocabulaire.

</details>

### #96 — Une session de grading qui se termine par asked_question ne notifie personne

**Nature** à moitié câblé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `lib/grading/dispatch.ts:258-303`
- `lib/notifications/create.ts:420-444`
- `lib/agent-sessions/dispatch-background-session.ts`
- `lib/workflow/agent-question.ts:49`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:319`

**Constat**

lib/grading/dispatch.ts n'appelle jamais handleAskedQuestionOutcome : son onTerminal ne fait qu'emitSessionFailed (:296-303). Or lib/notifications/create.ts:444 retourne délibérément tôt pour `outcome === "asked_question"` (cette notification est « owned by handleAskedQuestionOutcome »), et dispatchBackgroundSession ne contient aucune gestion de question. La route review epic (:319) et la route story (:293) appellent bien handleAskedQuestionOutcome. Résultat : un grader qui appelle mcp__arij__ask_question (dans l'allowlist) termine sans notification ni ligne d'activité « held ». Ce point avait été relevé comme Major par la code review de l'epic grading (arji.json) et n'a pas été corrigé.

**Précision du vérificateur**

lib/grading/dispatch.ts:296-305 (`onTerminal`) n'appelle jamais `handleAskedQuestionOutcome` ; un grader qui termine en `asked_question` (outil dans l'allowlist, recommandé par prompt-sections.ts:318) passe par `emitSessionFailed` → `createNotificationFromSession`, qui retourne tôt à lib/notifications/create.ts:191 (arbre de travail ; :444 dans HEAD) — et le hook terminal fait de même. Résultat : aucune notification, aucun webhook, aucune ligne d'activité « held », et la session est marquée failed avec l'erreur « missing report » ; dans le pipeline, runner.ts:382-384 conclut `paused_question` en supposant à tort que le stage a notifié. La question reste seulement visible via le commentaire agent sur le desk « Asks you ». Signalé Major dans la code review de l'epic grading (arji.json), non corrigé sur aucune branche ; __tests__/grading-agent-dispatch.test.ts n'a aucun cas asked_question.

Une session de grading qui se termine par `asked_question` ne notifie personne et n'écrit pas de ligne d'activité « held ». lib/grading/dispatch.ts:303-311 (`onTerminal`) n'appelle qu'`emitSessionCompleted`/`emitSessionFailed`, et `dispatchBackgroundSession` (lib/agent-sessions/dispatch-background-session.ts) n'a aucune gestion de question. Or `createNotificationFromSession` retourne délibérément tôt pour `outcome === "asked_question"` (lib/notifications/create.ts:191 dans l'arbre de travail, :444 dans HEAD), et `createAskedQuestionNotificationFromSession` n'est atteinte que via `handleAskedQuestionOutcome` (lib/workflow/agent-question.ts:49), appelée par stage-review.ts:215, automatic-transitions.ts:889, build/route.ts:442 et les deux routes review, jamais par le grading ; le hook terminal (terminal-notification.ts:29-35) et la route MCP ask-question (qui se défend d'appeler le handler) ne rattrapent rien. Le grader y a accès : `ask_question` est dans ARIJ_MCP_AGENT_TOOLS (mcp-injection.ts), la section « Arij tools » injectée à tout agent avec ligne de session (process-manager.ts:334) le lui recommande, et `classifySessionOutcome` (:314-320) produit bien `asked_question`. Effet net : session marquée `failed` (rapport manquant), aucune notification ni question ni échec, et lib/pipeline/runner.ts:383-385 conclut `paused_question` en supposant à tort que l'étape a notifié. Relevé Major par la code review de l'epic grading (arji.json), toujours ouvert ; `__tests__/grading-agent-dispatch.test.ts` n'a pas de cas `asked_question`.

**Recommandation**

Dans onTerminal du dispatch grading, si `run.outcome === "asked_question"`, appeler handleAskedQuestionOutcome({ projectId, epicIds:[epicId], sessionId, ticketStatus }) comme stage-review.ts:215 ; ajouter le cas au test grading-agent-dispatch.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'handleAskedQuestionOutcome|asked_question' lib/grading/dispatch.ts lib/agent-sessions/dispatch-background-session.ts → 0 résultat. rg 'question|handleAsked' lib/agent-sessions/dispatch-background-session.ts → 0. create.ts:444 `if (session.outcome === "asked_question") return;`.

</details>

### #98 — La route review-comments ignore projectId et accepte n'importe quel `status`

**Nature** risque · **Impact** moyen (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/epics/[epicId]/review-comments/route.ts:9-24`
- `app/api/projects/[projectId]/epics/[epicId]/review-comments/route.ts:27-41`
- `app/api/projects/[projectId]/epics/[epicId]/review-comments/route.ts:89-115`
- `app/api/projects/[projectId]/epics/[epicId]/comments/route.ts:17`
- `lib/db/schema.ts:645`

**Constat**

GET/POST/PATCH/DELETE de review-comments chargent l'epic par `eq(epics.id, epicId)` seul (:10-12, :28-38) alors que `projectId` est dans les params : n'importe quel projectId dans l'URL permet de lire, créer, modifier ou supprimer les findings d'un epic d'un autre projet, contrairement à la route voisine comments/route.ts qui passe par getEpicOr404(projectId, epicId) (:17, :58). PATCH copie `body.status` tel quel (:105) alors que le schéma documente `open | resolved` et que blocksMergeSql, merge-approval, tickets/route.ts, qa/findings ne testent que `"open"` : un statut fantaisiste sort silencieusement le finding de toutes les gates sans être « resolved ».

**Précision du vérificateur**

GET/POST/PATCH/DELETE de review-comments/route.ts ne destructurent que `epicId` (:10, :28, :81, :121) ; GET/POST chargent l'epic par `eq(epics.id, epicId)` seul (:12, :38), PATCH/DELETE ne vérifient que `reviewComments.epicId = epicId` (:92, :132) — n'importe quel projectId dans l'URL résout un epic d'un autre projet, contrairement à comments/route.ts (:17, :58) qui passe par getEpicOr404 (lib/api/route-helpers.ts:83-97, scoping documenté comme intentionnel). PATCH copie `body.status` sans validation (:104) alors que le schéma documente `open | resolved` (lib/db/schema.ts:661 dans l'arbre de travail, :645 dans HEAD) ; blocksMergeSql ne teste pas le statut lui-même mais tous ses appelants (merge-approval.ts:40, tickets/route.ts:414, qa/findings/route.ts:225,254, control-desk/route.ts:404, auto-mode/select.ts:325, stage-prompt.ts:179, dispatch-prompt.ts:245, epics/route.ts:241, pipeline/findings.ts:813) filtrent `status = 'open'`, et submit-findings (:154) refuse de résoudre un finding non-open : un statut fantaisiste sort silencieusement le finding de toutes les gates sans être « resolved » ni récupérable par le MCP.

review-comments/route.ts est la seule route sous app/api/projects/[projectId]/epics/[epicId]/ qui n'utilise pas getEpicOr404(projectId, epicId) : ses 4 handlers ignorent projectId (:10,:28,:81,:121) et chargent l'epic par id seul (:12,:38) ou ne scopent que sur reviewComments.epicId (:92,:132), donc un projectId quelconque dans l'URL lit/crée/modifie/supprime les findings d'un epic d'un autre projet. PATCH copie body.status sans validation (:104) alors que schema.ts:661 documente open|resolved et que toutes les gates (tickets/route.ts:414, qa/findings:225,254, control-desk:404, auto-mode/select:325, second-opinion:178, pipeline/findings:813, merge-approval:40, blocksMergeSql) ne testent que "open". Nuance : les seuls appelants réels (hooks/useReviewComments.ts via components/review/DiffViewer.tsx:55, components/qa/QaScreen.tsx:216) passent le bon projectId et n'envoient que status "resolved" — le trou n'est atteignable que par appel HTTP direct ; aucun test (__tests__/review-comments-route.test.ts) ne couvre le cas cross-project.

**Recommandation**

Utiliser getEpicOr404(projectId, epicId) dans les quatre handlers et valider `status` avec un z.enum(["open","resolved"]) (élargi si un statut `dismissed` est ajouté, cf. finding suivant).

<details><summary>Preuve relevée par l'auditeur</summary>

review-comments/route.ts:10 `const { epicId } = await params;` (projectId non destructuré dans les 4 handlers) ; :105 `if (body.status !== undefined) updates.status = body.status;` sans validation. comments/route.ts:17 `getEpicOr404(projectId, epicId)`.

</details>

### #99 — Le Dismiss du QA écrit `resolved` + « [dismissed] raison » dans le body : dismissal et acceptation-par-merge sont indistinguables

**Nature** risque · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `components/qa/QaScreen.tsx:205-245`
- `components/qa/DismissDialog.tsx:20-45`
- `lib/workflow/merge-approval.ts:31-44`
- `lib/db/schema.ts:634-653`
- `app/api/qa/findings/route.ts:372-395`

**Constat**

QaScreen.handleDismiss (:215-224) PATCH le finding en `status: "resolved"` et remplace son body par `${rawBody}\n\n[dismissed] ${reason}`, puis poste un ticket comment séparé. DismissDialog.tsx:20-40 documente que c'est un contournement faute de colonne/statut de dismissal. Conséquences vérifiées : rien ne lit jamais « [dismissed] » (rg → seule occurrence : l'écriture) ; un finding rejeté par l'humain et un finding accepté par le merge (resolveOpenReviewComments) ont le même statut ; VERDICTS RÉCENTS compte `findingsFiled` par session sans distinguer (qa/findings :372-395) ; le body d'un finding agent est réécrit après coup (la dernière ligne « accumulate as separate rows » de submit-findings suppose des bodies immuables). Le doc de rationalisation ne traite pas ce point.

**Précision du vérificateur**

QaScreen.handleDismiss (components/qa/QaScreen.tsx:209-249) PATCH le finding en `status: "resolved"` et réécrit son body en `${rawBody}\n\n[dismissed] ${reason}`, puis poste un ticket comment « **Finding dismissed** … » en best-effort (échec non rollbacké). DismissDialog.tsx:22-38 documente que c'est un contournement faute de colonne `dismissed_reason` / statut `dismissed` (schema.ts:661 : `// open | resolved`). Conséquences vérifiées : aucun code produit ne lit « [dismissed] » (seule occurrence : l'écriture ; un test l'épingle) ; un finding rejeté par l'humain et un finding accepté par le merge (lib/workflow/merge-approval.ts:32-44) ont le même statut `resolved` et sont indistinguables en base, dans l'agrégat QA et dans tous les lecteurs de review_comments (tous filtrent `status='open'`) ; le body d'un finding agent est muté après coup. La décision humaine ne survit que par l'écho ticket comment, qui entre bien dans le prompt de review épic (loadPromptComments → commentHistorySection, review.ts:257) mais pas de façon garantie ni structurée. Le compteur `findingsFiled` (qa/findings/route.ts:367-390) compte toutes les lignes par session sans distinguer aucun statut — effet secondaire mineur, non spécifique au dismiss. Le doc de rationalisation ne traite pas ce point.

Le Dismiss du QA (`components/qa/QaScreen.tsx:210-226`, atteint via `/qa` → FindingRow « Dismiss » → DismissDialog) PATCH le finding en `status: "resolved"` et réécrit son `body` en `${rawBody}\n\n[dismissed] ${reason}` ; la route PATCH (`review-comments/route.ts:103-104`) persiste les deux sans validation. En base, ce rejet humain est indistinguable (a) de l'acceptation-par-merge (`lib/workflow/merge-approval.ts:31-44`) et (b) du « Resolve » manuel sans raison du fil inline (`components/review/InlineCommentThread.tsx:55-60`, non cité par l'auditeur). Aucun code ne parse « [dismissed] » (seule occurrence : l'écriture), et tous les lecteurs de prior-findings/aggregate filtrent `status = 'open'` (lib/pipeline/findings.ts:178,813,891 ; stage-prompt.ts:179 ; dispatch-prompt.ts:245 ; select.ts:325 ; qa/findings:225,254), donc le reviewer suivant ne sait pas qu'un humain a tranché. Nuance : la raison n'est pas perdue pour l'humain — le body réécrit est rendu (atténué, badge « resolved ») dans le fil inline du DiffViewer de l'overlay ticket, et écho en ticket comment. L'argument sur « accumulate as separate rows » (submit-findings:24-25) n'implique pas l'immutabilité des bodies et doit être retiré. `schema.ts:661` (et non 645) porte le commentaire `// open | resolved`. Le comportement est épinglé par `__tests__/qa-findings-actions.test.tsx:208-215` ; DismissDialog.tsx:36-38 reconnaît que `dismissed_reason` + statut `dismissed` est le bon fix.

**Recommandation**

Migration manuelle : statut `dismissed` + colonne `dismissed_reason` ; faire lire `dismissed` par les prompts prior-findings (pour que le reviewer suivant sache qu'un humain a tranché) et par l'aggregate QA ; ne plus muter `body`.

<details><summary>Preuve relevée par l'auditeur</summary>

rg '\[dismissed\]' app components hooks lib → components/qa/QaScreen.tsx:223 uniquement. schema.ts:645 `status: text("status").notNull().default("open"), // open | resolved`. DismissDialog.tsx:36-38 « A dismissed_reason column (plus a dismissed status distinct from resolved) is the correct fix ».

</details>

### #220 — Le gate seconde opinion rejette l'epic pour tout finding ouvert, [minor]/[info] compris, en contradiction avec son propre prompt et avec blocksMergeSql

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/auto-mode/second-opinion.ts:171-180`
- `lib/auto-mode/second-opinion.ts:253-268`
- `lib/claude/prompts/review.ts:386`
- `lib/workflow/blocking-findings.ts:26-31`
- `lib/auto-mode/select.ts:320-327`
- `__tests__/auto-mode-second-opinion.test.ts:305-319`

**Constat**

readSecondOpinionState compte `openFindingCount(session.id)` toutes sévérités confondues (second-opinion.ts:171-180) et rejette dès que blocking > 0 (:258-268) avec la raison « N blocking finding(s) », en s'appuyant sur le commentaire :253-256 « Full Auto's merge selector and workflow completion guard treat every open finding as blocking ». Ce n'est plus vrai : select.ts:326 filtre par blocksMergeSql, merge-readiness.ts:17-23 dit que les findings ouverts ne bloquent plus, et blocking-findings.ts:26-31 classe [minor]/[info] comme non bloquants. Le prompt du gate (prompts/review.ts:386) dit au contraire « keep non-blocking suggestions in the summary — the verdict, not the findings list, is what decides ». Un gate qui répond approved_with_minor_issues + un [minor] anchoré parque l'epic avec « 1 blocking finding » (parkRejectedSecondOpinion, engine.ts:1263). Le test __tests__/auto-mode-second-opinion.test.ts:305-319 épingle ce comportement.

**Précision du vérificateur**

readSecondOpinionState (lib/auto-mode/second-opinion.ts:171-180, :258-268) compte toutes les review_comments ouvertes de la session du gate, sans filtre de sévérité, et rejette dès que le compte est > 0 avec la raison « N blocking finding(s) », en s'appuyant sur un commentaire (:253-256) devenu faux : le sélecteur de merge (select.ts:326) et le board passent désormais par blocksMergeSql, qui classe [minor]/[info] comme non bloquants (blocking-findings.ts:26-31, finding-severity.ts:24-29), et lib/workflow ne contient plus de guard comptant crûment les rows ouvertes. Le prompt du gate (review.ts:386) dit que le verdict décide, pas la liste de findings ; pourtant un gate approved/approved_with_minor_issues qui file un [minor] via submit_findings (row `[minor] …` open, route.ts:120-122) fait parquer l'epic par lib/auto-mode/engine.ts:1263 (parkRejectedSecondOpinion). Le test __tests__/auto-mode-second-opinion.test.ts:299-318 épingle ce comportement.

readSecondOpinionState (lib/auto-mode/second-opinion.ts:171-180, :255-268) compte tous les review_comments ouverts de la session seconde opinion sans distinction de sévérité et rejette dès qu'il y en a un, sur la foi d'un commentaire (:255-257, du 25/08) devenu faux depuis lib/workflow/blocking-findings.ts (:22-27 : [minor]/[info] ne bloquent pas), select.ts:326 (blocksMergeSql) et merge-readiness.ts:19-22. Le gate est réellement câblé : opt-in full_auto_second_opinion (AutoModeDialog.tsx:282-291), lu par engine.ts:640 et :1254, rejet → park + notification inbox « … — 1 blocking finding » (engine.ts:1093-1130, notifications/create.ts:351-375). L'exposition passe uniquement par MCP : submit_findings (route.ts:91,114-125) accepte une session review_second_opinion et écrit `[minor] …` avec son agentSessionId ; le parseur de prose n'est pas appelé pour ce type de session. Le prompt (prompts/review.ts:386) demande un findings vide pour approved/approved_with_minor_issues, ce qui atténue sans empêcher. Test __tests__/auto-mode-second-opinion.test.ts:299-319 épingle le comportement.

**Recommandation**

Remplacer openFindingCount par un comptage via blockingFindingSeverity (lib/review/finding-severity.ts) ou blocksMergeSql, mettre à jour le commentaire et le test ; ou aligner le prompt si le rejet sur [minor] est voulu (mais alors il contredit approved_with_minor_issues).

<details><summary>Preuve relevée par l'auditeur</summary>

second-opinion.ts:171-180 : `where(and(eq(agentSessionId, sessionId), eq(status, 'open')))` sans filtre de préfixe ; :259 `if (verdict === 'changes requested' || blocking > 0)`. Test :305-309 body '[minor] Cleanup remains before merge' → reason '1 blocking finding'.

</details>

### #221 — submit_findings.prior_findings est appelable par toute session non-chat : un agent de build peut résoudre lui-même les findings du reviewer sur son epic

**Nature** risque · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `app/api/mcp/submit-findings/route.ts:88-101`
- `app/api/mcp/submit-findings/route.ts:135-158`
- `bin/arij-mcp.mjs:91`
- `bin/arij-mcp.mjs:261`
- `bin/arij-mcp.mjs:862`
- `lib/mcp/http-auth.ts:49-71`
- `lib/mcp/board-tool-route.ts:62-85`
- `lib/pipeline/findings.ts:249-256`

**Constat**

Le seul garde d'agent de la route est `auth.agentType === 'chat'` (submit-findings/route.ts:91-99). Le toolset MCP « agent » (bin/arij-mcp.mjs:91, TOOLS:862) expose submit_findings à toutes les sessions build/fix/merge/grading, et sa boucle prior_findings (:141-158) résout tout row agent ouvert de l'epic dont l'id est fourni. Or le builder reçoit ces mêmes findings dans son prompt (buildReviewFeedbackSection, stage-prompt.ts:64) et get_ticket lui renvoie leurs ids (get-ticket/route.ts:79-85). Un builder qui « annonce » fixed via l'outil fait sortir les lignes de blocksMergeSql, de la section « Findings Still Open » du prochain reviewer et du compteur du desk, sans qu'aucun reviewer ne les ait revérifiées. L'écriture review_verdict sur sa propre ligne est sans effet (gates limités à ORDINARY_REVIEW_AGENT_TYPES), mais la résolution, elle, est durable. board-tool-route.ts:78 montre la bonne forme (allowlist par type) et l'audit précédent a relevé le même trou pour submit_grading.

**Précision du vérificateur**

Le seul garde de POST /api/mcp/submit-findings est `auth.agentType === 'chat'` → 403 (route.ts:91-99) ; requireMcpToken (http-auth.ts:49-71) ne restreint que les refinementActions. Le toolset « agent » du shim (bin/arij-mcp.mjs:67/862, AGENT_TOOLS:261) et l'allowlist de spawn (mcp-injection.ts:73-100, allowedToolNamesForAgentType sans withheld/exclusive pour submit_findings) exposent l'outil à toute session build/fix/merge/grading. La boucle prior_findings (route.ts:141-158) passe à `resolved` tout row agent `open` de l'epic du token, sans vérifier le type de l'appelant. Le builder obtient les ids via get_ticket (get-ticket/route.ts:79-85) — pas via le prompt : buildReviewFeedbackSection (stage-prompt.ts:64) n'émet que fichier/ligne/corps. Une résolution ainsi déclarée sort durablement les lignes du gate Full Auto (select.ts:322-327), du compteur to_merge (tickets/route.ts:411-416) et de la section « Findings Still Open » du prochain reviewer (stage-review.ts:108, readOpenReviewComments). L'écriture review_verdict sur la ligne build est inerte (findings.ts:394/467, ORDINARY_REVIEW_AGENT_TYPES). submit-grading/route.ts:42 a le même garde chat-only. Aucun test de mcp-routes.test.ts ne couvre un appel par un type non-review.

submit_findings.prior_findings est appelable par toute session non-chat (build, ticket_build, team_build, merge, grading…) : la route ne refuse que agentType='chat' (submit-findings/route.ts:91-99) et requireMcpToken ne restreint que refinement. Un build reçoit un token MCP (process-manager.ts:278, seuls memory writers/failure_digest sont exemptés) et mcp__arij__submit_findings figure dans son allowlist (mcp-injection.ts : aucun withheld/exclusive pour ce tool) ; le shim POSTe la route avec le bearer, atteignable aussi par curl. Le prompt du builder liste les findings ouverts SANS id (stage-code.ts:107 → buildReviewFeedbackSection), mais get_ticket (aucune garde de type) lui renvoie leurs ids (get-ticket/route.ts:79-85). Un « fixed » sur ces ids passe les rows agent ouverts de l'epic à resolved (:141-160), ce qui les retire du compteur du desk (control-desk/route.ts:404-405), de blocksMergeSql et de la section « Findings Still Open » du prochain reviewer, sans revérification. L'écriture review_verdict sur la ligne du builder est inerte (review-freshness.ts:92-96 et findings.ts filtrent sur les types review) ; le fallback prose [RC:id] FIXED n'est exécuté que par les finaliseurs review, donc le canal MCP est le seul chemin d'auto-résolution d'un builder. Aucun test ne couvre la réponse de submit-findings pour un token build.

**Recommandation**

Dans submit-findings (et submit-grading), refuser toute session dont l'agentType n'est pas dans ORDINARY_REVIEW_AGENT_TYPES ∪ {review_second_opinion} (pour findings) / GRADING_AGENT_TYPE (pour grading), sur le modèle de requireChatToolsetToken ; sinon retirer l'outil du toolset agent pour les types build.

<details><summary>Preuve relevée par l'auditeur</summary>

submit-findings/route.ts:91 `if (auth.agentType === 'chat') return 403` — aucun autre test de type. http-auth.ts:49-71 requireMcpToken ne restreint que 'refinement'. bin/arij-mcp.mjs:862 `const TOOLS = TOOLSET === 'chat' ? CHAT_TOOLS : AGENT_TOOLS` et AGENT_TOOLS contient submit_findings (:261). Route :141-158 : update status='resolved' pour tout row agent open de l'epic.

</details>

### #222 — Les routes review manuelles ne présentent jamais les findings antérieurs ([RC:id]) ni l'évidence de vérification au reviewer : resolvePriorFindingsFromProse y parse des tokens que le reviewer n'a pas reçus

**Nature** à moitié câblé · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/pipeline/stage-prompt.ts:99-176`
- `lib/pipeline/stage-review.ts:100-125`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:183-191`
- `app/api/projects/[projectId]/epics/[epicId]/review/route.ts:331-336`
- `app/api/projects/[projectId]/stories/[storyId]/review/route.ts:174-190`
- `app/api/projects/[projectId]/stories/[storyId]/review/route.ts:329-334`
- `lib/tokens/dispatch-prompt.ts`

**Constat**

buildPriorFindingsSection (la section qui demande « [RC:id] FIXED / STILL OPEN » et prior_findings) n'est appelée que par buildReviewStagePrompt (stage-review.ts:107, chemin pipeline/Full Auto). Les routes review epic/story construisent leur prompt via assembleEpicReviewPrompt / assembleStoryReviewPrompt (review/route.ts:183, stories/…/review/route.ts:174, lib/tokens/dispatch-prompt.ts) qui n'incluent ni cette section ni buildDeterministicVerificationReviewSection. Conséquences : (1) resolvePriorFindingsFromProse dans ces deux routes (:335, :331) ne peut matcher que si le reviewer invente spontanément des lignes [RC:id] ; (2) une review lancée depuis le bouton Review, /qa ou le start de review manuel ne connaît pas les findings ouverts et repart en « fresh set of Majors » — la boucle que stage-prompt.ts:99-112 documente comme corrigée ; (3) prior_findings n'est jamais demandé au reviewer manuel, donc les findings ne se résolvent que par le merge.

**Précision du vérificateur**

Les routes review epic/story (POST .../epics/[epicId]/review et .../stories/[storyId]/review, appelées par useAgentDispatch, ProjectBatchToolbar et QaScreen) construisent leur prompt via assembleEpicReviewPrompt / assembleStoryReviewPrompt (lib/tokens/dispatch-prompt.ts:341/396 → lib/claude/prompts/review.ts) qui ne lisent pas reviewComments et n'émettent aucun token [RC:id] ; buildPriorFindingsSection n'est appelé que par buildReviewStagePrompt (stage-review.ts:108), donc seulement par le runner pipeline et Full Auto (stages.ts:314, engine.ts:364). Les routes appellent pourtant resolvePriorFindingsFromProse (epic :335, story :331), qui ne peut matcher que si le reviewer a récupéré les ids via l'outil MCP get_ticket et deviné le format « [RC:id] FIXED » que seul le prompt pipeline enseigne. Conséquence : une review manuelle repart cycle-blind (nouveaux Majors à chaque cycle, boucle documentée à stage-prompt.ts:99-112) et les findings ouverts ne se résolvent en pratique que par le merge. La section de vérification déterministe manque elle aussi, mais parce que les routes manuelles ne produisent aucun rapport de vérification (mécanisme confiné à lib/pipeline).

Les quatre chemins de review manuelle (bouton Review de l'overlay ticket et page story via useAgentDispatch, review par lot du desk, passe /qa) dispatchent via assembleEpicReviewPrompt/assembleStoryReviewPrompt (lib/tokens/dispatch-prompt.ts), qui n'incluent jamais la section « Findings Still Open From Previous Reviews » (buildPriorFindingsSection, câblée seulement dans lib/pipeline/stage-review.ts:108 pour le pipeline/auto-mode). Une review manuelle relancée après corrections est donc cycle-blind — la boucle documentée à stage-prompt.ts:93-108 et corrigée par 5e3714e0 pour le pipeline seul. Les appels resolvePriorFindingsFromProse dans les deux routes (:335, :331) parsent des tokens [RC:id] que le prompt n'a jamais fournis ; ils ne sont pas strictement morts (get_ticket expose les ids et submit_findings.prior_findings accepte tout id ouvert de l'epic), mais rien n'invite le reviewer à s'en servir puisque l'instruction MCP est conditionnée à la présence de la section. En revanche, l'absence de buildDeterministicVerificationReviewSection n'est pas un demi-câblage : elle dépend d'un VerificationReport que seul le runner déterministe du pipeline produit ; une review manuelle n'en a pas.

**Recommandation**

Faire passer les routes review par buildReviewStagePrompt (ou ajouter buildPriorFindingsSection + la section de vérification à assembleEpicReviewPrompt/assembleStoryReviewPrompt), avec le cycle calculé depuis le nombre de reviews complétées ; sinon retirer l'appel resolvePriorFindingsFromProse des routes.

<details><summary>Preuve relevée par l'auditeur</summary>

grep -rln 'buildPriorFindingsSection|readOpenReviewComments' app lib → uniquement lib/pipeline/* (+ commentaire merge-approval). awk sur assembleEpicReviewPrompt dans dispatch-prompt.ts : aucune occurrence de reviewComments / RC: / verification. Les routes importent resolvePriorFindingsFromProse (review/route.ts:56) et l'appellent sur la sortie.

</details>

### #223 — Le bloc « Code Review Feedback » du prompt de build existe en deux copies : celle du build manuel est sans plafond, celle du pipeline est plafonnée (80 findings / 1 200 caractères)

**Nature** doublon · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/pipeline/stage-prompt.ts:36-92`
- `lib/tokens/dispatch-prompt.ts:120-141`
- `lib/tokens/dispatch-prompt.ts:238-245`

**Constat**

stage-prompt.ts:64-92 (buildReviewFeedbackSection) plafonne la liste (FINDINGS_LIST_MAX=80, FINDING_BODY_MAX_CHARS=1 200) et documente ce plafond comme réponse au prompt de 4,9 Mo mesuré le 2026-08-26. lib/tokens/dispatch-prompt.ts:120-141 (buildReviewFeedback, privé) est la même fonction sans aucun cap et sert assembleEpicBuildPrompt (:238), c'est-à-dire la route build epic manuelle, start_build des board tools et le retry. Le commentaire de stage-prompt.ts:60-62 décrit la copie du pipeline comme « byte-pattern of the epic build route's block », ce qui n'est plus vrai.

**Précision du vérificateur**

Le bloc « Code Review Feedback » existe bien en deux implémentations : `lib/pipeline/stage-prompt.ts:64-92` (`buildReviewFeedbackSection`, exportée, plafonnée à 80 findings / 1 200 caractères par corps, consommée uniquement par `lib/pipeline/stage-code.ts:107`) et `lib/tokens/dispatch-prompt.ts:120-141` (`buildReviewFeedback`, privée, sans aucun plafond), cette dernière servant `assembleEpicBuildPrompt` (:238) donc la route build manuelle `/api/projects/[projectId]/epics/[epicId]/build` et tous ses appelants (start_build de board-tools, retry-dispatch, CI autofix, inbox, NowDesk, QaScreen, DraftedEpicCard, BugCreateDialog, useAgentDispatch) ainsi que `prompt-estimate`. Aucun plafond en aval : `route.ts:206` passe `assembled.prompt` tel quel. Deux précisions : le commentaire `stage-prompt.ts:60-62` (« byte-pattern of the epic build route's block ») reste exact tant que les caps ne mordent pas — la version plafonnée diverge seulement au-delà, en ajoutant `_[N older open finding(s) omitted …]_` et le marqueur de troncature ; et la recommandation d'un module « client-safe » est infondée — les deux modules importent `@/lib/db` et sont strictement serveur, il suffit que `dispatch-prompt.ts` importe la version plafonnée.

**Recommandation**

Exporter buildReviewFeedbackSection depuis un module client-safe (lib/review/…) et le faire consommer par dispatch-prompt.ts ; supprimer buildReviewFeedback.

<details><summary>Preuve relevée par l'auditeur</summary>

Les deux fonctions produisent l'en-tête identique '## Code Review Feedback\n\nThe following review comments were left on your previous changes. Address each one:' (grep -rn 'Code Review Feedback' → stage-prompt.ts:76, dispatch-prompt.ts:131) ; seule stage-prompt.ts appelle capOpenFindings/findingBodyLine.

</details>

### #226 — Vérification déterministe : un seul exécuteur (lib/verify/runner.ts) mais deux pilotes d'applicabilité divergents (stage-verification.ts vs POST verify), et une collision de nom avec lib/pipeline/verify.ts (gate de régression bug)

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/pipeline/stage-verification.ts:20-134`
- `app/api/projects/[projectId]/epics/[epicId]/verify/route.ts:79-108`
- `app/api/projects/[projectId]/epics/[epicId]/verify/route.ts:135-225`
- `lib/auto-mode/engine.ts:432-441`
- `lib/auto-mode/engine.ts:815-960`
- `lib/verify/runner.ts:1-60`
- `lib/pipeline/verify.ts:1-60`
- `lib/pipeline/stage-code.ts:139-160`

**Constat**

Réponse à (e). Il n'y a pas trois implémentations de l'exécution : runVerification (lib/verify/runner.ts) est l'unique spawn/persistance, et verifyDeliveredCode (engine.ts:815) réutilise runPipelineVerification via un createPipelineStageDriver construit pour ce seul appel (engine.ts:432-441). La duplication est au niveau du pilote : stage-verification.ts:20-134 (config, worktree du DERNIER code session, assertManagedEpicWorktreePath, existsSync, lock, règle « non persisté = skip », emitTicketUpdated) et verify/route.ts:135-225 qui réécrit la même séquence avec des règles différentes — findExistingWorktree (:79-108) prend le worktree de la session la plus récente de n'importe quel type, teste isManagedEpicWorktreePath au lieu d'asserter, et un rapport non persisté est journalisé mais renvoyé comme succès (:194-206) là où le pipeline le traite en skip (:120-125). Par ailleurs lib/pipeline/verify.ts (createVerifyGate, régression rouge→vert pour les bugs) et lib/verify/* (commandes de vérification) portent le même nom, avec deux champs `verifyFailure` / `verificationFailure` sur PipelineStageRequest (stage-code.ts:139-160).

**Précision du vérificateur**

Identique au finding, avec une précision : le pattern « driver complet construit pour le seul appel `runDeterministicVerification` » apparaît à DEUX endroits, pas un — `lib/auto-mode/engine.ts:432-443` et `lib/auto-mode/merge.ts:354-361` (plus le ré-export `lib/pipeline/index.ts:249`). La recommandation d'exposer `runDeterministicVerification` sans driver complet vaut donc pour les deux appelants. Précision aussi sur la divergence de verdict : route `:197-223`, le non-persisté n'altère que le libellé de `logTransition` et la réponse reste un 200 `{ data: report }`, alors que `stage-verification.ts:121-123` en fait un skip tracé.

**Recommandation**

Extraire de stage-verification.ts un `planEpicVerification(projectId, epicId, {codeSessionId?})` réutilisé par la route POST ; exposer runDeterministicVerification sans passer par un driver complet ; renommer lib/pipeline/verify.ts en regression-gate.ts et unifier verifyFailure/verificationFailure en un discriminant.

<details><summary>Preuve relevée par l'auditeur</summary>

grep runVerification|withVerificationWorktreeLock|emitTicketUpdated dans verify/route.ts → :183,:218 ; route :79-108 sélectionne `agentSessions.worktreePath` par createdAt desc sans filtre agentType ; stage-verification.ts:52-62 filtre sur lastCodeSessionId. engine.ts:432-441 : `createPipelineStageDriver({...}).runDeterministicVerification(sessionId)`. lib/pipeline/verify.ts:44-56 « verify gate for bug tickets (RoboBun rule) ».

</details>

### #97 — GET /grading renvoie 500 pour un rapport mal formé, à rebours du contrat « must render as ungraded », et submit_grading est ouvert à toute session non-chat

**Nature** cassé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/epics/[epicId]/grading/route.ts:32-40`
- `lib/grading/report.ts:1-7`
- `hooks/useEpicDetail.ts:87`
- `app/api/mcp/submit-grading/route.ts:42-51`
- `lib/claude/mcp-injection.ts`

**Constat**

lib/grading/report.ts:1-7 pose le contrat : une ligne corrompue « must render as ungraded and must never green-light ». La route GET :34-38 répond pourtant `{ error: "Latest grading report is malformed" }` en 500 ; le client s'en sort seulement parce que useEpicDetail:87 teste `gradingRes.ok`, mais chaque ouverture d'overlay sur un tel ticket produit une erreur serveur, et la liste d'epics traite la même ligne en `null` (parseGradingEntries → aggregate null). Par ailleurs app/api/mcp/submit-grading/route.ts:42 ne refuse que `agentType === "chat"` : une session build/ticket_build/review peut déposer un rapport de grading sur son propre epic, qui devient le « latest » affiché par le Stamp — l'évaluateur n'est pas indépendant du producteur.

**Précision du vérificateur**

GET /api/projects/:p/epics/:e/grading répond un 500 construit (route.ts:33-39, sans exception ni log) pour une ligne gradingReports mal formée, alors que lib/grading/report.ts:4-6 demande un rendu « ungraded » et que la liste epics (route.ts:406-408) agrège la même ligne en null ; le client (useEpicDetail.ts:87) neutralise le 500 en null, donc l'affichage reste conforme mais chaque ouverture/poll de l'overlay de ce ticket encaisse un 500. Par ailleurs app/api/mcp/submit-grading/route.ts:42 ne refuse que agentType === "chat" : une session build/ticket_build/review (offerte de submit_grading par allowedToolNamesForAgentType) peut déposer un rapport sur son propre epic, qui devient le « latest » du Stamp et du gradingStatus de liste — ouverture figée par __tests__/mcp-routes.test.ts:1565-1613 (token « developer » → 200). Le pipeline autonome, lui, n'est pas affecté : stage-grading.ts:84-93 relit le rapport par agentSessionId du grader.

GET /projects/:p/epics/:e/grading (route.ts:33-38) répond 500 « Latest grading report is malformed » pour une ligne gradingReports corrompue/legacy, alors que lib/grading/report.ts:4-6 demande un rendu « ungraded » ; le seul consommateur, hooks/useEpicDetail.ts:73/87, avale le 500 en null (Stamp correct, mais une erreur serveur à chaque ouverture d'overlay et à chaque poll 5 s), et la liste d'epics (epics/route.ts:406-407) traite la même ligne en null sans erreur. Une telle ligne ne peut naître que par corruption manuelle/legacy (submit_grading valide via zod strict). Par ailleurs app/api/mcp/submit-grading/route.ts:42 ne refuse que agentType === "chat" ; mcp-injection.ts:82 offre submit_grading à tous les types d'agent (aucune entrée withheld/exclusive), et __tests__/mcp-routes.test.ts:1565+ codifie un dépôt réussi par un token "developer". Un rapport déposé par une session build/review devient le « latest » du Stamp (GET :24-30) et du gradingStatus de liste (epics/route.ts:180-204). En revanche le pipeline lit le rapport par reportId+agentSessionId du grader (lib/pipeline/stage-grading.ts:83-96) : aucun green-light autonome possible, l'impact est purement d'affichage.

**Recommandation**

GET : renvoyer `{ data: null }` (200) et logger, comme la liste. submit_grading : exiger `auth.agentType === GRADING_AGENT_TYPE` (une ligne, même motif que la garde chat).

<details><summary>Preuve relevée par l'auditeur</summary>

grading/route.ts:36 `{ error: "Latest grading report is malformed" }, { status: 500 }`. submit-grading :42 `if (auth.agentType === "chat")` est la seule garde de type ; GRADING_AGENT_TYPE = "grading" (dispatch.ts:35) n'est jamais comparé.

</details>

### #102 — La route verify et lib/verify/freshness parsent le même rapport deux fois et ne choisissent pas le « dernier » rapport avec le même ordre

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/projects/[projectId]/epics/[epicId]/verify/route.ts:44-72`
- `app/api/projects/[projectId]/epics/[epicId]/verify/route.ts:118-131`
- `lib/verify/freshness.ts:47-70`
- `lib/verify/freshness.ts:104-115`

**Constat**

verify/route.ts:44-72 (parseCommandResults + toResponseReport) et freshness.ts:47-70 (parseReport) sont la même fonction — même garde all-or-nothing, même mapping, même commentaire — dupliquée. Surtout, la route GET choisit le rapport affiché par `orderBy(desc(verifyReports.finishedAt), desc(id))` (tri lexical sur le texte, :128) alors que la gate de merge (freshness :113) trie par `julianday(finishedAt)`. Le doc de rationalisation dit avoir ramené les comparaisons de dates à des instants ; ici une ligne restée en format SQLite (`YYYY-MM-DD HH:MM:SS`) contre des lignes ISO (`…T…Z`) se classe différemment selon le chemin, et la bande VERIFICATION de l'overlay peut afficher un autre rapport que celui sur lequel Full Auto décide.

**Précision du vérificateur**

Duplication confirmée, divergence d'ordre non atteignable avec les données réelles. Vrai : `parseCommandResults` + `toResponseReport` (app/api/projects/[projectId]/epics/[epicId]/verify/route.ts:44-72) et `parseReport` (lib/verify/freshness.ts:47-70) sont la même fonction (même garde all-or-nothing, mêmes 6 champs, même `status: row.status === "pass" ? "pass" : "fail"`, commentaires jumeaux qui se citent mutuellement « matching the manual route »), et les deux requêtes « dernier rapport » trient différemment : route:128 `desc(verifyReports.finishedAt)` (tri texte) vs freshness:113 `desc(sql\`julianday(finished_at)\`)`. Faux/à retirer : la conséquence annoncée (l'overlay afficherait un autre rapport que celui sur lequel Full Auto décide). `verify_reports` n'a qu'un seul écrivain, lib/verify/runner.ts:242 et :255 (`new Date().toISOString()`), la table n'a aucun DEFAULT CURRENT_TIMESTAMP (lib/db/migrations/0040_verify_reports.sql:11-23) et aucun autre code n'insère dans cette table (grep `insert(verifyReports)` : runner.ts + tests seulement). Toutes les lignes sont donc en ISO `…T…Z`, format pour lequel l'ordre lexical et l'ordre julianday coïncident, avec le même tie-break `desc(id)`. Le finding se réduit à : (1) duplication du parseur à factoriser, (2) deux ordres de tri à unifier par principe (le lexical divergerait seulement si un jour un rapport était écrit au format SQLite « YYYY-MM-DD HH:MM:SS », ce que rien ne fait aujourd'hui). Recommandation d'exporter `parseVerifyReportRow` / `latestVerifyReport` depuis lib/verify/freshness.ts : valable, mais c'est du nettoyage, pas un bug utilisateur.

**Recommandation**

Exporter `parseVerifyReportRow` et `latestVerifyReport(projectId, epicId)` depuis lib/verify/freshness.ts et les utiliser dans la route GET.

<details><summary>Preuve relevée par l'auditeur</summary>

verify/route.ts:128 `.orderBy(desc(verifyReports.finishedAt), desc(verifyReports.id))` ; freshness.ts:113 `.orderBy(desc(sql\`julianday(${verifyReports.finishedAt})\`), desc(verifyReports.id))`. Les deux parseurs : mêmes 6 champs + `status: row.status === "pass" ? "pass" : "fail"`.

</details>

### #103 — Les prompts QA sauvegardés ne peuvent être ni modifiés ni supprimés

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** qa-verify-review

**Fichiers**
- `app/api/qa/prompts/route.ts`
- `components/qa/StartQaCheckDialog.tsx:113-160`

**Constat**

app/api/qa contient seulement findings/ et prompts/ ; prompts/route.ts n'expose que GET (liste) et POST (création). Aucune route `[id]`, aucun PATCH/DELETE, aucun écran de réglages ne consomme qaPrompts : les seuls appelants sont StartQaCheckDialog.tsx:115 (liste) et :154 (création). Chaque « Save as preset » dans le dialogue ajoute donc une ligne définitive à qa_prompts.

**Précision du vérificateur**

Les prompts QA sauvegardés depuis StartQaCheckDialog (« Save Prompt », components/qa/StartQaCheckDialog.tsx:137 pour le POST, :112 pour le GET ; 154/115 sur HEAD) ne peuvent être ni modifiés ni supprimés : app/api/qa/prompts/route.ts n'expose que GET et POST, aucun autre consommateur de qaPrompts n'existe (app/, components/, hooks/, lib/, bin/), et l'index unique qa_prompts_name_unique (lib/db/schema.ts:819) rend impossible l'écrasement d'un nom existant (POST → 400). La route PATCH/DELETE [promptId] a existé et a été retirée sciemment comme code mort par f0242187 (plan de nettoyage du 14/08, ligne 125) — le finding réel est le bouton « Save Prompt » laissé sans aucune gestion, pas une route oubliée.

Les prompts QA sauvegardés ne peuvent être ni modifiés ni supprimés : app/api/qa/prompts/route.ts n'expose que GET et POST ; la route PATCH/DELETE `[promptId]` qui existait (commit 11487ffe) a été retirée volontairement par f0242187 (docs/plans/2026-08-14-cleanup-refactor-plan.md:125, « aucune UI d'édition/suppression ») sans qu'une UI soit jamais ajoutée. Seul consommateur : components/qa/StartQaCheckDialog.tsx — lecture via usePolledResource l.111-112, création via POST l.137 (handleSavePrompt l.131-149) ; le sélecteur « Saved Prompt » (l.310-325) n'a aucun contrôle de suppression/renommage, et aucun écran de réglages, outil MCP ou routine ne touche qaPrompts. L'index unique qa_prompts_name_unique (schema.ts:819) fait en plus échouer (400) toute re-sauvegarde sous un nom existant : chaque « Save Prompt » ajoute une ligne définitive et non remplaçable à qa_prompts.

**Recommandation**

Ajouter app/api/qa/prompts/[promptId]/route.ts (PATCH/DELETE) et un contrôle de suppression dans le sélecteur de preset du dialogue, ou retirer la sauvegarde si elle n'est pas voulue.

<details><summary>Preuve relevée par l'auditeur</summary>

`find app/api/qa -type f` → findings/route.ts, prompts/route.ts. rg 'api/qa/prompts|qaPrompts' app components hooks lib (hors route et schema) → StartQaCheckDialog.tsx:115 et :154 seulement.

</details>

### #225 — « Qu'est-ce qu'une review » est défini trois fois avec deux sémantiques : le garde review→to_merge du moteur compte une seconde opinion et des types *_reviewer que rien n'écrit

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/pipeline/findings.ts:243-266`
- `lib/workflow/context.ts:66-99`
- `lib/mcp/review-channel-failure.ts:52-66`
- `lib/workflow/engine.ts:163-191`
- `lib/workflow/review-freshness.ts:46-59`

**Constat**

ORDINARY_REVIEW_AGENT_TYPES (findings.ts:249-256) est la liste stricte des gates et exclut explicitement review_second_opinion. context.ts:76-86 et review-channel-failure.ts:57-66 recopient chacun une règle lâche `agentType.includes('review') || security_reviewer || code_reviewer || compliance_reviewer || feature_reviewer` ; ces quatre noms n'apparaissent nulle part ailleurs dans lib/app (aucun writer). Conséquence : buildTransitionContext.hasCompletedReview est vrai avec une seule session review_second_opinion complétée, ce qui satisfait le garde « Cannot move to To Merge: no completed review » (engine.ts:184-191) alors que findings.ts:249 documente pourquoi la seconde opinion n'est pas une review ; selectUnverifiableReviewSessionIds re-filtre ensuite sur la liste stricte, donc les deux listes se contredisent dans la même fonction. review-freshness.ts:56 dérive correctement sa liste de findings.ts — le modèle à suivre.

**Précision du vérificateur**

Trois définitions de « ce qui est une review » coexistent : la liste stricte ORDINARY_REVIEW_AGENT_TYPES (findings.ts:249) et deux copies lâches identiques (context.ts:80-86, review-channel-failure.ts:57-66). Les faits sont exacts : les quatre noms security_reviewer/code_reviewer/compliance_reviewer/feature_reviewer n'ont aucun writer en production (le vrai mapping, constants.ts:152-155, écrit review_security/review_code/…) — ils ne survivent que dans deux fixtures de test (__tests__/epic-lifecycle-status.test.ts:196-199 mocke REVIEW_TYPE_TO_AGENT_TYPE avec ces vieux noms, __tests__/mcp-routes.test.ts:187), donc les supprimer touchera ces tests. La conséquence est réelle et atteignable : « review_second_opinion » passe includes('review'), n'est pas retiré par selectUnverifiableReviewSessionIds (qui re-filtre sur la liste stricte), donc une seule seconde opinion complétée met hasCompletedReview à vrai et ouvre le garde review→to_merge (engine.ts:180-190) ; la seconde opinion se dispatche justement sur un epic en statut review (second-opinion.ts:409). Correction de cadrage : ce n'est pas une dérive silencieuse — l'écart « plancher lâche / gate stricte » est documenté comme délibéré dans les trois fichiers (findings.ts:245-248, review-freshness.ts:53-55, review-channel-failure.ts:52-56). Le nettoyage actionnable est donc : supprimer les quatre noms morts et nommer explicitement le prédicat du plancher (p. ex. isReviewFloorAgentType partagé), pas forcément unifier sur isOrdinaryReviewAgentType sans décider d'abord si la seconde opinion doit compter pour le plancher.

**Recommandation**

Exporter isOrdinaryReviewAgentType (déjà présent, findings.ts:262) comme unique prédicat, l'utiliser dans context.ts et review-channel-failure.ts, supprimer les noms legacy ; si la seconde opinion doit compter pour le floor guard, le dire dans une liste dédiée plutôt que par `includes`.

<details><summary>Preuve relevée par l'auditeur</summary>

grep -rn 'security_reviewer|code_reviewer|compliance_reviewer|feature_reviewer' lib app components bin → seulement context.ts:82-85 et review-channel-failure.ts:61-64. context.ts:81 `agentType.includes('review')` inclut 'review_second_opinion' (SECOND_OPINION_AGENT_TYPE, second-opinion.ts:39).

</details>

### #227 — L'étape forensic n'est atteignable que par le runner pipeline (build routes mono-ticket avec pipeline actif, night run) : Full Auto parque des tickets sans jamais demander de post-mortem

**Nature** à moitié câblé · **Impact** faible · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/pipeline/forensic.ts:214-330`
- `lib/pipeline/runner-retry.ts:63-110`
- `lib/pipeline/index.ts:296-311`
- `app/api/projects/[projectId]/epics/[epicId]/build/route.ts:449-490`
- `lib/night/run.ts:336`
- `lib/pipeline/constants.ts:107-116`
- `lib/auto-mode/engine.ts:700-760`

**Constat**

Réponse à (c). runForensic n'a qu'un appelant : options.runForensic dans runner-retry.ts:85, câblé par startPipelineRun (index.ts:302). startPipelineRun est appelé par les routes build epic/story (build/route.ts:478, stories/…/build/route.ts:337) quand `pipelineParam ?? resolvePipelineEnabled(projectId)` est vrai (défaut true, constants.ts:115) et par lib/night/run.ts:336. Full Auto (engine.ts) pilote les stages lui-même avec sa propre échelle de parking (recordFailure/parkingThreshold) et ne référence ni runForensic ni le runner : un ticket parqué après trois échecs n'a aucun diagnostic, alors que la même séquence en pipeline en produit un. La chaîne est donc vivante mais couvre seulement les dispatches humains et nocturnes.

**Précision du vérificateur**

runForensic n'a qu'un appelant vivant : options.runForensic dans runner-retry.ts:85, câblé par startPipelineRun (index.ts:302). Celui-ci n'est appelé que par les routes build epic/story (build/route.ts:478 sous `ciAutofix ? false : (pipelineParam ?? resolvePipelineEnabled)`, stories/…/build/route.ts:337 sous `pipelineParam ?? resolvePipelineEnabled`, défaut serveur ON dans index.ts:92-100 ; constants.ts:115 n'est que le miroir client) et par le night run (lib/night/run.ts:336). Full Auto (engine.ts) n'importe que createPipelineStageDriver, documente lui-même l.214-215 qu'il ne passe pas par le runner, et parque via recordFailure/parkingThreshold (l.725-746 et cinq autres sites) avec une simple trace AUTO_MODE_REASONS.parked, sans diagnostic. Le même trou existe pour d'autres dispatches non cités : la route batch app/api/projects/[projectId]/build/route.ts en modes non-night (aucun startPipelineRun), un build mono-ticket avec `pipeline:false` ou ciAutofix, et, dans le pipeline même, le plafond de sessions atteint (runner-retry.ts:77 `state.sessionIds.length < options.maxSessions`) ou le budget de fix cycles épuisé (runner-stage-review.ts:69-71, délibéré). Le post-mortem couvre donc les dispatches humains avec pipeline actif et le night run, pas la supervision permanente.

runForensic n'a qu'un appelant (options.runForensic, runner-retry.ts:85) câblé par startPipelineRun (index.ts:302), lui-même appelé uniquement par les routes build mono-ticket epic/story quand `pipelineParam ?? resolvePipelineEnabled(projectId)` est vrai (défaut ON) et par lib/night/run.ts:336. Ces routes sont atteintes par de nombreux chemins réels (NowDesk, inbox, QA, DraftedEpicCard, BugCreateDialog, useAgentDispatch, outil chat board-tools, retry-dispatch), donc la chaîne est vivante pour les dispatches humains et nocturnes. En revanche Full Auto (engine.ts, documenté l.214 comme ne passant pas par le runner) dispatche via createPipelineStageDriver().launchStage et parque après recordFailure/parkingThreshold (l.725-746, l.942-957) sans jamais appeler runForensic — alors que la session morte est connue. Même absence de post-mortem pour deux chemins non cités : les builds CI-autofix (lib/routines/ci-autofix.ts envoie `pipeline: false`, route l.450) et les batchs DAG/parallèles ordinaires de ProjectBatchToolbar (route batch sans `pipeline: true` → pas de startPipelineRun, le réglage pipeline_enabled y est ignoré par conception).

**Recommandation**

Soit appeler runForensic depuis reconcileInFlight quand `failures >= parkingThreshold` (la session morte est connue), soit documenter que le post-mortem est réservé au pipeline ; dans les deux cas, garder en tête que la piste `raw` lue par readChunkTail est vide pour claude-code (déjà signalé).

<details><summary>Preuve relevée par l'auditeur</summary>

grep -rn 'runForensic|forensic' lib app (hors lib/pipeline/forensic*) → index.ts:8,302 et runner-retry.ts:85 uniquement. grep -rn startPipelineRun → build routes ×2, night/run.ts. engine.ts:700-760 : recordFailure → parked, aucun appel forensic.

</details>

### #228 — Board tools : pas de réimplémentation des routes /api/mcp, mais une chaîne d'appels HTTP en boucle locale, un contournement de post-comment justifié par une raison périmée, et une parité fast-mode / CLI-chat qui n'est vraie que pour 5 outils sur 8

**Nature** refacto · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `lib/chat/board-tools.ts:280-320`
- `lib/chat/board-tools.ts:407-430`
- `lib/chat/board-tools.ts:490-540`
- `lib/chat/board-tools.ts:566-582`
- `lib/mcp/board-tool-route.ts:93-140`
- `app/api/mcp/post-comment/route.ts:38-56`
- `bin/arij-mcp.mjs:685-710`

**Constat**

Réponse à (d). lib/chat/board-tools.ts est l'implémentation unique ; list-tickets, create-ticket, update-ticket, get-agent-status, start-build sont des wrappers createBoardToolRouteHandler (board-tool-route.ts) qui appellent l'exécuteur, lequel refait un fetch loopback vers les routes canoniques (/api/projects/:id/epics — la liste complète avec ses champs non lus signalés par ailleurs —, /epics/:id, /build, /sessions/active) en portant le credential interne. get_ticket et update_ticket_status en fast mode font un fetch vers /api/mcp/get-ticket et /api/mcp/update-ticket-status avec le token minté (board-tools.ts:407-430, 490-508) ; en CLI chat, le shim appelle ces mêmes routes directement — deux profondeurs d'appel pour le même outil. post_comment : le fast mode évite /api/mcp/post-comment au motif que « the chat turn's minted session has no agent_sessions row to satisfy the FK » (board-tools.ts:515-520) alors que la route gère déjà ce cas (post-comment/route.ts:40-45, agentSessionId null) ; le CLI chat, lui, passe par /api/mcp/post-comment. Le commentaire « parity by construction » (board-tools.ts:566-570) ne couvre donc pas post_comment / get_ticket / update_ticket_status.

**Précision du vérificateur**

lib/chat/board-tools.ts est bien l'implémentation unique : 5 des 8 outils (list_tickets, create_ticket, update_ticket, get_agent_status, start_build) sont exposés au CLI chat par des wrappers createBoardToolRouteHandler (lib/mcp/board-tool-route.ts:101-145) qui rappellent l'exécuteur, lequel refait un fetch loopback vers les routes canoniques (board-tools.ts:282, credential interne). get_ticket (:407-420) et update_ticket_status (:490-503) ne passent pas par ce mécanisme mais frappent /api/mcp/get-ticket et /api/mcp/update-ticket-status — les mêmes routes que le shim (bin/arij-mcp.mjs:871-874) : la parité de comportement tient, seule la profondeur d'appel diffère. Seul post_comment emprunte deux chemins distincts (fast mode → /api/projects/:id/epics/:id/comments ; CLI → /api/mcp/post-comment), et sa justification en commentaire (board-tools.ts:511-520, « no agent_sessions row to satisfy the FK ») est fausse : la route MCP gère déjà le cas (post-comment/route.ts:40-48, `sessionRow?.id ?? null`), et les deux routes sont de toute façon équivalentes (validation des mentions sautée pour author=agent, agentSessionId null). Correctif : cette contradiction n'est pas « périmée » — elle date du même commit (c2c31872) que le code qu'elle décrit. Le commentaire « parity by construction » est ligne 607, pas 566-570. Portée réelle : dette de documentation et détour HTTP redondant, sans divergence de comportement démontrée.

**Recommandation**

Faire passer postComment par /api/mcp/post-comment (même chemin que le CLI) et corriger le commentaire ; à terme, appeler les fonctions de lib directement au lieu de refaire un tour HTTP par outil (list_tickets pourrait lire lib/tickets-registry plutôt que la route epics).

<details><summary>Preuve relevée par l'auditeur</summary>

grep -rn board-tools app lib bin → seuls list-tickets/create-ticket importent des constantes, board-tool-route.ts importe CHAT_BOARD_TOOL_EXECUTORS ; board-tools.ts apiFetch(:293) `fetch(`${ctx.baseUrl}${path}`)` avec internalApiCredentialHeaders ; post-comment/route.ts:44-48 `sessionRow?.id ?? null`.

</details>

### #229 — Le SQL des préfixes de sévérité et l'enum de verdict sont recopiés hors des modules qui se déclarent source unique

**Nature** doublon · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:findings-verdict-parsing

**Fichiers**
- `app/api/qa/findings/route.ts:92-110`
- `lib/workflow/blocking-findings.ts:70-88`
- `lib/qa/aggregate.ts:488-494`
- `lib/auto-mode/second-opinion.ts:47-51`
- `lib/review/verdict.ts:12-37`
- `lib/review/finding-severity.ts:22-33`

**Constat**

lib/review/finding-severity.ts et lib/review/verdict.ts se présentent comme le vocabulaire partagé. Pourtant app/api/qa/findings/route.ts:104-109 (blockingPrefixSql) est une copie mot pour mot de bodyStartsWithAnySql (blocking-findings.ts:81-88, `SUBSTR(COALESCE(body,''),1,n) = prefix` OR-é) ; lib/qa/aggregate.ts:490-493 teste `reviewVerdict === 'approved' || 'approved_with_minor_issues' || 'changes_requested'` au lieu d'isStructuredReviewVerdict ; second-opinion.ts:47-51 déclare un troisième type GateVerdict (« approved with minor issues » avec espaces) parallèle à StructuredReviewVerdict.

**Précision du vérificateur**

Deux duplications réelles, la troisième est à écarter. (a) `app/api/qa/findings/route.ts:104-110` recopie la *tournure SQL* de `bodyStartsWithAnySql` (`lib/workflow/blocking-findings.ts:81-89`), fonction non exportée ; la route importe déjà la source unique du vocabulaire (`BLOCKING_FINDING_PREFIXES`, ligne 19), donc seule la construction du fragment est dupliquée, et le commentaire 92-103 en documente le motif. (b) `lib/qa/aggregate.ts:489-493` réinvente `isStructuredReviewVerdict` (`lib/review/verdict.ts:30-36`) alors que le module est client-safe et déjà voisin d'un import de `lib/review/finding-severity` — correction directe. (c) `GateVerdict` (`lib/auto-mode/second-opinion.ts:48-51`) n'est PAS un doublon de `StructuredReviewVerdict` : ses valeurs à espaces sont les captures lowercasées des regex markdown lues dans `ticket_comments`, un format de fil distinct des valeurs snake_case de `agent_sessions.review_verdict` ; le dériver demanderait une table de correspondance, pas une déduplication.

**Recommandation**

Exporter bodyStartsWithAnySql depuis blocking-findings.ts (ou finding-severity-sql.ts) et l'importer dans la route QA ; utiliser isStructuredReviewVerdict dans deriveVerdicts ; dériver GateVerdict de StructuredReviewVerdict.

<details><summary>Preuve relevée par l'auditeur</summary>

Comparaison des deux fonctions SQL : même map sur les préfixes, même reduce OR ; qa/findings/route.ts:98-102 justifie la copie par « stamp-weight, not merge question » mais le fragment est identique. grep isStructuredReviewVerdict lib app → findings.ts seulement.

</details>

