# M1 — Chess Core & Turn Engine: Design

**Status:** approved in chat on 2026-11-07, awaiting written-spec review.
**Milestone:** M1 of [docs/10](../../10-roadmap-and-milestones.md#m1--chess-core--turn-engine).
**Authority:** the rules are [docs/02](../../02-rules-framework.md); the architecture is
[docs/09](../../09-technical-architecture.md). This spec says *how* M1 builds them. Where it adds or
clarifies something, §10 lists the doc change that lands with it.

---

## 1. Goal and success criteria

Deliver `packages/engine`: a pure, deterministic, dependency-free TypeScript engine for the Action
phase of a stage — move generation, per-action legality, the action queue with deferred validation,
end-of-turn resolution R1–R5, stage-end evaluation (checkmate, stalemate, turn limit, no legal queue)
and the enemy AI of docs/02 §8.1. It also adds a small `packages/content` loader for
`data/economy.yaml` and a terminal playground.

M1 is done when every acceptance box of docs/10 M1 is ticked:

- Perft-style move-generation suite passes (castling and en passant excluded).
- 30 golden queue tests reproduce exact states and event streams.
- A fuzz test over 10,000 seeded queues never violates I1–I5.
- A preview/execution parity property test passes.
- Zero runtime dependencies in `packages/engine`.
- The enemy-AI golden-position suite passes, and a depth-4 enemy move takes < 50 ms (measured in
  Node in M1; the browser measurement waits for M5, which has the first UI).
- All state is deep-frozen in tests; no mutation anywhere.

## 2. Out of scope

Skills (only stubbed), the deck, durability, the Deployment phase and `startStage` (M2), rarity
abilities (M2), stage generation and the solver (M3), the shop and economy flow (M4), the web UI (M5).
A player pawn reaching rank 8 is removed and reported by an event; adding the promoted piece to the
deck is M2.

## 3. Decisions taken in brainstorming

| Decision | Choice | Why |
|---|---|---|
| How the engine gets tuning numbers | Every public function takes an `EngineConfig` argument; `packages/content` builds it from `data/economy.yaml` | The engine stays import-free and pure; the YAML stays the single source of truth; tests use the same loader |
| How move generation is verified | `chess.js` as a **devDependency only**, used by the perft test as a reference with castling, en passant and under-promotion filtered out | Official perft numbers assume castling and en passant; a filtered reference gives exact counts for our rules. Never imported by `src/`, never shipped |
| A way to try the engine before M5 | A small terminal playground, `npm run play` | Cheap, and lets the designer feel the AI early |
| Board representation | Immutable public state; a mutable 64-square board inside the search with make/unmake | Pure API at the boundary, fast enough for depth 4 and for the M3 solver |

Rejected representations: copying immutable maps at every search node (far too slow for search),
and bitboards (fastest, but docs/09 requires an engine a designer can read in one sitting).

## 4. Repository layout

```
package.json              workspaces: ["packages/*"]; scripts: validate, test, typecheck, play
tsconfig.base.json        strict, ES2022, moduleResolution bundler, noEmit
vitest.config.ts          one config for all workspaces
packages/engine/
  package.json            name @checkbreaker/engine, "dependencies": {} (must stay empty)
  src/
    index.ts              public API (§5)
    types.ts              StageState, BoardPiece, Action, GameEvent, CommitError, EngineConfig, Result
    square.ts             'a1'..'h8' <-> 0..63, file/rank helpers, ray tables
    position.ts           internal Position: Int8Array(64) + side to move; fromStage / toBoard
    movegen.ts            pseudo-legal moves and attack maps per piece type, both colors
    legality.ts           inCheck, legal enemy moves, player per-action legality, hasLegalQueue
    queue.ts              simulate: sequential cost accounting, per-action legality, I2 at the end
    rules.ts              R1–R5, stage-end evaluation, reward, commitQueue
    rng.ts                hash (FNV-1a, 32-bit) and rng(seed, cursor)
    enemy/
      evaluate.ts         terminal scores and positional terms
      zobrist.ts          keys from a fixed seeded generator
      search.ts           alpha-beta, iterative deepening, transposition table, quiescence
      policy.ts           enemyMove: best_move, scripted with fallback, tie-break
  test/                   vitest suites (§8)
packages/content/
  package.json            name @checkbreaker/content, dependency: yaml
  src/loadEngineConfig.ts reads data/economy.yaml → EngineConfig (validated shape, deep-frozen)
scripts/play.ts           terminal playground, run with tsx
```

There is no build step in M1: workspaces import each other's `src/index.ts` directly (package
`exports` pointing at source), Vitest and tsx run TypeScript as-is, and `npm run typecheck` runs
`tsc --noEmit` across both packages. New devDependencies at the root: `typescript`, `vitest`, `tsx`,
`chess.js`.

