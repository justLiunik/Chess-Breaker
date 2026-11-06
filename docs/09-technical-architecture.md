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

## 2. Repository layout

```
package.json                npm workspaces root (the `workspaces` field is added in M1,
                            when packages/ and apps/ first exist)
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
  gen/                      Stage generation + solver (M3)
apps/
  web/                      React UI
scripts/
  validate-content.mjs      ajv validation of content/ against schemas/
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
type Rarity = 'normal' | 'rare' | 'epic' | 'unique' | 'legendary';   // ascending; docs/06 §4

interface PieceInstance {                // a Hero Piece
  instanceId: string;
  pieceType: PieceType;
  rarity: Rarity | null;         // fixed at creation; null = king only (I12)
  durability: number | null;     // remaining deployments; null = immortal (king)
  durabilityMax: number | null;  // null = immortal (king)
  origin: 'starter' | 'shop' | 'reward';
  acquiredAtStage: number;
  status: 'in_deck' | 'deployed' | 'captured' | 'spent';
}

interface LoadedSkill { skillId: string; charges: number; chargesMax: number; }

interface RunState {
  version: number;                 // save-format version
  seed: string;                    // e.g. '7F3A-2210'
  actIndex: number;                // 0..2
  stageIndex: number;              // 0..2
  coins: number;
  deckCapacity: number;
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
                                   // instance. Absent = Stage Piece, implicitly Normal (I13).
  transformed?: { pieceType: PieceType; modifierId: string };
}

interface StageState {
  stageSeed: string;
  templateId: string;
  board: Record<Square, BoardPiece | undefined>;
  turnsUsed: number;
  turnLimit: number;
  focus: number;
  focusPool: number;
  moveCredits: number;             // reset to freeMovesPerTurn each turn
  deploymentsThisTurn: number;
  deploymentsPerTurn: number;
  deploymentRanks: number[];
  materialThreshold: number;
  swing: { captured: number; lost: number };   // domination metric, see docs/02 §7
  modifiers: ActiveModifier[];
  enemyPolicy: EnemyPolicy;
  status: 'active' | 'won' | 'lost';
  winReason?: 'checkmate' | 'domination';
}
```

## 4. The reducer contract

```ts
commitQueue(
  run: RunState,
  stage: StageState,
  queue: Action[],
): Result<
  { run: RunState; stage: StageState; events: GameEvent[]; award: { coins: number; reason: string } },
  CommitError
>
```

Guarantees:
- **Pure.** No I/O, no `Date.now()`, no `Math.random()`. Same inputs → deep-equal outputs.
- **Total.** Returns either a new state or a typed error, never throws for a player-legal-shaped input.
- **Event-emitting.** `GameEvent[]` is the *only* channel the UI animates from. The UI never diffs
  state to infer what happened.
- **Two-phase internally:** `simulate(queue)` produces the resolved state and the validation verdict;
  `apply(queue)` commits it. The **preview UI calls `simulate` and discards it** — preview and
  execution are literally the same function, which is how invariant I10 (preview equals payout) is
  satisfied by construction rather than by discipline.

`CommitError` is a discriminated union whose members are the invariant IDs of
[02 §9](02-rules-framework.md#9-legality-invariants), each carrying a human-readable cause:

```ts
type CommitError =
  | { kind: 'king_in_check_at_end'; square: Square; checkers: Square[] }
  | { kind: 'focus_exceeded'; atStep: number; needed: number; available: number }
  | { kind: 'credits_exceeded'; atStep: number }
  | { kind: 'durability_unavailable'; instanceId: string }
  | { kind: 'illegal_move'; atStep: number; from: Square; to: Square; reason: string }
  | { kind: 'invalid_deployment'; atStep: number; to: Square; reason: string };
```

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
  - `enemySeed          = hash(stageSeed, turnsUsed)`
  - `shopSeed           = hash(runSeed, actIndex, stageIndex, 'shop', visitIndex)` — covers piece
    type *and* rarity rolls, including rerolls

Because every random decision is a pure function of `(seed, cursor)`, a run is fully reproducible
from a short string — which powers bug reports, QA replay, and (later) seed sharing.

## 6. Module responsibilities

| Module | Owns | Must not |
|---|---|---|
| `engine/board` | Square math, move generation per piece type | Know about durability or skills |
| `engine/legality` | Per-action legality, end-state invariants | Know about transitions/durations |
| `engine/queue` | Sequential cost accounting, simulate/apply | Decide win conditions |
| `engine/rules` | End-of-turn order R1–R5, stage end evaluation | Render or animate |
| `engine/skills` | Primitive interpretation, modifier stack, expiry | Add per-skill special cases |
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
| Rarity effects (decision O) | `PieceInstance.rarity` already exists; effects enter as `data/economy.yaml → rarity` constants and, for traits, entries in the `engine/skills` primitive registry |
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
| Invariants | Property tests asserting I1–I13 over generated random queues (fuzz) |
| Shop rarity | Property test over seeded shop rolls: I14 holds for every act, guaranteed slots are Normal |
| Reducer purity | Deep-freeze state in tests; any mutation throws |
| Preview/execution parity | Property test: `simulate(q).state === apply(q).state` for random legal-ish queues |
| Economy | Property tests: coins ≥ 0, deck ≤ capacity, no piece at 0 durability survives a stage |
| Generation | 10k-stage solvability and precondition suite ([04 §9](04-stage-generation-and-authoring.md#9-test-plan-for-generation-m3-acceptance)) |
| Content | `npm run validate` — schema conformance of every content file |
| Replay | Golden run files: fixed seed + recorded queues must reproduce identical outcomes |

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
| `npm test` | Vitest across workspaces | M1 |
| `npm run dev` | Vite dev server for `apps/web` | M5 |
| `npm run build` | Production build | M5 |
| `npm run gen:report` | Template health report from the solver | M3 |
