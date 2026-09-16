# Lot 14 — Providers : sandbox codex, signaux de processus, fuite mémoire

**Difficulté** 3/4 — Difficile
**Findings** 6 (2 fort · 4 moyen · 0 faible ; effort 3 S · 3 M · 0 L)
**Dépendances** Coordonner avec le lot 07 (LIVE LOG claude-code).

## Décision

Aucun spawn en mode plan hors worktree avec un provider qui ne sait pas être en lecture seule. ClaudeCodeProvider devient un vrai provider (mcpConfigPath, onChunk) et le branchement `provider !== "claude-code"` disparaît.

## Objectif

Preflight qui refuse codex pour les spawns plan/chat/analyze dont le cwd n'est pas un worktree Arij (ou pas de cwd dépôt pour titrage/spec), signaux de processus partagés (isChildAlive/signalChild, detached) — récupérer la branche feature/epic-HeywuEXp4qYp qui fait déjà ce travail plutôt que le refaire —, processManager qui oublie les sessions terminées, sondes de disponibilité asynchrones avec mémorisation du verdict négatif.

## Démarche suggérée

1. Vérifier l'état de la branche HeywuEXp4qYp (fix SIGKILL) et la merger d'abord.
2. Preflight codex dans dispatchBackgroundSession / processManager.start + test.
3. ClaudeCodeProvider complet ; migrer les 5 branchements ; le spawn stream-json alimente le chunk raw (lot 07).
4. processManager : suppression planifiée de l'entrée après état terminal (garder un résumé sans prompt).
5. isAvailable/probeOmpVersion en execFile async.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #170 — Codex ignore `mode: "plan"` : chat, generate-spec, QA create-epics et titrage lancent `codex exec --dangerously-bypass-approvals-and-sandbox` hors de tout worktree

