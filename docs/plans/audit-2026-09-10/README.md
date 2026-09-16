# Plan de rationalisation — audit du 10 septembre 2026

Source : audit en lecture seule de l'arbre de travail (main `45e96387` + rationalisation UI non commitée), 239 findings soumis à réfutation adversariale, 234 confirmés, 1 contesté, 4 réfutés (exclus). Rapport complet avec fiches et filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c

## Décisions déjà prises (11/09)

- **Notifications** : retrait complet (lot 01).
- **Agents de review personnalisés** : retrait complet (lot 02).
- **Preuves visuelles** (attach_artifact) : on rétablit la galerie et le réglage (lot 03).
- **Frictions** : à trancher (lot 25).
- **Distribution npm** `npx arij` : à trancher (lot 20).

## Exécution (11/09/2026)

Faits dans l'ordre conseillé, lots **23 → 04 → 01 → 02**, sur l'arbre de travail
au-dessus de `45e96387` (+ la rationalisation UI non commitée). Détail par lot en
tête de chaque fichier ; ce qui suit est le bilan transverse.

**Migrations ajoutées** (écrites à la main, entrée `_journal.json` à la main) :

- `0059_drop_custom_review_agents.sql` — retire la table du lot 02.
- `0060_drop_notifications.sql` — retire `notifications` et
  `notification_read_cursor` (lot 01).

**Effets de bord hors périmètre des lots**, à connaître pour la suite :

- `components/notifications/` devient `components/toast/` et le namespace i18n
  `Notifications` devient `Toast` (le lot 01 demandait de renommer le
  ToastStack pour qu'il ne se confonde plus avec la table supprimée).
- `lib/workflow/system-comment.ts` (`postTicketSystemComment`,
  `postUnresolvedMentionsComment`) est le nouveau point de dépôt des signaux
  projet qui avaient un ticket : échec CI watch, autofix prêt, mentions non
  résolues.
- `lib/agent-sessions/session-outcome-webhook.ts` porte désormais le seul
  `session.completed` / `session.failed` sortant ; il est appelé par le hook
  terminal d'`instrumentation.ts`, plus par `lib/events/emit.ts`.
- `lib/utils/timestamps.ts` et `lib/agent-sessions/active-activity.ts` sont les
  deux modules partagés nés du lot 23 ; `lib/agent-sessions/last-activity.ts`
  et `lib/types/agent-session.ts` disparaissent.
- Deux conventions de test nouvelles, mécaniques :
  `__tests__/route-not-found-helper-convention.test.ts` (plus de 404
  `"Project not found"` recopié) et les entrées `EXERCISED` ajoutées à
  `git-github-route-status-convention.test.ts` pour `pr/sync` et
  `publish`.

**Points où la recommandation du lot n'a pas été suivie à la lettre** :

- Lots 01/04 : les routes d'artefacts (`epics/[epicId]/artifacts`,
  `artifacts/[artifactId]`, `lib/agent-sessions/artifact-view.ts`) restent en
  place — le lot 03 les rétablit.
- Lot 04 : `mcpServerSecrets`, `countAgentReviewCommentsSince`,
  `readReviewChannelState`, `isNegativeProseVerdict` et
  `NEGATIVE_VERDICT_SUBSTRINGS` sont conservés : ce sont les coutures de test de
  contrats de sécurité et de parsing, sans coût de bundle.
- Lot 04 : `ProviderType` / `AgentProvider` ne sont pas fusionnés —
  `AgentProvider` nomme aussi l'interface du contrat provider, un alias
  changerait le sens de l'import de `lib/providers/index.ts`. Seuls les
  commentaires périmés (Gemini, « resume support (Claude/Gemini only) », pi
  sélectionnable) sont corrigés.
- Lot 23 : `RefinementStatus` vivait déjà dans `lib/refinement/types.ts` ;
  seul l'import du composant depuis `app/api` était à corriger, fait.
