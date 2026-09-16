# Rationalisation du code — 10 septembre 2026

Cette revue couvre les régressions liées au passage du kanban au desk Piscine,
puis les contrats partagés du chat, des agents, de Git, des documents et des
réglages. La dernière passe traite les réserves recensées : idempotence serveur,
clonage commun, exclusions d’exécution, pagination, découpage des grands modules
et couverture réelle des contrôles React. Les refactorings conservent les
façades appelées par les routes et les workflows ; les changements de comportement
sont associés à des cas de régression reproductibles.

Le bilan cumulé retire **3 294 lignes nettes de TypeScript applicatif** sur
210 fichiers modifiés, nouveaux modules inclus, hors tests, documentation et
modifications préexistantes identifiées.

## Périmètre

Inventaire des routes, composants, hooks, bibliothèques, dépendances, tailles et
références d’import dans tout le dépôt. Revue manuelle approfondie des secteurs
ci-dessous, avec tests reproduisant les ordres de réponse réseau et les états
Git concernés. Lecture complémentaire des points d’intégration des routines,
du pipeline et des transitions workflow. Ce bilan ne signifie pas que chaque
ligne de tous les modules historiques a été réécrite ou vérifiée manuellement.

Les modifications déjà présentes dans Full Auto (`engine`, `registry`,
`constants`), `pipeline/stages`, leurs tests associés, les documents de travail
et `arji.json` ont été conservées. Les correctifs voisins sur les sélecteurs,
les fusions et les preuves de review ont été validés avec ces changements.

## Corrections et simplifications

