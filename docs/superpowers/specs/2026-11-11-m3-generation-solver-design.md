# M3 — Stage Generation, Solver & Par Economy: Design

**Status:** approved in chat on 2026-11-10/11, awaiting written-spec review.
**Milestone:** M3 of [docs/10](../../10-roadmap-and-milestones.md#m3--stage-generation--solver).
**Authority:**
- The rules are in [docs/02](../../02-rules-framework.md) and the economy in [docs/05](../../05-run-structure-and-economy.md); generation is [docs/04](../../04-stage-generation-and-authoring.md), the shop flow [docs/07](../../07-shop-phase.md), and the architecture [docs/09](../../09-technical-architecture.md).
- The rule changes decided in this brainstorm (the par, overtime, the shop preview, the unproven-stage pawn) are already in those docs.
- docs/04 §3–§5 still describe the old pipeline and solver; Phase 0 rewrites them from this spec (§6).

---

## 1. Goal and success criteria

Generate every stage from an authored template and a natural enemy formation, prove that it can be
mated within its par with the player's actual deck, and do it deterministically from the seed and the
deck. In the engine, replace the turn limit with the par economy.

M3 is done when every acceptance box of docs/10 M3 is ticked, and in addition:

- **The M1 and M2 suites stay green.** These are perft, golden, fuzz, parity, reference, the benches and the 338 tests. A snapshot changes only where this spec changes a field: `turnLimit` → `mateIn`, `turnBonus` → `parBonus`, `out_of_turns` → `out_of_coins`.
- **The proof cannot be spoiled by the shop.** A solver line found with the deck the shop opened with stays a winning line whatever the player buys. The enemy's clock never reads the wallet within the par (§7.3).
- **The proof is replayed.** No stage counts as proven unless its line was replayed through `startStage` and `commitQueue`.

## 2. Out of scope

| Not in M3 | Where |
|---|---|
| Calling the generator after a stage, the shop, run advancement | M4 (M3 ships pure functions) |
| Running generation in a Web Worker; the shop's next-stage preview panel; the HUD | M5 |
| Solver lines that use skills (the solver plays moves only; §9.1) | Not planned |
| Lichess *game* database, `placement: formation` for White, the "assign rarity to a full Lichess board" idea (parked by the user) | Not planned |
| Template tuning beyond the two new templates and First Steps | M6 |

## 3. Decisions taken in brainstorming

| # | Decision |
|---|---|
| D1 | The solver is a single-agent search: the enemy is deterministic, so each candidate queue gets the one reply `enemyMove` gives. |
| D2 | The next stage is generated **as soon as a stage is cleared**, from the deck after the stage-end chooser, never during play. The solver runs in the background over the results screen and the shop. |
| D3 | The shop shows the next stage as a **full-board preview, with no par and no label of any kind**. |
| D4 | Selling or merging a piece the next stage needs is the player's informed choice; nothing is re-checked after the shop. |
| D5 | The solver's budgets count **nodes, not time**, so generation depends only on the seed and the deck. |
| D6 | Up to **3 boards** are tried; if none is proven, the **first board gets one extra spawned pawn**, silently. There is no fallback formation library. |
| D7 | The extra pawn is the **one documented exception** to docs/05's "no hidden assistance": the rule is public (Codex), the pawn is visible, only *which* stage got it is not said. |
| D8 | Enemy formations come from **Lichess puzzle positions** (CC0): Black's side only, filtered (not trimmed) per template; random placement stays as the fallback. |
| D9 | **50 formations per template** to start (`maxPerTemplate`). |
| D10 | The solver is a **two-stage beam search**: cheap screening of many deployments, then a deep search on the best few. |
| D11 | **Par economy.** Every stage has a par "Mate in X" (X = 2–5), proven by the solver. There is no turn limit; each turn past X costs `overtimeCost`, from the pending base reward first, then the wallet. A turn neither can pay loses the run (`out_of_coins`). A mate within X pays `parBonus`. `coinRate` is removed. |
| D12 | The par is hidden only in the shop; the Stage screen shows `MATE IN X` from the Deployment phase on. |
| D13 | New templates (Act II boss, Act III normal) and tuning come at the end of M3, measured with `gen:report` and the real solver. |

The solver spike of 2026-11-10 that informed D1, D5, D6 and D10 (throwaway code, not in the repo):

| Measurement | Result |
|---|---|
| Brute-force search (all moves) | One deployment, 60 s, 5 turns deep, no mate found |
| Beam search guided by `evaluate`, Act II–III | Most stages solved in 0.2–7 s |
| Beam search, Act I | With 16 deployment candidates it mostly failed. With 200, Open Field seed 2 was solved (mate on turn 8, about 37,000 nodes, 13 s). |
| Costs | `simulate` dominates Act I. An enemy search at depth 3–4 costs 5–12 ms. `hasLegalQueue` is 2–5 % of the total. The enemy-reply memo saves 30–60 % of enemy calls. |

## 4. Phases

| Phase | Content | Depends on |
|---|---|---|
| 0 | `mix32` and seed streams; `packages/gen` scaffold; templates move to `content/templates/`; docs/04 §3–§5 rewritten | — |
| A | Par economy: data, schemas, validator, engine, tests | 0 |
| B | Formations: extraction tool, `content/formations/`, loader, validator checks | 0 (needs the Lichess download, asked first) |
| C | Generator pipeline: placement, spawned pawns, preconditions, `generateStage` without the solver | A, B |
| D | Solver: deployment candidates, beam, budgets, replay; wired into G6 | C |
| E | `gen:report`, the two new templates, First Steps tuning, acceptance runs | D |

## 5. Public API and state

### 5.1 Engine

```ts
mix32(h: number): number                         // murmur3 fmix32 finalizer
draw(seed: string, ...parts: (string | number)[]): number   // mix32(hash(seed, ...parts)) / 2^32, in [0, 1)
```

`hash` and `rng` are unchanged; `enemyMove`'s tie-break keeps `hash(stageSeed, turnsUsed)`.

`StageState`: `turnLimit` is removed; `mateIn: number` and `overtimePaid: number` are added.
`endReason`: `out_of_turns` → `out_of_coins`. `Award = { coins, base, parBonus }`, with `base` net
of overtime. New event `{ type: 'overtime_paid', turn, fromReward, fromWallet }`.

`EngineConfig.economy`: `coinRate` → `parBonus: {act1, act2, act3}` and `overtimeCost: {act1, act2, act3}`.
`EngineConfig.enemyAI.terminal.playerOutOfTurns` → `playerOutOfClock`.

`enemyMove(stage, seed, config, clock: number)` — `clock` is the player's turns left as the enemy
counts them (§7.3); `scoreRootMoves` already takes it as `playerTurnsLeft`.

### 5.2 Content

`loadTemplates(): Template[]` from `content/templates/*.yaml`; `loadFormations(): Record<templateId, Formation[]>`
from `content/formations/*.json`. `Formation = { id: string; rating: number; black: string }` where
`black` is the FEN placement field with only Black pieces.

### 5.3 Gen

```ts
generateStage(
  input: { run: RunState; actIndex: number; stageIndex: number; previousTemplateId?: string },
  config: EngineConfig,
  content: { templates: Template[]; formations: Record<string, Formation[]> },
): { stage: StageState; provenance: Provenance }

solveStage(run: RunState, stage: StageState, config: EngineConfig): {
  win: { placements: { instanceId: string; to: Square }[]; line: Action[][]; mateTurn: number } | null;
  stats: { screenNodes: number; deepNodes: number; deployments: number; enemyCalls: number; memoHits: number };
}

type Provenance = {
  templateId: string; seed: string; formationId: string | null; mirrored: boolean;
  attempts: number; proven: boolean; bonusPawn: boolean; solverNodes: number; validationFailed?: true;
};
```

`StageState.provenance` keeps its existing optional fields (`templateId`, `seed`, `attempts`,
`validationFailed`); the rest of `Provenance` is returned beside the stage for `gen:report` and is
never shown to the player.

## 6. Phase 0 — preparation

- **`mix32` and `draw`** in `engine/src/rng.ts`. Every random choice of the generator reads its own
  stream: `draw(stageSeed, 'template')`, `draw(stageSeed, 'formation', attempt)`,
  `draw(stageSeed, 'mirror', attempt)`, `draw(stageSeed, 'par')`, `draw(stageSeed, 'spawn', attempt, i, field)`,
  `draw(stageSeed, 'bonus-pawn', field)`, so a change to one step never shifts another.
- **`packages/gen`** (`@checkbreaker/gen`), depending on `@checkbreaker/engine` and
  `@checkbreaker/content`; the engine does not depend on it.
- **Templates** move from `content/examples/templates.yaml` to one file per template in
  `content/templates/`; the validator and the schema follow.
- **docs/04 §3–§5** rewritten to this spec: the pipeline of §8, the solver of §9, the formation mode
  of §7.2. Nothing in this spec may contradict docs/04 after Phase 0.

## 7. Phase A — Par economy in the engine

### 7.1 Data, schemas, validator

- `economy.yaml`: `coinRate` removed; `parBonus {act1: 6, act2: 9, act3: 12}`, `overtimeCost
  {act1: 2, act2: 3, act3: 4}`; boss amounts use `bossMultiplier` and are rounded with `Math.round`
  like the base reward. `enemyAI.terminal.playerOutOfTurns` renamed `playerOutOfClock`.
- Templates: `turnLimit` → `mateIn: [lo, hi]` with 2 ≤ lo ≤ hi ≤ 5. Starting ranges: Act I [4, 5],
  Act II [3, 4], Act III [2, 3], each boss its act's shorter end. The spawned-pawn rule "rank 8
  reachable within `turnLimit`" is removed; spawn ranks must still stay out of `enemyZone`.
- `stage.schema.json`: `mateIn` (2–5), `overtimePaid` (≥ 0), `out_of_coins`. The validator checks
  every new field and rejects `turnLimit` and `coinRate` with a named message.

### 7.2 Overtime and the award

- **R4** advances `turnsUsed` and never ends the stage by itself.
- **Award on a win** (R4): `base = max(0, baseFull − overtimePaid)`, `parBonus = turnsUsed ≤ mateIn ?
  parBonusFull : 0`, `coins = base + parBonus` (salvage unchanged, paid as it happens).
- **After R5**, in `commitQueue`, once the legal-queue check has not ended the stage: if
  `turnsUsed + 1 > mateIn`, the next turn costs `overtimeCost(act)`:
  `fromReward = min(cost, max(0, baseFull − overtimePaid))`, `fromWallet = cost − fromReward`. If
  `run.coins < fromWallet` the stage is lost with `out_of_coins`; otherwise `run.coins −= fromWallet`,
  `overtimePaid += cost`, and `overtime_paid` is emitted.
- Loss order after R5: `player_mated`, `player_stalemated`, then `out_of_coins` (docs/02 §7).

### 7.3 The enemy's clock

`clock(run, stage, config)`:
- within the par (`turnsUsed < mateIn`): `mateIn − turnsUsed`;
- past it: `floor((max(0, baseFull − overtimePaid) + run.coins) / overtimeCost)`, at least 1 while the stage is active.

The search scores a line that exhausts the clock as `playerOutOfClock`. Within the par the clock
never reads the wallet, so `enemyMove` within the par is a function of the stage alone and the
solver's proof survives the shop (§1).

### 7.4 Tests

- Overtime is charged from the reward, then the wallet, across the boundary turn.
- `out_of_coins` fires on an empty wallet with the reward spent.
- `parBonus` is paid exactly when `turnsUsed ≤ mateIn`.
- Boss rounding.
- The clock within and past the par.
- `enemyMove` within the par is unchanged by `run.coins` (property test).
- The M1 and M2 suites are migrated field by field.

## 8. Phase B and C — Formations and the generation pipeline

### 8.1 Formation extraction (offline)

`tools/formations/extract.ts` reads `.cache/lichess/lichess_db_puzzle.csv.zst` (git-ignored;
downloaded once with the user's permission; decompressed with Node's built-in zstd).

For each row:
1. Apply the first UCI move of `Moves` to `FEN` with chess.js. The result is the puzzle position, and the side to move solves it.
2. The defender is the other side. If it is White, flip the board vertically and swap colours.
3. Keep only Black's pieces. Reject the position if any of these holds:
   - a Black piece lies outside the template's `enemyZone`;
   - the composition is outside `enemyArmy`;
   - the value is outside the act band;
   - a pawn is on rank 8.
4. Deduplicate: a formation and its left–right mirror count once.

Survivors are sorted by `mix32(hash(puzzleId))`, and the first `generation.formations.maxPerTemplate` (50) are written to
`content/formations/<templateId>.json`. The file also records:
- the source, licence (CC0) and the source file's date and SHA-256;
- the filters applied;
- each formation's id, rating and Black placement.

Re-running on the same source file is byte-identical. A tiny CSV fixture in the repo tests the tool.
CI never downloads.

The validator re-checks every stored formation against its template and warns when a template has
fewer than `generation.formations.minPerTemplate` (20).

### 8.2 Pipeline

| Step | Content | On failure |
|---|---|---|
| G0 | `stageSeed = hash(runSeed, actIndex, stageIndex)` | — |
| G1 | Template by act and tier (boss when `stageIndex == 2`), weighted, avoiding `previousTemplateId` where possible | No template → engine bug |
| G2 | Board: a `fixed` template uses `fixedEnemy`. Otherwise a formation `⌊draw('formation', a) × n⌋`, mirrored left–right if `draw('mirror', a) < 0.5`. With an empty pool, the old random placement in `enemyZone`. | — |
| G3 | Deployment phase: `mateIn` drawn from the template range with `draw('par')` once per stage; spawn points; Focus; enemy policy | — |
| G4 | Spawned pawns: count, squares, rarity, `promotesTo` from their streams | No square → next attempt |
| G5 | Enemy value band, then the seven preconditions of docs/04 §4 | Next attempt; at most `maxRegenerations` (20) per template |
| G6 | `solveStage` with the deck (in-deck pieces with durability ≥ 1, and the King) | Next board; at most 3 boards that passed G5 |
| G7 | The first proven board, or else the first board that passed G5 plus one spawned pawn (`bonus-pawn` stream, template spawn ranks, preconditions re-checked; first legal square in stream order, none if none) | — |
| G8 | Emit `StageState` (`phase: deployment`, `mateIn`, `overtimePaid: 0`) and `Provenance` | — |

If 20 attempts fail G5 in a template, the next template of the act and tier is tried. If every one
fails, the last attempt is emitted with `validationFailed: true` — a content error the UI must report
as a bug. "Not proven" never sets `validationFailed`.

## 9. Phase D — The solver

### 9.1 Scope

The question is: is there a deployment and a line of single-move queues that mates within `mateIn`
turns and on turn 2 or later, against `enemyMove`?

- Queues are a single `MOVE`, or `MOVE` plus the Legendary knight's bonus `MOVE`. **No skills.** Skills only add options, so a line without them stays legal for any loadout.
- Rarity abilities, multi-capture and promotion come from the engine's `simulate`.

### 9.2 Deployment candidates

- **Subsets:** every type-and-rarity multiset of the deck that fits `spawnPoints`, counting identical instances once. Maximal subsets come first, largest value first, up to `deployment.maxSubsets` (6).
- **King squares:** up to `deployment.kingSquares` (4) safe squares on ranks 1–4, spread across files and ranks, avoiding squares on an open line to an enemy rook, bishop or queen.
- **Piece squares:** each piece's top `deployment.squaresPerPiece` (6) squares, scored by:
  - attacks on the squares next to the enemy king;
  - legal moves into ranks 5–8;
  - safety from enemy attack.
- **Combining:** greedy assignment plus single-piece variants, interleaved across subsets and King squares, up to `deployment.maxCandidates` (200). Each candidate is validated by `startStage`.

### 9.3 Search

- **Stage 1 (screening).** Every candidate runs a beam of width `screen.width` (4) for `min(screen.turns, mateIn)` turns (3). Candidates rank by the best score they reach. A mate found here ends the solve.
- **Stage 2 (deep).** The top `deep.candidates` (8) run a beam of width `deep.width` (32) to `mateIn` turns.
- **Beam step.** For each state and each candidate queue:
  1. `simulate` the queue.
  2. A win on turn ≥ 2 ends the search; a loss is dropped.
  3. On the last turn of the par only wins are kept: no enemy reply is needed.
  4. The others are scored by `−evaluate` with tiers and deduplicated by position.
  5. The top `width × expansion` (3) get an enemy reply, memoized per board by position.
  6. A reply that leaves no legal queue is dropped.
  7. The top `width` are kept.
- **Determinism.** All sorts break ties by the queue's text.

### 9.4 Budget, replay, output

- **Budget.** A node is one enemy reply needed (computed or memoized), so the count is the same on every device. A board stops at `solver.nodeBudget` (40,000; the spike's hardest solved board needed about 37,000). `solver.timeMs` and `orderHeuristic` are removed from `economy.yaml`.
- **Replay.** A found line is replayed through `startStage` and `commitQueue` with a run whose coins do not matter, because the par never reads the wallet. A mismatch rejects the line and is counted as a solver bug in `gen:report`.
- **Output.** `win` and `stats`, as in §5.3.

## 10. Phase E — Report, templates, acceptance

`npm run gen:report [--stages N] [--template id]` generates N stages per template (default 200)
with three deck fixtures: starter, mid (`run-mid.yaml`), and a strong Act III deck. Per template it
reports:
- the proven rate within the par;
- the solver's median mating turn against X;
- the bonus-pawn rate;
- screen and deep nodes, and nodes per tier mix;
- median and p95 wall time;
- the failure-reason histogram;
- the formation pool size.

The acceptance run uses 10,000 stages.

Two new templates complete the 6+ (Act II boss, Act III normal). First Steps is re-tuned (its spike
instances were not proven with 6 spawn points). Ranges, zones and armies change only on report
evidence, and each change is recorded in the template's `designNote`.

## 11. Testing

- **RNG:** chi-square over 8 buckets for 10,000 consecutive `draw` values; reproducibility.
- **Formations:** the extraction fixture, flip and colour swap, mirror deduplication, every filter, and byte-identical re-runs.
- **Pipeline:** each precondition on fixture boards; the streams' independence (changing the spawn stream does not move the formation); the 3-board and bonus-pawn path; the `validationFailed` path with a synthetic impossible template.
- **Solver:**
  - positions with a known mate in 2 and 3;
  - a Legendary knight bonus-move mate;
  - a promotion mate;
  - a tampered line rejected by replay;
  - the node budget stopping deterministically.
- **Bulk in CI:** 1,000 generated stages, 100 % preconditions, I13/I14 and determinism. The 10,000-stage solvability run stays in `gen:report`, outside CI.

## 12. Doc and data changes that land with M3

- docs/04 §3–§5 (Phase 0).
- docs/09: the `gen` package, `mix32` and `draw`, `enemyMove`'s `clock`, `overtime_paid`, `Provenance`.
- README: the Lichess credit.
- `economy.yaml`: §7.1, plus `generation.formations {maxPerTemplate: 50, minPerTemplate: 20}` and `generation.solver {nodeBudget, deployment, screen, deep, expansion}`.
- Schemas and the validator for templates, formations and stages.
- `.gitignore`: `.cache/`.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Act I deployment ply still too weak at 40,000 nodes | Tune §9.2 with `gen:report`; shorten the Act I par; the bonus pawn bounds the cost |
| Thin formation pool for Act I's `enemyZone` [7, 8] | Widen the zone to [6, 8] on report evidence (D13); random placement is the fallback |
| Wall time p95 above 15 s on a slow laptop | Node budgets keep the result identical; lower `deep.candidates` or `nodeBudget` and accept more bonus pawns |
| The par clock changes enemy behaviour near the par boundary | The property test of §7.4, and the golden suite migrated with intent |
| The Lichess file grows or changes format | The extractor records the source's date and checksum; formations are committed, so builds never depend on the download |
