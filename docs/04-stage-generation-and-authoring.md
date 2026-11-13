# 04 — Stage Generation & Authoring

Stages are **not** hand-authored positions. They are generated from authored **templates** and then
proven solvable by a solver before the player ever sees them. This document defines templates, the
generation pipeline, the solver contract, and the difficulty curve.

---

## 1. Why generation replaces authored puzzles

The rev. 1 design validated hand-authored puzzles against a stored `solution` line. That approach is
incompatible with the current game: the board is randomized and the player's army depends on their
deck, so a single stored line cannot exist.

The replacement has one elegant property that makes it *more* correct than authored solutions:

> **Stage generation runs as soon as the previous stage is cleared, seeded with the player's actual deck.**

The shop then shows the generated board as a preview, without its par ([07 §1](07-shop-phase.md#1-entry-exit-and-flow)).

Every stage is therefore validated as solvable **with the army the player actually owns** — including
a deck the designer never anticipated. There is no such thing as an unwinable stage caused by a
bad shop, and no need for the designer to enumerate deck states.

**Puzzle quality is preserved by templates, not by randomness.** A template is a designed encounter:
it fixes the enemy composition, the par range, board sparsity, and spawned pawns. Only the *exact
placement* and *which of the player's pieces appear* are randomized. The puzzle's shape is authored;
its instance is generated.

## 2. Template anatomy

```yaml
id: tpl-act1-open-field
title: Open Field
act: 1
tier: normal          # normal | boss
mateIn: [5, 5]        # the par "Mate in X": the generator picks X in this range; there is no turn limit
# spawnPoints: 6     # optional: lowers the act's budget (data/economy.yaml), never raises it

enemyArmy:            # ranges are inclusive [min, max]
  pawn: [2, 4]
  rook: [1, 1]
enemyZone: [7, 8]     # enemy occupies these ranks; ranks 5-8 only (Black side)

spawnedPawns:         # free, stage-only pawns for the player (docs/02 §2.1)
  count: [3, 4]
  ranks: [6]

focusPool: 3          # no deploymentRanks: the player always deploys on ranks 1-4

enemyPolicy: { type: best_move, depth: 2 }

preconditions:
  - enemy_king_on_board
  - safe_king_square
  - no_first_turn_mate
  - enemy_has_moves
  - enemy_value_in_band
  - deployment_squares_available
  - spawned_pawns_placed
```

Templates never specify the player's army — the player summons it from the deck in the Deployment phase ([02 §5](02-rules-framework.md#5-deployment)); a template may only lower its `spawnPoints`. The deployment ranks are not a template field: the player always deploys on ranks 1–4 (`rules.deploymentRanks`), and the enemy always starts on ranks 5–8. A normal template never
specifies exact squares — those are generated within `enemyZone` and `spawnedPawns.ranks`. Templates never
specify **rarity**: enemy pieces are locked to Normal, and spawned pawns roll theirs from the act's
rarity pool ([06 §4](06-deck-durability-and-permadeath.md#4-piece-categories-and-rarity)).

Spawned-pawn ranks are a real design dial. Closer to rank 8 makes promotion a cheap side-objective;
further away makes it a costly detour from the par. With no turn limit, rank 8 is always reachable;
the validator rejects a template whose spawn ranks overlap `enemyZone`.
Spawn ranks may lie inside the deployment ranks (3 and 4 usually do): a spawned pawn simply takes a
square the player could otherwise deploy on, and `deployment_squares_available` counts it.

**Fixed (set-piece) templates.** A template with `placement: fixed` replaces `enemyArmy` and
`enemyZone` with `fixedEnemy`, a hand-written square for every enemy piece, king included. Use it
for the few moments where an authored position matters more than variety — the run-1 tutorial stage
and signature bosses — usually paired with a `scripted` enemy. Everything else stays as usual: spawned
pawns and their rarities are generated, the player still chooses their own army, and the solver
still checks the stage against the player's actual deck. A fixed
template that the deck cannot solve fails like any other and falls through to the next template
(§3). Example: `tpl-act1-first-steps`.

**Why mostly generated, not hand-made.** The player's deck differs every run (rarities, promotions,
merges), so a fixed puzzle can be impossible for one deck and trivial for another, and fixed boards
are memorized after a few runs. Templates keep the encounter's *shape* authored while the solver
proves each *instance* fair. Stockfish may help author templates offline, but it cannot validate a
stage: it does not know these rules ([09 §1](09-technical-architecture.md#stockfish-as-a-design-tool-offline-only)).

Template authoring is a **design** activity, not a content grind: a template is ~15 lines and yields
a large family of stages.

## 3. Generation pipeline

Generation runs once per stage, **right after the previous stage is cleared**, from the deck as it
stands after the stage-end chooser. It never runs during play: the solver works in the background
over the results screen and the shop, which then shows the finished board as a preview without its
par ([07 §1](07-shop-phase.md#1-entry-exit-and-flow)). Nothing is re-checked after the shop: selling
or merging a piece the next stage needs is the player's informed choice. Generation is deterministic
for `(runSeed, actIndex, stageIndex, deck)`; the solver's budgets count nodes, never time.

| Step | Action | Failure → |
|---|---|---|
| **G0** | Derive seed: `stageSeed = hash(runSeed, actIndex, stageIndex)` | — |
| **G1** | Select a template by act and tier (the boss when `stageIndex == 2`), weighted by `draw(stageSeed, 'template')`; avoid the previous stage's template where possible | No template → engine bug (every act and tier needs at least 1 template) |
| **G2** | Board. A `fixed` template takes `fixedEnemy` as is. Any other template takes a formation (below) at index `⌊draw(stageSeed, 'formation', attempt) × n⌋`, mirrored left–right when `draw(stageSeed, 'mirror', attempt) < 0.5`. With an empty pool it falls back to random placement in `enemyZone` (streams `'army'` and `'place'`, at most `maxPlacementTries` squares tried per piece). Every enemy piece is a Stage Piece at Normal rarity; no rarity roll happens | — |
| **G3** | Prepare the Deployment phase: `mateIn` (the par X) drawn once per stage from the template range with `draw(stageSeed, 'par')`; `spawnPoints` (the act and tier's budget, lowered by the template if it says so); Focus; the enemy policy. **No Hero Piece is placed** — the King and the summons are the player's choice ([02 §5](02-rules-framework.md#5-deployment)) | — |
| **G4** | Spawn pawns: the count from `spawnedPawns.count`; per pawn a square in `spawnedPawns.ranks`, a rarity from `rarity.pool` for the act, then its `promotesTo` result (type, then tier per [02 §2.2](02-rules-framework.md#22-promotion)), all from `draw(stageSeed, 'spawn', attempt, i, field)` | No square → next attempt |
| **G5** | Verify the enemy army value is inside the act band (§6), then the seven preconditions (§4) | Next attempt, at most `maxRegenerations` (20) per template |
| **G6** | `solveStage` (§5) with the deck: the pieces with durability ≥ 1, and the King. A mate within the par, on turn 2 or later, must exist | Next board, at most `maxBoards` (3) boards that passed G5 |
| **G7** | Choose the board: the first proven one. If none is proven, the first board that passed G5 gets **one extra spawned pawn**, silently (below) | — |
| **G8** | Emit `StageState` (`phase: deployment`, `mateIn`, `overtimePaid: 0`) with provenance `{templateId, seed, attempts}`. The generator also returns `{formationId, mirrored, proven, bonusPawn, solverNodes}` beside it, for `gen:report` only; the player never sees them | — |

A *board* is one pass of G2–G5 that survives. If a template exhausts `maxRegenerations` attempts at
G5, the next template of the same act and tier is tried and the counter resets. If every template
fails, the last attempt is emitted with `validationFailed: true`: a content error that the UI must
surface as a bug-report prompt rather than showing an unverified stage. This is a **fail-loud**
path, not a silent fallback. A stage that merely was not proven never sets `validationFailed`.

**Seed streams.** Every random choice reads its own stream, `draw(seed, ...parts) =
mix32(hash(seed, ...parts)) / 2^32`, so a change to one step never shifts another:

| Stream | Used by |
|---|---|
| `draw(stageSeed, 'template')` | G1 |
| `draw(stageSeed, 'formation', attempt)` | G2, formation index |
| `draw(stageSeed, 'mirror', attempt)` | G2, mirroring |
| `draw(stageSeed, 'par')` | G3, once per stage |
| `draw(stageSeed, 'spawn', attempt, i, field)` | G4, per pawn and field (square, rarity, `promotesTo`) |
| `draw(stageSeed, 'bonus-pawn', field)` | G7, the extra pawn |
| `draw(stageSeed, 'army', …)` and `draw(stageSeed, 'place', …)` | Random-placement fallback in G2 |

**The bonus pawn.** The extra pawn is the one documented exception to
[05](05-run-structure-and-economy.md)'s "no hidden assistance": the rule is public (the Codex), the
pawn is visible on the board, and only *which* stage received it is never said. It is placed with
the `bonus-pawn` stream on the template's spawn ranks, with the preconditions re-checked, on the
first legal square in stream order; if none is legal, no pawn is added. The enemy side is not
changed.

### Formations

Enemy boards of non-fixed templates are natural positions rather than random scatter. They come from
the **Lichess puzzle database** (CC0), extracted offline by `tools/formations/extract.ts` and
committed to `content/formations/<templateId>.json`, so a build never depends on the download.

For each puzzle, the first UCI move of `Moves` is applied to the `FEN`, and the side to move solves
the result; the *other* side is the defender, and if that is White the board is flipped vertically
and the colours swapped. Only the defender's pieces are kept. The position is **filtered, not
trimmed**: it is rejected if any of these holds:

- a Black piece lies outside the template's `enemyZone`;
- the composition is outside `enemyArmy`;
- the value is outside the act band;
- a pawn is on rank 8.

A formation and its left–right mirror count once. Survivors are sorted by `mix32(hash(puzzleId))`
and the first `generation.formations.maxPerTemplate` (50) are stored with each formation's id,
rating and Black placement, plus the source, licence, file date and SHA-256 and the filters applied.
Re-running on the same source file is byte-identical. The validator re-checks every stored formation
against its template and warns when a template has fewer than `generation.formations.minPerTemplate`
(20). Random placement in `enemyZone` stays as the fallback for an empty pool; there is no other
fallback library.

## 4. Preconditions

The player's army is not on the board when these run (G5, after the spawned pawns are placed) — the
King and the summons are placed later, in the Deployment phase. So every precondition is about the generated board alone, or about what *any*
deployment could do on it.

| Precondition | Rule | Reason |
|---|---|---|
| `enemy_king_on_board` | Exactly one black king; no white Hero Piece on the board (`phase: deployment`) | The player's army is the player's to place |
| `safe_king_square` | At least one empty deployment square is not attacked by the enemy | The King must be able to start out of check (I2) |
| `no_first_turn_mate` | No deck piece alone, and no pair of deck pieces whose spawn costs fit the budget, summoned on any deployment squares, mates in one move | Instant wins are not puzzles |
| `enemy_has_moves` | The enemy has at least one legal move with the board as generated | A stage must not open on a stalemate (a loss, [02 §7](02-rules-framework.md#7-stage-end-evaluation)) |
| `enemy_value_in_band` | `enemyArmyValue` within the act's band ([§6](#6-difficulty-curve)) | Prevents hopeless boards |
| `deployment_squares_available` | At least `floor(spawnPoints / cheapest spawn cost) + 1` empty squares on ranks 1–4 | The King and the most summons the budget allows must fit |
| `spawned_pawns_placed` | Every spawned pawn is on an empty square in `spawnedPawns.ranks`, with a rarity and `promotesTo` within the act ceiling | Promotion must be a real, visible option from turn 1 |

`no_first_turn_mate` is an **approximation**: it tries each deck piece alone and every pair that
fits the budget, not every combination of summons, because larger combinations explode. Pairs are
checked because a summon on rank 4 sits only one or two ranks from the enemy zone, close enough for
one piece to cover the squares another needs to mate. A deployment of three or more pieces that
combines into a turn-1 mate is possible in principle; the spawn-point budget keeps it rare (at most
three summons in Act I), and finding one is a reward for reading the board, not a bug. If playtests
show it happening, the check widens to triples (tracked in [10](10-roadmap-and-milestones.md)).

## 5. The solver

The solver answers exactly one question: **"is there a deployment and a line of single-move queues
that mates within the par (X = `mateIn` turns), on turn 2 or later, against the enemy's actual
replies, with this deck?"** It does not look for the best line, only a winning one. It is a
**single-agent search**: the enemy is a deterministic function (`enemyMove`,
[02 §8.1](02-rules-framework.md#81-enemy-ai)), so after each candidate queue the solver computes the
*one* reply the enemy will play, including scripted lines and their fallback. Its prediction always
matches the real game, and it is far cheaper than a two-sided minimax.

"This deck" includes each Hero Piece's rarity, because rarity changes movement: `simulate` gives the
solver the abilities of [02 §2.3](02-rules-framework.md#23-rarity-movement-abilities) (ally leaps, extra
leaps and steps, multi-capture, the Legendary knight's free second move), and it models spawned pawns
and promotion. Lifeline does not affect a stage, so it is ignored.

**Queues are a single `MOVE`, or a `MOVE` plus the Legendary knight's bonus `MOVE`. No skills.**
Skills only add options, so a line without them stays legal for any loadout. The solver is therefore
**sound but incomplete**: a stage it accepts has a real winning deployment and line, so no unwinnable
stage ships; a win that needs a skill, or a deployment it does not try, only costs a regeneration or,
at worst, a bonus pawn.

### Deployment candidates (ply 0)

Trying every placement is hopeless (up to 32 squares on ranks 1–4, up to six pieces), so ply 0
enumerates a bounded, deterministic set. Each candidate is validated by `startStage`.

| Part | Rule | Bound |
|---|---|---|
| Subsets | Every type-and-rarity multiset of the deck that fits `spawnPoints`, identical instances counted once; maximal subsets first, largest value first | `deployment.maxSubsets` (6) |
| King squares | Safe squares on ranks 1–4, spread across files (e, d, f, c, g, b, h, a) and alternating ranks 1 and 2, avoiding an open line to an enemy rook, bishop or queen | `deployment.kingSquares` (4) |
| Piece squares | Each piece's best squares, scored by attacks on the squares next to the enemy king, legal moves into ranks 5–8, and safety from enemy attack | `deployment.squaresPerPiece` (6) |
| Combining | Greedy assignment plus single-piece variants, interleaved across subsets and King squares | `deployment.maxCandidates` (200) |

### Two-stage beam

1. **Screening.** Every candidate runs a beam of width `screen.width` (4) for `min(screen.turns, mateIn)`
   turns (3). Candidates rank by the best score they reach. A mate found here ends the solve.
2. **Deep search.** The top `deep.candidates` (8) run a beam of width `deep.width` (32) up to `mateIn` turns.

Each beam step, for every state and every candidate queue:

1. `simulate` the queue.
2. A win on turn `minSolveTurns` (2) or later ends the search; a loss is dropped.
3. On the last turn of the par only wins are kept, so no enemy reply is computed.
4. The others are scored by `−evaluate`, with tiers, and deduplicated by position.
5. The top `width × expansion` (3) get the enemy's reply, memoized per board by position
   (`memoizeEnemyReplies`).
6. A reply that leaves the player no legal queue is dropped
   ([02 §7](02-rules-framework.md#7-stage-end-evaluation)).
7. The top `width` states are kept.

All sorts break ties by text (the queue, square names), so the search is deterministic.

### Budgets, replay and acceptance

A **node** is one enemy reply needed, whether computed or taken from the memo, so the count is the
same on every device and generation depends only on the seed and the deck. A board stops when it
reaches `nodeBudget`.

A found line is **replayed** through `startStage` and `commitQueue` before it counts: no stage is
proven unless its line replays to a win. Within the par the enemy's clock never reads the wallet, so
the replay's coins do not matter and the proof survives whatever the player buys. A mismatch rejects
the line and is counted as a solver bug in `gen:report`.

| Parameter (`data/economy.yaml`) | Value | Notes |
|---|---|---|
| `generation.maxRegenerations` | 20 | Attempts per template at G5 |
| `generation.maxPlacementTries` | 50 | Random-placement fallback, per piece |
| `generation.maxBoards` | 3 | Boards the solver tries before the bonus pawn |
| `generation.formations.maxPerTemplate` | 50 | Formations stored per template |
| `generation.formations.minPerTemplate` | 20 | The validator warns below this |
| `generation.solver.nodeBudget` | 40,000 | Hard stop per board, in enemy replies; the spike's hardest solved board needed about 37,000 |
| `generation.solver.minSolveTurns` | 2 | A mate on turn 1 is a free win and is rejected |
| `generation.solver.memoizeEnemyReplies` | true | Saved 30–60 % of enemy searches in the spike |
| `generation.solver.deployment` | `maxSubsets` 6, `kingSquares` 4, `squaresPerPiece` 6, `maxCandidates` 200, `score` (`kingZone` 3, `advance` 1, `attacked` 5), `advanceRanks` 5–8 | Ply 0 |
| `generation.solver.screen` | `width` 4, `turns` 3 | Stage 1 |
| `generation.solver.deep` | `candidates` 8, `width` 32 | Stage 2 |
| `generation.solver.expansion` | 3 | Queues given an enemy reply per beam slot |
| `generation.solver.byAct`, `generation.solver.byTemplate` | `byAct` absent; `byTemplate` for `tpl-act1-first-steps` and `tpl-act1-open-field`: `nodeBudget` 5500, `deployment.kingSquares` 8, `screen.width` 1, `deep.candidates` 48 | Overrides deep-merged in the order global, `byAct[act]`, `byTemplate[templateId]` (`solverSettingsFor`); absent means none. Overridable keys: `nodeBudget`, `deployment.{maxSubsets,kingSquares,squaresPerPiece,maxCandidates}`, `screen.{width,turns}`, `deep.{candidates,width}`, `expansion`. `minSolveTurns`, `memoizeEnemyReplies`, `deployment.score` and `advanceRanks` are rejected, as is any unknown key or a `byTemplate` key that is not a template id; every merged block must pass the global rules. Enabled for First Steps (search-limited: its mating deployments rank 16th-23rd of 64 in screening) and Open Field: 30 % to 64.8 % and 82 % to 92.0 % proven (the global solver, then the override; 10,003-stage run for the override). The Gatehouse boss stays on the global solver: the same override took its single-worker p95 from 15.8 s to 67 s (depth-4 enemy, about 5 ms a node: a single-worker median of 9.5 s over a median 1,858 nodes) |
| Acceptance | A deployment and line that mate within `mateIn`, on turn 2 or later, and replay | The first found wins |
| Rejection | `nodeBudget` exhausted with no mate | Next board (G6); after `maxBoards`, the bonus pawn (G7) |

### Cost control

The solver is affordable because templates are narrow and the search is a beam rather than a tree.
The cost is dominated by `simulate` in Act I, and elsewhere by the enemy search (about 5–12 ms per
call at depth 3–4); `hasLegalQueue` is 2–5 % of the total. The deployment ply multiplies everything
below it, so its candidate set is the first knob to turn. Mitigations if real numbers exceed the
budgets (tracked in [10](10-roadmap-and-milestones.md)):

1. Tune the deployment scoring with `gen:report`.
2. Lower `deep.candidates` or `nodeBudget` and accept more bonus pawns; node budgets keep the result
   identical on every device.
3. Shorten the Act I par range, which shrinks the search depth.

### Measured numbers (M3 acceptance run)

`npm run gen:report -- --stages 1429 --json .cache/report-10k.json`: 1,429 stages per template, 10,003
in all, run seeds `report-<templateId>-<i>`; decks: Act I starter, Act II mid, Act III strong. It took
13,806 s on 7 workers. The proven rates, mating turns and node counts do not depend on the worker
count; wall times do (see the next table).

| Template | Par | Proven | Median mating turn | Bonus pawn | `validationFailed` | Replay failures | Median nodes (screen + deep) |
|---|---|---|---|---|---|---|---|
| First Steps (Act I) | 4-5 | 64.8 % (926) | 4 vs 4 | 35.2 % | 0 | 0 | 8,763 |
| Open Field (Act I) | 5 | 92.0 % (1,314) | 4 vs 5 | 8.0 % | 0 | 0 | 3,594 |
| The Gatehouse (Act I boss) | 4 | 74.9 % (1,071) | 3 vs 4 | 25.1 % | 0 | 0 | 1,112 |
| Fortress (Act II) | 4 | 95.5 % (1,364) | 3 vs 4 | 4.5 % | 0 | 0 | 864 |
| The Citadel (Act II boss) | 4 | 96.7 % (1,382) | 3 vs 4 | 3.3 % | 0 | 0 | 336 |
| The Last Line (Act III) | 2-3 | 97.1 % (1,387) | 2 vs 3 | 0.9 % | 29 | 0 | 216 |
| The Redoubt (Act III boss) | 2 | 85.1 % (1,216) | 2 vs 2 | 4.4 % | 150 | 0 | 180 |
| **All** | | **86.6 %** (8,660 of 10,003) | within 1 of the par in every template | | 179 | 0 | |

The Act III `validationFailed` stages all fail `no_first_turn_mate`: the strong deck mates on turn 1
on every one of 20 boards (150 of 1,429 Redoubt stages, 29 of 1,429 Last Line stages). Acts I and II
have none.

Wall time, one worker (the game generates in one Web Worker), 40 stages a template, one template at a
time on a laptop (`npm run gen:report -- --workers 1 --stages 40 --template <id>`):

| Template | Proven (40) | Median | p95 |
|---|---|---|---|
| First Steps | 55.0 % | 12.1 s | 29.0 s |
| Open Field | 92.5 % | 1.8 s | 15.4 s |
| The Gatehouse | 67.5 % | 9.5 s | 20.1 s |
| Fortress | 97.5 % | 1.6 s | 6.6 s |
| The Citadel | 100 % | 0.5 s | 4.8 s |
| The Last Line | 97.5 % | 1.7 s | 7.2 s |
| The Redoubt | 87.5 % | 0.9 s | 4.5 s |

The targets are a median of 3 s and a p95 of 15 s. Fortress, Citadel, Last Line and Redoubt meet
them; Open Field is 0.4 s over on p95; First Steps and the Gatehouse are over on both, which is where
the unproven boards pay the full three solver calls. These First Steps and Gatehouse numbers are
slower than the single-worker runs of Task 18 (p95 13.9 s and 15.8 s); another process was using the
machine during this run, so treat them as an upper bound and re-measure before tuning on them. The
10,003-stage run's own wall times (7 workers on 8 threads) are larger still and are not the figure to
read.

The proven-rate, `validationFailed` and wall-time gaps are recorded as accepted gaps in
[10](10-roadmap-and-milestones.md#m3--stage-generation--solver).

## 6. Difficulty curve

| Act | Par (`mateIn`) | Enemy army value | Spawn points | Spawned pawns (ranks) | Spawned-pawn rarity | Enemy policy depth |
|---|---|---|---|---|---|---|
| **I** | 4–5 (Open Field 5, First Steps 4–5) | 7–9 | 9 | 3–4 on rank 6 (First Steps: 4 on rank 5) | Normal–Rare | 2 |
| **II** | 4 (Fortress 4, Citadel 4) | 10–14 | 12 | 1–3 (Fortress 2–3 on rank 5, Citadel 1–2 on ranks 3–4) | up to Unique | 3 |
| **III** | 2–3 (Last Line 2–3) | 14–22 | 15 | 1–2 (ranks 4–5) | up to Legendary | 3 |
| **Boss** | Gatehouse 4, Citadel 4, Redoubt 2 | its act's band ×1.25 | its act's + 3 (12 / 15 / 18) | Gatehouse 4–5 on rank 6, Citadel 1–2, Redoubt 1–2 | as its act | 4 or `scripted` |

A normal stage's spawn points are three times the number of minors it can field (3 / 4 / 5 by act);
a boss affords one more. The player's summoned value therefore tracks the enemy army value band, with
the spawned pawns, the first move and the skills as the player's edge.

The par ranges were tuned at the end of M3 against `gen:report` (Act II is all Mate in 4, Open Field
Mate in 5; each template's `designNote` records the before and after). Spawned-pawn counts and ranks are the values the example templates use; the hard rule is only
that spawn ranks stay out of `enemyZone` (§2). Rarity comes from the act's
pool ([07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)).

Three independent difficulty dials, applied in this order:

1. **Par** — the harshest dial; it removes slack rather than adding difficulty, and missing it costs
   the par bonus and then overtime.
2. **Enemy army** — scales the material problem and the amount of capture risk.
3. **Policy depth** — makes the enemy punish loose play.

Spawned pawns are a fourth, *reward* dial rather than a difficulty dial: more pawns, or pawns spawned
closer to rank 8, make promotion cheaper and the stage more generous.

Act I should be cleared on a first run by a player who understands the rules; Act II should not.

## 7. Determinism and reproducibility

- `RunState.seed` fixes the run. `stageSeed = hash(runSeed, actIndex, stageIndex)` fixes each stage.
- Enemy decisions are seeded from `(stageSeed, turnNumber)`.
- A player-visible **seed code** on the run map enables bug reports and shared runs.
- Replaying a run with the same seed reproduces every board, every enemy move, and every shop stock.

## 8. Authoring workflow (for template designers)

1. **Pick the lesson.** What should this template teach or test? (e.g., "don't leave the rook
   hanging while chasing the par.")
2. **Draft the template** in `content/templates/`. Keep it ~15 lines.
3. **Run the validator** (M3) which generates 200 seeded instances and reports:
   solver success rate within the par, distribution of turns-to-win, and the failure-reason histogram.
4. **Tune** the four numbers that matter: `mateIn`, `enemyArmy`, `spawnPoints`, and
   `spawnedPawns`.
5. **Acceptance for a template:** ≥95% of generated instances solvable (a mate exists within the
   par), and the solver's median mating turn close to X: mates that all come well before X mean the
   par is too loose.

Checkmate is the only win, so the **median mating turn** is the single best health metric for a
template: one whose mates all need exactly X turns is tight (a player who misses the solver's line
pays overtime); one that always mates in 2 against a par of 5 is too loose.

## 9. Test plan for generation (M3 acceptance)

| Test | Assertion |
|---|---|
| Solvability | 10,000 generated stages across all templates: ≥95% pass the solver |
| Deployment start | 100% of stages are emitted in `phase: deployment` with no Hero Piece on the board, and with at least one deployment square safe for the King |
| No opening stalemate | 100% of stages give the enemy at least one legal move |
| Enemy value band | 100% of stages have `enemyArmyValue` inside the act band |
| Deployment availability | 100% of stages have at least `floor(spawnPoints / 3) + 1` free squares on ranks 1–4, and no enemy piece on ranks 1–4 |
| Stage rarity | 100% of enemy pieces are Normal (I13); spawned pawns and their `promotesTo` never exceed the act ceiling (I14) |
| Spawned pawns | 100% of stages spawn a count within the template range, or one above it on a bonus-pawn stage (§3), on spawn ranks outside `enemyZone` |
| Determinism | Same seed twice → byte-identical `StageState` |
| Regeneration bounds | Synthetic impossible template terminates within `maxRegenerations` and falls through |
| Difficulty banding | Median solver mating turn within one turn of the stage's par |