A test asserts that `packages/engine/package.json` has no `dependencies`, and that no file in
`packages/engine/src` imports anything outside that folder.

## 5. Public API

```ts
// rules.ts
simulate(run: RunState, stage: StageState, queue: Action[], config: EngineConfig):
  Result<{ run: RunState; stage: StageState; events: GameEvent[]; award: Award | null }, CommitError>

commitQueue(run: RunState, stage: StageState, queue: Action[], config: EngineConfig):
  Result<{ run: RunState; stage: StageState; events: GameEvent[]; award: Award | null }, CommitError>

// enemy/policy.ts
enemyMove(stage: StageState, seed: number, config: EngineConfig):
  { move: { from: Square; to: Square }; policy: EnemyPolicy }

// legality.ts (also used by the CLI and, later, the UI's move hints)
legalPlayerMoves(stage: StageState, from: Square): Square[]
hasLegalQueue(stage: StageState, config: EngineConfig): boolean

// rng.ts
hash(...parts: (string | number)[]): number
rng(seed: string, cursor: number): { value: number; next: number }
```

- `simulate` runs Resolve and R1–R4. It is what the preview calls. `commitQueue` is `simulate`
  followed, when the stage is still active, by R5 (the enemy's move and the start of the next turn).
  Preview and payout therefore come from the same code (I10).
- `Award` is `{ coins, base, turnBonus }`, present only when the stage was won. Salvage is not in it:
  salvage is paid into `run.coins` at each capture and reported by its own event.
- `RunState` is the schema's type. In M1 the engine reads `actIndex` and `stageIndex` (boss =
  `stageIndex 2`) and writes only `coins`.
- `EngineConfig` mirrors only the `economy.yaml` values the engine reads: `rules`
  (`freeMovesPerTurn`, `focusPool`, `minMovesPerQueue`), each piece's `value`, `economy`
  (`baseReward`, `coinRate`, `salvage.divisor`) and the whole `enemyAI` section. Turn limits are not
  in it: the stage carries its own `turnLimit`.

## 6. Engine behaviour

### 6.1 Board and moves

- Standard chess movement, blocking and capture for all six types. No castling, no en passant.
- Pawn: one square forward, two from its home rank (rank 2 for White, 7 for Black) when both squares
  are empty, diagonal captures. Spawned pawns sit on ranks 3–5 and so never double-step.
- **The king is never captured (I3):** a move whose destination holds a king is never generated. The
  king's square still counts as attacked for check detection.
- Enemy pawn reaching rank 1 → a Normal queen (`enemy_promoted` event).
- Player pawn reaching rank 8 → removed from the board (`pawn_promoted` event carrying its
  `promotesTo`). The deck side of promotion is M2.
- **Two kinds of legality:**
  - *Player, per action:* the piece exists on `from`, is White, and `to` is reachable by its geometry
    with a clear path and not occupied by a White piece or a king. Check is **not** considered
    mid-queue; it is checked once, on the end state (I2).
  - *Enemy:* standard chess legality — a move may not leave the black king in check.

### 6.2 The queue (`simulate`)

Walking the queue in order:

