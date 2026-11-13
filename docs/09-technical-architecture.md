# 09 — Technical Architecture

A single-page web game with a **pure, deterministic, dependency-free rules engine** at its core. The
engine has no knowledge of React, storage, or animation; the same code path serves the UI, the
preview, the solver used at generation time, and replay.

---

## 1. Stack

| Concern | Choice | Note |
|---|---|---|
| Language | TypeScript (strict) | |
| Build | Vite | |
| UI | React 18 + `useReducer`/Context | No global state library at MVP |
| Package manager | **npm workspaces** | `pnpm` was the intended choice but is not installed in the build environment; npm workspaces are equivalent for this repo's needs and require no extra tooling. Migrating to pnpm later is a lockfile-only change. |
| Tests | Vitest | |
| Content validation | `ajv` (draft 2020-12) + `yaml` | Dev-only; never shipped to the client |
| Persistence | `localStorage` JSON, versioned | No backend, no accounts, no telemetry |
| Animation | CSS transitions + a tiny board renderer | No game engine, no canvas required at MVP |

**Runtime dependency budget for `packages/engine`: zero.** A chess engine that a designer cannot read
in one sitting is a liability, and the rules here are deliberately non-standard enough that a third-
party chess library would fight the design (deferred moves, transform durations, deferred check
validation). Movement generation is ~200 lines.

`chess.js` appears only as a **dev-only perft reference** in the engine's tests (M1): it checks our
move generation on positions where the rules agree, never at runtime and never in a bundle.

### Stockfish as a design tool (offline only)