| Secteur | Résultat |
| --- | --- |
| Desk et tickets | Projet propriétaire retrouvé dans toutes les sections ; réponse refusée bloquant le build associé ; erreurs de fusion visibles ; protection des clics concurrents ; file de fusion respectant sa position. |
| Sélection et modale | Sélection multiple indépendante de l’ouverture du ticket ; fermeture conservant la sélection du lot ; état de la modale isolé par projet et ticket ; réponses périmées ignorées, y compris A → B → A. |
| Page projet | Commandes de lot réunies dans `ProjectBatchToolbar` ; lien des tickets retenus vers le registre filtré ; sous-arbre du layout remonté au changement de projet ; ancienne synchronisation incapable de rafraîchir le nouveau projet ; erreurs d’import visibles. |
| Chat | Historique, mutations et streams isolés par conversation ; doubles envois protégés ; réponses en arrière-plan conservées ; erreurs visibles ; restauration et liens de conversation corrigés ; association des tickets limitée au projet courant et aux titres non ambigus. Les deux surfaces utilisent `useChatWorkspace` et `useChatComposer` pour leurs actions et saisies ; brouillons texte/images par conversation et composition IME respectée. Une coupure SSE après acceptation ne transforme plus le message et ses images en brouillon à renvoyer ; questions et créations en cours restent accessibles après un aller-retour entre conversations. Les deux chemins de création d’epic envoient l’identité de conversation au serveur ; la même proposition retrouve le même epic après rechargement ou depuis une autre fenêtre. |
| Polling | `usePolledResource` commun au desk, à la QA, à l’inbox, aux projets et aux frictions : dernière réponse valide conservée, lectures ordonnées, réponses antérieures à une mutation invalidées. Lecture unique, validation de la forme des données et polling conditionnel partagés ; les rapports QA arrêtent leur polling à la fin du dernier rapport actif. |
| File d’exécution | Critères statiques parent/story partagés avec Full Auto ; aucun rang si aucune story n’est buildable ; question sur une story ne bloquant pas ses voisines exécutables ; question parent restant bloquante. Parking parent/story, budget de rejets et propriété des runs pipeline/night/DAG partagés avec Full Auto ; motif affiché et rang suspendu. Les libellés distinguent la file visible du prochain dispatch réel. |
| Inbox | Fin du chargement même en cas d’échec ; erreur et Retry ; curseur de lecture refusé signalé ; commentaire ou build déjà accepté conservé comme succès si seul le marquage lu échoue ; pas de relance immédiate du build ; tri des instants réels ; contrat de données partagé. Pages de 50 tickets, ordre stable et compteurs globaux ; seules les lignes visibles chargent un extrait borné de leur dernier commentaire. Le badge global demande uniquement les métadonnées. |
| QA | Scope projet transmis au serveur et appliqué avant les limites d’historique ; compteurs, couverture et règles calculés dans ce scope ; couleurs stables ; statuts actifs cohérents entre SQL et affichage. |
| Lectures serveur | Sessions, réponses utilisateur, comptes de stories et dernières erreurs partagés entre desk et registre ; projections étroites ; sélection du dernier événement indépendante du format SQLite/ISO. Les scopes et l’usage des index ont été vérifiés par `EXPLAIN QUERY PLAN`. |
| Agents | Réponses de configuration ordonnées, dernière configuration valide conservée après erreur ; scope projet incomplet empêché d’écrire globalement ; mutations d’affectation partagées et verrouillées par rôle ; reset des prompts réellement reflété ; brouillon récent conservé pendant la sauvegarde. |
| Limites et réglages | Aucune valeur fictive après un échec de lecture ; Retry et écriture bloquée avant une première lecture valide. Le budget projet ne peut plus être effacé avant son chargement. Les sauvegardes globales ne suppriment plus les modifications saisies pendant le PATCH. |
| Routines et MCP | Rafraîchissement conservant les brouillons non sauvegardés ; accusé de sauvegarde établissant une nouvelle baseline ; lectures anciennes incapables de rétablir une routine supprimée ; formulaires MCP et secrets isolés par scope, champs soumis gelés pendant la requête. Les réponses de mutation deviennent directement la référence locale ; une erreur de rafraîchissement ne démonte plus les éditeurs de routines. |
| Sessions | Pagination commune aux logs et aux réponses ; une lecture en vol par ressource ; annulation au changement d’identité ; dernière lecture garantie à la fin d’une session, même derrière un poll échoué ; scans de fichiers et d’actions sérialisés séparément ; transcription chat protégée contre les anciennes réponses. |
| Coût des sessions | Suppression du chargement de toutes les pages d’historique toutes les trois secondes dans `useAgentPolling` : aucun composant produit ne consommait plus les anciennes données de badges calculées ainsi. |
| Spec | Ancien projet non réaffiché ; édition bloquée avant lecture valide ; génération empêchée si la sauvegarde préalable échoue ; polling sérialisé ; édition réouverte seulement après rechargement du résultat. Un GET final échoué laisse la mise à jour en attente de relecture au lieu d’annoncer un résultat non chargé. Paramètre `provider` client sans effet retiré. |
| Écriture de spec | Spec, epics et stories écrits dans une transaction ; comparaison avec la spec utilisée par le prompt avant écriture. Une édition concurrente provoque un conflit au lieu d’être écrasée. Le résultat reste dans la session ou, pour l’ancien endpoint sans session durable, dans un document de proposition unique, exclu du contexte automatique. |
| Documents et mémoire | Upload partagé ; erreur réseau libérant l’interface ; succès partiels affichés ; suppression et aperçu actualisés ; réponses de scan périmées neutralisées ; mémoire protégée contre une ancienne lecture après sauvegarde/restauration. |
| Fraîcheur des reviews | Dates SQL ramenées à une précision UTC fixe et comparaisons JavaScript sur les instants ; fractions et fuseaux traités correctement dans les verdicts, les conflits, les findings, la seconde opinion et les preuves mécaniques. Dates invalides incapables d’effacer un signal négatif. |
| Vérification mécanique | Dernière fin de session effective prise en compte, avec fallback `completedAt`, y compris pour `ticket_build` et `team_build` ; preuve périmée ou indatable refusée. |
| Git | Même branche d’intégration pour le checkpoint, la fusion, le rollback et les prompts ; verrou couvrant capture → fusion → validation/rollback ; retry de fusion manuelle également verrouillé. Worktree avec changements suivis, indexés ou non suivis conservé ; fichiers ignorés traités selon Git. |
| Clonage | Deux façades réunies autour du même cœur : verrou de destination, staging atomique, délai global, commandes non interactives et retry authentifié après refus anonyme. Import existant utilisable hors ligne ; racine du dépôt et `origin` vérifiés ; revalidation avant remplacement ; aucun nettoyage fondé sur le seul préfixe d’un dossier tiers. Le réglage `clone_timeout_ms` s’applique aussi à l’import. |
| Prompts | Façade publique conservée ; compositions réparties par domaine, types et collecte de sections partagés. La résolution de mémoire stockée se fait à la frontière commune, avec priorité à la valeur explicitement fournie. Les builders de réécriture mémoire/spec gardent leur politique d’injection propre. |
| Notifications | Contenus purs séparés des lectures et de l’insertion/nettoyage communs ; suppressions de recherches projet et insertions répétées. Succès de session sans message dédupliqués ; nettoyage ordonné par instant puis insertion pour conserver la notification fraîche en cas d’égalité. |
| Chat persistant | Cycle de vie commun séparé des adaptateurs Claude/OMP. Libération des ressources après échec synchrone de spawn/écriture, rejet des attentes annulées avant readiness, isolation des exceptions d’observateurs et décodage UTF-8 préservé entre fragments. |
| Dreaming | Collecte read-only, réglages/cutoffs et décisions pures séparés du dispatch et de l’écriture mémoire gardée. Attribution des diagnostics forensic limitée au bon ticket/story ; les liens explicites sont réservés avant les anciennes heuristiques. |
| Synchronisation et issues GitHub | Branche saisie indépendante de la branche résolue par le serveur ; anciens statuts annulés ; Push/Pull mutuellement exclusifs. Filtres d’issues protégés contre les réponses périmées ; mapping modifiable seulement après lecture valide ; sélection ajoutée pendant un import conservée ; configuration inconnue distinguée d’une absence de configuration. |
| Revue et état Git | Six hooks de diff, commentaires, worktrees, dépendances, PR et statut utilisent les mêmes règles de lecture et de mutation. Erreurs HTTP visibles ; brouillons de review conservés après refus ; suppression sans faux succès ; endpoints PR vérifiant le projet propriétaire. |
| Dialogues | Chargements initiaux refusés distingués de réglages vides ; champs gelés pendant l’envoi ; mutations concurrentes bloquées immédiatement. Une nouvelle instance à chaque ouverture isole les réponses tardives. Retry de prévisualisation nocturne conservant les options saisies. |
| Frictions | Échec initial distinct d’une liste vide ou d’un compteur nul ; Retry ; dismiss verrouillé par friction, même lorsque plusieurs requêtes avancent en parallèle. |
| Usage et releases | Changement de période invalidant les anciennes réponses ; retour de sauvegarde rafraîchissant la période active ; création de release récupérable après erreur réseau, chargement avec Retry, brouillon isolé par projet. |
| Bilans nocturnes | Sessions ordonnées par instant ; fin effective `endedAt` prise en compte ; coûts calculés depuis les lignes déjà lues ; labels regroupés en une requête ; dix runs de reprise sélectionnés en SQL après exclusion des runs déjà connus. |
| Rétention | Comparaison des instants avec fractions et fuseaux avant purge ; date terminale illisible conservée sans repli sur une date de création plus ancienne ; borne de rétention invalide ne supprimant rien. |
| Fichiers de sessions et build | Création des logs centralisée, douze blocs de préparation identiques remplacés ; dossier `data` exclu des traces de déploiement. Hook de compilation explicite pour le manifest d’instrumentation ignoré par les exclusions de routes de Turbopack ; exclusion dédiée pour le retracing Webpack. |
| Distribution CLI | `instrumentation.ts`, absent de l’archive npm, ajouté au package : le démarrage installé conserve les nettoyages de sessions, watchdog et ordonnanceurs. Test sur le contenu réel produit par `npm pack --dry-run`, sans publication. |
| Contrats Next | Signature HTTP settings conforme ; page Spec réduite à la liaison des paramètres de route, état de l’éditeur dans `SpecWorkspace`. Le réglage de polling des tests ne figure plus dans les props de la route publique. |

