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

> **Stage generation runs after the shop, seeded with the player's actual deck.**

Every stage is therefore validated as solvable **with the army the player actually owns** — including
a deck the designer never anticipated. There is no such thing as an unwinable stage caused by a
bad shop, and no need for the designer to enumerate deck states.

**Puzzle quality is preserved by templates, not by randomness.** A template is a designed encounter:
it fixes the enemy composition, turn limit, board sparsity, and spawned pawns. Only the *exact
placement* and *which of the player's pieces appear* are randomized. The puzzle's shape is authored;
its instance is generated.

## 2. Template anatomy

```yaml
id: tpl-act1-open-field
title: Open Field
act: 1
tier: normal          # normal | boss
turnLimit: 8
# spawnPoints: 6     # optional: lowers the act's budget (data/economy.yaml), never raises it

enemyArmy:            # ranges are inclusive [min, max]
  pawn:   [2, 4]
  knight: [0, 1]
  bishop: [0, 1]
  rook:   [0, 1]
enemyZone: [7, 8]     # enemy occupies these ranks; ranks 5-8 only (Black side)

spawnedPawns:         # free, stage-only pawns for the player (docs/02 §2.1)
  count: [2, 2]
  ranks: [3, 4]       # rank 8 must be reachable within turnLimit

focusPool: 3          # no deploymentRanks: the player always deploys on ranks 1-4

enemyPolicy: { type: best_move, depth: 3 }

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
further away makes it a costly detour from the coin preview. The validator rejects a template whose
lowest spawn rank cannot reach rank 8 within `turnLimit`, or whose spawn ranks overlap `enemyZone`.
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

Generation runs once per stage, after the shop resolves. It is deterministic for
`(runSeed, actIndex, stageIndex)`.

| Step | Action | Failure → |
|---|---|---|
| **G0** | Derive seed: `hash(runSeed, actIndex, stageIndex)` | — |
| **G1** | Select template: filter by act + tier, weighted; exclude templates used in the previous stage of the same act where possible | No template → engine bug (every act/tier must have ≥2 templates) |
| **G2** | Roll enemy army from `enemyArmy` ranges (a fixed template takes `fixedEnemy` as-is). Every enemy piece is a Stage Piece at Normal rarity; no rarity roll happens | — |
| **G3** | Place enemy pieces in `enemyZone` under constraints (no illegal square, the enemy king not in check, and at least one deployment square left unattacked for the player's King); skipped for a fixed template | Retry placement (max 50 tries) → regenerate |
| **G4** | Prepare the Deployment phase: set `spawnPoints` (the act and tier's budget, lowered by the template if it says so) and `phase: deployment`. **No Hero Piece is placed** — the King and the summons are the player's choice ([02 §5](02-rules-framework.md#5-deployment)) | — |
| **G4b** | Spawn pawns: roll the count from `spawnedPawns.count`; for each pawn roll a rarity from `rarity.pool` for the act, then its `promotesTo` result (type, then tier per [02 §2.2](02-rules-framework.md#22-promotion)); place on random empty squares in `spawnedPawns.ranks` | Retry placement → regenerate |
| **G5** | Compute the enemy army value; verify it is inside the act band (§6) | Regenerate |
| **G6** | Assert preconditions (§4) | Regenerate |
| **G7** | **Solver check** (§5): a checkmate exists within the turn limit, using the current board + remaining deck | Regenerate |
| **G8** | Emit `StageState` with provenance `{templateId, seed, attempts}` | — |

Regeneration cap: `maxRegenerations` (20). On exhaustion, fall through to the next-best template for
that act/tier and reset the counter. If every template fails, the generator emits the last attempt
with a `validationFailed` flag — the UI must surface this as a bug report prompt rather than showing
an unverified stage. This is a **fail-loud** path, not a silent fallback.

## 4. Preconditions

The player's army is not on the board when these run — the King and the summons are placed later, in
the Deployment phase. So every precondition is about the generated board alone, or about what *any*
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

The solver answers exactly one question: **"can this stage be won within the turn limit, with this
deck and this loadout?"** It does not need to find the *best* line, only a winning one — which keeps
it tractable.

"This deck" includes each Hero Piece's rarity, because rarity changes movement: the solver generates
moves with the abilities of [02 §2.3](02-rules-framework.md#23-rarity-movement-abilities) (ally leaps,
extra leaps and steps, multi-capture, the Legendary knight's free second move). Lifeline does not
affect a stage — the queen still leaves the board — so the solver ignores it. It also models spawned
pawns and promotion; a promoted piece joins the deck but cannot be summoned until the next stage, so
within a stage promotion only removes the pawn. Because every promotion result is rolled at
generation, the solver sees exactly what the player sees.

### Search shape

- **Ply 0 is the deployment.** The solver first chooses a King square and a set of summons whose
  spawn costs fit `spawnPoints`, with their squares. Trying every placement is hopeless (up to 32
  squares on ranks 1–4, up to six pieces), so it enumerates a bounded candidate set:
  - pieces: subsets of the deck by **type + tier** (identical instances are interchangeable) that fit
    the budget, largest and most valuable first;
  - squares: for each piece, only squares from which it reaches the enemy zone, an open file or
    diagonal, or a spawned pawn's path within two moves; the King on safe squares only.

  This search is **incomplete but sound**: a stage it accepts has a real winning deployment and
  line, so no unwinnable stage ever ships; a winning deployment it fails to try only costs a
  regeneration.
- **Every later ply is a turn, not an action.** Each ply expands the current position into candidate
  *queues*, not individual actions.
- **Queue candidates** per turn are generated from a bounded combinatorial set, each holding at
  least one `MOVE` (there is no pass):
  - single `MOVE`
  - `MOVE` + one skill
  - skill + `MOVE` + `MOVE` (Twin Step lines)
  - `MOVE` + bonus `MOVE` (Legendary knight; also combined with each line above)
- **Move enumeration** is chess-legal generation plus rarity abilities; skills add a small
  multiplicative factor (bounded by charges remaining). Rare+ knights and bishops widen per-piece
  branching, and a Legendary knight roughly squares its own; these are the first places to look if
  solver budgets are exceeded.
- **Losing leaves are pruned at once.** A queue that stalemates the enemy, a reply that leaves the
  player with no legal queue, and a position with no turns left are all losses
  ([02 §7](02-rules-framework.md#7-stage-end-evaluation)); the solver never expands them.
- **Enemy replies are not branched.** The enemy is a deterministic function
  (`enemyMove`, [02 §8.1](02-rules-framework.md#81-enemy-ai)), so after each candidate queue the solver
  computes the *one* reply the enemy will actually play — including scripted lines and their fallback.
  The solver is therefore a **single-agent search** over the player's deployment and queues, far
  cheaper than a two-sided minimax, and its prediction always matches the real game.
- **Enemy replies are memoized** per position (`generation.memoizeEnemyReplies`): the same position
  never runs the enemy's search twice. Without this, an enemy search at every solver node would be
  the dominant cost.

### Budgets and acceptance

| Parameter | Value | Notes |
|---|---|---|
| `solverNodeBudget` | 200,000 queue-nodes | Hard stop |
| `solverTimeMs` | 2,000 | Wall-clock guard |
| Acceptance | any deployment + queue sequence terminating in `WIN` **using at least 2 turns** | First found wins; the 2-turn floor rejects free wins |
| Ordering heuristic | mate-in-1 first → checks/captures → everything else | Finds wins fast; keeps cost flat |
| Rejection | budget exhausted with no win | Stage regenerated |

### Cost control

The solver is affordable **only** because templates are narrow. With ~8–10 pieces on the board,
~3 skills, and an 8-turn limit, the branching factor per ply stays in the low hundreds in practice;
the mate-first ordering typically resolves Act I stages in well under 10k nodes. The deployment ply
multiplies everything below it, so its candidate set is the first knob to turn: fewer candidate
squares per piece, or only the strongest few subsets.

Mitigations if real numbers exceed budget (tracked in [10](10-roadmap-and-milestones.md)):
1. Cache: memoize accepted template+seed combinations in a shipped table for the most common
   starting decks.
2. Precompute: validate a template family offline against a set of representative deck archetypes,
   then verify only the deck-specific deployment online.
3. Loosen: reduce Act I turn limits, which shrinks the search depth.

## 6. Difficulty curve

| Act | Turn limit | Enemy army value | Spawn points | Spawned pawns (ranks) | Spawned-pawn rarity | Enemy policy depth |
|---|---|---|---|---|---|---|
| **I** | 8 | 7–9 | 9 | 2 (3–4) | Normal–Rare | 2 |
| **II** | 6 | 10–14 | 12 | 1–2 (3–4) | up to Unique | 3 |
| **III** | 5 | 14–22 | 15 | 1–2 (3–5) | up to Legendary | 3 |
| **Boss** | limit − 1 | its act's band ×1.25 | its act's + 3 (12 / 15 / 18) | 1–2, ranks still reachable in the tighter limit | as its act | 4 or `scripted` |

A normal stage's spawn points are three times the number of minors it can field (3 / 4 / 5 by act);
a boss affords one more. The player's summoned value therefore tracks the enemy army value band, with
the spawned pawns, the first move and the skills as the player's edge.

Spawned-pawn counts and ranks are the values the example templates use; the hard rule is only that
rank 8 must be reachable within the turn limit from every spawn rank (§2). Rarity comes from the act's
pool ([07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)).

Three independent difficulty dials, applied in this order:

1. **Turn limit** — the harshest dial; it removes slack rather than adding difficulty.
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
   hanging while chasing the turn counter.")
2. **Draft the template** in `content/templates/`. Keep it ~15 lines.
3. **Run the validator** (M3) which generates 200 seeded instances and reports:
   solver success rate, distribution of turns-to-win, and the failure-reason histogram.
4. **Tune** the four numbers that matter: `turnLimit`, `enemyArmy`, `spawnPoints`, and
   `spawnedPawns`.
5. **Acceptance for a template:** ≥95% of generated instances solvable (a mate exists within the
   limit), and median mating turn around 60% of the turn limit.

Checkmate is the only win, so the **median mating turn** is the single best health metric for a
template: one whose mates cluster on the final turn is too tight (and pays only the base reward);
one that always mates in 2 is too loose.

## 9. Test plan for generation (M3 acceptance)

| Test | Assertion |
|---|---|
| Solvability | 10,000 generated stages across all templates: ≥95% pass the solver |
| Deployment start | 100% of stages are emitted in `phase: deployment` with no Hero Piece on the board, and with at least one deployment square safe for the King |
| No opening stalemate | 100% of stages give the enemy at least one legal move |
| Enemy value band | 100% of stages have `enemyArmyValue` inside the act band |
| Deployment availability | 100% of stages have at least `floor(spawnPoints / 3) + 1` free squares on ranks 1–4, and no enemy piece on ranks 1–4 |
| Stage rarity | 100% of enemy pieces are Normal (I13); spawned pawns and their `promotesTo` never exceed the act ceiling (I14) |
| Spawned pawns | 100% of stages spawn a count within the template range, on spawn ranks, with promotion reachable in the turn limit |
| Determinism | Same seed twice → byte-identical `StageState` |
| Regeneration bounds | Synthetic impossible template terminates within `maxRegenerations` and falls through |
| Difficulty banding | Median solver win turn within ±20% of the template's target band |