**Nature** cassé · **Impact** fort (vérificateur : plutôt plus) · **Effort** M · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/providers/codex.ts:103-105`
- `lib/providers/codex.ts:216-233`
- `app/api/projects/[projectId]/chat/route.ts:165-176`
- `app/api/projects/[projectId]/chat/stream/route.ts:952-957`
- `app/api/projects/[projectId]/generate-spec/route.ts:102-110`
- `app/api/projects/[projectId]/qa/reports/[reportId]/create-epics/route.ts:257-267`
- `lib/chat/title-generation.ts:29-36`
- `docs/architecture/mcp-provider-matrix.md:294-299`

**Constat**

CodexProvider.buildArgs ne lit jamais `mode` et passe `--dangerously-bypass-approvals-and-sandbox` à chaque exec (lib/providers/codex.ts:103-105, commentaire 220-221 « No mode here »). Le contrat documenté (docs/architecture/mcp-provider-matrix.md:294-299, codex.ts:98-101) justifie ce choix par le confinement dans un worktree jetable par ticket. Or quatre chemins spawnent codex en `mode: "plan"` directement dans le dépôt réel : chat one-shot (app/api/projects/[projectId]/chat/route.ts:165-176, cwd = project.gitRepoPath), chat stream (chat/stream/route.ts:952-957, même cwd), génération de spec (generate-spec/route.ts:102-110), création d'epics QA (qa/reports/[reportId]/create-epics/route.ts:257-267) et le titrage de conversation (lib/chat/title-generation.ts:29-36, cwd = process.cwd(), c'est-à-dire le répertoire d'Arij lui-même). Les trois autres providers honorent bien la posture lecture seule (claude `--permission-mode plan` spawn.ts:130 ; omp `--tools read,grep,glob` pi.ts:265-271 ; agy `--mode plan` agy.ts:129-131) : seul codex a un « plan » en écriture totale sur le checkout principal.

**Précision du vérificateur**

CodexProvider.buildArgs ne lit jamais `mode` (lib/providers/codex.ts:220-222) et pousse `--dangerously-bypass-approvals-and-sandbox` à chaque exec comme à chaque resume (codexApprovalArgs l.103-105, appelé l.243 et l.270), avec `-C cwd` (l.272). Le contrat (codex.ts:98-101, docs/architecture/mcp-provider-matrix.md:294-299) fonde le confinement sur le worktree jetable par ticket, et options-registry.ts:24-27 interdit de réexposer `-s/--sandbox`. Or cinq chemins spawnent le provider résolu en `mode: "plan"` directement dans le checkout principal (`project.gitRepoPath || process.cwd()`) : chat one-shot (chat/route.ts:165-176), chat stream (chat/stream/route.ts:952-957), generate-spec (route.ts:102-110), QA create-epics (route.ts:257-267), et le titrage avec `cwd: process.cwd()` = le dépôt d'Arij lui-même (lib/chat/title-generation.ts:29-36). Aucun preflight ni gate de mode ne bloque codex (base-provider.ts:201/481 ; pas de preflight dans codex.ts). Les trois autres providers dérivent une posture lecture seule de `mode` (claude spawn.ts:130, pi.ts:265-271, agy.ts:129-131). Précision : codex n'est atteint que si un agent nommé codex est assigné/choisi pour le type (resolveAgent, agent-resolution.ts:508-522) ; le titrage a un défaut claude/haiku (l.73-83) mais une assignation `title_generation` → codex le remplace.

CodexProvider.buildArgs (lib/providers/codex.ts:220-227) ne lit jamais `mode` et pousse `--dangerously-bypass-approvals-and-sandbox` sur `codex exec` (l.270) comme sur `codex exec resume` (l.243) ; aucune garde dans base-provider.ts ni index.ts. Le contrat documenté (mcp-provider-matrix.md:294-299) justifie cela par le worktree jetable par ticket, mais codex est assignable à n'importe quel AGENT_TYPES via AssignmentsView/CliDropdown (PROVIDER_OPTIONS, constants.ts:236-241 ; route d'assignation validant seulement isAgentProvider) et sélectionnable dans le chat (AgentSelectPill.tsx:356). Chemins réels spawnant codex en `mode: "plan"` HORS worktree, sur `project.gitRepoPath || process.cwd()` : chat stream (chat/stream/route.ts:954-959 et relance 1004-1008, atteint par hooks/useChat.ts:92), titrage (lib/chat/title-generation.ts:29-33, cwd = process.cwd() = le dépôt Arij, appelé par stream/route.ts:346), generate-spec (route.ts:103-108, via hooks/useSpecGeneration.ts:30), QA create-epics (route.ts:257-264, via components/qa/ReportDetail.tsx:224), et — non cités par l'auditeur — via dispatchBackgroundSession → processManager.start (process-manager.ts:381-387) : spec-update.ts:186-187, spec-auto-rewrite.ts:296-297, dreaming.ts:268-269, memory-distill.ts:590-591, forensic.ts:300-301, ainsi que les release notes (releases/route.ts:272-274) ; l'import (import/route.ts:70-75) spawne en `analyze` sur le clone. La route POST /chat non-stream (chat/route.ts:167-172) est identique mais n'a pas de client UI (seul un test la référence). Les trois autres providers honorent le read-only (spawn.ts:125-130, pi.ts:265-271, agy.ts:129-131) : codex est le seul dont le « plan » est une écriture totale sur le checkout principal ou sur le répertoire d'Arij.

**Recommandation**

Soit refuser codex (preflight) pour tout spawn dont le cwd n'est pas un worktree Arij et dont le mode est plan/chat/analyze, soit ne pas donner de cwd dépôt à ces chemins (titrage/spec n'ont pas besoin d'écrire), soit rendre la posture explicite dans le sélecteur d'agent (« codex = écriture totale hors worktree »). Au minimum documenter l'exception dans mcp-provider-matrix.md.

<details><summary>Preuve relevée par l'auditeur</summary>

codex.ts:220 « No mode here: unlike the other providers, every codex exec gets the same approval/sandbox posture » ; codex.ts:103-105 `return ["--dangerously-bypass-approvals-and-sandbox"]` ; chat/route.ts:170 `cwd: project.gitRepoPath || process.cwd(), mode: "plan"` ; title-generation.ts:32 `cwd: process.cwd()` ; matrix.md:297-299 « Containment comes from the disposable per-ticket worktree ».

</details>

### #171 — Trois implémentations du kill SIGTERM→SIGKILL ; celle de claude-code (provider par défaut) a une garde morte et ne tue pas l'arbre de processus — toujours ouvert (06/09)

**Nature** cassé · **Impact** fort (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/claude/spawn.ts:376-388`
- `lib/claude/spawn.ts:645-661`
- `lib/claude/spawn.ts:286-290`
- `lib/providers/base-provider.ts:93-126`
- `lib/providers/base-provider.ts:530`
- `lib/providers/base-provider.ts:616-634`
- `lib/chat/persistent-runner.ts:459-463`
- `lib/chat/persistent-runner.ts:558-560`
- `lib/claude/process-manager.ts:424-429`
- `lib/claude/process-manager.ts:545-567`