## Code retiré

- Hooks de l’ancien board : `useKanban`, `useBoardMerge`, `useDashboardSummary`,
  `useNotifications`, ainsi que l’ancien helper de sélection.
- Dix composants sans consommateur produit : ancien QuickCapture, badges
  priorité/type/grading/git, ThemeToggle, ProjectSourceBadge,
  ProjectFrictionLink, DependencyEditor et UserStoryQuickActions.
- Dépendances `@dnd-kit/core`, `@dnd-kit/sortable` et `@dnd-kit/utilities`.
- Tests exclusivement dédiés à ces interfaces retirées ; les contrats métier
  actifs et les parcours de remplacement restent couverts.
- Quarante-deux anciennes clés orphelines, quatre namespaces devenus vides et
  autres clés rendues inutiles pendant la seconde passe. Les nouveaux retours
  d’erreur disposent de leurs traductions.
- Exceptions obsolètes du contrôle React Compiler pour les fonctions désormais
  analysées ; la liste d’exceptions est désormais vide. Les imports, variables et suppressions ESLint inutiles identifiés ont été retirés.

## Limites et choix conservés

- **La file affichée et le dispatch gardent leurs scopes produit.** Le desk
  classe les parents `todo`/`in_progress` et partage les blocages d’exécution
  avec Full Auto. Le superviseur considère aussi les stories inachevées sous
  `review`/`to_merge`, puis ses capacités et vérifications du cycle courant : un
  rang affiché ne garantit donc pas un départ immédiat.
