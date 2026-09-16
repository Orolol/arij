# Lot 07 — Stockage des sessions, rétention, LIVE LOG

**Difficulté** 4/4 — Très difficile — agent fort + revue humaine
**Findings** 15 (5 fort · 7 moyen · 3 faible ; effort 5 S · 10 M · 0 L)
**Dépendances** Coordonner avec le lot 14 pour le spawn claude-code. Gros lot : le découper en 3 tickets (écriture, lecture, routes) si nécessaire.

## Décision

Le volume se traite à l'écriture (provider + cap par session), pas par une rétention planifiée. La rétention par jours peut rester comme filet mais n'est plus la réponse principale.

## Objectif

Base sous contrôle (les frames omp cumulatives ne sont plus persistées, cap d'octets raw par session, un seul lieu pour le résultat final), lecture par la queue pour le LIVE LOG, claude-code qui diffuse enfin en direct, page session live qui s'arrête de poller une session terminée, route de détail allégée.

## Démarche suggérée

1. Mesurer avant/après en lecture seule (requêtes dans les fiches 230/235).
2. PiProvider/OhMyPiProvider : splitter de lignes avant onRawChunk, ne pas persister tool_execution_update (ou seulement le delta).
3. appendChunk : compteur d'octets raw par session + cap (ex. 4 Mio) avec conservation de la tête et de la queue.
4. Store : page « queue » (ORDER BY sequence DESC sous budget) ; la route détail sème le raw par la queue ; readStreamTail SQL pour forensic.
5. claude-code : spawn stream-json avec onChunk relayé en chunk raw (coordonner avec le lot 14, ClaudeCodeProvider).
6. Indexer les appels mcp__arij__ à l'écriture (petite table) au lieu de rescanner le raw à chaque ouverture.
7. Arrêter logs.json pour les sessions qui ont un store de chunks ; supprimer la double écriture final-output/result-<id>.
8. Seeder une routine retention par défaut (ou retirer le kind si le cap suffit) ; exposer session_chunk_retention_days ou retirer la clé.
9. Regrouper les 22 constantes de cap ; extraire read-session.ts / list-sessions.ts de la route.
10. Page session live : isRunning dérivé du statut ; agrégat serveur pour la bande de la liste.

## Règles communes

- Brancher depuis `main` une fois la rationalisation UI du 10/09 commitée ; `npm ci` avant toute mesure (CLAUDE.md).
- Lecture seule d'abord : reprendre chaque preuve ci-dessous avec `rg` sur l'arbre courant, les numéros de ligne ont pu glisser.
- Migrations écrites à la main + entrée `_journal.json` (jamais `drizzle-kit generate`).
- Piscine : pas d'en-tête de page, état = mot/icône, couleur = stratum ou identité projet, composer depuis `@/components/piscine`.
- Tests : rouge avant vert quand le finding est un bug ; `npm run test:changed` en itérant, suite complète + `npm run i18n:check` + `npm run lint` avant de rendre.
- Fiches complètes avec filtres : https://claude.ai/code/artifact/d6b75642-3074-440b-868d-703187d8468c (chercher `#n`).

## Findings du lot

### #70 — La rétention n'a toujours aucun chemin d'exécution réel : 0 routine en base, aucun seed, fenêtre sans UI (toujours ouvert depuis le 06/09)

**Nature** à moitié câblé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** pipeline-routines

**Fichiers**
- `lib/routines/retention.ts:375-410`
- `lib/routines/crud.ts:203-206`
- `lib/routines/crud.ts:326`
- `lib/settings/writable-keys.ts:73`
- `lib/i18n/messages/en/Routines.json:36`
- `components/settings-piscine/settings-fields.ts`

**Constat**

Le code est complet (lib/routines/retention.ts, dispatché par actions.ts:258-259, dû via isDailyRoutineKind) mais rien ne crée jamais de routine `retention` : le seul INSERT dans `routines` est crud.ts:326 (création manuelle par l'UI). Lecture read-only de data/arij.db le 10/09 : `select * from routines` → [], fichier 1,24 Go, 302 905 lignes agent_session_chunks, 1 814 sessions ; aucune ligne `session_chunk_retention_days` dans settings. Cette fenêtre n'a d'ailleurs aucune UI : elle n'apparaît que dans lib/settings/writable-keys.ts:73/108 et dans le texte d'aide Routines.json:36 — pas dans components/settings-piscine/settings-fields.ts. Créer la routine exige d'ouvrir Paramètres projet → Routines → JSON brut. De plus crud.ts:203-206 ne valide que `maxDeletedChunks` et `vacuum` alors que retention.ts:386-390 lit aussi `maxCappedPrompts` et lève si non entier positif : une valeur invalide est acceptée à l'écriture et fait échouer la routine à l'exécution (échec lui-même invisible, cf. finding précédent).

**Précision du vérificateur**

Toujours ouvert depuis le 06/09 : la routine `retention` a un chemin d'exécution complet (instrumentation.ts:75 → scheduler.ts → actions.ts:258-259 → retention.ts:375) mais rien ne crée jamais de ligne `routines` de kind retention — seul INSERT : crud.ts:326 via POST /api/projects/[projectId]/routines ; aucune migration ni création de projet ne seed. Base réelle au 10/09 (readonly) : 0 routine, 0 clé `session_chunk_retention_days*` en settings, 302 905 agent_session_chunks, 1 814 sessions, fichier 1,24 Go ; l'unique autre purge (chunk-prune.ts:195) n'est consommée que par retention.ts. La fenêtre `session_chunk_retention_days` n'a aucune UI : absente de components/settings-piscine/settings-fields.ts et des réglages projet, présente seulement dans writable-keys.ts:73/108 et le hint Routines.json:36. Nuance : la création manuelle ne demande pas de JSON brut — le formulaire Routines (Select kind + config pré-remplie `{ vacuum: true }` par defaultRoutineConfig, constants.ts:75) suffit — mais reste un geste manuel par projet. Enfin crud.ts:191-194 ne valide que maxDeletedChunks/vacuum alors que retention.ts:386-390 exige `maxCappedPrompts` entier positif (throw retention.ts:330) : une valeur invalide passe à l'écriture et fait échouer le run.

Le code de rétention est complet et câblé (lib/routines/retention.ts, dispatché par actions.ts:258-259, scheduler démarré par instrumentation.ts:72-75) mais aucun chemin automatique ne crée jamais de routine `retention` : l'unique INSERT dans `routines` est crud.ts:326 (createProjectRoutine), atteint seulement par POST app/api/projects/[projectId]/routines/route.ts:59, appelé seulement par components/routines/RoutinesSettings.tsx:235. Pas de seed à la création de projet, pas de migration d'insertion, pas d'outil MCP. Base réelle le 10/09 (readonly) : `routines` = [], aucune clé `session_chunk_retention%` dans settings, fichier 1,24 Go, 302 905 agent_session_chunks, 1 814 sessions — toujours ouvert depuis l'audit du 06/09. Le chemin UI existe (Paramètres projet → Routines → sélecteur « Data retention », config pré-remplie { vacuum: true }) mais est opt-in par projet ; la fenêtre `session_chunk_retention_days` n'a aucun champ dans components/settings-piscine (seulement writable-keys.ts:73/108 et le texte d'aide Routines.json:36). Enfin crud.ts:191-195 ne valide que `maxDeletedChunks` et `vacuum` alors que retention.ts:386-390 lit aussi `maxCappedPrompts` et lève une Error si non entier ≥ 1 : une valeur invalide passe le zod `z.record(unknown)` (validation.ts) et persistedConfig, puis fait échouer la routine à l'exécution.

**Recommandation**

Seeder une routine `retention` (enabled, heure creuse) à la création de projet et via une migration pour les projets existants ; exposer `session_chunk_retention_days` dans la bande Pipeline/Workspace des réglages ; ajouter `maxCappedPrompts` à validateConfig et au hint. Vérifier ensuite sur la base réelle que le premier run prune effectivement.

<details><summary>Preuve relevée par l'auditeur</summary>

node -e avec better-sqlite3 readonly : routines → [] ; settings like 'session_chunk_retention%' → [] ; count(agent_session_chunks)=302905 ; `rg -n "insert\(routines\)" app lib` → crud.ts:326 seul ; `rg -n "session_chunk_retention" app components hooks lib` hors retention.ts → writable-keys.ts:73/108 et Routines.json:36 uniquement.

</details>

### #172 — Bande LIVE LOG vide pendant toute la durée d'une session claude-code : le provider par défaut n'écrit aucun chunk `raw`

**Nature** à moitié câblé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/claude/process-manager.ts:424-440`
- `lib/claude/process-manager.ts:394-409`
- `lib/claude/spawn.ts:299-305`
- `lib/claude/spawn.ts:442-664`
- `lib/providers/base-provider.ts:540-576`
- `components/session-live/SessionLogTail.tsx:26-34`
- `components/session-live/SessionLogTail.tsx:189-192`
- `components/session-live/LiveLogBand.tsx:182-206`

**Constat**

SessionLogTail lit uniquement le flux `raw` (components/session-live/SessionLogTail.tsx:26-34). Ce flux n'est produit que par BaseCliProvider (base-provider.ts:540-576 → onRawChunk) relayé par processManager via `onChunk` (process-manager.ts:394-409). La branche claude-code de processManager.start (424-440) appelle `spawnClaude(options)` sans aucun callback : spawn.ts:299-305 se contente d'empiler stdout, et `--output-format json` ne rend qu'un document à la sortie (le commentaire process-manager.ts:507-509 le dit : « Claude Code only returns stdout on exit »). Le repli `logsFallback` de LiveLogBand.tsx:182-206 s'appuie sur `session.logs`, écrit en fin de session (lib/pipeline/stage-session.ts:171). Résultat : « Waiting for agent output… » (SessionLive.json:57) tant que la session tourne. Mesuré sur data/arij.db (lecture seule) : 0 chunk `raw` pour les 1 288 sessions claude-code, contre 9 094 pour 137 sessions codex, 281 524 pour 58 sessions omp, 135 pour 114 sessions agy. Le spawner streaming (`spawnClaudeStream`, spawn.ts:442-664, stream-json) existe mais n'est branché que sur le chat.

**Précision du vérificateur**

Bande LIVE LOG vide pendant toute la durée d'une session claude-code : SessionLogTail (components/session-live/SessionLogTail.tsx:28-33, 187-193) ne lit que le flux `raw`, produit uniquement par BaseCliProvider (lib/providers/base-provider.ts:261-283, 544, 563) via le `onChunk` que processManager ne passe qu'aux providers non claude-code (lib/claude/process-manager.ts:394-409). La branche claude-code (424-440) appelle `spawnClaude(options)` sans callback ; spawn.ts:299-301 accumule stdout et `ClaudeOptions` n'offre aucun hook ; seul un chunk `output` final est écrit par `persistResultAsChunk` (676-700). Le repli `logsFallback` (LiveLogBand.tsx:182-206) dépend de logs.json, écrit après la fin du process (lib/pipeline/stage-session.ts:171). Résultat : « Waiting for agent output… » (SessionLive.json:57) tant que la session tourne. Mesuré en lecture seule sur data/arij.db : 0 chunk `raw` pour 1288 sessions claude-code (1181 chunks `output`), contre 9094 raw sur 177 sessions codex, 281524 sur 230 oh-my-pi, 135 sur 118 agy, 9891 sur 1 pi (les nombres de sessions du finding original — 137/58/114 — sous-comptent les totaux par provider). `spawnClaudeStream` (spawn.ts:442) n'a qu'un appelant, le chat (app/api/projects/[projectId]/chat/stream/route.ts:1151). Aucun message d'état provider-spécifique n'existe dans les clés log.* de SessionLive.json.

Finding exact. Précisions : (1) même le provider dynamique ClaudeCodeProvider.spawn (lib/providers/claude-code.ts:41-79) n'appelle jamais onChunk — retirer la garde `provider !== "claude-code"` de process-manager.ts:380 ne suffirait pas, il faut un spawn qui émette. (2) Aucune source de repli en cours de route : process-manager/stage-session ne passent pas logIdentifier, donc pas de stream-log disque non plus, et spawnClaude n'y écrirait le stdout qu'à la sortie (finishLog). (3) Les sessions claude-code ne portent que des chunks `output` (1 181 sur 1 288 sessions, chunkKey result-<id>, écrits par persistResultAsChunk après exit). (4) Le chemin UI est réel : desk (NowDesk.tsx:768) → /projects/:id/sessions/:sid → LiveSessionScreen:171 → LiveLogBand:182 → SessionLogTail:188-192 → « Waiting for agent output… » tant que status === "running".

**Recommandation**

Faire passer les sessions agent claude-code par un spawn stream-json (réutiliser spawnClaudeStream ou ajouter un onChunk à spawnClaude) et relayer chaque ligne NDJSON en chunk `raw` comme le fait base-provider. À défaut, afficher un état explicite « ce provider ne diffuse pas en direct » plutôt qu'un « Waiting for agent output… » permanent.

<details><summary>Preuve relevée par l'auditeur</summary>

Requête read-only better-sqlite3 sur data/arij.db : `select provider, count(*) from agent_session_chunks c join agent_sessions s ... where stream_type='raw' group by provider` → agy 135, codex 9094, oh-my-pi 281524, pi 9891 ; aucune ligne claude-code. process-manager.ts:426 `const spawned = spawnClaude(options);` (pas d'onChunk) ; SessionLogTail.tsx:28-33 « It reads the `raw` stream, and only `raw` ».

</details>

### #230 — Le flux raw persiste chaque frame progressive `tool_execution_update` d'omp : 543 Mo sur 817 Mo sont des réémissions cumulatives du même résultat d'outil

**Nature** cassé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `lib/providers/base-provider.ts:540-575`
- `lib/providers/base-provider.ts:261-286`
- `lib/providers/pi.ts:91-130`
- `lib/providers/pi.ts:282`
- `lib/claude/process-manager.ts:393-409`

**Constat**

Le flux `raw` est écrit par lib/providers/base-provider.ts:540-575 : un `appendSessionChunk` par événement `data` du pipe stdout/stderr (clé `stdout:N`), sans aucun parsing — d'où des lignes de 65 536 octets max (taille d'une lecture de pipe) et 262 022 lignes < 1 Ko (une ligne NDJSON chacune). Pour oh-my-pi (`--mode json`, lib/providers/pi.ts:282), chaque événement `tool_execution_update` transporte `partialResult` = TOUTE la sortie accumulée de l'outil depuis le début ; le provider persiste donc n frames de taille croissante pour un résultat de taille finale f (O(n²)). Mesuré en lecture seule sur data/arij.db : session ZZAP6QWzM-Ss (112,7 Mo, 3 015 lignes, 20 min) → 104,7 Mo de `tool_execution_update` contre 1,2 Mo de `tool_execution_end` ; le seul appel `npm test` (call_1873934) = 517 frames, 24,7 Mo persistés pour 51 150 octets de texte final (×483). Sur les 58 sessions omp qui ont un flux raw (817 Mo = 90 % du raw), 543,6 Mo (66,5 %) sont des `tool_execution_update`. 35 sessions ≥ 5 Mo (toutes omp/build des 26-27/08) portent 817 Mo des 911 Mo. Codex, lui, écrit 87,9 Mo de stderr (progression) pour 0,2 Mo de stdout.

**Précision du vérificateur**

Le flux `raw` est écrit par lib/providers/base-provider.ts:540-575 : un `appendSessionChunk` par événement `data` du pipe (clé `stdout:N`), sans découpage ni parsing — lignes de 65 536 octets max (lecture de pipe, le cap d'écriture est à 256 Kio) et ~267 000 lignes < 1 Ko. Aucun provider ne surcharge `buildChunkCallbacks` et rien ne filtre `tool_execution_update`. Pour oh-my-pi (`--mode json`, pi.ts:282), chaque `tool_execution_update` transporte dans `partialResult` la sortie accumulée de l'outil, plafonnée à une fenêtre de queue d'environ 50 Ko une fois cette taille dépassée : le provider persiste donc n frames de ~min(f, 50 Ko) chacune pour un résultat final f (O(n × fenêtre), quadratique jusqu'à 50 Ko). Mesuré : session ZZAP6QWzM-Ss (112,7 Mo, 3 015 lignes, 20 min) → 105,5 Mo de `tool_execution_update` contre 1,2 Mo de `tool_execution_end` ; `npm test` call_1873934 = 518 frames, 24,7 Mo persistés pour 51 Ko de texte final (×483). Sur les 58 sessions omp avec flux raw (817 Mo = 90 % des 911 Mo de raw), 548 Mo (66,6 %) sont des `tool_execution_update`. Les 35 sessions ≥ 5 Mo portent 817 Mo : 32 omp (26/08 → 10/09, donc toujours actif en septembre), 2 codex, 1 pi. Codex écrit 87,9 Mo de stderr (progression) pour 0,2 Mo de stdout.

Le flux `raw` est écrit par lib/providers/base-provider.ts:540-575 : un `appendSessionChunk` (lib/claude/process-manager.ts:393-409) par événement `data` du pipe, clé `stdout:N`, sans parsing — la déduplication par clé de chunks.ts:583-660 est donc inopérante et le cap 256 KiB par chunk ne mord jamais (max 65 536 octets, 267 049 rows < 1 Ko). Ni PiProvider ni OhMyPiProvider ne surchargent `buildChunkCallbacks` ; `tool_execution_update`/`partialResult` n'apparaissent nulle part dans le code. Avec `--mode json` (pi.ts:282), chaque `tool_execution_update` porte le `partialResult` cumulé : session ZZAP6QWzM-Ss (omp, 27/08, 20 min) = 3 015 rows / 112,7 Mo dont 105,5 Mo de `tool_execution_update` contre 1,2 Mo de `tool_execution_end` ; `call_1873934` (npm test) = 518 frames, 25,5 Mo persistés pour 52,7 Ko de résultat final (partialResult 89 → 52 137 chars, ×484). Sur les 58 sessions omp avec raw (817,5 M chars = 90 % des 911,1 M du raw), 548,0 Mo sur 823,2 Mo (66,6 %) sont des `tool_execution_update`. Les 35 sessions ≥ 5 M chars (817,2 M) sont 32 omp + 2 codex + 1 pi, modes code/plan, du 26/08 au 10/09 (pas seulement 26-27/08 ; omp toujours actif, 230 sessions). Codex écrit 87,9 M chars de stderr pour 0,23 M de stdout. Le flux est réellement consommé : LiveSessionScreen → LiveLogBand → SessionLogTail (raw paginé, route sessions/[sessionId]:196) et, plus coûteux, `?view=arij-actions` (arij-actions.ts:490) et forensic.ts:161 chargent le flux entier en mémoire via `listSessionChunks`. La rétention 30 jours (chunk-prune.ts/retention.ts) existe déjà mais n'agit qu'a posteriori.

**Recommandation**

Traiter le volume à la source, dans le provider, pas par une rétention a posteriori : dans PiProvider/OhMyPiProvider, surcharger `buildChunkCallbacks` (ou insérer un splitter de lignes avant `onRawChunk`) pour ne pas persister les frames `tool_execution_update` (ou n'en garder que le delta par rapport à la précédente pour le même toolCallId), garder `tool_execution_start/end`, `message_*`. Même logique pour la progression stderr de codex si elle est cumulative. Un `data` event ≠ une unité sémantique : découper en lignes NDJSON avant de persister rendrait aussi le dédoublonnage par clé significatif. Ajouter un budget d'octets raw par session à l'écriture (voir finding rétention).

<details><summary>Preuve relevée par l'auditeur</summary>

node readonly sur data/arij.db : `raw by provider` → oh-my-pi 281 524 lignes / 817 452 025 chars / 58 sessions ; `per-session raw chars distribution` → ≥5M : 35 sessions / 817 203 582 chars ; reconstitution du flux de ZZAP6QWzM-Ss : bytes by type = tool_execution_update 104 673 132, tool_execution_end 1 222 166 ; longueurs successives des updates de call_1873934 : 214, 216, 339, 562 … 51 561, 52 262 ; 58 sessions omp : 543 602 934 / 817 452 086 octets en tool_execution_update. base-provider.ts:540 `child.stdout?.on("data", …) → callbacks.onRawChunk?.({source:"stdout", index, text})` sans parsing ; pi.ts:91-130 parse pourtant déjà le NDJSON (message_end) à la fin du run.

</details>

### #231 — La bande LIVE LOG lit le flux raw par la tête : aucun chemin de lecture « queue » n'existe, une session terminée de 112 Mo s'ouvre sur ses 64 premiers Kio

**Nature** à moitié câblé · **Impact** fort · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `app/api/projects/[projectId]/sessions/[sessionId]/route.ts:373-384`
- `lib/agent-sessions/session-detail.ts:68-71`
- `lib/agent-sessions/chunks.ts:355-389`
- `components/session-live/useSessionStreamPager.ts:106-131`
- `components/session-live/SessionLogTail.tsx:27-33,139-165`
- `components/session-live/LiveLogBand.tsx:183-186`

**Constat**

La route détail sème `chunkStreams.raw` avec `readChunkPage(sessionId, streamType, {limit: 20, maxBytes: 64 KiB})` SANS `after` (app/api/…/sessions/[sessionId]/route.ts:373-384), donc les 20 premiers chunks. Le store n'a que des lectures ascendantes (`listChunksStmt` orderBy asc, `pageChunksStmt` `gt(sequence, after)` — chunks.ts:355-389) ; le pager client n'avance que d'une page ≤ 1 Mio par appel (useSessionStreamPager.ts:106-128) et, pour une session en cours, d'une page par poll de 3 s (l.131). SessionLogTail épingle le scroll au bas de ce qui est CHARGÉ (l.139-165), c'est-à-dire au bas de la tête du flux. Conséquences : pour ZZAP6QWzM-Ss (112 Mo, terminée) la bande « tail » affiche le début et il faut ~112 clics « Load more » pour atteindre la fin ; pour une session omp en cours (mesuré 91 Ko/s), le lecteur commence par rejouer tout le backlog à 1 Mio/3 s avant d'atteindre le direct. Le module de rétention (chunk-prune.ts:14-24) et le forensic (readChunkTail) considèrent pourtant la QUEUE comme la seule partie utile — c'est exactement celle que l'UI ne sait pas demander.

**Précision du vérificateur**

La bande LIVE LOG ne sait lire le flux `raw` que par la tête. La route détail sème `chunkStreams.raw` avec `readChunkPage(sessionId, streamType, {limit: 20, maxBytes: 64 KiB})` sans `after` (route.ts:376-381) ; le store n'a que des lectures ascendantes (`listChunksStmt` asc, `pageChunksStmt` `gt(sequence, after)` + asc, chunks.ts:355-389 ; aucun `desc`/`before` dans le fichier ni dans aucun consommateur de `?stream=`). Le pager client (useSessionStreamPager.ts:105-118) n'avance que d'une page ≤ 1 Mio par appel, et d'une page par poll de 3 s pour une session en cours (`useSessionPolling(key, load, isRunning, 3000)`, l.127 — pas l.131) ; SessionLogTail (l.149-165) épingle le scroll au bas du contenu chargé, donc au bas de la tête. Pour ZZAP6QWzM-Ss (completed, oh-my-pi, 1 240 s, raw = 3 015 chunks / 112 707 865 chars, 0 marqueur de prune) le seed ne contient en fait qu'un seul chunk (le n°1, tronqué à ~64 KiB, car il dépasse à lui seul le budget) et ~108 clics « Load more » sont nécessaires pour atteindre la fin. Le forensic (`readChunkTail`, forensic.ts:154-170) et la rétention (chunk-prune.ts:17-21) traitent la queue comme la seule partie utile ; seule une session déjà élaguée (hors fenêtre de rétention, 30 j par défaut) s'ouvre sur sa queue, par effet de bord de la suppression de la tête.

La bande LIVE LOG (page sessions/[sessionId] → LiveLogBand → SessionLogTail → useSessionStreamPager) est semée par la route détail avec la TÊTE du flux raw (readChunkPage sans `after`, limit 20 / 64 KiB — pour ZZAP6QWzM-Ss le budget d'octets ferme le seed avant 20 chunks, les 20 premiers pesant 397 Ko). Le store n'a que des lectures ascendantes (asc + `gt(sequence, after)`), la route et fetchSessionChunkPage n'acceptent qu'`after`/`offset`, et le pager avance d'une page ≤ 1 MiB par clic « Load more » ou par poll de 3 s quand la session tourne. Le pin de scroll épingle donc le bas de la tête chargée : pour la session terminée de 112,7 Mo (3 015 chunks, non pruneée à 15 jours), ~108 clics pour atteindre la fin ; pour une session en cours, tout le backlog est rejoué à 1 MiB/3 s avant d'atteindre le direct. Seuls readChunkTail (forensic, dreaming) et la rétention (chunk-prune, tail par flux, défaut 30 jours) lisent la queue — aucun chemin UI/API ne l'expose ; une session ne s'ouvre « sur sa fin » qu'une fois pruneée passé la fenêtre de rétention.

**Recommandation**

Ajouter au store une page « queue » (`ORDER BY sequence DESC LIMIT n` sous budget d'octets, puis renversée) et faire semer la route avec la queue pour `raw` (le pager remonte ensuite vers l'amont avec un curseur `before`). Pour une session en cours, partir de la queue puis suivre avec `after`. Cela rend cohérents UI, forensic et rétention sur « ce qui compte est la fin ».

<details><summary>Preuve relevée par l'auditeur</summary>

route.ts:376 `readChunkPage(sessionId, streamType, { limit: SESSION_DETAIL_PREVIEW_LIMIT, maxBytes: SESSION_DETAIL_PREVIEW_BYTES })` — pas de `after` ; chunks.ts:381 `gt(agentSessionChunks.sequence, sql.placeholder("after"))`, aucun `desc`/`before` dans le fichier ; useSessionPolling(key, load, isRunning, 3000) avec `load` = une seule page ; grep `after` dans LiveLogBand.tsx : aucun. DB : ZZAP6QWzM-Ss 3 015 chunks / 112 707 865 chars ; durée 1 240 s.

</details>

### #235 — Même planifiée, la rétention par fenêtre de jours ne bornerait pas la base : 90 % des octets viennent de 35 sessions écrites en 48 h, et la fenêtre par défaut de 30 jours ne libère rien aujourd'hui

**Nature** risque · **Impact** fort (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `lib/routines/retention.ts:107-133`
- `lib/routines/retention.ts:36-69`
- `lib/agent-sessions/chunk-prune.ts:174-183`
- `lib/agent-sessions/chunks.ts:574-660`

**Constat**

Complément au finding « rétention jamais exécutée » (toujours vrai : 0 ligne dans `routines`, 0 clé `session_chunk_retention_*` dans `settings`). Le point nouveau est le dimensionnement : chunk-prune.ts (425 l.) + retention.ts (551 l.) + chunk-retention.ts (64) + prompt-backfill.ts (141) ≈ 1 180 lignes (+ ~1 350 lignes de tests) implémentent un critère TEMPOREL (`terminalAt <= cutoff`, chunk-prune.ts:174-183) avec `DEFAULT_SESSION_CHUNK_RETENTION_DAYS = 30` (retention.ts:133). Le plus vieux chunk date du 26/08 (15 jours) : une exécution aujourd'hui scannerait 0 session éligible — la doc du fichier le reconnaît (retention.ts:126-131 « a 30-day pass reclaimed NOTHING »). Le problème réel est volumétrique, pas temporel : 35 sessions ≥ 5 Mo = 817 Mo (90 %), toutes des builds omp des 26-27/08 (762 Mo sur ces deux jours) ; les 115 sessions < 100 Ko pèsent 0,2 Mo. Un budget d'octets par session à l'écriture (ou la suppression des frames cumulatives, cf. finding omp) aurait borné la table à quelques dizaines de Mo sans routine, sans VACUUM différé (retention.ts:36-69), sans marqueur.

**Précision du vérificateur**

La rétention (jamais planifiée : 0 ligne `routines`, 0 clé `session_chunk_retention_*`) repose sur un critère purement temporel (chunk-prune.ts:174-181, `julianday(COALESCE(ended_at, completed_at, created_at)) <= cutoff`, statuts completed/failed/cancelled) avec un défaut de 30 jours (retention.ts:133). Le plus vieux chunk datant du 25/08 (raw : 26/08), une exécution aujourd'hui ne sélectionnerait 0 session — ce que retention.ts:125-131 documente, en renvoyant vers le réglage `session_chunk_retention_days` (7 jours mesurés → 72,7 Mio). Le volume est concentré : 35 sessions raw ≥ 5 Mo = 817 Mo (90 % du raw), dont 27 des 26-27/08 (762 Mo de raw sur ces deux jours ; majoritairement omp, mais aussi 1 pi et 2 codex) et 8 omp du 31/08 au 10/09 ; 115 sessions < 100 Ko pèsent 0,2 Mo. Le seul cap à l'écriture est par chunk (`capChunkContent`, 256 Kio, chunks.ts:174/614), aucun budget par session n'existe. Un cap par session à l'écriture aurait bien contenu ces sessions, mais à 4 Mio il laisserait ~240 Mo de raw (+72 Mo output/response), pas « quelques dizaines de Mo » ; il faudrait ~1 Mio pour descendre à ~100 Mo. Le problème est donc un défaut de valeur par défaut et d'absence de borne volumétrique, pas l'absence de toute borne.

La rétention est câblée de bout en bout (UI RoutinesSettings → POST /routines → scheduler démarré par instrumentation.ts → runRetentionRoutine ; marqueur affiché par SessionLogTail/SessionOutputStream) mais jamais instanciée : 0 ligne dans `routines`, 0 clé `session_chunk_retention_*` dans `settings`. Le critère est temporel (`chunk-prune.ts:172-181`, `terminalAt <= cutoff` sur completed/failed/cancelled) avec défaut 30 j (`retention.ts:133`) : mesuré aujourd'hui avec la requête exacte du pruner, 0 session éligible à 30 j, 514 sessions / 333 Mo raw à 15 j, 883 / 821 Mo à 7 j. La fenêtre n'est réglable que par l'API settings (`session_chunk_retention_days`, `lib/settings/writable-keys.ts:73`), aucun champ UI. Le problème est volumétrique : 39 sessions ≥ 5 Mo = 876 Mo sur 983 Mo de chunks (89 %), 36 d'entre elles oh-my-pi (839 Mo) des 26-27/08 (826 Mo) ; plus grosse session 112,7 Mo raw ; seul cap à l'écriture existant = 256 KiB par chunk (`chunk-cap.ts`), aucun budget par session dans `appendChunk` (`chunks.ts:583`). `chunk-retention.ts` et `prompt-backfill.ts` sont sous `lib/agent-sessions/`, pas `lib/routines/` ; plus vieux chunk 25/08 (17 j). `agent_sessions.prompt` (144,8 Mo, 1 083 lignes > 64 Kio) dépend de la même routine jamais créée.

**Recommandation**

Remplacer le pruner planifié par un cap par session dans appendChunk : compteur d'octets raw par session (agent_session_sequences peut porter `raw_bytes`), au-delà d'un budget (ex. 4 Mio) supprimer les plus anciens chunks raw de la session en gardant la tête (prompt echo, premières commandes) et la queue ; conserver output/response intacts (72 Mo à eux deux). Retirer retention.ts/chunk-prune.ts/prompt-backfill.ts et leurs tests, ou les réduire à un `VACUUM` manuel documenté.

<details><summary>Preuve relevée par l'auditeur</summary>

DB : `routines` → [] ; `retention settings` → [] ; `sessions by age bucket (raw chars)` → 2026-08-26 : 36 sessions / 332 847 700 ; 2026-08-27 : 19 / 429 278 678 ; total ≥5M : 35 sessions / 817 203 582 ; <100k : 115 sessions / 205 158. wc -l : chunk-prune 425, retention 551, chunk-retention 64, prompt-backfill 141 ; __tests__/session-chunk-retention.test.ts ~960 l., session-prompt-backfill.test.ts ~430 l.

</details>

### #113 — La page de session live interroge deux endpoints toutes les 3 s indéfiniment, même pour une session terminée, en neutralisant la logique « dernière lecture » du hook

**Nature** risque · **Impact** moyen (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/projects/[projectId]/sessions/[sessionId]/page.tsx:15-20,117-121`
- `components/session-live/useSessionPolling.ts:56-64`
- `app/api/projects/[projectId]/sessions/[sessionId]/route.ts:283-300,330-345`

**Constat**

`sessions/[sessionId]/page.tsx:117-118` appelle `useSessionPolling(key, readSession, true, 3000)` et `useSessionPolling(key+":actions", readActions, true, 3000)` avec `isRunning` codé à `true`. Le hook (useSessionPolling.ts:56-64) possède justement un mécanisme « transition running→terminal → une lecture finale puis arrêt » ; avec `true` en dur il est mort pour cette page. Résultat : une page de session terminée laissée ouverte frappe `GET /sessions/:id` (3 lectures de chunks + logs.json + collectDurableArijActions) et `?view=arij-actions` (scan du flux brut, route.ts:283-300) toutes les 3 s, alors que les streams (`useSessionStreamPager`) et `/files` sont, eux, correctement gatés sur `isRunning`. La rationalisation a introduit ce hook ici (diff : `usePolling(loadSession, 3000)` → deux `useSessionPolling(…, true, …)`) sans brancher `isRunning`.

**Précision du vérificateur**

app/projects/[projectId]/sessions/[sessionId]/page.tsx:98-99 appelle deux fois `useSessionPolling(…, true, 3000)` avec `isRunning` codé à `true`, ce qui rend inopérant le mécanisme « transition running→terminal → dernière lecture puis arrêt » de components/session-live/useSessionPolling.ts:55-63, alors que useSessionStreamPager.ts:127, useSessionFiles.ts:77 et la page chat (sessions/chat/[conversationId]/page.tsx:106) branchent bien l'état. Une page de session terminée laissée ouverte rejoue donc toutes les 3 s le GET métadonnées complet (route.ts:371-400 : logs.json parsé, 3 previews de chunks, actions durables) et le GET `?view=arij-actions`. Nuances : (a) ce n'est pas une régression — HEAD avait déjà `usePolling(loadSession, 3000)` inconditionnel et le déclarait voulu (commentaire HEAD :25, commit 99e2de34) ; la rationalisation a seulement ajouté un hook qui permettrait d'arrêter sans le brancher, tout en annonçant dans docs/architecture/ui-rationalisation-2026-09-10.md:45 une « dernière lecture garantie à la fin d'une session » qui ne vaut ici que pour streams et fichiers ; (b) le poll d'actions est bon marché après le premier passage : lib/agent-sessions/arij-action-scan.ts:63-122 reprend à un curseur en cache LRU (16 sessions) et ne relit rien pour une session terminée déjà scannée, sauf éviction ou redémarrage. Le vrai coût récurrent est le GET métadonnées. Correctif : passer `session?.status === "running" || session?.status === "queued"` (statuts confirmés dans lib/agent-sessions/lifecycle-status.ts:19) comme `isRunning` aux deux appels.

`app/projects/[projectId]/sessions/[sessionId]/page.tsx:98-99` passe `isRunning=true` en dur aux deux `useSessionPolling` (metadata + `?view=arij-actions`), donc `hooks/usePolling.ts:31` garde un `setInterval` de 3 s tant que la page est montée, y compris pour une session terminée, et l'effet « dernière lecture à la transition » de `components/session-live/useSessionPolling.ts:61-67` ne peut jamais se déclencher — alors que `useSessionStreamPager.ts:127` et `useSessionFiles.ts:77` sont gatés sur `isRunning`. Ce n'est toutefois pas une régression de la rationalisation : HEAD (99e2de34) et la version antérieure (4802b4d3, `usePolling(loadSession, 3000)`) pollaient déjà sans garde, le commentaire HEAD le déclarait délibéré, et le nouveau test non suivi `__tests__/session-detail-lifecycle.test.tsx:85-94` épingle 3 lectures metadata en 6 s pour une session `completed`. Le coût récurrent pour une session terminée est borné : la vue actions reprend derrière un curseur serveur (`lib/agent-sessions/arij-action-scan.ts:105-120`, requête indexée `sequence > after` rendant une page vide, re-scan seulement après éviction du LRU de 16 ou redémarrage) ; la vue par défaut (`route.ts:347-401`) coûte 1 select, 3 pages de prévisualisation, `collectDurableArijActions` et surtout `readSessionLogs` (:83-97, lecture + JSON.parse de logs.json capé) toutes les 3 s. Lignes citées à corriger : page.tsx 98-99 (pas 117-118), route.ts 326-345 pour la vue actions (pas 283-300) et 347-401 pour le payload par défaut. Si l'on gate sur `running`/`queued`, il faut aussi changer le test lifecycle qui exige l'inverse.

**Recommandation**

Passer `session?.status === "running" || session?.status === "queued"` comme `isRunning` (le hook garantit alors la lecture finale à la transition), et laisser le bouton Refresh pour le reste.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:117 `useSessionPolling(\`${projectId}:${sessionId}\`, readSession, true, 3000, { immediate: true })` ; commentaire :17-19 « Metadata and the expensive action scan poll independently, including for finished sessions ». `git diff` du fichier montre le remplacement de `usePolling(loadSession, 3000)`.

</details>

### #114 — La liste des sessions parcourt tout le keyset côté client pour calculer une bande de synthèse de quatre cellules, avec des types miroirs écrits à la main

**Nature** refacto · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** session-live-releases-spec

**Fichiers**
- `app/projects/[projectId]/sessions/page.tsx:50-88,283-357`
- `app/api/projects/[projectId]/sessions/route.ts:164-165,193-262`
- `lib/agent-sessions/session-list.ts:43-62`

**Constat**

`sessions/page.tsx:283-323` suit `nextCursor` jusqu'à la fin de la liste (pages de 200) à chaque montage, uniquement pour dériver `band` (running/queued/today/coût, :333-357) et permettre le tri « last activity ». La route `GET /sessions` n'accepte que `limit`/`cursor` (sessions/route.ts:164-165), aucun filtre ni agrégat. Le commentaire de la page mesure 733 sessions → 4 requêtes gaspillées au seul changement de projet. Les interfaces `AgentSession`/`ChatSession` (page.tsx:50-88) reproduisent à la main la projection de la route (:193-262) sans type partagé ; `lib/agent-sessions/session-list.ts` n'exporte que des types de pagination génériques (`UnifiedSessionListPage<T = unknown>`).

**Précision du vérificateur**

La page Sessions charge bien tout le keyset côté client à chaque montage (`app/projects/[projectId]/sessions/page.tsx:288`, `fetchUnifiedSessions<UnifiedSession>(projectId, {signal, onPage})`, pages de 200 via `SESSION_LIST_DEFAULT_PAGE_SIZE`), et la route `GET /api/projects/[projectId]/sessions` n'accepte que `limit` et `cursor` (route.ts:163-165) — aucun filtre état/provider ni agrégat côté serveur. Mais le walk complet n'est PAS « uniquement » pour la bande de quatre cellules : la page rend la liste exhaustive non fenêtrée (`visible.map` à page.tsx:703, aucun slice ni virtualisation) avec recherche et filtres état/provider appliqués en mémoire sur `items` (:363-411), plus le tri « last activity » (:399-410) et la bande (:337-361). La liste elle-même exige donc la totalité des lignes tant que filtres et tri restent clients ; l'agrégat serveur seul ne supprimerait pas le walk, il faudrait aussi déporter filtres/tri (ce que la recommandation dit à moitié). Second correctif : les « 4 requêtes gaspillées au changement de projet » citées comme coût actuel sont, dans le commentaire même (:255-260), le coût que l'`AbortController` ajouté à cet effet SUPPRIME — c'est une mesure d'échelle (733 sessions ≈ 4+ pages), pas un gaspillage encore présent. Exact en revanche : les interfaces `AgentSession`/`ChatSession` (page.tsx:51-88) rejouent à la main la projection de la route (:175-262) et `lib/agent-sessions/session-list.ts` n'exporte aucun type de ligne (seulement `UnifiedSessionListPage<T = unknown>`, `UnifiedSessionPagingOptions`, `FetchUnifiedSessionsOptions<T>`, :43-70) ; le même miroir se répète en réduit dans `hooks/useTicketOverlayData.ts:97-101` (`UnifiedSessionRow`).

**Recommandation**

Exposer un agrégat serveur (`?summary=1` ou route sœur) pour la bande, et servir les filtres état/provider côté serveur ; exporter le type de ligne unifiée depuis `lib/agent-sessions/session-list.ts` et l'importer dans la page.

<details><summary>Preuve relevée par l'auditeur</summary>

page.tsx:288 `await fetchUnifiedSessions<UnifiedSession>(projectId, { signal, onPage })` (walk complet) ; route : `searchParams.get("limit")`, `searchParams.get("cursor")` seulement ; `rg -n "^export (type|interface)" lib/agent-sessions/session-list.ts` → aucun type de ligne.

</details>

### #156 — La route de détail de session porte 500 lignes de lecture de fichiers, de cap et de fusion d'actions ; lib/agent-sessions/session-detail.ts n'en contient que le contrat client

**Nature** refacto · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** agent-sessions-config-mcp

**Fichiers**
- `app/api/projects/[projectId]/sessions/[sessionId]/route.ts:83-182`
- `app/api/projects/[projectId]/sessions/[sessionId]/route.ts:184-253`
- `app/api/projects/[projectId]/sessions/[sessionId]/route.ts:255-437`
- `app/api/projects/[projectId]/sessions/route.ts:100-272`
- `lib/agent-sessions/session-detail.ts`

**Constat**

app/api/projects/[projectId]/sessions/[sessionId]/route.ts (503 lignes) implémente dans la route readSessionLogs (stat/parse/cap de logs.json, 100 lignes), readChunkPage, readArijActions, la projection sans prompt, la résolution du composite, le cap de lastNonEmptyText, puis un DELETE qui orchestre scheduler + processManager + lifecycle + QA. La liste (sessions/route.ts, 272 lignes) embarque de même le keyset SQL, l'encodage de curseur et la fusion sessions/conversations. Le module lib/agent-sessions/session-detail.ts ne porte que les constantes et les fetchers client. Toute la logique serveur de lecture d'une session est donc non réutilisable (le desk et l'overlay refont leurs propres lectures) et testable seulement via la route.

**Précision du vérificateur**

La route de détail de session (503 l.) définit en local `readSessionLogs` (l.83), `readChunkPage` (l.184), `readArijActions` (l.222) et les parseurs de curseur, et la route liste (272 l.) porte le keyset SQL, l'encodage de curseur (l.92-120) et la fusion sessions/conversations (l.212-271) — c'est une longueur de route inhabituelle et une extraction possible. Mais la motivation avancée ne tient pas : `readChunkPage`/`readArijActions` ne sont que des enveloppes try/catch autour de `lib/agent-sessions/{chunks,arij-actions,arij-action-scan}.ts` (seul `readSessionLogs`, ~65 l., est de la vraie logique locale), et il n'y a AUCUNE lecture dupliquée ailleurs : le desk (`components/desk/NowDesk.tsx:455`) et l'overlay (`hooks/useTicketOverlayData.ts:370`) consomment la même route par fetch, la pagination partagée vit dans `lib/agent-sessions/session-list.ts` (`findUnifiedSession`, importé par l'overlay l.52) et les bornes/fetchers client dans `session-detail.ts`. Le comportement est par ailleurs couvert par six suites qui importent le module de route. Finding cosmétique, pas structurel.

**Recommandation**

Extraire lib/agent-sessions/read-session.ts (readSessionLogs, readChunkPage, readArijActions, buildSessionDetail) et lib/agent-sessions/list-sessions.ts (keyset + merge) ; garder les routes comme fines couches d'I/O, ce qui permet aussi aux lectures du desk/overlay de partager la même projection.

<details><summary>Preuve relevée par l'auditeur</summary>

wc -l → 503 et 272 lignes. rg 'function readSessionLogs|function readChunkPage|function readArijActions' → définis dans la route (l.83, 184, 222). session-detail.ts : uniquement des `export const` de bornes et fetchSessionArijActions/fetchSessionChunkPage/fetchSessionStream côté client (window.location.origin).

</details>

### #232 — readChunkTail matérialise tout le flux (jusqu'à 112 Mo) pour en garder 8 000 caractères, sur la connexion synchrone partagée

**Nature** risque · **Impact** moyen · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `lib/pipeline/forensic.ts:154-167`
- `lib/pipeline/forensic.ts:268-277`
- `lib/workflow/dreaming-collector.ts:437-442`
- `lib/pipeline/constants.ts:359-362`
- `lib/routines/retention.ts:164-180`

**Constat**

lib/pipeline/forensic.ts:154-167 : `listSessionChunks(sessionId, streamType).map(c => c.content).join("")` puis `.slice(-maxChars)`. C'est l'un des deux derniers appelants produit de `listSessionChunks` (l'autre est une branche morte, voir finding dédié). Appelé par runForensic sur le raw ET l'output d'une session morte (forensic.ts:268-277) et par le collecteur Dreaming pour chaque session candidate sur response/output (dreaming-collector.ts:437-442). Sur la base live, le plus gros flux raw est 112,7 Mo et 27 chunks output/response dépassent 256 Kio (57 Mo au total) ; le forensic d'une session omp de build morte lit donc jusqu'à 112 Mo, en synchrone, pour construire 8 Ko de prompt. Le store sait déjà faire `length()`/`substr()` côté SQLite (chunks.ts:366-407) mais n'expose aucune lecture descendante. Les budgets de rétention `SESSION_CHUNK_RETAINED_TAIL_CHARS` sont dérivés de ce lecteur (retention.ts:164-180), ce qui a figé la conception « on garde N caractères de queue » sur un lecteur qui lit tout.

**Précision du vérificateur**

lib/pipeline/forensic.ts:154-167 : `readChunkTail` matérialise tout le flux via `listSessionChunks` (SELECT complet ascendant, chunks.ts:355-364/685-689, sur la connexion better-sqlite3 synchrone partagée) puis `.slice(-maxChars)`. C'est le seul appelant produit vivant de `listSessionChunks` — arij-actions.ts:490 n'est atteint par aucun appelant produit (la route passe toujours `chunks: []`, le scan est dans arij-action-scan.ts). Appelé par `runForensic` sur `raw` (8 000) et `output` (4 000) d'une session morte, minutes après sa mort donc avant tout prune (forensic.ts:268-277, runner-retry.ts:85), et par Dreaming sur `response` puis, seulement si vide, `output` (dreaming-collector.ts:436-443). Base live : plus gros flux raw 112,7 Mo / 3 015 rows (session omp build *completed*) ; 27 chunks output/response > 256 Kio pour 57,4 Mo ; la plus grosse session omp build *failed* porte 12,2 Mo d'output + 8,3 Mo de response. Le store possède déjà `substr()`/`length()` (chunks.ts:373-395) mais n'expose aucune lecture descendante. Les budgets de rétention `SESSION_CHUNK_RETAINED_TAIL_CHARS` (retention.ts:164-180) sont dérivés de ce lecteur.

readChunkTail (lib/pipeline/forensic.ts:154-167) matérialise tout le flux via listSessionChunks (SELECT non borné, ORDER BY sequence ASC, sur la connexion better-sqlite3 synchrone) pour n'en garder que slice(-maxChars). Deux chemins produit réels l'atteignent : le post-mortem du pipeline (routes build epic/story et night run → runner-retry.ts:85 → runForensic → forensic.ts:268-277, raw 8000 + output 4000 chars ; 28 sessions forensic en base) et le digest Dreaming (POST /api/projects/:id/memory/dream et night run → collectDreamDigest → resolveFinalText, dreaming-collector.ts:436-442, response puis output par candidat). Le store n'offre que des pages ascendantes avec substr (chunks.ts:366-407), aucune lecture par la queue. Mesures live : plus gros flux raw 112,7 Mo (session build omp complétée — borne haute, pas un forensic mesuré) ; 27 chunks > 256 Kio totalisant 57,4 Mo (18 output, 9 response). Les budgets de rétention (retention.ts:164-180, chunk-prune.ts:19-22) sont dérivés de ce lecteur ; de plus le commentaire retention.ts:112-117 (« Dreaming lit last_non_empty_text ») est périmé face au collecteur non tracké qui lit les flux.

**Recommandation**

Ajouter au store une `readStreamTail(sessionId, streamType, maxChars)` : `SELECT substr(content, -?, ?) … ORDER BY sequence DESC` accumulée jusqu'au budget, ou réutiliser la page « queue » du finding précédent. Faire pointer forensic et dreaming dessus et supprimer `listSessionChunks` (plus d'appelant).

<details><summary>Preuve relevée par l'auditeur</summary>

grep `listSessionChunks(` hors chunks.ts → forensic.ts:161 et arij-actions.ts:490 uniquement ; forensic.ts:161-165 `joined = listSessionChunks(...).join(""); … joined.slice(-maxChars)` ; DB : max raw par session 112 707 865 chars ; `chunks > 256KiB` = 27 lignes / 57 403 969 chars.

</details>

### #234 — Vingt-deux constantes de cap dans huit fichiers, deux vocabulaires de marqueurs et deux rendus pour des marqueurs qu'aucune ligne de la base n'a jamais portés

**Nature** refacto · **Impact** moyen (vérificateur : plutôt moins) · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `lib/agent-sessions/chunks.ts:41-67,158-178`
- `lib/agent-sessions/chunk-cap.ts`
- `lib/agent-sessions/chunk-retention.ts`
- `lib/agent-sessions/prompt-cap.ts`
- `lib/agent-sessions/prompt-backfill.ts`
- `lib/agent-sessions/session-detail.ts:59-118`
- `lib/agent-sessions/arij-action-scan.ts:41-46`
- `components/session-live/SessionLogTail.tsx:183-201`
- `components/sessions/SessionOutputStream.tsx:44-77`

**Constat**

Inventaire vérifié : caps d'écriture (capChunkContent 256 Kio chunks.ts:158-178 ; capSessionPrompt 128 Kio lifecycle.ts:388-402), caps de lecture (SESSION_CHUNK_PAGE_MAX_BYTES 1 Mio, SESSION_CHUNK_MAX_CONTENT_BYTES 256 Kio, CHUNK_PAGE_BATCH_ROWS 64 chunks.ts:41-67 ; SESSION_CHUNK_PAGE_MAX_LIMIT 1000, PREVIEW 20/64 Kio, SESSION_CHUNK_MAX_PAGES 50, ARIJ_ACTIONS_MAX_PAGES 200 session-detail.ts:59-118 ; ARIJ_ACTION_SCAN 2 Mio/500 arij-action-scan.ts:41-46 ; ARIJ_SCAN_MAX_PENDING_CHARS 1 Mio), caps logs.json (4, session-detail.ts:74-97), caps de rétention (3 queues + PRUNE_MIN_TRUNCATION + 50 000 + 500), queues forensic (2) et telescope/dreaming. Faits mesurés : le cap d'écriture 256 Kio ne peut jamais toucher `raw` (max observé 65 536 octets = taille d'une lecture de pipe) ; les 27 seules lignes > 256 Kio sont des output/response du 26/08, antérieures au cap (commit ed517d1c du 05/09 11:43) ; les 3 lignes qui matchent `chunk capped by Arij`/`pruned by Arij data retention` sont des sessions d'agents qui citent le SOURCE de chunk-cap.ts/chunk-retention.ts dans leur sortie — aucun marqueur n'a jamais été produit. chunk-retention.ts (64 l.) n'a qu'un producteur mort (le pruner) mais deux rendus client (SessionLogTail.tsx:14-15,183-201 ; SessionOutputStream.tsx:8-14,44-77). prompt-backfill.ts (141 l.) n'est atteignable que par la routine morte alors que sa cible est finie et connue : 36 prompts > 128 Kio, tous du 25-26/08 (25,5 Mo), plus 1 du 05/09 10:57 antérieur au cap (12:36).

**Précision du vérificateur**

Dispersion réelle des caps : ~22 constantes de plafond réparties sur 8 fichiers (chunks.ts, chunk-cap.ts, prompt-cap.ts, session-detail.ts, arij-action-scan.ts, chunk-retention.ts, pipeline/constants.ts, routines/constants.ts), avec deux vocabulaires de marqueurs distincts (élision d'écriture vs élision de rétention). Les mesures DB du finding sont exactes : aucun marqueur de cap de chunk ni de rétention n'a jamais été écrit, les 27 lignes > 256 Kio (output/response) et les 36 prompts > 128 Kio sont tous antérieurs aux caps du 05/09. MAIS la conclusion « producteur mort » est fausse : la routine `retention` est un produit livré et activable (AVAILABLE_ROUTINE_KINDS, validation crud.ts:191, dispatch actions.ts:258, offerte à la création dans RoutinesSettings.tsx:72) ; elle n'a simplement jamais été créée sur cette base, où la table `routines` est entièrement vide (aucune routine d'aucun type). chunk-retention.ts n'est donc pas supprimable — chunk-prune.ts:37/313 l'importe et l'écrit — et ses « deux rendus » ne sont pas un doublon mais deux vues distinctes montées ensemble par LiveLogBand.tsx:183 (tail replié) et :213 (flux déplié). Le marqueur de prompt, lui, est bel et bien produit (19 lignes) et rendu par PromptComposedCard.tsx:65. Ce qui reste : regrouper et documenter les constantes de cap par lecteur (écriture / page / preview / scan / logs), et documenter capChunkContent comme la garde des seuls chunks finaux output/response (raw est déjà borné à 65 536 octets par la taille de lecture du pipe). Pas de suppression de code au motif de mort.

**Recommandation**

Regrouper les caps dans un seul module de constantes documenté par lecteur (écriture / page / preview / scan / logs) ; supprimer chunk-retention.ts et ses deux rendus tant qu'aucun producteur ne tourne ; remplacer prompt-backfill.ts par un UPDATE one-shot en migration (36 lignes connues) ; garder capChunkContent uniquement comme garde des deux chunks finaux, et le documenter comme tel.

<details><summary>Preuve relevée par l'auditeur</summary>

DB : `raw` maxc 65 536 ; `rows > 256KiB by date/stream` → 2026-08-26 output 18 / response 9, rien après ; `prune marker rows` → 3 chunks raw de sessions 5d4P3yRQhicS / VVcWMBAnbzBu / I16haNAgmm-4 dont le contenu commence par le docblock de prompt-cap.ts / retention.ts (git diff cité par l'agent) ; `elision marker rows` → 3, mêmes sessions ; `prompts > 128KiB by day` → 08-25: 7, 08-26: 28, 09-05: 1 (10:57, non marqué, cap commit f90a386f 12:36) ; `prompt marker present` 19 (cap actif). git log --diff-filter=A : chunk-cap/prompt-cap/chunk-prune/retention/chunk-retention/prompt-backfill tous créés le 05/09.

</details>

### #236 — Le seul lecteur du MILIEU du flux raw est le scan des actions Arij, rejoué à l'ouverture de chaque session terminée : jusqu'à 56 requêtes séquentielles de 2 Mio pour retrouver des appels `mcp__arij__` qu'on pourrait indexer à l'écriture

**Nature** risque · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `lib/agent-sessions/session-detail.ts:118,152-186`
- `lib/agent-sessions/arij-action-scan.ts:41-53,80-121`
- `app/projects/[projectId]/sessions/[sessionId]/page.tsx:80-98`
- `app/api/projects/[projectId]/sessions/[sessionId]/route.ts:215-247,323-345`
- `lib/agent-sessions/arij-actions.ts:221-287`
- `lib/telescope/collect.ts:349-403`

**Constat**

Réponse à (b) : les lecteurs du raw d'une session terminée sont (1) la preview de tête (20 chunks / 64 Kio, à chaque poll de 3 s), (2) les pages « Load more », (3) le scan `?view=arij-actions`, (4) readChunkTail (forensic, sessions mortes seulement). Telescope ne lit que la ligne `max(sequence)` (collect.ts:349-403). Seul (3) parcourt tout le flux : fetchSessionArijActions (session-detail.ts:152-186) boucle jusqu'à 200 requêtes tant que `hasMore`, chaque requête lisant 2 Mio / 500 chunks en synchrone (arij-action-scan.ts:103-121), déclenchée `immediate` à l'ouverture de la page (page.tsx:80-98). Pour ZZAP6QWzM-Ss (112 Mo) : ~56 requêtes, 112 Mo lus sur la connexion partagée, pour en extraire une poignée de tool calls. Le cache est process-local, 16 entrées LRU (arij-action-scan.ts:53, 80-86) : redémarrage du dev server ou 17 sessions ouvertes = rescan complet. Or le scanner est déjà incrémental (createArijToolCallScanner, arij-actions.ts:252) et pourrait tourner dans le chemin d'écriture (onChunk) et persister ses trouvailles : la donnée raw ne servirait alors plus qu'une fois, à l'écriture, et le milieu du flux deviendrait jetable.

**Précision du vérificateur**

Les lecteurs du raw d'une session terminée sont : la preview de tête (20 chunks / 64 Kio par stream, à chaque poll de 3 s puisque `useSessionPolling(…, true, 3000)` poll aussi les sessions terminées), les pages `?stream=`, le scan `?view=arij-actions`, et `readChunkTail` (forensic sur session morte) qui — contrairement à ce que dit le finding — matérialise lui aussi TOUT le raw via `listSessionChunks` avant d'en garder la queue. Seul le scan CONSOMME le milieu : `fetchSessionArijActions` (session-detail.ts:152-186) boucle jusqu'à 200 requêtes, chacune lisant en synchrone 2 Mio / 500 chunks (arij-action-scan.ts:101-123), déclenchée au montage (page.tsx:99). Pour ZZAP6QWzM-Ss (completed, 3 015 chunks, 112,7 M chars, 15 chunks contenant `mcp__arij__`) : ~54-56 requêtes. Le cache LRU (16 entrées, arij-action-scan.ts:52/81-85) fait que le scan complet tourne une fois par process et par session — réouvrir la page dans la fenêtre du cache coûte une requête vide ; le rescan intégral n'arrive qu'au redémarrage ou après éviction. `collectArijActions` (lecture intégrale) n'a aucun appelant applicatif. Le scanner incrémental existe (arij-actions.ts:252) et `process-manager.onChunk` (394-407) est bien le point de branchement. Nuance : la rétention (30 j par défaut, chunk-prune.ts) rend déjà le milieu du raw jetable pour les sessions terminales, au prix d'une liste d'actions réduite à la queue — indexer à l'écriture supprimerait ce prix.

Le scan `?view=arij-actions` est le seul lecteur intégral du flux raw des sessions terminées atteignable depuis l'UI (page session, liée depuis la liste des sessions, les frictions, la mémoire et la spec) ; il est rejoué une fois par process et par session (cache LRU de 16 entrées, perdu au redémarrage ou à la 17e session ouverte), déclenché immédiatement à l'ouverture, en ~54-56 requêtes séquentielles de 2 Mio pour la session ZZAP6QWzM-Ss (112,7 M chars, 3 015 chunks) et en plusieurs pages pour 44 sessions dont le raw dépasse 2 Mio. Une fois le curseur en fin de flux, le poll de 3 s continue (isRunning codé `true`) mais ne coûte qu'une lecture indexée vide. Les autres lecteurs sont bornés (preview de tête, Load more, telescope sur max(sequence)) ou ciblent les sessions mortes (readChunkTail forensic ; dreaming ne lit que response/output). Rien n'indexe les appels `mcp__arij__` à l'écriture (process-manager.onChunk n'appelle qu'appendSessionChunk), alors que la routine `retention` prune déjà le milieu du raw en assumant explicitement la perte de cette liste d'actions (chunk-prune.ts:24-29) — persister les appels détectés au moment de l'écriture supprimerait à la fois le rescan et cette perte.

**Recommandation**

Brancher `createArijToolCallScanner` dans process-manager.onChunk (un scanner par session vivante) et persister chaque appel détecté dans une petite table `agent_session_tool_calls` (ou réutiliser ticket_activity_log) ; la route ne fait plus que trois lectures indexées, le client plus une seule requête, et le raw n'a plus de lecteur intégral — prérequis pour le borner à l'écriture.

<details><summary>Preuve relevée par l'auditeur</summary>

session-detail.ts:162 `for (let page = 0; page < SESSION_ARIJ_ACTIONS_MAX_PAGES; page++)` … `if (!body.data.hasMore) return latest` ; arij-action-scan.ts:41 `ARIJ_ACTION_SCAN_MAX_BYTES = 2 * 1024 * 1024`, :53 `ARIJ_ACTION_SCAN_CACHE_SIZE = 16` ; page.tsx:98 `useSessionPolling(…, readActions, true, 3000, { immediate: true })` ; DB : 112 707 865 chars pour ZZAP6QWzM-Ss ; grep listSessionChunks/agentSessionChunks → telescope lit `max(sequence)` puis la seule ligne gagnante.

</details>

### #237 — Le résultat final d'une session vit dans logs.json (80 Mo, 3 283 fichiers) en plus des flux output/response, et la route détail lit et sert les trois à chaque poll

**Nature** doublon · **Impact** moyen · **Effort** M · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `lib/agent-sessions/dispatch-background-session.ts:359`
- `lib/agent-sessions/lifecycle.ts:521-541`
- `app/api/projects/[projectId]/sessions/[sessionId]/route.ts:83-150,404-412`
- `lib/agent-sessions/backfill.ts:34-47,110-126`
- `lib/agent-sessions/last-text.ts`
- `components/spec/SpecWorkspace.tsx:160`
- `components/session-live/LiveLogBand.tsx:190-235`

**Constat**

En plus de la double écriture output déjà relevée (final-output + result-<id>), dispatch-background-session.ts:359 écrit `JSON.stringify(result)` — l'enveloppe complète, dont `result` (le texte) — dans data/sessions/<id>/logs.json (80 Mo, 3 283 fichiers pour 1 814 sessions, le plus gros 14,8 Mo) ; lifecycle.ts:521-541 en écrit un stub s'il manque. La route détail (route.ts:83-150) rouvre ce fichier à chaque GET (poll 3 s), le parse jusqu'à 4 Mio, tronque `result` à 256 Kio, puis sert AUSSI les previews `response` et `output` (mêmes octets) et `lastNonEmptyText`. Le client choisit ensuite lui-même : SpecWorkspace.tsx:160 `session.logs?.result || lastChunk || session.lastNonEmptyText`, LiveLogBand.tsx:200-235 `session.logs` en fallback. Quatre dérivations de « dernier texte » coexistent : chunks.ts:634-646 à l'append, chunk-prune.ts:222-231 depuis les chunks, backfill.ts:34-47 depuis logs.json (exécuté en synchrone sur le GET détail, jusqu'à 200 fichiers parsés, backfill.ts:110-126), route.ts:404-412 depuis logs.json encore. 16 sessions terminées avec chunks n'ont toujours pas de last_non_empty_text.

**Précision du vérificateur**

Confirmé dans l'arbre de travail, avec trois précisions. Vrai : dispatch-background-session.ts:359 écrit l'enveloppe complète du run (clés success/result/duration/cliSessionId/endedWithQuestion, vérifié sur un fichier réel) dans data/sessions/<id>/logs.json ; lifecycle.ts:521-541 en écrit un stub via backfillMissingSessionLog (appelé depuis transitionSessionStatus:353) ; mesures reproduites (80 Mo, 3283 logs.json, plus gros = Td-XQYuqB9e2 à 14 821 852 o — le commentaire de la route qui annonce « 8.6 MB » est périmé) ; DB 1814 sessions / 1812 logs_path / 16 lignes terminales avec chunks et last_non_empty_text NULL ; la route détail (readSessionLogs ligne 83, appel ligne 371) rouvre et parse le fichier à chaque GET, poll 3 s confirmé (page.tsx:64 + useSessionPolling 3000), et sert `logs` INCONDITIONNELLEMENT (ligne 424) alors que `prompt` est bien gated par ?include=prompt (ligne 347), en plus des previews des trois flux raw/output/response (ligne 376) et de lastNonEmptyText ; les consommateurs clients choisissent eux-mêmes (SpecWorkspace.tsx:161, LiveLogBand.tsx:193 et :225). Précisions : (1) runBackfillRecentSessionLastNonEmptyTextOnce (route:269) est gardé par un Set au niveau module (backfill.ts:110-126) — les jusqu'à 200 fichiers ne sont parsés qu'une fois par projet et par process, pas à chaque requête ; (2) la dérivation « à l'append » est chunks.ts:660-672, pas 634-646 ; (3) la 4e dérivation (route:408, extractLastNonEmptyTextFromLogs) ne traite que les logs tableau legacy et renvoie null pour la forme objet écrite aujourd'hui — elle est quasi morte sur les données actuelles. Les caps existants (4 MiB parse, 256 Kio sur result, 512 Kio servi) bornent le coût par poll mais ne suppriment ni la triple écriture ni les trois dérivations vivantes.

**Recommandation**

Faire des flux `output`/`response` la seule source du résultat (arrêter d'écrire logs.json pour les sessions qui ont un store de chunks ; garder le fichier uniquement pour les spawns éphémères sans ligne agent_sessions) ; servir `logs` seulement sur `?include=logs` comme le prompt ; une seule fonction `deriveLastNonEmptyText(sessionId)` côté store, et sortir le backfill du chemin de requête (migration one-shot sur les 16 lignes).

<details><summary>Preuve relevée par l'auditeur</summary>

du -sh data/sessions → 80M ; find -name logs.json | wc -l → 3283 ; plus gros : Td-XQYuqB9e2/logs.json 14 821 852 o ; DB `logs_path set` 1 812/1 814 ; `last_non_empty_text null on terminal with chunks` 16 ; route.ts:86 `readSessionLogs(logsPath)` puis :373-384 previews des trois flux dans le même payload ; route.ts:283 `runBackfillRecentSessionLastNonEmptyTextOnce(projectId)` en tête de GET.

</details>

### #175 — Le résultat des sessions codex/omp/agy est persisté deux fois dans le flux `output` (clé `final-output` puis `result-<sessionId>`)

**Nature** doublon · **Impact** faible (vérificateur : plutôt plus) · **Effort** S · **Statut** confirmé · **Domaine d'audit** providers-spawn

**Fichiers**
- `lib/claude/process-manager.ts:507-510`
- `lib/claude/process-manager.ts:673-706`
- `lib/providers/base-provider.ts:359-369`
- `lib/providers/codex.ts:356-376`
- `lib/agent-sessions/chunks.ts:597-606`

**Constat**

BaseCliProvider.emitFinalChunks (base-provider.ts:359-369 ; codex.ts:356-376) émet le résultat en chunk `output` clé `final-output` via onChunk. processManager.start appelle ensuite `persistResultAsChunk` pour TOUS les providers (process-manager.ts:510) alors que son propre commentaire (673-679) le réserve à claude-code ; il réinsère le même texte avec la clé `result-<sessionId>` (694-699). La déduplication du store est par clé fournie (lib/agent-sessions/chunks.ts:597-606), donc deux lignes identiques. Mesuré sur data/arij.db : codex 147 doublons exacts sur 152 lignes `result-*`, agy 18/18, oh-my-pi 141/201 (les 60 restants sont des runs où extractPiResult a rendu un texte différent du -o/stdout).

**Précision du vérificateur**

Finding confirmé, avec trois précisions. (a) Le provider `pi` est aussi concerné (1/1 doublon mesuré), pas seulement codex/agy/oh-my-pi ; seul `claude-code` est indemne, parce que `ClaudeCodeProvider` surcharge entièrement `spawn()` (claude-code.ts:27,32,40) et n'émet jamais `final-output`. (b) Pour codex, le doublon n'est pas systématique par construction : `CodexProvider.emitFinalChunks` (codex.ts:356-376) n'émet `final-output` que si le fichier `-o` a produit du contenu, et le doublon n'existe que quand ce contenu est identique au `result` retenu — d'où 147/152 et non 152/152 ; pour oh-my-pi l'écart (141/201) vient de `extractPiResult`. (c) L'impact n'est pas seulement du stockage : le flux `output` est relu en tail concaténé et réinjecté dans des prompts LLM (`lib/workflow/dreaming-collector.ts:436-443`, `lib/pipeline/forensic.ts:273-277`), donc le texte final occupe deux fois le budget de tail — ce qui justifie une sévérité un cran au-dessus d'un simple doublon de lignes.

**Recommandation**

Garder persistResultAsChunk uniquement quand `provider === "claude-code"` (comme le dit le commentaire), ou faire que les providers non-CC n'émettent plus `final-output` ; ajouter un test process-manager qui compte les chunks `output` après un run codex simulé.

<details><summary>Preuve relevée par l'auditeur</summary>

Requête read-only : `select provider, count(*), sum(exists(final-output de même session, même contenu))` sur agent_session_chunks stream_type='output' and chunk_key like 'result-%' → agy 18/18, codex 152/147, oh-my-pi 201/141, claude-code 1181/0.

</details>

### #233 — Chemin « clé dérivée sha256 » du store et parseur batch des actions Arij : aucun appelant produit, 0 ligne en base

**Nature** mort · **Impact** faible (vérificateur : plutôt moins) · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `lib/agent-sessions/chunks.ts:190-231`
- `lib/agent-sessions/chunks.ts:574-604`
- `lib/agent-sessions/arij-actions.ts:289-318`
- `lib/agent-sessions/arij-actions.ts:392-396`
- `lib/agent-sessions/arij-actions.ts:487-496`
- `lib/providers/base-provider.ts:261-286`
- `lib/claude/process-manager.ts:694-699`

**Constat**

chunks.ts:190-231 (`DERIVED_CHUNK_KEY_PREFIX`, `deriveChunkKey`, 40 lignes de doc) et la branche `if (!suppliedKey)` de appendChunk (chunks.ts:574-604) ne servent qu'aux écrivains sans clé. Or les deux seuls écrivains produit fournissent toujours une clé : base-provider.ts:261-286 (`stdout:N`, `stderr:N`, `final-output`, `final-response`) et process-manager.ts:694-699 (`result-<sessionId>`). Sur 302 905 lignes en base : 0 clé `sha256-…`, 0 clé NULL. Seul __tests__/session-chunk-dedupe.test.ts exerce ce chemin. De même, `collectArijActions` n'est appelé en produit que via `collectDurableArijActions` avec `chunks: []` (arij-actions.ts:392-396) : la branche `listSessionChunks(sessionId, "raw")` (l.487-494) et `extractArijToolCalls` (l.289) — le parseur non incrémental que arij-action-scan.ts a remplacé — sont injoignables hors tests (26 références dans __tests__/arij-actions.test.ts).

**Précision du vérificateur**

Deux chemins défensifs sans producteur en produit, confirmés par la base (302 905 lignes : 0 clé NULL, 0 clé sha256-). (a) chunks.ts:193-231 (DERIVED_CHUNK_KEY_PREFIX + deriveChunkKey + ~40 lignes de doc) et le fallback `suppliedKey ?? deriveChunkKey(...)` de appendChunk (chunks.ts:613) : les seuls écrivains produit — base-provider.ts:269/276/283 (buildChunkCallbacks, non surchargé) et process-manager.ts:400/698 — fournissent toujours une clé ; seul __tests__/session-chunk-dedupe.test.ts exerce le chemin. À noter : ajouté délibérément le 2026-09-05 (4acfeee4) en clôture de findings de revue, donc défensif et testé plutôt qu'oublié. (b) Dans arij-actions.ts, la branche `if (!chunks) { chunks = listSessionChunks(sessionId, "raw") }` (l.487-494) est injoignable en produit : le seul appelant produit est collectDurableArijActions (route.ts:229 et :395) qui passe `chunks: []`. Correction au finding : collectArijActions et extractArijToolCalls ne sont PAS injoignables — collectArijActions est l'implémentation de collectDurableArijActions et extractArijToolCalls y est appelée à chaque requête, sur un tableau vide. Le nettoyage correct est donc d'inliner collectArijActions dans collectDurableArijActions (en supprimant l'option `chunks`, le fallback listSessionChunks et l'appel à extractArijToolCalls, remplacé par les dbActions triées) et non de supprimer ces fonctions ; extractArijToolCalls ne garde d'usage que les tests, le scanner incrémental (arij-action-scan.ts) restant le chemin produit.

**Recommandation**

Rendre `chunkKey` obligatoire dans AppendSessionChunkInput, supprimer deriveChunkKey et la branche keyless ; supprimer `collectArijActions`/`extractArijToolCalls` (garder collectDurableArijActions + le scanner incrémental) et les tests correspondants.

<details><summary>Preuve relevée par l'auditeur</summary>

grep `appendSessionChunk(` produit → process-manager.ts:396 (chunkKey: chunk.chunkKey ?? null, toujours fourni par buildChunkCallbacks) et :694 (chunkKey: `result-${sessionId}`) ; grep `onChunk(` dans lib/providers → uniquement base-provider.ts:266/273/280 avec chunkKey ; DB `chunk_key patterns` : stdout 291 656, stderr 8 988, final-response 374, final-output 334, result-* 1 553, aucune autre valeur ; grep `collectArijActions|extractArijToolCalls|deriveChunkKey` hors lib/agent-sessions → uniquement __tests__.

</details>

### #238 — Le coût des index de agent_session_chunks est négligeable (30 Mo sur 1 040 Mo, ~33 µs par insertion) ; l'index unique (session_id, stream_type, chunk_key) ne dédoublonne jamais le raw par construction

**Nature** refacto · **Impact** faible · **Effort** S · **Statut** confirmé · **Domaine d'audit** r2:session-chunks-storage

**Fichiers**
- `lib/db/schema.ts:326-349`
- `lib/db/migrations/0005_codex_session_chunks.sql:19-23`
- `lib/agent-sessions/chunks.ts:309-320,325-340,574-585,686`
- `lib/providers/base-provider.ts:541-548`

**Constat**

Réponse à (e). dbstat en lecture seule : table 1 039,6 Mo (253 810 pages), index `session_sequence_unique` 8,1 Mo, `session_stream_key_unique` 12,6 Mo, `session_stream_sequence_idx` 9,4 Mo, `agent_session_sequences` 80 Ko. Micro-bench sur un fichier scratch (WAL, synchronous=NORMAL comme la base live, une transaction par chunk comme chunks.ts:686, sonde SELECT par clé + upsert RETURNING de la séquence + INSERT avec les trois index) : 40 000 lignes de 3 Ko en 1 302 ms = 32,5 µs/ligne, soit ~10 s cumulés pour les 300 644 lignes raw sur 15 jours. Le coût des écritures live est donc le CONTENU (911 Mo écrits, +WAL 14 Mo), pas les index. En revanche l'index unique sur `chunk_key` (le plus gros des trois, 12,6 Mo) ne sert le dédoublonnage que pour 5 clés fixes par session : pour le raw, `stdout:N`/`stderr:N` est un compteur monotone par spawn (base-provider.ts:541-548), donc la sonde `selectExistingByKeyStmt` (chunks.ts:309-320, exécutée avant CHAQUE insertion) ne peut jamais trouver de doublon ; 291 656 + 8 988 lignes paient une sonde et une entrée d'index pour une garantie vide. L'écart `next_sequence-1 ≠ max(sequence)` sur 10 sessions montre aussi que la table de séquences et l'index unique (session_id, sequence) peuvent diverger sans que rien ne le détecte.

**Précision du vérificateur**

Coût des index de agent_session_chunks confirmé négligeable : 30,1 Mo d'index (8,1 + 12,6 + 9,4) plus 80 Ko de table de séquences pour 1 039,6 Mo de table, et ~30-33 µs par insertion (bench répliqué : 30,2 µs/ligne, 3 Ko, une transaction par chunk, WAL + synchronous=NORMAL) soit ~10 s cumulés pour les 300 644 lignes raw. Le coût d'écriture est le contenu, pas les index. L'index unique (session_id, stream_type, chunk_key) n'offre effectivement aucun dédoublonnage au raw : la clé `stdout:N`/`stderr:N` est un compteur monotone par spawn (base-provider.ts:541-548, 269), et la vérification empirique le confirme — sur 1 663 sessions, max(index) = count(*) partout, donc la sonde selectExistingByKeyStmt (chunks.ts:309-320), exécutée avant chaque insertion, n'a jamais trouvé de doublon sur 300 644 lignes. Deux corrections : les clés fixes sont au nombre de 3, pas 5 (final-output 334, final-response 374, result-<sessionId> 1 553) ; et l'écart next_sequence-1 ≠ max(sequence) sur 10 sessions n'est pas une divergence silencieuse mais l'effet attendu de l'élagage de rétention (chunk-prune.ts:195 supprime les lignes, 204 annule chunk_key), les sessions concernées n'ayant plus que leur queue final-output/final-response. En conséquence la piste « dériver la séquence de max(sequence)+1 » doit être écartée : après un prune elle réattribuerait des séquences déjà servies comme curseurs de pagination et de lecture forensique. Seule la piste « réserver la sonde de dédoublonnage aux flux output/response » reste valable. Citation à ajuster : la transaction par chunk est en chunks.ts:682-683, pas 686.

**Recommandation**

Ne pas chercher d'économie côté index. Si le dédoublonnage par clé n'a de sens que pour final-output/final-response/result-*, réserver la sonde aux flux `output`/`response` (le raw n'en a pas besoin) ; envisager de dériver la séquence de `max(sequence)+1` sous l'index unique existant plutôt que d'une table parallèle mise à jour à chaque chunk.

<details><summary>Preuve relevée par l'auditeur</summary>

dbstat : agent_session_chunks 1 039 605 760 o ; session_sequence_unique 8 110 080 ; session_stream_key_unique 12 578 816 ; session_stream_sequence_idx 9 375 744. Bench scratch idx-perRowTxn : 40 000 rows in 1302 ms = 32.5 µs/row (la variante sans index n'a pas terminé en 300 s : sans index la sonde par clé est un scan de table, ce qui confirme que l'index est ce qui rend la sonde gratuite). PRAGMA synchronous = 1, journal_mode = wal. DB `sequences vs chunk max` → 10.

</details>

## État au 11/09/2026 — côté écriture livré

Sur la branche `feature/lot-14-providers-spawn` (second commit, après le lot 14),
uniquement les fichiers que la rationalisation en cours ne touche pas.

Fait :
- #230 : filtre de lignes NDJSON dans PiProvider, frames `tool_execution_update`
  non persistées (`createPiRawLineFilter`, hook `flush` du BaseCliProvider).
- #235 : cap de 4 Mio par session sur le flux raw dans `appendChunk`
  (`SESSION_RAW_STREAM_MAX_BYTES`, tête de 20 chunks conservée, trim à 75 %,
  une ligne-marqueur `raw-trimmed`). Total seedé depuis SQLite par session.
- #231 (store) / #232 : `listChunkTail` et `readTail` dans le store ;
  `readChunkTail` (forensic) lit par la queue.
- #172 : `spawnClaude({ onRawLine })` passe en stream-json et relaie chaque
  ligne ; ClaudeCodeProvider émet les chunks raw + final-output/final-response.
- #175 : `persistResultAsChunk` supprimé, une seule copie du résultat.

Reste (côté lecture, fichiers M/?? de la rationalisation — après son commit) :
- #231 route : la route détail sème le raw avec `listSessionChunkTail` ; pager
  avec curseur `before` (useSessionStreamPager).
- #236 : indexer les appels `mcp__arij__` à l'écriture (table + onChunk) et
  faire lire l'index par `?view=arij-actions`.
- #237 : arrêter logs.json quand un store de chunks existe ; route détail sans
  triple lecture.
- #70 : seed d'une routine retention par défaut (ou retrait du kind) ; exposer
  `session_chunk_retention_days` ou retirer la clé.
- #113, #114, #156 : page session live (isRunning dérivé), agrégat serveur de la
  liste, extraction read-session.ts / list-sessions.ts.
- #234 : regrouper les 22 constantes de cap (les nouvelles sont dans chunk-cap.ts).
- #238 : rien à faire, informatif.

Validation : tsc 0, eslint 0 sur les fichiers touchés, suite vitest verte sauf
`documents-upload-platform-body-cap` (même échec de boot que sur la base).
Données existantes : le cap ne s'applique qu'aux sessions qui écrivent encore ;
les 780 Mo historiques restent à purger (rétention ou script one-shot).

## État au 11/09/2026 — côté lecture livré

Branche `feature/lot-07-sessions-lecture` (worktree
`.arij-worktrees/lot-07-sessions-lecture`), commit `db509394`, empilée sur le
lot 11 : cette branche porte toute la pile (SIGKILL, lot 14, lot 07 écriture,
lot 11, lot 07 lecture).

Fait : #231 (route, pager, « Load earlier output »), #237 (logs.json servi
seulement sur `?include=logs`, volet Réponse sur les flux), #113 (la page live
s'arrête de poller une session terminée), #156 (moitié détail :
`lib/agent-sessions/read-session.ts`), #236 (migration 0061, index des appels
`mcp__arij__` à l'écriture, scan unique persisté pour l'historique), #114
(agrégat SQL pour la bande de la liste), #70/#235 partiel (passe unique au boot
qui ramène sous le cap les flux raw historiques, puis un VACUUM différé ;
validation `maxCappedPrompts` corrigée).

Non fait :
- #70 : pas de routine de rétention seedée ni retirée — décision produit
  (rétention en opt-in, le volume est borné à l'écriture et repris au boot).
- #156 moitié liste : extraction de `sessions/route.ts` vers `list-sessions.ts`.
- #237 côté écriture : les dispatchers écrivent toujours logs.json.
- #234 : regroupement des 22 constantes de cap.

Au merge : la migration 0061 a un `when` au-dessus des 0057–0060 non commitées
de la rationalisation et de la 0057 du lot 11 ; l'ordre d'application est donc
bon, seuls les noms de fichiers sont à harmoniser si on le souhaite.
