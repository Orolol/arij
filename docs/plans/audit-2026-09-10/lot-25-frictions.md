# Lot 25 — Frictions : fermer la boucle ou retirer

**Difficulté** 1/4 — Simple — agent peu coûteux
**Findings** 2 (0 fort · 2 moyen · 0 faible ; effort 0 S · 2 M · 0 L)
**Dépendances** Indépendant.

## Décision

À trancher par l'utilisateur : (a) fermer la boucle (frictions ouvertes injectées dans le prompt de build/refinement et le digest de nuit, dédup sans file_path) ou (b) retirer report_friction, la table, la page et la pastille. Dans les deux cas la page est portée sur Piscine ou supprimée.

## Objectif

Registre vivant ou registre disparu, plus de registre à sens unique.

## Démarche suggérée

1. Demander la décision ; (a) = 1 jour, (b) = 2 heures.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #199 — Frictions : registre à sens unique — 98 lignes écrites, rien ne les lit hors la page et la pastille, aucune boucle de retour

**Nature** à moitié câblé · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:orphan-small-domains-and-docs

**Fichiers**
- `app/api/mcp/report-friction/route.ts:85-110`
- `app/api/projects/[projectId]/frictions/route.ts:9-33`
- `app/api/projects/[projectId]/frictions/[frictionId]/route.ts:12-60`
- `lib/frictions/constants.ts:11-21`
- `lib/db/migrations/0038_frictions.sql:1-4`
- `app/projects/[projectId]/frictions/page.tsx:213-218`
- `app/api/projects/[projectId]/epics/route.ts:486-510`

**Constat**

report_friction écrit dans `frictions` (dédup par (projet, catégorie, file_path, statut ouvert) — les rapports sans chemin ne sont jamais dédupliqués). Les seuls lecteurs sont GET /frictions (page + pastille du workshop) et POST /epics pour la conversion. Aucun prompt, digest, dreaming ni night summary ne relit la table (grep « frictions » dans lib/workflow, lib/night, lib/claude/prompts : zéro occurrence ; prompt-sections.ts ne cite que le nom de l'outil). En base live : 98 lignes, toutes `new`, 0 `converted`, 0 `dismissed` ; le statut `triaged` est déclaré (constants.ts, CHECK SQL, labels) mais aucun code ne l'écrit ; il n'existe ni DELETE ni purge. Le lien « Source session » pointe vers `/sessions/<agent_session_id>` alors que la colonne n'a volontairement pas de FK : après suppression du ticket (deleteEpicPermanently efface les agent_sessions) le lien répond 404.

**Précision du vérificateur**

Frictions : registre à sens unique confirmé. report_friction (app/api/mcp/report-friction/route.ts:85-135) écrit dans `frictions` ; les seuls lecteurs sont GET /api/projects/:id/frictions (page app/projects/[projectId]/frictions/page.tsx:71 + components/agents-workshop/FrictionsPill.tsx:41) et POST /epics pour la conversion (epics/route.ts:486-510, 666-676). Aucun prompt, digest ni résumé de nuit n'importe la table (grep lib/workflow, lib/night, lib/claude, lib/routines, lib/auto-mode : seules mentions du nom de l'outil dans prompt-sections.ts:295/322 et mcp-injection.ts:29/77/105). Base live : 98 lignes toutes `new`, 0 converted, 0 dismissed, un seul projet ; la dédup par chemin fonctionne (8 lignes cumulées, max ×26). `triaged` est déclaré (0038_frictions.sql:13, schema.ts:397, constants.ts:13/21, presentation.ts:15, page.tsx:43) mais aucun `update(frictions)` ne l'écrit. Aucun DELETE/purge côté API ; seule la cascade FK sur project_id efface des lignes. Nuances : l'absence de dédup sans file_path est un choix délibéré commenté (route.ts:86-89) et testé (__tests__/report-friction-mcp.test.ts:367), pas une omission (13 lignes sans chemin, 0 doublon observé) ; le lien « Source session » pointe vers `/projects/<projectId>/sessions/<agent_session_id>` (page.tsx:222-227) sans FK (schema.ts:370), et deleteEpicPermanently (lib/planning/permanent-delete.ts:52-71) efface les agent_sessions de l'epic → le GET session répond 404 (sessions/[sessionId]/route.ts:300/333) affiché en alerte `loadError` par la page ; scénario réel dans le code mais 0 session orpheline en base aujourd'hui (les 11 frictions à epic NULL viennent de sessions e2e_test/tech_check/refinement sans epic).

**Recommandation**