1. Refuse with `stage_not_active` if `status ≠ active`, `wrong_phase` if `phase ≠ action`.
2. Refuse with `empty_queue` if the queue holds no `MOVE` (`minMovesPerQueue`).
3. For each action: `ACTIVATE_SKILL` → `unsupported_action` (M1 stub). `MOVE` → needs 1 credit
   (`credits_exceeded {atStep}` otherwise), must pass player per-action legality
   (`illegal_move {atStep, from, to, reason}`, reason ∈ `no_piece`, `not_your_piece`, `unreachable`,
   `own_piece`, `king_square`), then applies: capture (salvage `floor(value / divisor)` into
   `run.coins`, `capture` event), promotion, `move` event.
4. After the last action, R1 (no modifiers exist in M1, so nothing reverts) and R2: I1–I3 hold, else
   `invariant_violation {invariant}` — an engine bug, the turn is not applied.
5. I2 on the end state: the player's king not in check, else
   `king_in_check_at_end {square, checkers}`.
6. R3 and R4 (§6.3).

Errors carry the first failing step. `simulate` never throws for any input that matches the types.

### 6.3 End of turn and stage end

| Step | Rule |
|---|---|
| R3 | Black has no legal move: if in check → `status: won`, `endReason: checkmate`; if not → `status: lost`, `endReason: enemy_stalemated` |
| R4 | `turnsUsed + 1`. On a win: `award = round(baseReward[act] × (boss ? bossMultiplier : 1)) + (turnLimit − turnsUsed) × coinRate[act]`, added to `run.coins`. If not won and `turnsUsed = turnLimit` → `lost`, `out_of_turns` |
| R5 | Only if still active: `enemyMove` with `seed = hash(stageSeed, turnsUsed)`, applied with its events; then credits = `freeMovesPerTurn`, Focus = `focusPool`. Then, if `hasLegalQueue` is false → `lost`, `player_mated` (king in check) or `player_stalemated` |

`hasLegalQueue` in M1: some single White `MOVE` whose resulting position leaves the White king not in
check. (M2 widens it to skills.) The enemy always has a move when R5 runs, because R3 has already
ended the stage otherwise.

### 6.4 Events

`move`, `capture` (square, piece, salvage), `pawn_promoted`, `enemy_promoted`, `check` (which king),
`stage_won` (award), `stage_lost` (endReason), `enemy_move`, `enemy_fell_back`, `turn_started`. The
event stream is the only thing a UI animates from (docs/09 §4).

## 7. Enemy AI

Implements docs/02 §8.1 exactly; all numbers from `config.enemyAI`.

- **Search:** alpha-beta minimax over a mutable `Position` with make/unmake. One ply = one enemy
  move or one player move. The player is modelled as **one standard move** per turn — standard chess
  legality, since a single-move turn must end with its own king safe.
- **Iterative deepening** from depth 1 to the policy depth, with no time limit (time would break
  determinism). Each iteration seeds move ordering for the next.
- **Transposition table:** created fresh in every `enemyMove` call, so there is no hidden state
  between calls. Key: Zobrist hash of pieces, side to move and the player's turns left, from a fixed
  seeded generator. Entries store depth, bound type, best move; mate scores are stored relative to
  the node and re-based by ply on read.
- **Quiescence:** at depth 0, stand pat on the static evaluation, then search captures only, for at
  most `quiescence.maxDepth` plies, for both sides.
- **Terminals:**
  - Player mated (player to move, in check, no legal move): `+playerMated − ply`.
  - Player with no legal move and not in check, or enemy with no legal move and not in check: the
    player has lost by stalemate — scored the same, `+playerMated − ply`.
  - Player's turns run out without a mate: `+playerOutOfTurns`.
  - Enemy mated: `enemyMated + ply`.
- **Evaluation:** escape squares × `kingEscapeSquare`, player-attacked squares next to the enemy king
  × `kingZoneAttacked`, `kingInCheck` if in check, (enemy − player material) × `materialPerPoint`,
  enemy legal moves × `mobilityPerMove`. Piece values from `config.pieces`.
- **Move ordering:** TT move, then captures by most valuable victim / least valuable attacker, then
  checks, then from-square and to-square index.
- **Tie-break:** at the root each move is searched with the window `(best − 1, +∞)` so a move that ties
  the best gets an exact score (scores are integers). The tied moves keep their stable order and one
  is picked with `seed mod count`.
