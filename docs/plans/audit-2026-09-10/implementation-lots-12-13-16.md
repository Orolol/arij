# Lots 12, 13 et 16 — compte rendu du 16/09/2026

Les trois lots sont implémentés dans l’arbre de travail, sans commit. L’index et
les trois fiches portent leur statut de réalisation. L’arbre contient également
des modifications d’autres lots ; les vérifications globales portent sur cet
ensemble partagé.

## Lot 12 — Git, GitHub et projets

- **#55, #56** : lien d’import depuis la création de projet ; suppression dans
  les réglages avec confirmation et option de nettoyage du clone géré par Arij.
  Le client d’import ne transmet plus `cloneSource`.
- **#57** : retrait des routes mortes `git/connect` et `git/detect-remote` ;
  validation `owner/repo` commune aux créations et modifications de projets.
- **#59** : `runAuthenticatedGit` pour fetch, pull, push et publication des tags.
  Le PAT reste dans une configuration éphémère limitée à GitHub ; environnement
  non interactif partagé avec le clone, erreurs expurgées et annulation réelle
  du fetch de statut après quatre secondes.
- **#62** : catalogue partagé de projets, endpoint léger de présence du PAT et
  snapshot de statut/worktrees transmis au bandeau Git. Le bandeau affiche la
  branche correspondant aux compteurs et à l’action push de la page.
- **#63** : confinement des chemins mutualisé ; endpoint d’image document
  scopé au projet, contrôle du chemin réel et des symlinks, type MIME limité,
  CSP et rendu dans le lecteur de documents.
- **#65** : métadonnées projet incluses dans la transaction d’import, erreur
  JSON nommant `arji.json`, export accessible sur Git Sync.
- **#66, #104** : `logSyncOperation` unique, échecs normalisés en `failed`,
  création de PR journalisée comme `pr_create`, lecture PR scopée au projet et
  affichage des vingt dernières opérations sur Git Sync.

Le portage complet Piscine des anciennes pages import/Git Sync reste le lot 17.

## Lot 13 — prompts

- **#206–208** : textes des tickets/stories/critères neutralisés ; feedback de
  review partagé entre lancement manuel et pipeline, limité à 80 findings et
  1 200 caractères par corps ; éléments de grading bornés et neutralisés ;
  preuves forensic protégées par des fences adaptées au contenu.
- **#209–211** : forensic et génération de spec exemptés du MCP ticket ; section
  outils conditionnée au ticket ; cinq outils de planification explicitement
  annoncés ; liste du shim filtrée selon l’allowlist du lancement ; mentions
  figées du préfixe Claude supprimées des prompts grading/seconde opinion.
- **#212, #217** : les findings critical/major bloquent la seconde opinion,
  minor/info restent consultatifs ; review de story adaptée aux bugs, checklist
  partagée avec la review d’epic.
- **#213, #214** : préambule projet avec collector, corps de ticket, verdict final
  et instructions additionnelles mutualisés ; vocabulaire de colonnes et de
  drag-and-drop retiré des instructions concernées.
- **#216** : budget global de 30 000 tokens initialisé sans écraser un réglage
  existant ; caps distincts de spec/mémoire, réduits pour review, QA, refinement
  et résolution de merge. Le cap CI reste indépendant du transport provider.

## Lot 16 — review, QA et verdicts

- **#218, #219, #220** : ingestion prose accessible aux reviews manuelles et à
  Full Auto via la résolution commune ; parseur du dernier `Overall Verdict`
  explicite, ignorant les blocs de code et reconnaissant les vocabulaires
  code/feature/bug. Pipeline, workflow, seconde opinion, Dreaming et QA utilisent
  le contrat partagé. Un finding critical/major bloque même sous une approbation
  prose ; un finding minor ne transforme pas un verdict négatif en approbation.
