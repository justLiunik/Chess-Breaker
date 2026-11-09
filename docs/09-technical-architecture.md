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
  multi-action turns, no turn limit. Its verdict is a hint; the M3 solver, which uses the game's own
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
packages/
  engine/                   Pure TS: board, moves, queue resolution, evaluation
  content/                  Loads + validates data, exports typed definitions
                            (M1: `loadEngineConfig()` for data/economy.yaml only)
  gen/                      Stage generation + solver (M3)
apps/
  web/                      React UI
scripts/
  validate-content.mjs      ajv validation of content/ against schemas/
  play.ts                   Terminal playground over the engine (`npm run play`, M1)
docs/                       Design documents 00–11
```

Boundary rules:
- `engine` imports nothing but its own source.
- `content` may import `engine` types, never the reverse.
- `gen` imports `engine` + `content`; the **web app must never import `gen`** — the solver must not
  ship to the client at MVP (it is a generation-time and CI tool). If genres later need runtime
  generation, that is a deliberate bundle-size decision.

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
  turnLimit: number;
  focus: number;
  focusPool: number;
  moveCredits: number;             // reset to freeMovesPerTurn each turn
  spawnPoints: number;             // summon budget: total spawnCost of the summons (King free); ranks are rules.deploymentRanks
  modifiers: ActiveModifier[];
  enemyPolicy: EnemyPolicy;
  status: 'active' | 'won' | 'lost';   // 'won' always means checkmate (docs/02 §7)
  endReason?: 'checkmate' | 'enemy_stalemated' | 'out_of_turns' | 'player_mated' | 'player_stalemated';
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

type Award = { coins: number; base: number; turnBonus: number };   // null unless the stage was won
```

Every engine function takes `config: EngineConfig` (from `loadEngineConfig()`) as its last argument;
no tuning number lives in engine code. M1 also exports:

```ts
simulate(run, stage, queue, config)        // same Result as commitQueue, without the enemy reply
enemyMove(stage, seed: number, config): {
  move: { from: Square; to: Square } | null,   // null when Black has no legal move
  policy: EnemyPolicy,                         // scripted cursor / fellBack advanced
}
legalPlayerMoves(stage, from): Square[]
hasLegalQueue(stage, config): boolean
```

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

M1 produces `king_in_check_at_end`, `credits_exceeded`, `empty_queue`, `illegal_move`,
`stage_not_active`, `wrong_phase`, `unsupported_action` and `invariant_violation`.

```ts
type CommitError =
  | { kind: 'king_in_check_at_end'; square: Square; checkers: Square[] }
  | { kind: 'focus_exceeded'; atStep: number; needed: number; available: number }   // not produced in M1 (no skills yet)
  | { kind: 'credits_exceeded'; atStep: number }
  | { kind: 'empty_queue' }                                   // no MOVE in the queue: there is no pass
  | { kind: 'illegal_move'; atStep: number; from: Square; to: Square; reason: MoveRejection }
  | { kind: 'stage_not_active' }
  | { kind: 'wrong_phase'; expected: 'deployment' | 'action' }
  // startStage only:
  | { kind: 'durability_unavailable'; instanceId: string }
  | { kind: 'invalid_deployment'; to: Square; reason: string }    // occupied, outside ranks 1–4, or King missing
  | { kind: 'spawn_points_exceeded'; budget: number; cost: number }
  // M1 only (removed in M2, when skills exist):
  | { kind: 'unsupported_action'; atStep: number; actionType: 'ACTIVATE_SKILL' }
  // R2 safety net; a bug if it ever fires:
  | { kind: 'invariant_violation'; invariant: 'I1' | 'I2' | 'I3'; detail: string };

type MoveRejection = 'no_piece' | 'not_your_piece' | 'unreachable' | 'own_piece' | 'king_square';
```

M1 produces only the first group plus `unsupported_action` and `invariant_violation`; the
`startStage`-only kinds arrive in M2.

## 5. Determinism and RNG

Randomness is **never consumed by the engine's rules**, only by generation, enemy policy, and shop
stock. Those all take randomness from an explicit cursor over a seed string:

```ts
function rng(seed: string, cursor: number): { value: number; next: number }
```

- No mutable PRNG object is stored in game state; the cursor is a plain number, so state stays
  serializable and replay is exact.
- Seed derivation:
  - `runSeed            = player seed or generated`
  - `stageSeed          = hash(runSeed, actIndex, stageIndex)`
  - `enemySeed          = hash(stageSeed, turnsUsed)`, where `turnsUsed` is the value after R4's increment
  - `shopSeed           = hash(runSeed, actIndex, stageIndex, 'shop', visitIndex)` — covers piece
    type *and* rarity rolls, including rerolls
  - spawned-pawn rarity and `promotesTo` are drawn from `stageSeed` during generation (G4b), never
    at the moment of promotion — so the engine's rules still consume no randomness

Because every random decision is a pure function of `(seed, cursor)`, a run is fully reproducible
from a short string — which powers bug reports, QA replay, and (later) seed sharing.

## 6. Module responsibilities

