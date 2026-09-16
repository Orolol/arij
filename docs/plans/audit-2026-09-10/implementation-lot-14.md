# Lot 14 — compte rendu du 16 septembre 2026

Lot réalisé dans l'arbre partagé, après `npm ci`, au-dessus de `45e96387` et
des rationalisations déjà présentes. Le README de l'audit et la fiche du lot
portent le statut « fait le 16/09 ».

## Changements

| Findings | Résultat |
|---|---|
| #170, #193 | Codex refuse plan/chat/analyze avant le lancement hors d'un chemin réel `.arij-worktrees/<worktree>`. Cela couvre les appels directs, les routes de chat/spec/import/titrage et les dispatchs de fond, notamment mémoire et diagnostics. |
| #171 | Helper de signaux partagé, spawns détachés, SIGTERM puis SIGKILL sur le groupe ; attente de fermeture et occupation du ticket maintenue pendant l'arrêt. Le runner persistant utilise le même helper. |
| #173 | Claude passe par le registre des providers ; fichier MCP exposé, raw chunks en direct et résultat final sans double écriture. Le chat frais passe par la capacité `spawnStream`, les reprises et retries par `spawn`. |
| #174 | À la fermeture : prompt vidé et références au provider/kill libérées. Éviction après cinq minutes, protégée contre la réutilisation du même identifiant ; un processus annulé encore ouvert empêche son redémarrage sous cet identifiant. |
| #181 | `which`, `codex login status` et `omp --version` asynchrones avec timeout de cinq secondes. Sonde OMP mutualisée entre appels concurrents ; refus en cache cinq secondes, version acceptée en cache jusqu'au redémarrage du serveur. |

La garde Codex vérifie le chemin de travail choisi par Arij ; elle ne crée pas
une sandbox système. Les tâches en mode `code` conservent leur comportement.
Une tâche auparavant configurée sur Codex en mode restreint hors worktree échoue
avec une erreur indiquant les providers disposant d'un mode lecture seule.

## Reprise du travail existant

Les changements des commits `746944d9` / `6386c228` (SIGKILL) et `d7fd0e0b`
(lot 14) ont été repris avec une intégration à trois versions pour conserver
les modifications déjà présentes dans l'arbre partagé. Les hunks Claude LIVE LOG
de `0b475a82` ont aussi été repris comme prérequis de l'interface commune. Il
ne s'agit pas d'une fusion Git ni d'un commit de cet arbre, et le reste du
lot 07 n'est pas déclaré terminé.

La route QA conserve le dispatch canonique installé par le lot 06. Le code
obsolète de journalisation retiré par le lot 04 n'est pas réintroduit. La
rationalisation existante du runner persistant est conservée et son préflight
OMP est devenu asynchrone.

## Vérifications

Les tests couvrent notamment le refus Codex avant spawn, les liens symboliques,
l'annulation d'un processus réel et de ses descendants, l'escalade après sortie
du parent, le chat avec MCP et reprise, les chunks Claude en direct (y compris
un caractère UTF-8 coupé entre deux lectures), la rétention après réexécution et
l'annulation pendant un préflight OMP.

- `npm ci` : installation propre avant les mesures.
- `npm test` : **689 fichiers, 9 086 tests réussis, aucun échec**. La première
  passe a détecté deux mocks à adapter à `spawnStream` et à `execFile` ; ils
  sont corrigés et la suite complète a été relancée.
- `npm run i18n:check` : **2 259 clés définies et utilisées**, aucune manquante
  ni orpheline.
- ESLint ciblé sur les fichiers de ce lot : **aucune erreur ni avertissement**.
- `npm run lint` : **aucune erreur** ; avertissements du reste de l'arbre.
- `npx tsc --noEmit` : contrôle global encore en échec, sans erreur dans les
  fichiers modifiés pour ce lot. Il reste notamment des références générées
  `.next` vers des routes supprimées, des types UI/i18n, des fixtures de tests
  et des types manquants dans `lib/usage/aggregate.ts`. Le build global n'est
  donc pas déclaré validé.
- `git diff --check` sur le périmètre providers, Claude, chat, routes et docs
  de ce lot : propre. Les changements des autres lots ont été conservés.