- **Scripted policy:** plays `line[cursor]` if it is a legal enemy move, advancing `cursor`. If it is
  illegal or the line is exhausted, it switches permanently to `best_move` at `fallbackDepth`
  (template value, else `defaultFallbackDepth`), sets `fellBack`, and emits `enemy_fell_back`. It
  never skips ahead in the line.

Performance target: a depth-4 move in < 50 ms in Node on the golden positions, measured by a
benchmark test (median of 20 runs). If mobility counting dominates, it may become a pseudo-legal
count — but only with a matching docs/02 §8.1 change.

## 8. Testing

All tests deep-freeze their inputs; any mutation throws.

| Suite | Content |
|---|---|
| `square`, `rng` | Coordinate round-trips; `hash` and `rng` are stable across runs (fixed expected values) |
| Perft | 6 positions with many pawns and sliders, depths 1–4, compared with chess.js counts filtered to our rules (no castling, no en passant, queen-only promotion). Player-pawn promotion is excluded from the comparison (its rule differs) |
| Move generation | Table-driven per piece type: blocking, captures, king never capturable, enemy promotion to queen |
| Queue golden tests | 30 scenarios (queue in → state + events out), stored as snapshot files that are reviewed when created: every `CommitError`, deferred check through an attacked square, capture with salvage, checkmate win with the reward formula, enemy stalemate loss, out of turns, player mated and stalemated after R5, scripted fallback |
| Fuzz | 10,000 seeded random queues on seeded random positions: I1–I5 always hold for accepted queues; refused queues change nothing |
| Parity | For random queues, `simulate`'s events are an exact prefix of `commitQueue`'s, and its award and pre-R5 state equal what `commitQueue` produced before the enemy moved |
| Enemy AI golden | Same position + seed → same move; mate-in-1 always taken; an unavoidable mate delayed as long as possible; quiescence does not hang a piece just past the horizon; a stalemate line is preferred over material; scripted → fallback when the move is illegal or the line ends; TT on and off give identical moves |
| Benchmark | Depth-4 move < 50 ms median on the golden positions |
| Boundaries | `packages/engine` has no dependencies and no imports outside its `src` |
| Config | `loadEngineConfig()` on the real `economy.yaml` produces a complete, frozen `EngineConfig` |

## 9. Playground (`npm run play`)

Loads `economy.yaml`, builds an Act I stage from `tpl-act1-open-field` with a fixed enemy layout and a
hand-placed player army (King e1, Rook a1, Bishop f1, two spawned pawns), and prints an ASCII board.
The player types a move (`a1a7`), sees the preview verdict, commits, and sees the enemy's reply and the event list. `help`, `undo-plan` and
`quit` are the only commands. It is a dev tool, not part of any package.

## 10. Doc changes that land with M1

| Doc | Change |
|---|---|
| docs/09 §4 | Every engine function takes `config: EngineConfig` as its last argument; `enemyMove(stage, seed, config)` returns `{ move, policy }`; `award` becomes `{ coins, base, turnBonus } | null`; `CommitError` gains `unsupported_action` (M1 only, removed in M2) and `invariant_violation` (R2) |
| docs/09 §1, §11 | `chess.js` listed as a dev-only perft reference; `npm test`, `npm run typecheck`, `npm run play` marked M1 |
| docs/09 §2 | `package.json` gains the `workspaces` field; `packages/content` exists from M1 (loader only) |
| docs/10 M1 | The depth-4 timing is measured in Node in M1 and re-measured in the browser in M5 |

## 11. Risks

| Risk | Response |
|---|---|
| Depth-4 search misses 50 ms | Measure first; then cheaper mobility (with a docs change), better ordering, a smaller quiescence depth via `economy.yaml` |
| Deferred validation "fixed" mid-queue | Golden tests that walk the king through check and give a vanishing check; docs/02 §3 calls it core |
| chess.js disagrees because of rule differences | The filter is part of the test and documented; disagreements are investigated one position at a time, never by loosening the comparison |
| Hidden state in the search | TT built per call; a test calls `enemyMove` twice with a different call in between and requires the same move |
