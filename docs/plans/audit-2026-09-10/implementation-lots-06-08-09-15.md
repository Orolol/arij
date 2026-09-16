# Réalisation des lots 06, 08, 09 et 15 — 11 septembre 2026

Les changements sont présents dans l'arbre de travail, sans commit. Cet arbre contient aussi des travaux simultanés sur les autres lots. Les résultats globaux ci-dessous décrivent cet arbre partagé, pas une branche isolée des quatre lots.

## Lot 08 — serveur tickets

- GET unitaire d'un epic, avec ses stories et son dernier rapport de grading ; index `GET /epics?view=index` limité à `id`, `readableId`, `title`.
- Liste courante allégée : suppression des indicateurs de merge/grading/commentaires inutilisés ; maintien des compteurs de stories et de l'outcome utilisé par le chat.
- Faits de sessions, questions, derniers commentaires, merge et sessions actives mutualisés dans `lib/control-desk/read-model.ts`. Inbox et desk utilisent la même règle pour une question de story, même si une autre story a terminé depuis.
- Création du ticket, de ses stories et des dépendances dans une transaction unique. Une cible absente produit `422 DEPENDENCY_TARGET_NOT_FOUND` ; les erreurs de cycle et de projet ne sont plus ignorées.
- Suppression via le chemin de retraite : refus des sessions actives, y compris stories et team ; tombstone conservé dans les documents ; nettoyage du worktree géré par Arij sans forcer la suppression d'un arbre sale.
- Retrait de PATCH/DELETE sur la collection `user-stories` ; la route story unitaire reste canonique.

## Lot 09 — client

- L'overlay utilise le GET unitaire et l'index léger. La page ne double plus son polling des sessions actives ; les événements SSE sont filtrés par epic et les toasts viennent des événements de session.
- `ProjectsProvider` partage la liste des projets. `ControlDeskProvider` partage le desk et son compteur Inbox sur les pages desk ; le résumé Inbox n'y est plus pollé séparément.
- `useMergeBatch` et `lib/inbox/client.ts` mutualisent les écritures. L'auto-résolution utilise uniquement `resolve-merge`, après un conflit identifié ; un autre refus ne lance pas d'agent.
- Migration des lecteurs du registre, configuration agents, usage, historique chat et des pollers pipeline, activité, commentaires, night runs, sessions et vagues. Le lecteur partagé gère l'ordre des réponses, l'invalidation après écriture, le changement de contexte, la cadence variable et l'annulation optionnelle.
- Mutations de création/upload/assignation basées sur `useScopedMutation`, avec maintien du résultat d'une création lorsqu'on revient à sa conversation.
- Deep links mutualisés par `useConsumedQueryParam`, dialogues regroupés dans `ProjectDeskDialogs`, toolbar sur les composants Piscine.
- Test de convention AST et allowlist des appels `fetch` restants : les appels historiques ou propres au streaming peuvent diminuer, pas augmenter sans décision explicite.

## Lot 06 — lancement de sessions

- `dispatchBuildSession`, `dispatchReviewSession` et `dispatchMergeResolution` s'appuient sur `dispatchBackgroundSession` : lifecycle, scheduler, logs, classification et settlement ont un seul propriétaire.
- Routes epic/story, batch solo/team, pipeline, résolution de merge manuelle/automatique et conflit de pull utilisent ce chemin. Les événements de fin ne sont plus doublés par les finalizers du pipeline ; la review de story émet les événements attendus.
- Conservation des identifiants de reprise validés ; `null` permet de démarrer explicitement sans identifiant CLI préassigné.
- Retrait de la branche agent de `/merge`. `/resolve-merge` utilise le prompt d'atelier, la résolution de la branche par défaut et les verrous avant mutation du worktree, puis pendant le merge final. Les refus de merge gardent leur trace, leur code et leurs fichiers en conflit.
- Les routines appellent `lib/build/dispatch*`, sans importer de route ni fabriquer de requête Next. Une règle ESLint interdit les imports `@/app/**` depuis les bibliothèques, hooks et composants.
- Génération QA en arrière-plan avec réponse `202` et `sessionId`. Insertion transactionnelle partagée, identifiants lisibles, événements et export ; sortie inexploitable sans création partielle.
- Contrats Git validés par Zod ; types de refinement et constantes de review dans des modules partagés.

## Lot 15 — batch, auto-mode et routines

- `sequential` utilise une seule entrée par vague et attend réellement son résultat terminal.
- Gardes de night run, batch et pipeline appliquées à tous les modes ; verrou de préparation contre deux requêtes batch simultanées ; préflight avant création de worktree.
- Le parallèle renvoie les sessions lancées et la liste des préparations refusées. Une erreur tardive ne cache plus les sessions déjà créées.
- `startWaveBatch` porte les callbacks communs et la réponse de première vague pour DAG et night run.
- GET auto-mode léger par défaut ; `?candidates=1` réserve le calcul des candidats aux surfaces qui le demandent. Les tickets parkés sont visibles dans le dialogue et dans « À vous ».
- Schéma batch/night partagé avec les routines ; upsert des settings partagé. Les paliers night par projet non configurables ont été retirés ; les réglages globaux et overrides explicites de requête restent disponibles.
- Une erreur transitoire de lancement CI sans reçu de session libère la réclamation, y compris sur un nouveau SHA après une tentative antérieure réussie.

## Vérification

- Installation verrouillée par `npm ci` avant les mesures.
- Groupe principal : 377 tests ciblés verts sur 32 fichiers (le dernier import manquant du test SQL a été corrigé puis son fichier relancé).
- Derniers tests supplémentaires : attente séquentielle, résultat parallèle partiel, reprise CLI, contexte partagé, annulation des polls, questions de story, tickets parkés, erreurs transitoires CI. Derniers passages verts : 64 tests de lecteurs/polling (9 fichiers), 94 tests serveur (5 fichiers), puis intégration des routes/scheduler/chrome (243 tests sur 14 fichiers, avec le dernier mock corrigé et son fichier relancé). Ces groupes se recouvrent et ne doivent pas être additionnés.
- `i18n:check` passe : aucun message manquant ni orphelin.
- Lint ciblé des derniers lecteurs et services : aucune erreur ; un avertissement de limitation du React Compiler dans la toolbar.
- La suite complète et `test:changed` ont été exécutés. Le dernier passage global hors bac à sable donnait 8 921 tests verts et 128 échecs, avant les adaptations de harnais vérifiées ensuite par les passages ciblés. La validation globale n'est pas verte : des fixtures/contrats des autres lots évoluent simultanément. Les adaptations nécessaires aux contrats de ces quatre lots ont été relancées séparément.
- Build non validé : Turbopack échoue sur l'ouverture d'un port local, y compris après exécution autorisée hors bac à sable ; le repli webpack échoue sur la lecture du résultat TypeScript `--showConfig`. `tsc` rencontre aussi des erreurs dans les fichiers des autres travaux en cours. Aucune validation visuelle en navigateur n'est revendiquée.
