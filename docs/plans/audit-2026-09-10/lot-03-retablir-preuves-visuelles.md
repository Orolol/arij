# Lot 03 — Rétablir les preuves visuelles (galerie + réglage)

**Difficulté** 2/4 — Moyen
**Findings** 2 (1 fort · 0 moyen · 1 faible ; effort 1 S · 1 M · 0 L)
**Dépendances** Aucune. Le lot 04 ne doit PAS supprimer artifact-view.ts, servable-artifacts.ts ni les routes artifacts (elles retrouvent un consommateur ici).

## Décision

Décision produit du 11/09 : on RÉTABLIT. La mécanique serveur (outil MCP attach_artifact, section de prompt, table session_artifacts, deux routes GET) est conservée ; il manque la surface.

## Objectif

Une bande d'images Piscine dans l'overlay ticket (et/ou l'écran de session live) qui consomme GET /epics/:id/artifacts et sessionArtifactUrl() ; une case à cocher Piscine pour `visual_proof_enabled` dans la bande Verification/Build des réglages ; suppression des PNG à la suppression de la session/du ticket.

## Démarche suggérée

1. Relire b58a55c0 (galerie initiale) et 7fec5315 (suppression) pour récupérer le contrat.
2. Composant SessionArtifactsBand dans components/ticket (primitives piscine, pas de couleur-état), monté dans TicketOverlay ; refresh sur artifact:created.
3. Champ dans settings-fields.ts + clé i18n pour visual_proof_enabled.
4. Nettoyage disque : supprimer data/sessions/<id>/artifacts avec la session (deleteEpicPermanently / retireTicket) et documenter que la rétention ne le couvre pas.
5. Tests : rendu de la bande, route de service (servable-artifacts déjà testé).

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #148 — attach_artifact : les preuves visuelles sont capturées, stockées et servies par deux routes que plus aucune UI n'appelle

**Nature** à moitié câblé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `lib/agent-sessions/artifact-view.ts`
- `app/api/projects/[projectId]/epics/[epicId]/artifacts/route.ts`
- `app/api/projects/[projectId]/artifacts/[artifactId]/route.ts`
- `app/api/mcp/attach-artifact/route.ts`
- `lib/agent-sessions/artifacts.ts:319`
- `lib/agent-sessions/arij-actions.ts:468-484`
- `lib/claude/prompt-sections.ts:597-601`
- `lib/claude/mcp-injection.ts:73-78`
- `lib/claude/visual-proof.ts:6`
- `lib/settings/writable-keys.ts:81`
- `app/projects/[projectId]/page.tsx:77`

**Constat**

Le tool MCP attach_artifact (toujours présent dans ARIJ_MCP_AGENT_TOOLS), la section de prompt VISUAL_PROOF_SECTION, attachSessionArtifact (copie du PNG dans data/sessions/<id>/artifacts, insert session_artifacts), l'événement artifact:created, la route de liste GET epics/[epicId]/artifacts et la route de service GET artifacts/[artifactId] forment une chaîne complète — dont la seule sortie visible était SessionArtifactGallery, ajoutée le 25/08 (b58a55c0) et supprimée le 28/08 (7fec5315) avec le nouvel overlay ticket. Depuis, aucun composant ne construit l'URL d'un artefact : lib/agent-sessions/artifact-view.ts (seul constructeur de cette URL) n'a zéro importeur. Ce qui reste visible est une ligne texte « Attached visual proof » + caption dans la liste d'actions Arij. Le réglage visual_proof_enabled qui déclenche l'instruction est écrivable via PATCH /api/settings mais n'a aucun contrôle dans les réglages. Les fichiers copiés ne sont pas couverts par la rétention (lib/routines/retention.ts ne touche que les chunks).

**Précision du vérificateur**

Le tool MCP attach_artifact (bin/arij-mcp.mjs:180, ARIJ_MCP_AGENT_TOOLS lib/claude/mcp-injection.ts:78), la section VISUAL_PROOF_SECTION (prompt-sections.ts:597-601, injectée par prompt-builder.ts:1148/1329 via isVisualProofEnabled depuis stage-code.ts, dispatch-prompt.ts et build/route.ts:538), attachSessionArtifact (artifacts.ts:227, copie disque + insert session_artifacts), l'événement artifact:created, lookupServableSessionArtifact (lib/agent-sessions/servable-artifacts.ts — également orphelin, omis par le finding), la route de liste GET epics/[epicId]/artifacts et la route de service GET artifacts/[artifactId] forment une chaîne complète dont la seule sortie visuelle, SessionArtifactGallery (b58a55c0, 25/08), a été supprimée le 28/08 (7fec5315). Depuis, aucun composant/hook ne construit l'URL d'un artefact : lib/agent-sessions/artifact-view.ts a zéro importeur ; TicketScreenshots rend les images de bug report (lib/uploads/ticket-images), pas les artefacts de session. Le résidu visible est une ligne texte « Attached visual proof » + caption dans ArijActionsList (arij-actions.ts:468-484) et une entrée « done » dans la timeline du ticket (derive.ts:309). visual_proof_enabled est écrivable via PATCH /api/settings (writable-keys.ts:81) mais sans contrôle ni clé i18n dans les réglages. La routine retention (chunks + cap des prompts) ne supprime jamais data/sessions/<id>/artifacts. GET /api/dashboard/summary reste sans appelant après la suppression de hooks/useDashboardSummary.ts (D dans l'arbre).