**Constat**

lib/providers/base-provider.ts a la version correcte : spawn `detached: true` (530), signal au groupe `-pid` (115-126) et garde sur exitCode/signalCode (93-101, 616-634) avec un commentaire qui explique précisément pourquoi `!child.killed` est faux dès le premier signal. lib/claude/spawn.ts, chemin réel de toutes les sessions claude-code via processManager.start (process-manager.ts:426), garde encore `if (child && !child.killed)` avant SIGTERM et avant SIGKILL (spawn.ts:376-388 pour spawnClaude, 645-649 et 652-661 pour spawnClaudeStream) : l'escalade SIGKILL ne peut jamais tirer, et le spawn n'est pas `detached` (286-290, 483-487) donc seul le processus de tête reçoit le signal. lib/chat/persistent-runner.ts:459-463 et 558-560 est une troisième variante (`child.exitCode === null`, pas de groupe). lib/verify/runner.ts:171,204-208 en est une quatrième, correcte. Conséquence : annuler une session claude-code (DELETE sessions/[id] → processManager.cancel → spawned.kill) laisse vivants les sous-processus (serveur dev, tests) exactement comme décrit dans base-provider.ts:104-113, et un `claude` qui ignore SIGTERM survit à sa propre annulation.

**Précision du vérificateur**

Toujours ouvert sur main/arbre de travail, mais fix déjà en review : le ticket HeywuEXp4qYp (bug, statut review) a une branche non mergée feature/epic-HeywuEXp4qYp-claude-code-cancel-cannot-escalate-to-si (commits 746944d9, 6386c228) qui extrait isChildAlive/signalChild dans lib/providers/process-signals.ts, spawne `detached: true` et retire les gardes `!child.killed` de lib/claude/spawn.ts — l'action est « merger cette branche », pas réimplémenter. Sur main : spawn.ts:376-387 et 645-661 gardent `!child.killed` avant SIGTERM et avant SIGKILL (escalade impossible), nodeSpawn 286-290 / 483-487 sans `detached` (seul le pid de tête est signalé) ; tous les chemins claude-code y passent (process-manager.ts:426 et lib/providers/claude-code.ts:54 qui réutilise le même `kill`), plus spawnClaudeStream via app/api/projects/[projectId]/chat/stream/route.ts:1151. Correction de lignes : lib/chat/persistent-runner.ts (467 lignes) a son kill aux lignes 289-291, pas 459-463/558-560 ; sa garde SIGKILL sur `child.exitCode === null` escalade correctement, il ne lui manque que le signal de groupe. lib/verify/runner.ts:97-109,171 est correct.