- Lot 04 : les champs `breakerThreshold` / `costCapUsd` restent sur
  `NightRunSnapshot` (le registre) ; ils disparaissent du **détail servi**
  (`NightRunDetail`), qui est ce que personne ne lisait.

**État des vérifications** : `npm run i18n:check` (2 256 clés, 0 orpheline),
`tsc` propre sur les fichiers touchés, `npm run lint` sans erreur, suite
complète **9 044 passés / 38 échoués sur 7 fichiers**, tous dans les surfaces
qu'un autre lot réécrit en ce moment (`claude-code-live-stream`,
`composite-persistent-chat`, `omp-user-config-not-displaced`,
`persistent-chat-runner` et leurs voisins) — aucun n'est couvert par les lots
23, 04, 01, 02 ou 19.

**Lot 19 — suite de tests, fait le 11/09/2026** : traité après les quatre lots de
rationalisation, comme l'ordre conseillé l'indique (consolider des tests que
d'autres lots suppriment serait du travail perdu). 9 des 12 findings sont faits,
3 sont différés avec raison — le détail est en tête de
`lot-19-suite-de-tests.md`.

Sept harnais neufs dans `__tests__/helpers/` : `background.ts` (l'attente
d'effet observable, qui remplace 114 `flushBackground()`), `provider-fixtures.ts`
(une seule `claudeEnvelope`), `fake-child.ts` (l'union des 7 fausses
ChildProcess), `event-source-mock.ts`, `next-navigation-mock.ts`,
`migration.ts`, `temp-git-repo.ts`. Plus `liveDbModule` ajouté à
`db-mock.ts`, consommé par 24 fichiers.

Deux changements de code produit accompagnent le lot, parce que le test ne
pouvait pas attendre ce que le produit ne rendait pas : `settled` est exposé par
les quatre dispatchs et les trois déclencheurs qui ne l'avaient pas (il résout
après le hook terminal, ne rejette jamais), et
`__tests__/vi-mock-specifiers-resolve.test.ts` fait échouer la suite dès qu'un
`vi.mock("@/…")` ne résout sur aucun fichier — vitest ignore un tel mock en
silence, donc la garde que son auteur croyait avoir posée n'existait pas. Ce
gardien a attrapé un troisième cas dès son ajout.

**Lots 08 → 09 → 06 → 15 également réalisés le 11/09/2026** : tickets côté
serveur et client, dispatch unifié des sessions, Full Auto, night runs, batch et
routines. Les tests ciblés et le contrôle i18n passent ; la suite globale et le
build restent non validés sur l'arbre partagé. Voir le
[compte rendu des changements et vérifications](implementation-lots-06-08-09-15.md).

**Lots 21 → 22 → 18 → 20 → 24 réalisés le 16/09/2026** : usage et base de
données, i18n libellés serveur, réglages et cohérence UI partagée, app shell /
docs / CI, configuration d'agents et workshop. Zéro erreur de clés i18n, suites
de tests ciblées et réglages 100 % vertes (658 tests passés, 0 échec). Voir le
[compte rendu des changements et vérifications](implementation-lots-18-20-21-22-24.md).

**Lots 12 → 13 → 16 réalisés le 16/09/2026** : parcours projets et Git,
protections et composition des prompts, verdicts et findings communs, dismissal
QA et vérification déterministe. Les validations ciblées et les limites des
contrôles globaux sont détaillées dans le
[compte rendu des changements et vérifications](implementation-lots-12-13-16.md).

## Les lots

| Lot | Titre | Difficulté | Findings | Impact | Effort | Statut |
|---|---|---|---|---|---|---|
| [01](lot-01-retrait-notifications.md) | Retrait complet du sous-système notifications | 2/4 | 5 | 2 fort · 0 moyen · 3 faible | 2 S · 2 M · 1 L | fait le 11/09 |
| [02](lot-02-retrait-agents-review-personnalises.md) | Retrait des agents de review personnalisés | 1/4 | 1 | 1 fort · 0 moyen · 0 faible | 0 S · 0 M · 1 L | fait le 11/09 |
| [03](lot-03-retablir-preuves-visuelles.md) | Rétablir les preuves visuelles (galerie + réglage) | 2/4 | 2 | 1 fort · 0 moyen · 1 faible | 1 S · 1 M · 0 L | branche `feature/lots-03-05-10` (16/09) |
| [04](lot-04-code-mort-mecanique.md) | Code mort mécanique : fichiers, exports, routes, tokens, restes du board | 1/4 | 26 | 0 fort · 0 moyen · 26 faible | 26 S · 0 M · 0 L | fait le 11/09 |
| [05](lot-05-parcours-perdus-overlay.md) | Parcours perdus dans l'overlay ticket et le desk | 2/4 | 9 | 1 fort · 4 moyen · 4 faible | 7 S · 2 M · 0 L | en cours, branche `feature/lots-03-05-10` |
| [06](lot-06-dispatch-unifie-sessions.md) | Un seul chemin de lancement de session (build, review, merge, pull, create-epics) | 4/4 | 8 | 4 fort · 4 moyen · 0 faible | 2 S · 4 M · 2 L | fait le 11/09 |
| [07](lot-07-stockage-sessions-live-log.md) | Stockage des sessions, rétention, LIVE LOG | 4/4 | 15 | 5 fort · 7 moyen · 3 faible | 5 S · 10 M · 0 L | branche `feature/lot-07-sessions-lecture` (11/09) |
| [08](lot-08-tickets-serveur-read-model.md) | Tickets côté serveur : projection de GET /epics, GET unitaire, read-model partagé | 3/4 | 10 | 3 fort · 6 moyen · 1 faible | 3 S · 7 M · 0 L | fait le 11/09 |
| [09](lot-09-tickets-client-polling.md) | Tickets côté client : polling, rafraîchissements, helpers partagés | 2/4 | 11 | 0 fort · 7 moyen · 4 faible | 2 S · 9 M · 0 L | fait le 11/09 |
| [10](lot-10-chat.md) | Chat : une seule interface, un seul runner de tour | 4/4 | 14 | 1 fort · 6 moyen · 7 faible | 10 S · 2 M · 2 L | branche `feature/lots-03-05-10` (16/09) |
| [11](lot-11-spec-memoire-releases.md) | Spec, mémoire (dreaming/distill) et releases | 3/4 | 16 | 4 fort · 7 moyen · 5 faible | 12 S · 4 M · 0 L | branche `feature/lot-07-sessions-lecture` (11/09) |
| [12](lot-12-git-github-projets.md) | Git, GitHub, import et suppression de projet | 2/4 | 9 | 1 fort · 5 moyen · 3 faible | 6 S · 3 M · 0 L | fait le 16/09 |
| [13](lot-13-prompts-securite-coherence.md) | Couche prompts : neutralisation, doublons, cohérence des règles | 2/4 | 11 | 1 fort · 7 moyen · 3 faible | 8 S · 3 M · 0 L | fait le 16/09 |
| [14](lot-14-providers-spawn.md) | Providers : sandbox codex, signaux de processus, fuite mémoire | 3/4 | 6 | 2 fort · 4 moyen · 0 faible | 3 S · 3 M · 0 L | branche `feature/lot-07-sessions-lecture` (11/09) |
| [15](lot-15-auto-mode-night-batch-routines.md) | Full Auto, night runs, batch DAG, routines | 3/4 | 10 | 0 fort · 6 moyen · 4 faible | 8 S · 2 M · 0 L | fait le 11/09 |
| [16](lot-16-review-qa-findings-verdicts.md) | Review, QA, findings et verdicts | 3/4 | 17 | 2 fort · 8 moyen · 7 faible | 11 S · 6 M · 0 L | fait le 16/09 |
| [17](lot-17-ilots-pre-piscine.md) | Portage Piscine des îlots restants | 3/4 | 11 | 0 fort · 7 moyen · 4 faible | 3 S · 3 M · 5 L | à faire |
| [18](lot-18-reglages-coherence-ui.md) | Réglages et cohérence de l'UI partagée | 1/4 | 6 | 0 fort · 3 moyen · 3 faible | 3 S · 3 M · 0 L | fait le 16/09 |
| [19](lot-19-suite-de-tests.md) | Suite de tests : harnais partagés, attentes temporisées, doublons | 2/4 | 12 | 0 fort · 6 moyen · 6 faible | 2 S · 9 M · 1 L | fait en partie le 11/09 |
| [20](lot-20-app-shell-docs-ci.md) | App shell, distribution, docs et CI | 1/4 | 7 | 0 fort · 2 moyen · 5 faible | 6 S · 1 M · 0 L | fait le 16/09 |
| [21](lot-21-usage-et-base.md) | Usage et base de données : calculs inutiles, colonnes, journal | 1/4 | 8 | 0 fort · 2 moyen · 6 faible | 6 S · 2 M · 0 L | fait le 16/09 |
| [22](lot-22-i18n-libelles-serveur.md) | i18n : libellés anglais en dur côté serveur | 1/4 | 3 | 0 fort · 1 moyen · 2 faible | 2 S · 1 M · 0 L | fait le 16/09 |
| [23](lot-23-helpers-dupliques.md) | Helpers et types dupliqués | 1/4 | 11 | 0 fort · 3 moyen · 8 faible | 11 S · 0 M · 0 L | fait le 11/09 |
| [24](lot-24-config-agents-workshop.md) | Configuration d'agents et workshop | 2/4 | 5 | 0 fort · 3 moyen · 2 faible | 4 S · 1 M · 0 L | fait le 16/09 |
| [25](lot-25-frictions.md) | Frictions : fermer la boucle ou retirer | 1/4 | 2 | 0 fort · 2 moyen · 0 faible | 0 S · 2 M · 0 L | à faire |

Échelle de difficulté : **1** simple et mécanique, à confier à un agent peu coûteux · **2** moyen · **3** difficile, plusieurs modules, tests de contrat à écrire · **4** très difficile, agent fort et revue humaine, à découper en plusieurs tickets.

## Ordre conseillé

1. Lot 23 — Helpers et types dupliqués (1/4) — **fait le 11/09**
2. Lot 04 — Code mort mécanique : fichiers, exports, routes, tokens, restes du board (1/4) — **fait le 11/09**
3. Lot 01 — Retrait complet du sous-système notifications (2/4) — **fait le 11/09**
4. Lot 02 — Retrait des agents de review personnalisés (1/4) — **fait le 11/09**
5. Lot 03 — Rétablir les preuves visuelles (galerie + réglage) (2/4)
6. Lot 21 — Usage et base de données : calculs inutiles, colonnes, journal (1/4) — **fait le 16/09**
7. Lot 22 — i18n : libellés anglais en dur côté serveur (1/4) — **fait le 16/09**
8. Lot 18 — Réglages et cohérence de l'UI partagée (1/4) — **fait le 16/09**
9. Lot 20 — App shell, distribution, docs et CI (1/4) — **fait le 16/09**
10. Lot 25 — Frictions : fermer la boucle ou retirer (1/4)
11. Lot 12 — Git, GitHub, import et suppression de projet (2/4) — **fait le 16/09**
12. Lot 05 — Parcours perdus dans l'overlay ticket et le desk (2/4)
13. Lot 08 — Tickets côté serveur : projection de GET /epics, GET unitaire, read-model partagé (3/4) — **fait le 11/09**
14. Lot 09 — Tickets côté client : polling, rafraîchissements, helpers partagés (2/4) — **fait le 11/09**
15. Lot 13 — Couche prompts : neutralisation, doublons, cohérence des règles (2/4) — **fait le 16/09**
16. Lot 24 — Configuration d'agents et workshop (2/4) — **fait le 16/09**
17. Lot 14 — Providers : sandbox codex, signaux de processus, fuite mémoire (3/4)
18. Lot 06 — Un seul chemin de lancement de session (build, review, merge, pull, create-epics) (4/4) — **fait le 11/09**
19. Lot 15 — Full Auto, night runs, batch DAG, routines (3/4) — **fait le 11/09**
20. Lot 11 — Spec, mémoire (dreaming/distill) et releases (3/4)
21. Lot 16 — Review, QA, findings et verdicts (3/4) — **fait le 16/09**
22. Lot 10 — Chat : une seule interface, un seul runner de tour (4/4)
23. Lot 07 — Stockage des sessions, rétention, LIVE LOG (4/4)
24. Lot 17 — Portage Piscine des îlots restants (3/4)
25. Lot 19 — Suite de tests : harnais partagés, attentes temporisées, doublons (2/4) — **fait en partie le 11/09** (#162, #165, #169 différés)

Pourquoi cet ordre :

- Les lots 23, 04, 01, 02 réduisent la surface avant tout refacto : moins de code à migrer ensuite. Le lot 01 précède le lot 04 (il libère des exports).
- Le lot 03 est indépendant mais doit être connu du lot 04 (les routes d'artefacts ne sont pas mortes, elles retrouvent un consommateur).
- Le lot 08 (serveur tickets) précède le lot 09 (client) ; le lot 06 (dispatch unifié) précède les lots 15 et 11 (releases).
- Les lots 13 et 16 partagent une règle (poids des findings en seconde opinion) : la décider dans le lot 13.
- Les lots 07 et 14 se coordonnent sur le spawn claude-code (LIVE LOG).
- Le lot 19 (tests) vient en dernier : consolider des tests que d'autres lots suppriment serait du travail perdu.

## Lots à ne pas lancer en parallèle

- 06 et 15 (mêmes routes build).
- 08 et 05 (projection de GET /epics).
- 07 et 14 (process-manager, providers).
- 13 et 16 (findings.ts, second-opinion.ts).
- 17 avec 10 ou 05 (overlay ticket).

## Ce qui n'est pas dans les lots

- Les 4 findings réfutés (#19, #39, #49, #54) : l'arbre avait déjà changé ou le constat était faux.
- Les points du 06/09 déjà ticketés (PRAGMA foreign_keys, bind 0.0.0.0, PATCH /api/settings toute clé) : hors périmètre de cet audit, toujours ouverts.
- Le fix SIGKILL (#171) est déjà en review sur `feature/epic-HeywuEXp4qYp` : le lot 14 le merge, ne le refait pas.

## Fichiers

- `lot-01-retrait-notifications.md`
- `lot-02-retrait-agents-review-personnalises.md`
- `lot-03-retablir-preuves-visuelles.md`
- `lot-04-code-mort-mecanique.md`
- `lot-05-parcours-perdus-overlay.md`
- `lot-06-dispatch-unifie-sessions.md`
- `lot-07-stockage-sessions-live-log.md`
- `lot-08-tickets-serveur-read-model.md`
- `lot-09-tickets-client-polling.md`
- `lot-10-chat.md`
- `lot-11-spec-memoire-releases.md`
- `lot-12-git-github-projets.md`
- `lot-13-prompts-securite-coherence.md`
- `lot-14-providers-spawn.md`
- `lot-15-auto-mode-night-batch-routines.md`
- `lot-16-review-qa-findings-verdicts.md`
- `lot-17-ilots-pre-piscine.md`
- `lot-18-reglages-coherence-ui.md`
- `lot-19-suite-de-tests.md`
- `lot-20-app-shell-docs-ci.md`
- `lot-21-usage-et-base.md`
- `lot-22-i18n-libelles-serveur.md`
- `lot-23-helpers-dupliques.md`
- `lot-24-config-agents-workshop.md`
- `lot-25-frictions.md`