| Module | Owns | Must not |
|---|---|---|
| `engine/board` | Square math, move generation per piece type and rarity ability (data-driven from `pieces.yaml`) | Know about durability or skills |
| `engine/legality` | Per-action legality, check detection and `hasLegalQueue` (not the end-state invariants, which `engine/queue` checks) | Know about transitions/durations |
| `engine/queue` | `resolveQueue` (Resolve, R1, R2, I2) and `applyPlayerMove`: sequential cost accounting and per-step legality | Decide win conditions |
| `engine/deployment` | The Deployment phase: placement validation, `startStage`, durability spend at Start | Run after Start |
| `engine/rules` | `simulate` and `commitQueue` (R3–R5): stage end evaluation (checkmate, stalemate, turns, no legal queue) and the enemy reply | Render or animate |
| `engine/skills` | Primitive interpretation, modifier stack, expiry | Add per-skill special cases |
| `engine/enemy` | `enemyMove(stage, seed, config) → { move | null, policy }` (move is null only when the enemy has no legal move): alpha-beta with iterative deepening, transposition table, capture quiescence, evaluation, seeded tie-break, scripted lines and fallback (docs/02 §8.1) | Read the clock, RNG or UI state from anywhere but its arguments |
| `content` | Loading + validating YAML, typed accessors | Mutate state |
| `gen` | Templates, generation pipeline, solver | Be imported by the web app |
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
| Invariants | Property tests asserting I1–I15 over generated random deployments and queues (fuzz) |
| Rarity gating | Property test over seeded shop rolls, spawned pawns and promotion results: I14 holds for every act; recovery offers are Normal |
| Rarity movement | Table-driven per tier: Rare bishop never captures on a leap, Unique does; Rare/Unique knight leap sets; Legendary knight bonus used at most once per turn, only by itself, never onto the king's square; Rare rook/queen never capture on a leap; Unique rook diagonal step; Legendary rook captures once after a leap and multi-captures only without one; Legendary queen multi-captures with or without a leap |
| Multi-capture | Second target only when directly adjacent beyond the first; never across a gap; enemy king as second target → stop on the first, king in check; one credit; both pieces pay salvage |
| Merge | 3 same type + tier with durability ≥ 1 → 1 new instance one tier up at full durability; refused above the act ceiling, for Legendary inputs, kings and pawns; never changes an existing instance (I12) |
| Lifeline | First capture of a Unique+ queen returns it at stage end with 1 durability and `usedOnce: [lifeline]`; second capture destroys it |
| Retention | Over seeded rolls, Legendary queens appear at ~20% of the Legendary rate of other types, in shop and promotion alike |
| Promotion | Pawn on rank 8 → pawn removed, `promotesTo` instance in the deck, **not** summonable until the next stage (deck locked); over-capacity cut fires at stage end |
| Deployment phase | `startStage` refuses: no King, King in check, occupied squares or squares outside ranks 1–4, summons whose total spawn cost (Legendary bishop 5) exceeds `spawnPoints`, a piece at 0 durability; on success spends exactly 1 durability per summon and nothing for the King or for pieces left in the deck; no `commitQueue` before it and no summon after it |
| Stalemate | Enemy with no legal move and not in check at R3 → stage lost (`enemy_stalemated`), the enemy never moves; player with no legal queue after R5 → `player_mated` or `player_stalemated`; an empty or skill-only queue → `empty_queue` |
| Reducer purity | Deep-freeze state in tests; any mutation throws |
| Preview/execution parity | Property test: `simulate`'s events are a prefix of `commitQueue`'s, awards equal, run and `turnsUsed` equal, for random legal-ish queues |
| Economy | Property tests: coins ≥ 0, deck ≤ capacity, no piece at 0 durability survives a stage |
| Generation | 10k-stage solvability and precondition suite ([04 §9](04-stage-generation-and-authoring.md#9-test-plan-for-generation-m3-acceptance)) |
| Content | `npm run validate` — schema conformance of every content file |
| Replay | Golden run files: fixed seed + recorded queues must reproduce identical outcomes |
| Enemy speed | `npm run bench`: depth-4 median < 50 ms on sparse, stage-like positions (Node in M1; re-measured in the browser in M5). Kept out of `npm test` so timing never flakes a normal run |
| Enemy AI | Golden positions: same position + seed → same move; mate-in-1 for the enemy is always taken; an unavoidable enemy mate is delayed as long as possible; quiescence never hangs a piece just past the horizon; scripted line → fallback when its move turns illegal or the line ends; transposition table on/off gives identical moves |

## 10. Performance notes

- Board is 64 squares; move generation and queue simulation are trivially fast (microseconds).
- The only performance-sensitive component is the **generation-time solver**, which is a CI and
  authoring tool, not client code ([04 §5](04-stage-generation-and-authoring.md#5-the-solver)).
- Target bundle: engine + app under 250 KB gzipped. No chess library, no solver, no schema validator
  in the shipped bundle.

## 11. Repository scripts

| Script | Does | Status |
|---|---|---|
| `npm run validate` | Schema-validate everything in `content/` | **M0** |
| `npm test` | Vitest across workspaces (excludes the benchmark) | **M1** |
| `npm run bench` | Enemy depth-4 timing benchmark, run on its own | **M1** |
| `npm run typecheck` | `tsc` over packages and scripts | **M1** |
| `npm run play` | Terminal playground: one Act I stage against the enemy | **M1** |
| `npm run dev` | Vite dev server for `apps/web` | M5 |
| `npm run build` | Production build | M5 |
| `npm run gen:report` | Template health report from the solver | M3 |