- **#96, #97, #221** : garde du type d’agent pour `submit_findings` et
  `submit_grading` ; question du grader transmise au handler commun, ticket
  maintenu à son statut et décision journalisée ; rapport de grading malformé
  rendu comme non évalué avec diagnostic serveur.
- **#98, #99, #222** : mutations de findings scopées au projet et validées ;
  dismissal distinct de la résolution, raison dédiée, corps conservé ; reviews
  manuelles enrichies des identifiants `[RC:id]`, décisions humaines, cycle et
  preuves de vérification fraîches.
- **#102, #226** : lecture et classement des rapports de vérification partagés ;
  `planEpicVerification` commun au POST manuel et au pipeline ; gate de régression
  renommé `regression-gate.ts` ; cause d’échec discriminée commande/régression.
- **#103** : modification et suppression des presets QA depuis le dialogue.
- **#223, #225, #229** : feedback client-safe unique, prédicat des reviews
  ordinaires partagé, enum de verdict et SQL des préfixes de sévérité communs.
- **#224 repris du lot 04** : champs inutilisés retirés du contrat du runner ;
  source du verdict et verdict structuré inscrits dans sa trace.
- **#227** : choix explicite de conserver le forensic dans le pipeline ; cette
  portée est documentée dans l’architecture Full Auto.
- **#228** : commentaire du chat rapide envoyé par la même route MCP que le CLI.

La migration manuelle `0061_review_dismissal_and_git_log` ajoute
`dismissed_reason`, normalise le journal Git et initialise le budget de prompts.
La reprise d’une base sans journal de migrations reconnaît la nouvelle colonne.

## Vérifications

- Installation des dépendances avec `npm ci` avant les mesures.
- Passage ciblé consolidé : **68 fichiers verts, 1 249 tests réussis**, avec trois
  attentes restantes dans `epic-verify-route`. Ces attentes ont été alignées sur
  le rattachement au code session et les erreurs du pilote commun, puis les
  **9 tests de cette route ont repassé au vert**. Les 69 fichiers ciblés sont
  ainsi validés, soit 1 252 tests distincts.
- Contrats Git/MCP avec processus Git et serveur local hors sandbox : **58 tests
  verts** (`git-github-route-status-convention`, `mcp-e2e`). Parcours d’import
  GitHub : **29 tests verts** après retrait de `cloneSource` du payload attendu.
- Régressions ajoutées : validation de dépôt, transport Git et redaction,
  neutralisation des prompts, verdicts contradictoires, portée des mutations,
  dismissal, presets QA, confinement des images et rollback de l’import.
  La question du grader est également couverte contre la base migrée.
- `npm run i18n:check` : **2 250 clés définies/référencées, zéro manquante ou
  orpheline**. ESLint ciblé sur les modules et surfaces de ces lots : succès.
- Dernière suite complète hors sandbox : **668 fichiers verts / 14 en échec ;
  8 974 tests réussis / 42 en échec**. Elle précède les dernières relances ciblées
  réussies de `epic-verify-route`, `review-unverifiable-gate` et
  `import-page-github-flow`. Ce résultat global ne constitue donc pas une
  validation intégrale de l’arbre.
- Le lint global et `tsc --noEmit` restent en échec sur l’arbre partagé : notamment
  desk, routines, traductions/usage, tests et types Next générés qui référencent
  encore des routes supprimées. Au moment de la mesure, le lint global affichait
  24 erreurs et 79 avertissements ; TypeScript 74 diagnostics. Aucun diagnostic
  TypeScript ne concernait les nouveaux modules Git, prompts, review,
  vérification, import ou tests d’audit ajoutés pour ces lots.

Les échecs globaux restants concernent notamment les harnais de conversations,
la navigation TopBar, les anciens tests du fichier de suppressions ESLint,
les assertions de catalogue i18n et les surfaces de routines. Des fichiers de
ces autres lots ont évolué pendant les contrôles. Aucun build de production ni
parcours navigateur complet n’est revendiqué comme validé.