Toujours ouvert (relevé le 06/09 pour spawn.ts:376-388) et confirmé dans l'arbre de travail : lib/claude/spawn.ts garde `if (child && !child.killed)` avant SIGTERM ET avant le SIGKILL différé (376-388 spawnClaude ; 645-661 spawnClaudeStream), donc l'escalade SIGKILL ne tire jamais, et les deux spawns (286-290, 483-487) ne sont pas `detached` : seul le processus `claude` de tête reçoit le signal. Ce code est sur le chemin de production de toutes les sessions claude-code : process-manager.ts:426 (`spawnClaude`, provider par défaut) → cancel():556 `session.kill()`, appelé par DELETE app/api/projects/[projectId]/sessions/[sessionId]/route.ts:469 et lib/projects/cancel-sessions.ts:53 (suppression de projet) ; le chat SSE (chat/stream/route.ts:1151, kill() en 1216 sur abort) ; et lib/providers/claude-code.ts:54 qui délègue aussi à spawnClaude — donc `getProvider("claude-code")` ne profite pas de la version correcte de lib/providers/base-provider.ts (isChildAlive 93-101, signalChild -pid 115-126, detached 530, kill 616-634), réservée de fait à codex/oh-my-pi/agy. Troisième variante dans lib/chat/persistent-runner.ts (réécrit dans l'arbre) : 169-173 spawn sans `detached`, 289-291 `!child.killed` avant SIGTERM puis `child.exitCode === null` avant SIGKILL — l'escalade y marche, seul le groupe de processus manque. Quatrième, correcte : lib/verify/runner.ts:171,204-208. Conséquence : annuler une session claude-code laisse vivants ses sous-processus (dev server, tests) et un `claude` qui ignore SIGTERM survit à son annulation. Recommandation inchangée : extraire isChildAlive/signalChild dans un module partagé, les utiliser dans spawn.ts (deux spawners) et persistent-runner.ts, spawner `detached: true`, test simulant killed=true/exitCode=null qui doit observer SIGKILL.

**Recommandation**

Extraire `isChildAlive`/`signalChild` de base-provider.ts dans un module partagé (lib/providers/child-signal.ts) et les utiliser dans spawn.ts (les deux spawners) et persistent-runner.ts ; spawner `detached: true` dans spawn.ts comme dans base-provider. Un test qui simule un enfant ignorant SIGTERM (child.killed=true, exitCode=null) doit voir SIGKILL.

<details><summary>Preuve relevée par l'auditeur</summary>

spawn.ts:376-387 `if (child && !child.killed) { killed = true; child.kill("SIGTERM"); setTimeout(() => { if (child && !child.killed) child.kill("SIGKILL"); }, 5000); }` ; base-provider.ts:621-628 « `!child.killed` is already false here and the escalation this timer exists for could never fire » ; spawn.ts:286-290 nodeSpawn sans `detached` ; git log lib/claude/spawn.ts : dernier commit b8bed3c5 (options registry) n'a pas touché au kill.

</details>

### #173 — Le branchement `provider !== "claude-code" ? getProvider().spawn : spawnClaude()` est recopié à cinq endroits alors que ClaudeCodeProvider existe pour l'éviter

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/providers/claude-code.ts:39-82`
- `lib/claude/process-manager.ts:381-440`
- `app/api/projects/[projectId]/chat/route.ts:163-190`
- `app/api/projects/[projectId]/generate-spec/route.ts:99-120`
- `app/api/projects/[projectId]/qa/reports/[reportId]/create-epics/route.ts:257-281`
- `app/api/projects/[projectId]/chat/stream/route.ts:952-957`
- `app/api/projects/[projectId]/chat/stream/route.ts:1081-1108`
- `app/api/projects/import/route.ts:70-77`
- `lib/chat/title-generation.ts:29-36`

**Constat**

lib/providers/claude-code.ts:39-82 enveloppe spawnClaude derrière l'interface AgentProvider, mais cette classe est contournée partout où la session compte : process-manager.ts:381-440 (branche explicite, parce que ClaudeCodeProvider.spawn jette `mcpConfigPath` et ne reçoit pas `onChunk`), chat/route.ts:165-190, generate-spec/route.ts:102-120, qa create-epics/route.ts:257-281 et chat/stream/route.ts:952 + 1081-1108. Seuls import/route.ts:70 et title-generation.ts:29 passent réellement par ClaudeCodeProvider.spawn. Le commentaire de chat/route.ts:163-164 (« Same rule as generate-spec ») montre que la règle est propagée par copie. Chaque copie ré-implémente le mapping mode/cwd/model/cliOptions et diverge déjà : import passe par le provider avec `logIdentifier`, process-manager ne passe jamais `logIdentifier`, chat/route.ts ne passe pas de `mcp`. C'est aussi la cause directe du finding sur la bande LIVE LOG.

**Précision du vérificateur**

Le finding est exact ; deux précisions à apporter. (a) Le chemin claude de chat/stream n'est pas seulement `spawnClaude` : la session fraîche passe par `spawnClaudeStream` (chat/stream/route.ts:1151), les l.1081/1097 ne couvrant que le resume et son retry. C'est ce troisième chemin qui rend la suppression de la branche non triviale : ClaudeCodeProvider ne sait pas exprimer le stream-json, donc la recommandation « brancher onChunk via un spawn stream-json » est un préalable, pas un simple nettoyage. (b) Le contournement dans process-manager n'est pas seulement dû à `onChunk` : `spawnClaude` ne prend pas `onChunk` du tout (seul `spawnClaudeStream` streame), donc la vraie contrainte bloquante côté process-manager est `mcpConfigPath`, dont il a besoin pour `teardownMcpChannel` (process-manager.ts:429, 449, 479, 491, 520, 564) et que `ClaudeCodeProvider.spawn` ne renvoie pas (claude-code.ts:75-81). Le reste — 5 branches recopiées, seuls import/route.ts:70 et title-generation.ts:29 traversant réellement le provider, divergences logIdentifier/mcp, commentaire « Same rule as generate-spec » (chat/route.ts:163-164) — est vérifié ligne à ligne.

**Recommandation**

Faire de ClaudeCodeProvider un vrai provider : exposer mcpConfigPath dans ProviderSession (ou nettoyer le fichier dans le provider), brancher onChunk via un spawn stream-json, puis supprimer la branche spéciale de processManager.start et des quatre routes pour ne garder que `getProvider(provider).spawn(...)`.

<details><summary>Preuve relevée par l'auditeur</summary>

rg `spawnClaude\(` app lib → 6 sites hors spawn.ts (process-manager:426, create-epics:271, generate-spec:114, chat/route:183, chat/stream:1081 et 1097) ; rg `getProvider\(` → 10 sites ; claude-code.ts:54-66 ne retourne que {promise, kill, command} (mcpConfigPath perdu), pas d'onChunk.

</details>

### #174 — processManager n'oublie jamais une session : `remove()` n'est appelé que par les tests, la Map garde prompt et résultat de chaque session pour toute la vie du serveur

**Nature** cassé · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/claude/process-manager.ts:77`
- `lib/claude/process-manager.ts:470-482`
- `lib/claude/process-manager.ts:583-633`
- `lib/claude/process-manager.ts:610-621`
- `lib/agent-sessions/wait-for-completion.ts:39-42`

**Constat**

ClaudeProcessManager.sessions (process-manager.ts:77) reçoit un TrackedSession par start() (470-482) qui conserve `options` (le prompt complet — jusqu'à 128 Ko+ selon lib/agent-sessions/prompt-cap, un cas de 4,9 Mo cité dans resolve-session-output.ts:84-86) et `result`. La seule suppression est `remove()` (610-621), dont les seuls appelants sont __tests__/process-manager.test.ts:203-209 et __tests__/session-status-integration.test.ts:91-105 ; `listAll`, `listActive` et `activeCount` (583-633) n'ont pas non plus d'appelant en production. Un serveur qui enchaîne les sessions Full Auto/night accumule donc en mémoire chaque prompt et chaque résultat, sans borne.

**Précision du vérificateur**

`ClaudeProcessManager.sessions` (lib/claude/process-manager.ts:77) reçoit à chaque `start()` un TrackedSession (l.470-482) qui garde `options` — le prompt COMPLET tel que remis au CLI, persona et section MCP incluses (l.208, 332 ; commentaire l.215 « handed, whole »), sans le plafond de 128 Kio qui ne s'applique qu'à la colonne en base via capSessionPrompt (l.216, 352) — et `result` (texte de sortie complet, ClaudeResult.result). Le seul `sessions.delete` est dans `remove()` (l.610-621), appelé uniquement par __tests__/process-manager.test.ts:203-209 et __tests__/session-status-integration.test.ts:91-106 ; les appelants de production se limitent à `start` (19 sites), `getStatus` (lib/agent-sessions/wait-for-completion.ts:39-42) et `cancel` (lib/projects/cancel-sessions.ts:53), aucun ne libérant l'entrée. `listAll`/`listActive`/`activeCount` (l.583-633) n'ont pas d'appelant hors tests. Sur un serveur `next start` de longue durée qui enchaîne les sessions, chaque prompt et chaque résultat restent en mémoire sans borne (sous `next dev`, le HMR remet la Map à zéro). Le fichier cité pour le cas 4,9 Mo est lib/claude/resolve-session-output.ts:84-86 (pas lib/agent-sessions/).

ClaudeProcessManager.sessions (lib/claude/process-manager.ts:77) reçoit un TrackedSession par start() (set à la ligne 482) qui conserve `options` — le prompt COMPLET remis au CLI, NON cappé : le cap de 128 Ko de prompt-cap.ts ne s'applique qu'à la copie écrite en base (lignes 216 et 352, commentaire 214-215 « never on the way into the spawn ») — ainsi que `result.result` (stdout entier, spawn.ts:358/368). Le `.then/.catch` de start() (485-534) mute l'entrée sans jamais la supprimer ; le seul `sessions.delete` est dans `remove()` (610-621), dont les seuls appelants sont __tests__/process-manager.test.ts:203,209 et __tests__/session-status-integration.test.ts:91,98,105. En production, seuls `start`, `cancel` et `getStatus` (wait-for-completion.ts:39-42) sont appelés ; `listAll`, `listActive`, `activeCount` n'ont aucun consommateur, et ni instrumentation.ts ni lib/routines/retention.ts ne touchent le singleton (exporté ligne 745). Chaque session neuve (id nanoid neuf) s'accumule donc en mémoire pour toute la vie du processus serveur ; seuls les re-dispatchs sous le même sessionId écrasent leur entrée. Référence du cas 4,9 Mo : lib/claude/resolve-session-output.ts:84-86 (et non lib/agent-sessions/).

**Recommandation**

Dans le `.then/.catch` de start() (485-534), après transition terminale, planifier la suppression de l'entrée (ou ne conserver qu'un résumé sans `options.prompt`), en gardant un délai compatible avec wait-for-completion qui interroge getStatus après la fin. Ajouter un test qui vérifie la taille de la Map après N sessions terminées.

<details><summary>Preuve relevée par l'auditeur</summary>

rg `processManager\.(remove|listAll|listActive|getStatus|activeCount)` app lib → seul getStatus (wait-for-completion.ts:39-42) ; rg `\.remove\(sessionId\)|processManager\.remove` sur tout le dépôt → uniquement __tests__/process-manager.test.ts et __tests__/session-status-integration.test.ts (les `agentScheduler.remove` sont un autre objet).

</details>

### #181 — Sondes de disponibilité en execSync/execFileSync bloquantes sur des chemins de requête (which, `codex login status`, `omp --version`)

**Nature** risque · **Impact** moyen (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/providers/base-provider.ts:323-330`
- `lib/providers/codex.ts:451-467`
- `lib/providers/omp-version.ts:108-137`
- `lib/providers/oh-my-pi.ts:132-135`
- `app/api/providers/available/route.ts:12-21`
- `lib/chat/default-chat-mode.ts:87`
- `lib/chat/default-chat-mode.ts:140-147`
- `lib/agent-config/review-segregation.ts:136-148`

**Constat**

BaseCliProvider.isAvailable fait `execSync("which …")` (base-provider.ts:323-330) ; CodexProvider.isAvailable enchaîne `which codex` puis `execSync("codex login status", {timeout: 5000})` (codex.ts:451-467) ; probeOmpVersion fait `execFileSync("omp", ["--version"], {timeout: 5000})` (omp-version.ts:111-137) et ne mémorise qu'un verdict positif (108-109, 135) : sur une install omp trop vieille, chaque spawn restreint (plan/chat/analyze, oh-my-pi.ts:132-135 et persistent-runner.ts:454) rebloque le serveur jusqu'à 5 s. Ces sondes tournent dans des handlers HTTP : GET /api/providers/available (route.ts:12-21, les 4 providers — `Promise.all` n'aide pas, l'appel est synchrone), POST/GET conversations via resolveDefaultChatMode (lib/chat/default-chat-mode.ts:87, 140-147), la ségrégation reviewer (lib/agent-config/review-segregation.ts:143). Pendant ce temps aucune autre requête ni aucun flux SSE n'avance. La durée réelle n'a pas été mesurée ; le blocage est structurel.

**Précision du vérificateur**

Les sondes de disponibilité sont bien synchrones dans le processus serveur : `execSync("which …")` (base-provider.ts:323-330, sans timeout), `execSync("codex login status", {timeout: 5000})` (codex.ts:451-467) et `execFileSync("omp", ["--version"], {timeout: 5000})` (omp-version.ts:111-137, mémoïsé seulement si version ≥ 18.0.6, ligne 135 — re-sondage volontaire, commentaire 103-107). Elles tournent dans GET /api/providers/available (route.ts:12-21, 4 providers, `Promise.all` sans effet), dans resolveDefaultChatMode (default-chat-mode.ts:87,140-147 ← conversations/route.ts:62,157 et [conversationId]/route.ts:171), dans pickAlternativeReviewProvider (review-segregation.ts:140-147), et le preflight omp à chaque spawn restreint (oh-my-pi.ts:132-135 via base-provider.ts:481 ; côté persistant lib/chat/persistent-runner.ts:160 via persistent-providers/oh-my-pi.ts:210 — pas persistent-runner.ts:454). Amplitude mesurée sur cet hôte : which ≈ 0 ms, `codex login status` ≈ 50 ms, `omp --version` ≈ 300 ms (une seule fois sur omp 18.1.13) ; le blocage de 5 s n'est que le plafond de timeout si un CLI pend, et le re-sondage omp par spawn ne concerne qu'une install < 18.0.6 déjà refusée. Passer à execFile asynchrone reste pertinent, mais l'impact ordinaire est de dizaines à centaines de ms, pas de secondes.

Les sondes de disponibilité sont synchrones et bloquent la boucle d'événements : `BaseCliProvider.isAvailable` (base-provider.ts:323-330, `execSync("which …")`, aucun timeout ; hérité par claude-code, oh-my-pi, agy), `CodexProvider.isAvailable` (codex.ts:451-467, `which codex` + `execSync("codex login status", {timeout:5000})`), et `probeOmpVersion` (omp-version.ts:111-137, `execFileSync("omp",["--version"],{timeout:5000})`) qui ne mémorise qu'un verdict positif conforme (l.135) et re-sonde à chaque spawn restreint sur une install absente/illisible/trop vieille. Chemins réels atteints : GET /api/providers/available (route.ts:12-21, 4 providers en séquence sous un `Promise.all` inopérant), fetché à chaque montage de `/agents` (hooks/useProvidersAvailable.ts:29 → AgentsWorkshopView.tsx:123, CliInventoryCard.tsx:23-24) ; `resolveDefaultChatMode` (default-chat-mode.ts:87, 140-147) depuis GET conversations quand le projet n'en a aucune (conversations/route.ts:62), POST avec provider non-chat sans agent nommé (:157) et PATCH de reset ([conversationId]/route.ts:171) — court-circuité si un agent CHAT est assigné ; `pickAlternativeReviewProvider` (review-segregation.ts:143) via agent-resolution.ts:691 (review/grading, si la ségrégation est activée) et second-opinion.ts:283 — moteur auto-mode/pipeline, pas des handlers HTTP mais même processus ; preflight omp à chaque spawn plan/chat/analyze (oh-my-pi.ts:132-135 ← base-provider.ts:481) et au démarrage du chat persistant (lib/chat/persistent-providers/oh-my-pi.ts:210 → lib/chat/persistent-runner.ts:160, et non lib/providers/persistent-runner.ts:454 qui n'existe pas). Durée non mesurée ; blocage structurel.

**Recommandation**

Passer à `execFile` asynchrone (promisifié) dans isAvailable et probeOmpVersion (l'interface est déjà `Promise<boolean>`), et mémoriser aussi un verdict négatif pendant quelques secondes pour ne pas re-sonder à chaque spawn refusé.

<details><summary>Preuve relevée par l'auditeur</summary>

codex.ts:459 `execSync("codex login status 2>&1", { encoding: "utf-8", timeout: 5000 })` ; omp-version.ts:115 `execFileSync("omp", ["--version"], {…timeout: 5000…})` avec `let trustedVersion` (108) mémorisé seulement si `ompAllowlistIsEnforced` (135) ; default-chat-mode.ts:140-147 boucle `isCliAvailable(cli)` par provider persistant à chaque création de conversation.

</details>

### #193 — Les écrivains mémoire tournent en `mode: "plan"` dans le clone principal : avec codex, c'est `--dangerously-bypass-approvals-and-sandbox` hors de tout worktree

**Nature** risque · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:dreaming-memory-subsystem

**Fichiers**
- `lib/workflow/dreaming.ts:214-220`
- `lib/workflow/memory-distill.ts:598-606`
- `lib/providers/codex.ts:95-105`
- `lib/agent-config/constants.ts:19-20`

**Constat**

dreaming.ts:214-220 et memory-distill.ts:598-606 dispatchent avec `mode: 'plan'` et `cwd: project.gitRepoPath || process.cwd()` — aucun worktree, puisque ce sont des passes projet. `codexApprovalArgs()` (lib/providers/codex.ts:103-105) renvoie inconditionnellement le drapeau bypass, sans regarder le mode ; le docblock au-dessus dit que ce qui contient ces agents est « a disposable per-ticket git worktree », qui n'existe pas ici. Un agent nommé codex configuré pour `dreaming`/`memory_distill` (types présents dans AGENT_TYPES, lib/agent-config/constants.ts:19-20) a donc écriture libre sur le dépôt principal, avec un prompt qui embarque jusqu'à 30 queues de réponses d'agents et le texte de la mémoire (neutralisés mais non sandboxés). Instance nouvelle de la cause déjà retenue pour chat/generate-spec/QA/titrage.

**Précision du vérificateur**

Les écrivains mémoire tournent en `mode: "plan"` dans le clone principal, sans worktree : lib/workflow/dreaming.ts:263-269 et lib/workflow/memory-distill.ts:585-591 dispatchent avec `mode: "plan"` et `cwd: project.gitRepoPath || process.cwd()`, transmis tel quel par dispatch-background-session.ts:317-330. `codexApprovalArgs()` (lib/providers/codex.ts:103-105) renvoie inconditionnellement `--dangerously-bypass-approvals-and-sandbox` (poussé l.243/270, commentaire l.220-221 « No `mode` here »), et le docblock l.98-101 suppose un worktree jetable qui n'existe pas ici. Aucune garde provider/type dans agent-resolution.ts (508-560, 628-642) ; __tests__/named-agents-crud.test.ts:480-500 valide même la résolution de `memory_distill` vers `provider: "codex"`. Un agent codex assigné (ou composite/agent global par défaut codex) à `dreaming`/`memory_distill` (constants.ts:19-20) obtient donc l'écriture libre sur le dépôt principal, avec un prompt embarquant jusqu'à 30 sessions (DREAM_MAX_SESSIONS, dreaming-constants.ts:191) et la mémoire courante. Même schéma dans lib/pipeline/forensic.ts:300-301 (et spec-update.ts:186-187 / spec-auto-rewrite.ts:296-297, probablement déjà couverts par « generate-spec »). Instance nouvelle de la cause déjà retenue pour chat/generate-spec/QA/titrage.

**Recommandation**

Pour les sessions `mode: 'plan'` sans worktree, refuser codex (ou tout provider sans mode lecture seule) au niveau de `dispatchBackgroundSession`, ou leur donner un worktree jetable comme les builds.

<details><summary>Preuve relevée par l'auditeur</summary>

codex.ts:103 `function codexApprovalArgs(): string[] { return ["--dangerously-bypass-approvals-and-sandbox"]; }` sans paramètre de mode. dreaming.ts:219 `cwd: project.gitRepoPath || process.cwd()`.

</details>

## État au 11/09/2026

Livré sur la branche `feature/lot-14-providers-spawn` (worktree
`/home/orosius/workspace/.arij-worktrees/lot-14-providers-spawn`), commit unique
au-dessus du merge de `feature/epic-HeywuEXp4qYp` (fix SIGKILL, #171).

- #170 / #193 : preflight codex (`lib/providers/spawn-containment.ts`), refus de
  plan/chat/analyze hors `.arij-worktrees`. Docs mises à jour.
- #171 : branche mergée ; correction d'un défaut de la branche (repli sur
  `child.kill` quand le signal de groupe répond ESRCH sur un enfant vivant).
- #173 : claude-code passe par `getProvider` dans le process manager et les routes
  chat (POST non-stream), generate-spec, QA create-epics. **Reste** : la branche
  resume de `chat/stream/route.ts` (spawnClaude ×2) et le chemin streaming — à
  traiter avec le lot 10. Le LIVE LOG claude-code (onChunk stream-json) reste au
  lot 07.
- #174 : éviction après 5 min, prompt libéré à la fermeture.
- #181 : `which`/`codex login status` asynchrones ; mémo négatif omp 5 s. La sonde
  omp reste synchrone (préflight synchrone partagé avec le runner persistant,
  fichier réécrit par la rationalisation en cours).

Validation : tsc 0, eslint 0 sur les fichiers touchés, i18n 0 écart, suite
vitest verte sur `npm ci` propre sauf `documents-upload-platform-body-cap`
(boot `next dev` à froid > 10 s, échoue aussi sur le commit de base dans un
worktree neuf).

À merger sur `main` après la rationalisation du 10/09 ; conflits attendus faibles
(`generate-spec/route.ts` : hunks disjoints).