Décider du statut du registre : soit fermer la boucle (injecter les frictions ouvertes du projet dans le prompt de build/refinement ou dans le digest de nuit, et donner un écrivain à `triaged` ou le retirer), soit assumer le registre passif et ajouter une purge/DELETE et un compteur global. Dans les deux cas, ne plus rendre un lien vers une session que la suppression de ticket efface (afficher l'id en texte quand la session n'existe plus).

<details><summary>Preuve relevée par l'auditeur</summary>

node better-sqlite3 readonly : `select status,count(*) from frictions group by status` → [{new:98}] ; `grep -rn triaged --include=*.ts . | grep -v __tests__` → uniquement schema.ts:397, constants.ts:13/21, presentation.ts:15, page.tsx:43 (aucun UPDATE) ; `grep -rn frictions lib/workflow lib/night lib/claude/prompts` → vide ; liste des fichiers citant frictions/Friction : page, pill, 2 routes, report-friction, epics/route.ts (conversion), constants/presentation, schema/init/journal, docs, tests.

</details>

### #200 — La page /projects/:id/frictions est un écran shadcn pré-Piscine qui rend des libellés anglais en dur venant de lib/

**Nature** refacto · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:orphan-small-domains-and-docs

**Fichiers**
- `app/projects/[projectId]/frictions/page.tsx:24-27`
- `app/projects/[projectId]/frictions/page.tsx:41-46`
- `app/projects/[projectId]/frictions/page.tsx:118-160`
- `lib/frictions/presentation.ts:5-45`

**Constat**

La page importe Badge, Button, Card de components/ui, deux `<select>` natifs stylés à la main, un `<h2>` de titre avec icône (un écran ne rend pas son propre en-tête), et une table STATUS_STYLES où la couleur est l'état (amber/blue/emerald/muted). Le reste du copy passe par `useTranslations("ProjectFrictions")`, mais les catégories et statuts affichés viennent de FRICTION_CATEGORY_LABELS / FRICTION_STATUS_LABELS (anglais codé en dur dans lib/frictions/presentation.ts), et `frictionToEpicDraft` fabrique un titre/description anglais (« Reported N times by coding agents. ») qui entre tel quel dans le ticket. C'est le même défaut que « SECTION_LABELS » ou « merge-readiness », mais sur un module que personne n'avait relevé.

**Précision du vérificateur**

La page /projects/:id/frictions garde deux dettes réelles et vérifiées, mais aucune ne lui est propre. (a) Dette i18n spécifique : `lib/frictions/presentation.ts:5-18` définit 9 libellés anglais en dur (FRICTION_CATEGORY_LABELS, FRICTION_STATUS_LABELS) rendus en page.tsx:148, :164, :204, :210, et `frictionToEpicDraft` (:24-31) compose en anglais le titre et la phrase « Reported N times by coding agents. » du brouillon d'epic — chaînes invisibles pour `scripts/i18n/check-keys.mjs`, qui ne voit que les clés manquantes/orphelines. Ce brouillon est toutefois un `initialDraft` éditable dans EpicCreateDialog, pas un texte injecté sans relecture, et le namespace fr de la page est de toute façon quasi vide (seul `retry`), comme la plupart des namespaces fr. (b) Dette visuelle NON spécifique : imports `@/components/ui/{badge,button,card}` (:24-26), deux `<select>` natifs (:138-167) et STATUS_STYLES où la couleur porte l'état (:41-46, appliqué :208). Seul le point STATUS_STYLES enfreint une règle explicite de CLAUDE.md ; le `<h2>` avec icône (:122-125) n'en enfreint aucune (l'interdiction porte sur la chrome — logo/nav/⌘K — pas sur un titre de section), et les imports shadcn sont l'état commun de documents, github-issues, git-sync, qa, settings, stories/[storyId] et sessions/chat, seule `releases/page.tsx` étant portée sur Piscine. À traiter comme un lot transverse « écrans secondaires non portés + libellés d'état hors catalogue », pas comme un défaut isolé du module frictions.

**Recommandation**

Porter la page sur `@/components/piscine` (Stamp/PillButton, OptionRow, pas d'en-tête), remplacer les deux tables de libellés par des clés de catalogue (`ProjectFrictions.category.*`, `.status.*`), et faire composer le brouillon d'epic côté page avec `t()` plutôt que dans lib.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:24-26 `import { Badge } from "@/components/ui/badge"; import { Button } …; import { Card, CardContent } …` ; :41-46 STATUS_STYLES par couleur ; :145 et :195 `FRICTION_CATEGORY_LABELS[category]` ; presentation.ts:5-18 tables Record<…, string> anglaises ; presentation.ts:31-33 `Reported ${occurrences} times by coding agents.`

</details>