Confirmé tel quel, avec deux précisions : (1) lib/agent-sessions/servable-artifacts.ts (path-containment, 142 lignes) n'a lui aussi d'autre consommateur que la route de service orpheline GET artifacts/[artifactId] et ses tests, il fait partie de la surface à retirer ou à recâbler ; (2) le ticket arji.json MPRo9qUFeJSE « Galerie dans le ticket + restitution session » est en status done alors que la galerie livrée (b58a55c0) a été supprimée par 7fec5315 sans remplacement — l'unique abonné à artifact:created (app/projects/[projectId]/page.tsx:77) ne fait que recharger le desk.

Le tool MCP attach_artifact (ARIJ_MCP_AGENT_TOOLS, mcp-injection.ts:77), VISUAL_PROOF_SECTION (prompt-sections.ts:597), attachSessionArtifact (artifacts.ts:319-355 : copie dans data/sessions/<id>/artifacts + insert session_artifacts), l'événement artifact:created (emit.ts:120) et les deux routes GET epics/[epicId]/artifacts et artifacts/[artifactId] forment une chaîne complète dont la seule sortie visuelle, SessionArtifactGallery (b58a55c0), a été supprimée le 28/08 (7fec5315). Depuis, lib/agent-sessions/artifact-view.ts (seul constructeur de l'URL) n'a aucun importeur, aucun composant/hook ne construit ni ne fetch une URL /artifacts, et le seul rendu restant est la ligne texte « Attached visual proof » + extrait de caption (arij-actions.ts:478-484) via components/shared/ArijActionsList.tsx et la timeline de l'overlay (derive.ts:309). visual_proof_enabled est écrivable via PATCH /api/settings (writable-keys.ts:81) sans aucun champ dans settings-fields.ts. La rétention (retention.ts) ne traite que les chunks et le plafonnement des prompts ; aucun code ne supprime les fichiers copiés (pas de rmSync sur un répertoire de session, pas de delete(sessionArtifacts)) — la FK cascade efface la ligne DB mais laisse le PNG sur disque. Annexe confirmée : GET /api/dashboard/summary n'a plus d'appelant (hooks/useDashboardSummary.ts supprimé dans l'arbre).

**Recommandation**

Soit rétablir une galerie (dans TicketOverlay ou LiveSessionScreen) qui consomme GET .../epics/:id/artifacts et sessionArtifactUrl(), plus un toggle Piscine pour visual_proof_enabled ; soit retirer le tool, la section de prompt, les deux routes, artifact-view.ts et la copie disque. Dans l'intervalle, au minimum supprimer artifact-view.ts et les deux routes orphelines pour ne pas laisser une surface HTTP servant des fichiers que rien n'affiche.

<details><summary>Preuve relevée par l'auditeur</summary>

rg 'artifact-view' sur tout le dépôt → 0 résultat. rg -i 'artifact' components hooks app (hors app/api) → seulement ArijActionsList.tsx (icône/couleur du kind), derive.ts:309, csv.ts (commentaire), LiveSessionScreen.tsx:185 (commentaire) et page.tsx:77 (refresh sur artifact:created) : aucun <img>, aucun fetch vers /artifacts. git show --stat 7fec5315 → « components/kanban/epic-detail/SessionArtifactGallery.tsx | 88 -- » et « __tests__/epic-detail-session-artifacts.test.tsx | 183 --- ». rg 'visual_proof' components lib/settings app hors app/api → uniquement writable-keys.ts:81 (aucune bande de réglages). arij-actions.ts:478-484 : summary « Attached visual proof », detail excerpt(caption) — texte seul.

</details>

### #180 — Le réglage `visual_proof_enabled` est acceptable par PATCH /api/settings et lu par les prompts de build, mais aucune surface ne l'expose

**Nature** à moitié câblé · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/claude/visual-proof.ts:6`
- `lib/claude/visual-proof.ts:35-51`
- `lib/settings/writable-keys.ts:81`
- `lib/tokens/dispatch-prompt.ts:231-232`
- `lib/pipeline/stage-code.ts:87`
- `lib/claude/prompt-sections.ts:597`

**Constat**

lib/claude/visual-proof.ts:6,35 lit la clé `visual_proof_enabled` ; elle alimente les prompts de build (lib/tokens/dispatch-prompt.ts:231-232 et 313-314, app/api/projects/[projectId]/build/route.ts:538, lib/pipeline/stage-code.ts:87,99 → VISUAL_PROOF_SECTION prompt-builder.ts:1148,1329) et figure dans l'allowlist d'écriture lib/settings/writable-keys.ts:81. Mais rg `visual_proof|VISUAL_PROOF|visualProof` sur components/ et app/ (hors app/api) ne renvoie rien : ni carte de réglage, ni clé i18n, ni champ dans settings-fields.ts. La fonctionnalité n'est activable que par un appel API manuel.

**Précision du vérificateur**

Le réglage global `visual_proof_enabled` (lib/claude/visual-proof.ts:6,35-51, défaut OFF) est accepté par PATCH /api/settings via l'allowlist lib/settings/writable-keys.ts:81 (filtre app/api/settings/route.ts:108) et alimente les prompts de build : lib/tokens/dispatch-prompt.ts:231-232 et 313-314, app/api/projects/[projectId]/build/route.ts:538, lib/pipeline/stage-code.ts:87,99 → `options.visualProofEnabled` → lib/claude/prompts/implementation.ts:164-165 et 327-328 poussent VISUAL_PROOF_SECTION (lib/claude/prompt-sections.ts:597, ré-exportée par prompt-builder.ts:19 — les lignes 1148/1329 citées n'existent pas, le fichier fait 91 lignes). Aucune surface ne l'expose : 0 hit dans components/, app/ (hors api), hooks/, lib/i18n ; absent de components/settings-piscine/settings-fields.ts, et useSettingsDraft.ts:163-176 n'envoie que les clés de SETTING_FIELDS ; aucun outil MCP ni script bin/ n'écrit de setting. L'epic d'origine (arji.json JWSrCAtyLuxu, commit 64b4e19) n'a jamais prévu de toggle UI : la fonctionnalité n'est activable que par appel API manuel.

Le réglage global `visual_proof_enabled` (lib/claude/visual-proof.ts:6,35-51, défaut OFF) est accepté par PATCH /api/settings via l'allowlist lib/settings/writable-keys.ts:81 et transmis aux prompts de build par lib/tokens/dispatch-prompt.ts:231-232 et 313-314, app/api/projects/[projectId]/build/route.ts:538 et lib/pipeline/stage-code.ts:87,99, puis injecté comme VISUAL_PROOF_SECTION (lib/claude/prompt-sections.ts:597) dans lib/claude/prompts/implementation.ts:164-165 et 327-328 (prompt-builder.ts:19 n'est qu'un ré-export ; les lignes 1148/1329 citées n'existent pas, le fichier fait 91 lignes). Aucune surface ne l'expose : pas d'entrée dans components/settings-piscine/settings-fields.ts, aucune clé i18n, aucun outil MCP de réglage (app/api/mcp/ ne liste aucun outil settings), aucune routine (lib/routines/settings.ts n'écrit que ci_autofix), aucune migration/seed. Seul un appel API manuel l'active. Nuance : l'epic d'origine dans arji.json (commit 64b4e19a) n'a jamais demandé de contrôle UI pour ce setting — c'est un opt-in délibérément API-only plutôt qu'un câblage oublié, mais aucun ticket n'en couvre l'exposition.

**Recommandation**

Soit ajouter le toggle dans la bande Verification/Build des réglages Piscine (settings-fields.ts a déjà le patron des clés client-safe), soit retirer la clé de writable-keys et fixer le comportement (toujours off) pour ne pas maintenir un chemin de prompt invisible.

<details><summary>Preuve relevée par l'auditeur</summary>

rg -n `visual_proof|VISUAL_PROOF|visualProof` components app --glob '!app/api' → 0 résultat (le seul hit de components/shared/ArijActionsList.tsx:76 est un commentaire sur les artefacts) ; rg -in `visualproof|visual proof` components lib/i18n lib/settings → uniquement writable-keys.ts:81.

</details>


## État au 16/09/2026 — livré

Branche `feature/lots-03-05-10` (worktree `.arij-worktrees/lots-03-05-10`),
commit `b3b54020`. La base de la branche est `012cdf02`, un instantané exact de
l'arbre non commité partagé au 16/09 (rationalisation UI et lots en cours
d'autres agents). Ne pas merger cette branche seule : son premier commit
n'est pas du travail de lot. Au merge, les fichiers identiques à l'arbre
partagé ne produisent pas de conflit.

Fait :
- #148 : `SessionArtifactsBand` dans l'overlay, sous VERIFY. Vignettes servies
  par id opaque, légende, session, lightbox partagé. Rien n'est rendu sans preuve ;
  en cas d'échec de lecture, l'erreur s'affiche en toutes lettres avec Retry.
  `useEpicArtifacts` relit sur `artifact:created` et sur le tick de repli SSE,
  pas sur le bump de l'hôte. Le disque est nettoyé :
  `removeSessionArtifactDirectories` s'exécute après le commit des suppressions
  définitives (ticket et story).
- #180 : le switch `visual_proof_enabled` est dans Réglages → bande Agents &
  mémoire, sous les outils MCP. Clé et parseur sont dans
  `lib/claude/visual-proof-constants.ts` (client-safe).

Reste :
- `DELETE /api/projects/:id` supprime les sessions par cascade FK sans passer
  par le nettoyage : `data/sessions/<id>/artifacts` fuit encore → lot 12 ou suivi.
  Lire les ids de session avant `db.delete(projects)`, puis appeler
  `removeSessionArtifactDirectories`.
- Lot 04 : NE PAS supprimer `lib/agent-sessions/artifact-view.ts`,
  `servable-artifacts.ts` ni les deux routes artifacts, qui ont de nouveau un consommateur.

Validation (install hardlinkée du worktree, sans `npm ci`) : tsc = base
(48 erreurs préexistantes de l'instantané), eslint 0 erreur, i18n 0 écart,
suite complète 27 échecs contre 38 sur la base (seul nouveau :
`spec-page-update-feedback`, flaky sous charge, 3/3 vert isolé).