The enemy AI is our own minimax ([02 §8](02-rules-framework.md#8-enemy-behavior)). Stockfish — or
Fairy-Stockfish, which accepts custom pieces — may be used **only as an external helper for the
designer**:

| Allowed use | Why it helps |
|---|---|
| Sanity-checking a template's sample positions ("is this mate reachable at all in normal chess?") | A fast second opinion before the M3 solver runs |
| Drafting `scripted` lines for teaching and boss stages | Finds strong, natural-looking defensive moves to write into the script |
| Spotting positions that are trivially lost or won for the enemy | Catches bad templates early |

Rules for using it:

- **Never shipped and never imported.** It runs as a separate program (UCI over the command line)
  from a dev script or by hand. `packages/engine`, `packages/gen` and `apps/web` must not depend on
  it, and it is not vendored into the repository.
- **Advisory only.** Stockfish plays standard chess: one move per side, no rarity abilities, no
  multi-action turns, no par or overtime. Its verdict is a hint; the M3 solver, which uses the game's own
  rules, is the only authority on whether a stage is solvable.
- **Scripted lines are re-checked.** A line drafted with Stockfish must replay legally in our engine
  before it goes into a template.
- **Licence.** Stockfish is GPLv3. Using it as a separate tool on the designer's machine, without
  distributing it with the game, keeps the game's own code free of that obligation. This is a
  personal, non-commercial project ([11 H](11-open-decisions.md#h-monetization)), so the question only
  returns if the game is ever published.

## 2. Repository layout

```
package.json                npm workspaces root (`"workspaces": ["packages/*"]` from M1;
                            `apps/*` joins when apps/web exists in M5)
data/
  economy.yaml              ALL tuning constants (single source of truth)
schemas/
  piece.schema.json
  skill.schema.json
  template.schema.json
  stage.schema.json
  run.schema.json
content/
  examples/                 Validated example content (this milestone)
  templates/                Stage templates (M3)
  formations/               Enemy formations per template, extracted from Lichess puzzles (M3)
packages/
  engine/                   Pure TS: board, moves, queue resolution, evaluation. Two entries: `.` (the
                            public API) and `./internal` (re-exports for `gen` only)
  content/                  Loads + validates data, exports typed definitions: `loadEngineConfig`,
                            `loadGenConfig`, `loadTemplates`, `loadFormations`, `solverSettingsFor`,
                            `valueBandFor`, `enemyArmyValue`
  gen/                      Stage generation + solver (M3), `@checkbreaker/gen`
apps/
  web/                      React UI
scripts/
  validate-content.mjs      ajv validation of content/ against schemas/
  check-links.mjs           Broken-link check over the Markdown (`npm run check:links`)
  play.ts                   Terminal playground over the engine (`npm run play`, M1)
  gen-report.ts             Template health report (`npm run gen:report`, M3); its worker threads
                            run `gen-report-worker.ts`
tools/
  formations/extract.ts     Offline formation extractor (`npm run formations:extract`, M3)
docs/                       Design documents 00–11
```

Boundary rules:
- `engine` imports nothing but its own source.
- `content` may import `engine` types, never the reverse.
- `gen` imports `engine` + `content`, and the engine's `./internal` entry (`src/internal.ts`:
  `fromBoard`, `tiersOf`, `legalMoves`, `inCheck`, `evaluate`, `makeMoveTiered`, `abilityAttacked`,
  `applyPlayerMove` and the like), which exists for the solver and is not public API. The **main
  thread never imports `gen`**: generation runs at runtime, over the results screen and the shop,
  so only the generation Web Worker (M5) imports it, and the solver ships inside that worker.

## 3. Core types

```ts
type Square = string;                          // 'a1' … 'h8'
type PieceType = 'king' | 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';
type Color = 'white' | 'black';
type Rarity = 'normal' | 'rare' | 'unique' | 'legendary';   // ascending; docs/06 §4

interface PieceInstance {                // a Hero Piece
  instanceId: string;
  pieceType: Exclude<PieceType, 'pawn'>;  // pawns never enter the deck
  rarity: Rarity | null;         // fixed at creation; null = king only (I12)
  durability: number | null;     // remaining deployments; null = immortal (king)
  durabilityMax: number | null;  // null = immortal (king); depends on rarity for some types
  origin: 'starter' | 'shop' | 'promotion' | 'merge' | 'reward';
  acquiredAtStage: number;
  status: 'in_deck' | 'deployed' | 'captured' | 'spent';
  usedOnce?: Array<'lifeline'>;  // once-per-run rarity abilities already used
}

interface LoadedSkill { skillId: string; charges: number; chargesMax: number; }

interface RunState {
  version: number;                 // save-format version
  seed: string;                    // e.g. '7F3A-2210'
  actIndex: number;                // 0..2
  stageIndex: number;              // 0..2
  coins: number;
  deckCapacity: 8;                 // fixed (docs/06 §2)
  deck: PieceInstance[];
  loadout: LoadedSkill[];
  history: StageRecord[];          // outcome, turns used, coins earned, pieces lost
  rngCursor: number;
  status: 'in_progress' | 'won' | 'lost';
}

interface BoardPiece {
  pieceType: PieceType;
  color: Color;
  instanceId?: string;             // present only for Hero Pieces; rarity is read from the deck
                                   // instance. Absent = Stage Piece.
  stageId?: string;                // Stage Pieces only ('s01', 's02', ... in square-index order); ids
                                   // that skills, modifiers and capture events use instead of squares
  spawned?: true;                  // a spawned pawn (player-side Stage Piece), docs/02 §2.1
  rarity?: Rarity;                 // spawned pawns only; enemy pieces are implicitly Normal (I13)
  promotesTo?: { pieceType: 'knight' | 'bishop' | 'rook' | 'queen'; rarity: Rarity };
                                   // spawned pawns only; rolled at generation, shown to the player
  transformed?: { pieceType: PieceType; modifierId: string };
}

interface StageState {
  stageSeed: string;
  templateId: string;
  phase: 'deployment' | 'action';  // deployment: only Stage Pieces on the board; action: deck locked
  board: Record<Square, BoardPiece | undefined>;
  turnsUsed: number;
  mateIn: number;                 // the par "Mate in X" (2–5); no turn limit: turns past it cost overtime (docs/02 §7)
  overtimePaid: number;           // overtime paid so far this stage, from the pending reward and the wallet together
  focus: number;
  focusPool: number;
  moveCredits: number;             // reset to freeMovesPerTurn each turn
  spawnPoints: number;             // summon budget: total spawnCost of the summons (King free); ranks are rules.deploymentRanks
  modifiers: ActiveModifier[];
  skillLog: { skillId: string; turn: number; targetId?: string }[];   // every accepted ACTIVATE_SKILL: once_per_turn and already_targeted read it
  enemyPolicy: EnemyPolicy;
  status: 'active' | 'won' | 'lost';   // 'won' always means checkmate (docs/02 §7)
  endReason?: 'checkmate' | 'enemy_stalemated' | 'out_of_coins' | 'player_mated' | 'player_stalemated';
  provenance?: { templateId?: string; seed?: string; attempts?: number; validationFailed?: boolean };  // set by `gen` (G8)
}
```

## 4. The reducer contract

A stage has two commits. The first, once per stage, ends the Deployment phase:

```ts
startStage(
  run: RunState,
  stage: StageState,               // phase: 'deployment'
  placements: { instanceId: string; to: Square }[],   // the King plus summons within spawnPoints
  config: EngineConfig,
): Result<{ run: RunState; stage: StageState; events: GameEvent[] }, CommitError>
```

It validates all placements at once (I2, I7, I8, I15) — every square empty and on ranks 1–4, the
summons' total spawn cost (per type and rarity, `pieces.<type>.spawnCost`) within `spawnPoints` —
spends 1 durability per non-King summon,
marks those instances `deployed`, and returns the stage in `phase: 'action'`. Placements are never
partially applied. Every later turn goes through the second:

```ts
commitQueue(
  run: RunState,
  stage: StageState,
  queue: Action[],
  config: EngineConfig,
): Result<
  { run: RunState; stage: StageState; events: GameEvent[]; award: Award | null },
  CommitError
>

type Award = { coins: number; base: number; parBonus: number };   // null unless the stage was won; base is net of overtime
```

Every engine function takes `config: EngineConfig` (from `loadEngineConfig()`) as its last argument;
no tuning number lives in engine code. M1 also exports:

```ts
simulate(run, stage, queue, config)        // same Result as commitQueue, without the enemy reply
enemyMove(stage, seed: number, clock: number, config): EnemyPick
type EnemyPick = {
  move: { from: Square; to: Square } | null,   // null when Black has no legal move
  policy: EnemyPolicy,                         // scripted cursor / fellBack advanced
}
enemyClock(run, stage, config): number        // the turns the enemy's search assumes the player has left
applyEnemyTurn(run, stage, pick: EnemyPick, config): Result<{ run; stage; events }, CommitError>
// enemyMove clamps the clock itself to the largest the search tables hold (MAX_CLOCK, internal to the engine, not exported)
legalPlayerMoves(stage, from, config): Square[]
hasLegalQueue(run, stage, config): boolean   // credits are read from stage.moveCredits (module legal-queue.ts)
endStage(run, stage, config): Result<{ run; events; overCapacity: number }, CommitError>
compileAbilities(rarityAbilities): AbilityTable   // pieces.yaml rarityAbilities → per-tier flags; the loader calls it
TIERS: readonly Rarity[]                          // rarities in tier order: a tier is an index into it
spawnCostOf(type, rarity, config): number
durabilityMaxOf(type, rarity, config): number | null
```

`enemyClock` is the clock for `enemyMove`: within the par it is `mateIn - turnsUsed` and never reads
the wallet, so a stage proven before the shop stays proven whatever the player buys; past the par it
is the overtime turns the pending base reward plus the wallet still pay for (at least 1, via
`stageEconomy`). `commitQueue` computes the seed as `hash(stageSeed, turnsUsed)` and the clock, then
calls `enemyMove` and `applyEnemyTurn`. `applyEnemyTurn` is the enemy's half of the turn (R5, modifier
expiry, the next turn, White's check, the no-legal-queue loss and the overtime charge) and takes the
pick as an argument so the solver can reuse memoized replies.

`hasLegalQueue` searches skills first, then moves (see [03 §3](03-skill-framework.md#3-effect-primitives)).
It tries each set of skills once, in loadout order, and never tries a skill whose primitives cannot
change Resolve or R2 (`QUEUE_NEUTRAL` in the primitive registry: today `suppress_piece`).
`compileAbilities` throws on a parameter the engine does not implement (`multi_capture.maxTargets`
≠ 2, `bonus_self_move.amount` ≠ 1, `lifeline.usesPerRun` ≠ 1) and on a leaper that would make a
square both a single move and a multi-capture's second square.
`endStage` runs on a `won` stage: it returns deployed pieces to the deck with their durability, removes
`spent` pieces, and returns a lifeline-saved queen with its lifeline's `returnDurability` (1 in
`pieces.yaml`).

`simulate` runs R1–R4 (the player's queue and stage-end evaluation); `commitQueue` is `simulate`
plus R5, the enemy's reply and the start of the next turn.

Guarantees:
- **Pure.** No I/O, no `Date.now()`, no `Math.random()`. Same inputs → deep-equal outputs.
- **Total.** Returns either a new state or a typed error, never throws for a player-legal-shaped input.
- **Event-emitting.** `GameEvent[]` is the *only* channel the UI animates from. The UI never diffs
  state to infer what happened.
- **Two-phase internally:** `simulate(queue)` runs Resolve–R4 and produces the resolved state and the
  validation verdict; `commitQueue(queue)` is `simulate` plus R5 (the enemy's reply). The **preview UI
  calls `simulate` and discards it** — preview and execution share the same code path, which is how invariant I10 (preview equals payout) is
  satisfied by construction rather than by discipline.

`CommitError` is a discriminated union whose members are the invariant IDs of
[02 §9](02-rules-framework.md#9-legality-invariants), each carrying a human-readable cause:

```ts
type CommitError =
  | { kind: 'king_in_check_at_end'; square: Square; checkers: Square[]; afterRevert: boolean }
  | { kind: 'focus_exceeded'; atStep: number; needed: number; available: number }
  | { kind: 'credits_exceeded'; atStep: number }
  | { kind: 'empty_queue' }                                   // no MOVE in the queue: there is no pass
  | { kind: 'illegal_move'; atStep: number; from: Square; to: Square; reason: MoveRejection }
  | { kind: 'skill_unavailable'; atStep: number; skillId: string;
      reason: 'not_in_loadout' | 'not_implemented' | 'no_charges' | 'once_per_turn' }
  | { kind: 'invalid_target'; atStep: number; skillId: string; target?: Square;
      reason: 'no_target' | 'wrong_target' | 'excluded' | 'already_targeted' }
  | { kind: 'stage_not_active' }
  | { kind: 'wrong_phase'; expected: 'deployment' | 'action' }
  // startStage only:
  | { kind: 'durability_unavailable'; instanceId: string }
  | { kind: 'invalid_deployment'; to: Square;
      reason: 'occupied' | 'outside_zone' | 'king_missing' | 'king_in_check' | 'not_in_deck' | 'duplicate' }
  | { kind: 'spawn_points_exceeded'; budget: number; cost: number }
  // endStage only:
  | { kind: 'stage_not_won'; status: StageState['status'] }
  // R2 safety net, and R5's capture of a Hero Piece that has no deck instance (I15); a bug if it ever fires:
  | { kind: 'invariant_violation'; invariant: 'I1' | 'I2' | 'I3' | 'I15'; detail: string };

type MoveRejection = 'no_piece' | 'not_your_piece' | 'unreachable' | 'own_piece' | 'king_square';
```

`king_in_check_at_end.afterRevert` is true when the King is attacked only on the board R1 reverted.
`unsupported_action` is gone: an `ACTIVATE_SKILL` is checked like any other step (spec section 8.1
order: loadout and `mvp` status, charges, `once_per_turn`, Focus, then the target). `focus_exceeded`
is produced for a skill whose cost exceeds the Focus left at its step.

### Events

`GameEvent[]` is the only animation channel. Besides the M1 events (`move`, `capture`,
`pawn_promoted`, `enemy_promoted`, `check`, `stage_won`, `stage_lost`, `enemy_move`,
`enemy_fell_back`, `turn_started`), M2 adds:

| Event | Emitted by |
|---|---|
| `stage_started` | `startStage` |
| `piece_summoned { instanceId, square }` | `startStage`, one per summon |
| `skill_activated { skillId, target? }` | each accepted `ACTIVATE_SKILL` |
| `piece_transformed { target, pieceType }` | `set_piece_type` (`target` is a piece id) |
| `piece_suppressed { target }` | `suppress_piece` |
| `transform_reverted { target }` | R1, when a transformed piece reverts |
| `modifier_expired { modifierId }` | R1 and the end of R5, for every modifier removed, including one dropped because its target was captured |
| `lifeline_saved { instanceId }` | a Unique+ queen captured for the first time |
| `piece_returned { instanceId, durability: number \| null }` | `endStage`, per piece back in the deck (`null` for the King) |
| `piece_removed { instanceId, reason: 'spent' }` | `endStage`, per spent piece |
| `overtime_paid { turn, fromReward, fromWallet }` | `applyEnemyTurn`, when a turn past the par is charged: `fromReward` comes out of the pending base reward, `fromWallet` out of the wallet (docs/02 §7). A turn neither can pay ends the stage with `out_of_coins` |

`capture` and `pawn_promoted` carry the ids of the pieces involved (`instanceId` / `stageId`).
`enemy_fell_back` is emitted **before** `enemy_move`.

A stage that ends at R3 or R4 keeps its live suppress modifier in `StageState.modifiers`; the stage
is finished and `endStage` ignores modifiers.

## 5. Determinism and RNG

Randomness is **never consumed by the engine's rules**, only by generation, enemy policy, and shop
stock. Those all take randomness from an explicit cursor over a seed string:

```ts
function rng(seed: string, cursor: number): { value: number; next: number }
function mix32(h: number): number                          // murmur3 finalizer: spreads a 32-bit hash's bits
function draw(seed: string, ...parts: (string | number)[]): number   // mix32(hash(seed, ...parts)) / 2^32, in [0, 1)
```

`hash` is FNV-1a, whose top bits are skewed on short inputs, so `draw` runs it through `mix32`. Every
random choice in generation reads its own named stream, `draw(stageSeed, <stream>, ...)`, so adding a
choice to one step never shifts another (the stream list is in
[04 §3](04-stage-generation-and-authoring.md#3-generation-pipeline)). `rng(seed, cursor)` stays for
cursor-based consumers (today the enemy search's transposition-table keys).

- No mutable PRNG object is stored in game state; the cursor is a plain number, so state stays
  serializable and replay is exact.
- Seed derivation:
  - `runSeed            = player seed or generated`
  - `stageSeed          = hash(runSeed, actIndex, stageIndex)`, formatted as upper-case hex `XXXX-XXXX`:
    the format `stage.schema.json` requires and the player-visible seed code uses
  - `enemySeed          = hash(stageSeed, turnsUsed)`, where `turnsUsed` is the value after R4's increment
  - `shopSeed           = hash(runSeed, actIndex, stageIndex, 'shop', visitIndex)` — covers piece
    type *and* rarity rolls, including rerolls
  - spawned-pawn rarity and `promotesTo` are drawn from `stageSeed` during generation (G4b), never
    at the moment of promotion — so the engine's rules still consume no randomness

Because every random decision is a pure function of `(seed, cursor)`, a run is fully reproducible
from a short string — which powers bug reports, QA replay, and (later) seed sharing.

## 5b. The generation API (`@checkbreaker/gen`)

```ts
generateStage(
  input: GenInput,                 // { run: RunState; actIndex; stageIndex; previousTemplateId? }
  content: GenContent,             // { templates: Template[]; formations: Record<templateId, Formation[]> }
  config: GenConfig,               // EngineConfig & { gen } (loadGenConfig)
): { stage: StageState; provenance: Provenance }

generateWith(input, content, config, solve: SolveFn)   // the same, with an injected solver (tests, gen:report)
type SolveFn = (run: RunState, stage: StageState, config: GenConfig) => SolveResult

solveStage(run, stage, config: GenConfig): SolveResult
// replayLine(run, stage, win, config): boolean is internal to the solver (reached through solveStage): it plays a found line through startStage and commitQueue

type Provenance = {
  templateId: string; seed: string;                    // seed = the stageSeed, XXXX-XXXX
  formationId: string | null; mirrored: boolean;
  attempts: number;                                    // G5 attempts used
  proven: boolean;                                     // false on a bonus-pawn or validationFailed stage
  bonusPawn: boolean;
  solverNodes: number;
  validationFailed?: true;                             // every template exhausted maxRegenerations
}
type SolveResult = {
  win: { placements: Placement[]; line: Action[][]; mateTurn: number } | null;
  stats: { screenNodes; deepNodes; deployments; enemyCalls; memoHits; replayFailures: number };
}
```

`generateStage` is G0-G8 of [04 §3](04-stage-generation-and-authoring.md#3-generation-pipeline). The
`StageState` it returns carries only `{templateId, seed, attempts, validationFailed?}` as
`provenance`; the full `Provenance` (formation, mirroring, proof, bonus pawn, nodes) goes beside it
for `gen:report`, and the player never sees it. Generation is a pure function of the run seed, the
act and stage index, and the deck, so the same input twice gives a byte-identical `StageState`.
`solveStage` merges the act's and the template's solver overrides over the global block with
`solverSettingsFor(actIndex, templateId, config)` (`@checkbreaker/content`); a found line is
replayed before it counts, and a replay mismatch is counted in `stats.replayFailures` and treated as
not found.

Rulings the generator and solver depend on:
- `stageSeed` is the G0 hash formatted as upper-case hex `XXXX-XXXX`, matching the stage schema
  pattern and the player-visible seed code.
- A Legendary knight's free second move counts as part of the same turn: a queue is a `MOVE` plus
  its bonus `MOVE`, and the solver tries both.
- Spawned-pawn moves are not tried in `no_first_turn_mate`: the precondition summons deck pieces only.
- The solver's King deployment squares alternate ranks 1 and 2, spread across files (e, d, f, c, g, b, h, a).
- A node is one enemy reply needed, from the memo or computed, so node counts are the same on every device.

## 6. Module responsibilities

| Module | Owns | Must not |
|---|---|---|
| `engine/board` | Square math, move generation per piece type and rarity ability (data-driven from `pieces.yaml`) | Know about durability or skills |
| `engine/legality` | Per-action legality and check detection (not the end-state invariants, which `engine/queue` checks) | Know about transitions/durations, or import `engine/queue` |
| `engine/queue` | `resolveQueue` (Resolve, R1, R2, I2), built from one step at a time (`beginQueue`, `resolveStep`) and a lean end judge (`queueAccepted`, no I2 detail), and `applyPlayerMove`: sequential cost accounting and per-step legality | Decide win conditions |
| `engine/legal-queue` (`legal-queue.ts`) | `hasLegalQueue`: candidate queues (skill targets, `legalPlayerMoves`) resolved by `engine/queue`'s own steps and judge, a shared prefix once | Judge a queue any other way than `engine/queue` does |
| `engine/deployment` (`deployment.ts`) | The Deployment phase: placement validation, `startStage`, durability spend at Start | Run after Start |
| stage end (`stage-end.ts`) | `endStage`: deck write-back after a won stage (return, remove spent, lifeline) | Run on a stage that is not won |
| `engine/rules` | `simulate` and `commitQueue` (R3–R5): stage end evaluation (checkmate, stalemate, turns, no legal queue) and the enemy reply | Render or animate |
| `engine/skills` (`skills/check.ts`, `skills/registry.ts`) | `check.ts`: the ordered `ACTIVATE_SKILL` checks; `registry.ts`: primitive interpretation, modifier stack (an `instant` effect is never stored), expiry, which primitives are queue-neutral | Add per-skill special cases |
| `engine/abilities` (`abilities.ts`) | Compiles `rarityAbilities` from `pieces.yaml` into per-tier move data; spawn cost and durability lookups; the lifeline (whether a capture is saved, the durability it returns with) | Be consulted by name in `engine/rules` |
| `engine/enemy` | `enemyMove(stage, seed, clock, config) → { move \| null, policy }` (move is null only when the enemy has no legal move): alpha-beta with iterative deepening, transposition table, capture quiescence, evaluation, seeded tie-break, scripted lines and fallback (docs/02 §8.1) | Read the clock, RNG or UI state from anywhere but its arguments |
| `content` | Loading + validating YAML, typed accessors | Mutate state |
| `gen` | Template selection, board and spawned-pawn generation, preconditions, the solver and `generateStage` | Be imported by the web app's main thread (only the generation Web Worker imports it); use `Math.random`, `Date.now` or `performance.now` (generation depends only on the seed and the deck) |
| `apps/web` | Rendering, input, animation, persistence | Contain rules logic |

**The single most important architectural rule:** *no rule may live in the UI.* If a designer wants a
behavior the engine does not express, the engine gains a primitive — the UI never compensates.

## 7. Extension points (reserved now, implemented later)

| Feature | Reserved where |
|---|---|
| Enemy skills / bosses | `StageState.enemyPolicy.loadout?: LoadedSkill[]` |
| Obstacles / terrain | `StageState.board` values gain a `terrain` variant |
| Playing as Black | `StageState.playerColor` (default `'white'`) |
| Branching run map | `RunState.history` already records a path; add `RunState.route` |
| Skills with new primitives | `engine/skills` primitive registry — add one entry, no other change |
| Meta-progression | `RunState` gains no fields; a separate `ProfileState` is added beside it |
| New rarity abilities (decision O follow-ups) | New `rarityAbilities` entries in `pieces.yaml`; a genuinely new behaviour adds one piece-ability primitive, nothing else |
| Neutral Stage Pieces (decision P) | `BoardPiece.color` gains a third value; still no `instanceId` |

## 8. Persistence

- Key: `checkbreaker.save.<version>`; value: `{ run: RunState, stage: StageState, savedAt }`.
- `RunState.version` gates migration; unknown future versions are refused with a clear message rather
  than silently corrupting a run.
- Autosave points: after every committed turn, after shop exit, after stage generation.
- **No server.** A lost save is a lost run; the UI says so once and never nags.

## 9. Testing strategy

| Layer | Approach |
|---|---|
| Move generation | Table-driven per piece type against hand-verified positions |
| Queue resolution | Golden tests: queue in → resolved state + events out |
| Invariants | Property tests asserting I1–I15 over generated random deployments and queues (fuzz): 10,000 cases mixing moves with `ACTIVATE_SKILL` of random loadouts, valid and invalid targets; none throws, none breaks I1–I6, paid moves never exceed credits (plus Twin Step grants and Legendary-knight bonus moves) and Focus spent never exceeds the pool. White's Hero Pieces carry random rarities and the deck matches the board (same ids), so multi-captures, bonus moves, R5 Hero captures and lifeline saves occur, each with a coverage count; a board/deck desync refuses with `invariant_violation` I15. `parity.test.ts` checks `commitQueue` = `simulate` + R5 including the deck changes of R5 captures |
| Rarity gating | Property test over seeded shop rolls, spawned pawns and promotion results: I14 holds for every act; recovery offers are Normal |
| Rarity movement | Table-driven per tier: Rare bishop never captures on a leap, Unique does; Rare/Unique knight leap sets; Legendary knight bonus used at most once per turn, only by itself, never onto the king's square; Rare rook/queen never capture on a leap; Unique rook diagonal step; Legendary rook captures once after a leap and multi-captures only without one; Legendary queen multi-captures with or without a leap |
| Multi-capture | Second target only when directly adjacent beyond the first; never across a gap; enemy king as second target → stop on the first, king in check; one credit; both pieces pay salvage |
| Merge | 3 same type + tier with durability ≥ 1 → 1 new instance one tier up at full durability; refused above the act ceiling, for Legendary inputs, kings and pawns; never changes an existing instance (I12) |
| Deck lifecycle | `deck-lifecycle.test.ts`, `stage-end.test.ts`: a captured instance leaves `run.deck` at once; `endStage` returns deployed pieces with their durability, removes `spent` ones only then; promotion adds exactly `promotesTo` at full durability; I15 over 500 chained random queues |
| Skills | `skills.test.ts`, `modifiers.test.ts`: every `ACTIVATE_SKILL` check in spec 8.1 order (earlier wins), effects of Twin Step, Ascension and Lockdown, R1 revert, R3 suppression, R5 root mask, a temporary queen never mates |
| `hasLegalQueue` | `legal-queue.test.ts`: skill-enabled escapes count, no charges or short Focus do not; agrees with an exhaustive search over every interleaving on 300 small boards. `npm run bench` bounds the worst case found so far (a mated board with all three launch skills) at 400 ms |
| Rarity abilities | `abilities*.test.ts`, `enemy-abilities.test.ts`: per-tier tables from `pieces.yaml`, ability-aware attack squares, the Legendary knight bonus move in the queue, abilities suspended while Ascension holds, the enemy search models abilities |
| Reference differential | `reference.test.ts`: the optimised move generator is checked against a slow, independent reference implementation on the same positions |
| Lifeline | First capture of a Unique+ queen returns it at stage end with its `returnDurability` (1) and `usedOnce: [lifeline]`, also when it was spent (a Legendary queen); second capture destroys it |
| Retention | Over seeded rolls, Legendary queens appear at ~20% of the Legendary rate of other types, in shop and promotion alike |
| Promotion | Pawn on rank 8 → pawn removed, `promotesTo` instance in the deck, **not** summonable until the next stage (deck locked); over-capacity cut fires at stage end |
| Deployment phase | `deployment.test.ts`: `startStage` refuses: no King, King in check, occupied squares or squares outside ranks 1–4, summons whose total spawn cost (Legendary bishop 5) exceeds `spawnPoints`, a piece at 0 durability; on success spends exactly 1 durability per summon and nothing for the King or for pieces left in the deck; no `commitQueue` before it and no summon after it |
| Stalemate | Enemy with no legal move and not in check at R3 → stage lost (`enemy_stalemated`), the enemy never moves; player with no legal queue after R5 → `player_mated` or `player_stalemated`; an empty or skill-only queue → `empty_queue` |
| Reducer purity | Deep-freeze state in tests; any mutation throws |
| Preview/execution parity | Property test: `simulate`'s events are a prefix of `commitQueue`'s, awards equal, run and `turnsUsed` equal, for random legal-ish queues, skills included |
| Economy | Property tests: coins ≥ 0, deck ≤ capacity, no piece at 0 durability survives a stage |
| Generation | 10k-stage solvability and precondition suite ([04 §9](04-stage-generation-and-authoring.md#9-test-plan-for-generation-m3-acceptance)) |
| Content | `npm run validate` — schema conformance of every content file |
| Replay | Golden run files: fixed seed + recorded queues must reproduce identical outcomes |
| Enemy speed | `npm run bench`: depth-4 median < 50 ms on sparse, stage-like positions (Node in M1; re-measured in the browser in M5). `GAME_FENS` must stay within 1.1x the same-machine M1 baseline + 50 ms (Ruling R14); rarity boards are report-only. Kept out of `npm test` so timing never flakes a normal run |
| Enemy AI | Golden positions: same position + seed → same move; mate-in-1 for the enemy is always taken; an unavoidable enemy mate is delayed as long as possible; quiescence never hangs a piece just past the horizon; scripted line → fallback when its move turns illegal or the line ends; transposition table on/off gives identical moves |

## 10. Performance notes

- Board is 64 squares; move generation and queue simulation are trivially fast (microseconds).
- The only performance-sensitive component is the **generation-time solver**. It runs at runtime in
  the generation Web Worker, off the main thread ([04 §5](04-stage-generation-and-authoring.md#5-the-solver)).
- Target bundle: engine + app under 250 KB gzipped, the worker (with the solver) counted separately.
  No chess library and no schema validator in the shipped bundle.

## 11. Repository scripts

| Script | Does | Status |
|---|---|---|
| `npm run validate` | Schema-validate everything in `content/` | **M0** |
| `npm test` | Vitest across workspaces (excludes the benchmark) | **M1** |
| `npm run bench` | Enemy depth-4 timing benchmark, run on its own | **M1** |
| `npm run typecheck` | `tsc` over packages and scripts | **M1** |
| `npm run play` | Terminal playground: place the King and two minors (Deployment phase, `startStage`), then play one Act I stage against the enemy | **M1**, M2 |
| `npm run dev` | Vite dev server for `apps/web` | M5 |
| `npm run build` | Production build | M5 |
| `npm run gen:report -- [--stages N] [--template id] [--workers W] [--json out.json]` | Template health report: proven rate, mating turn vs par, bonus pawns, `validationFailed`, replay failures, solver nodes and wall time per template, on a fixed deck per act. Numbers are identical whatever `--workers` is; only the wall times differ, so measure them with `--workers 1` (the game generates in one Web Worker) | M3 |
| `npm run formations:extract` | Rebuild `content/formations/<templateId>.json` from the cached Lichess puzzle file in `.cache/lichess/` (git-ignored, CC0). Offline: it never downloads | M3 |
| `npm run check:links` | Fail on a broken relative link or heading anchor in the Markdown | M3 |