- **Deux présentations de chat restent actives.** Le panneau projet et la page
  utilisent les mêmes contrôleurs, tout en conservant leur présentation.
  L’idempotence d’une proposition est durable dans SQLite, avec une clé par
  projet/conversation/contenu normalisé. Le choix de statut initial ne crée
  pas une seconde proposition. La suppression de l’epic conserve un tombstone :
  rejouer cette proposition répond 409 au lieu de recréer silencieusement un ticket.
- **L’inbox conserve des compteurs globaux.** Les réponses parent/story et leurs dernières questions sont évaluées séparément.
  La pagination borne le nombre de
  tickets et les corps transmis, sans transformer le badge en compteur de la
  seule page. Le calcul des compteurs continue donc de lire les métadonnées
  globales ; il ne s’agit pas d’un coût SQL constant quelle que soit la base.
- **Les avertissements tardifs du compilateur restent distincts des angles
  morts.** Tous les composants/hooks passent désormais ses validations. Certaines
  constructions limitent encore sa mémoïsation ; les images de messages et
  pièces jointes conservent leur rendu natif. Aucun avertissement n’a été caché
  pour obtenir ce résultat.

- **Compatibilité du traçage Next.** Le contournement est explicite dans
  `next.config.ts` et `bin/build-traces.mjs`, via le hook documenté
  `runAfterProductionCompile`. Il modifie seulement le manifest de build ;
  les fichiers utilisateur restent sur disque. Les migrations applicatives et
  dépendances natives restent dans les traces. Aucun fichier de Next n’est modifié.

## Validation

Les versions directes installées ont été comparées au lockfile. La suppression
des trois dépendances inutilisées ne modifie pas les versions restantes.

Tests de races par promesses contrôlées, tests API sur bases SQLite migrées,
et tests de merge/rollback dans de vrais dépôts Git temporaires. Le test HTTP
des uploads utilise son propre serveur loopback, cache, base et répertoire de
fichiers. Aucun lancement réel d’agent sur les projets utilisateur n’a été requis.

Le build et les parcours navigateur utilisent des bases de test sous `/tmp`.
La migration 0057 est vérifiée sur une base migrée depuis 0056 puis rouverte ;
le catalogue exhaustif du schéma couvre colonnes, contraintes et index de la
nouvelle table. Les textes des prompts et leurs snapshots sont conservés.

| Contrôle | Résultat |
| --- | --- |
| Vitest complet | **689 fichiers, 9 269 tests passent** |
| Playwright complet | **90 scénarios passent**, Chrome, deux workers, serveur de production |
| TypeScript | Aucune erreur, y compris au build final |
| ESLint | Aucune erreur ; **43 avertissements** (40 limites d’optimisation React, 3 images natives), contre 148 au début de la revue |
| Catalogue | **2 238 clés** définies et référencées ; aucune manquante ni orpheline |
| Build production | Réussi avec Turbopack et Webpack ; aucun fichier `data` référencé dans les 193 manifests contrôlés de chaque build |
| Contrôles de distribution | 24 tests CLI/configuration passent, dont lecture du contenu réel de l’archive npm ; tests de filtrage du manifest conservant les migrations et dépendances |
| Diff | `git diff --check` propre |

La suite navigateur vérifie notamment création de tickets, build/review/merge,
chat et documents, filtres du registre, QA, focus clavier et géométrie mobile.
Le contrôle React Compiler couvre **512 fonctions sur 512**, dans 345 fichiers.
La liste des fonctions échappant aux validations est vide ; le test refuse
toute nouvelle exception non recensée et toute ancienne exception devenue inutile.
