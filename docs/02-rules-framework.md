# 02 — Rules Framework (Authoritative)

This document is the authority. If any other document disagrees with it, this one wins. Tuning
*numbers* live in [`data/economy.yaml`](../data/economy.yaml); the *rules* below do not.

---

## 1. Definitions

| Term | Definition |
|---|---|
| **Run** | One attempt: 3 acts × 3 stages. Ends on any stage loss. State lives in `RunState`. |
| **Stage** | One chess encounter with a turn limit and terminal conditions. State lives in `StageState`. |
| **Turn** | One player commit + resolution + one enemy reply. |
| **Action** | A single entry in the player's action queue: `MOVE` or `ACTIVATE_SKILL`. |
| **Action Queue** | The ordered list of actions committed for a turn. |
| **Move credit** | Currency that pays for `MOVE`. Starts at 1 per turn (the **Free Move**). |
| **Focus** | Currency that pays for `ACTIVATE_SKILL` only. Refills to the pool value each turn. |
| **Durability** | A piece instance's remaining deployments: how many more stages it can be summoned into (see [06](06-deck-durability-and-permadeath.md)). |
| **Hero Piece** | A piece the player owns: an instance in `RunState.deck`. On a board it carries an `instanceId`. May hold any rarity. |
| **Stage Piece** | A piece placed by the stage itself, not drawn from the deck: the enemy army and the player's spawned pawns (and any future neutral pieces). No `instanceId`, never joins the deck. Enemy Stage Pieces are always Normal rarity. |
| **Spawned pawn** | A free, stage-only pawn the stage places for the player, with a rolled rarity and a visible promotion result (§2.2). The only way the player gets pawns. |
| **Promotion** | A spawned pawn reaching rank 8 leaves the board and becomes a new Hero Piece in the deck (§2.2). |
| **Rarity** | A piece's tier: Normal, Rare, Unique, Legendary (ascending). Every piece except the King has one. Bishops, knights, rooks and queens gain abilities by tier (§2.3); see also [06 §4](06-deck-durability-and-permadeath.md#4-piece-categories-and-rarity). |
| **Deployment phase** | The step between entering a stage and the first move, in which the player places the King and summons pieces from the deck (§5). |
| **Summon** | Placing a deck piece on the board in the Deployment phase. Costs its spawn cost from the stage's spawn points, and 1 durability, both paid at Start. The only way a Hero Piece reaches the board. |
| **Spawn points** | A stage's summon budget (Act I 9 · Act II 12 · Act III 15; bosses +3). The summons' total spawn cost — knight 3, bishop 3 (Legendary 5), rook 5, queen 9 — must fit it; the King is free (§5). |
| **Deployment square** | An empty square on ranks 1–4, the player's half of the board, where the King or a summon may be placed. Ranks 5–8 are enemy territory. |
| **Stalemate** | A side that is not in check and has no legal move (the player: no legal queue). Either side's stalemate is a **loss** for the player (§7). |
| **End state** | The board position after the queue resolves *and* after end-of-turn expiry (step R1). |

**The player always plays White and always moves first.** Playing Black is deferred
([11](11-open-decisions.md)).

## 2. Board and pieces

- Standard 8×8 board, algebraic coordinates `a1`–`h8`, White at ranks 1–2.
- Standard chess piece movement, blocking, and capture, with these exceptions:
  - **The king can never be captured.** Checkmate is the only way to defeat a king.
  - Castling and en passant are **disabled** (they are position-dependent complexity that adds
    nothing to sparse puzzle boards and complicate transform/durability interactions).
  - **Player pawn promotion** follows §2.2, not the chess rule. **Enemy pawns** promote by the
    normal chess rule, to a Normal queen only.
  - Pieces with a rarity above Normal gain the movement abilities in §2.3.
- Castling rights are absent; generated stages have no castling flags.
- Every piece on the board is either a **Hero Piece** (the player's, from the deck) or a **Stage
  Piece** (placed by the stage: the enemy army and the player's spawned pawns). Every piece except
  the King has a **rarity**; enemy pieces are always Normal. Material values (P1 N3 B3 R5 Q9) are
  the same at every tier; they set salvage and the enemy army's value band.

### 2.1 Pawns come from the stage, never the deck

Pawns cannot be bought and never enter the deck. Each stage **spawns** pawns for the player instead:

- The template sets how many (`spawnedPawns.count`) and on which ranks (`spawnedPawns.ranks`). The
  ranks are chosen so that rank 8 is reachable within the turn limit.
- Each spawned pawn gets a rarity rolled from the act's rarity pool
  ([07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)): Act I pawns are Normal or Rare.
- Spawned pawns cost nothing: no deck slot, no durability, no summon. They are placed by the stage
  at generation, so they are already on the board when the Deployment phase begins.
- They move and capture as standard chess pawns at every tier (one square forward, capture
  diagonally; the two-square first step applies only from rank 2). Their rarity changes only what
  they promote into.
- A captured spawned pawn is gone for the stage only; there is nothing permanent to lose. At stage
  end every surviving
  spawned pawn is discarded.

### 2.2 Promotion

When a spawned pawn reaches rank 8, it **promotes**:

1. The pawn leaves the board immediately; its square becomes empty. Nothing appears in its place.
2. A new **Hero Piece** instance is created: the pawn's `promotesTo` result, at full durability for
   its type and tier, with `origin: promotion`.
3. The new piece joins the deck **at once**, but the deck is locked for the stage (§5): it can first
   be summoned in the **next** stage.

**The result is rolled at stage generation, not at promotion**, and is shown on the pawn from turn 1
("→ Rare Knight"). Promotion is random, but never a hidden dice roll: the player plans with the
result in view, the solver knows it, and preview equals outcome (I10).

| Roll | Rule |
|---|---|
| Piece type | Knight 35 · Bishop 35 · Rook 20 · Queen 10 (`promotion.resultTypeWeights`) |
| Tier | One tier above the pawn with 75% chance, otherwise the pawn's own tier (`promotion.tierUpChance`) |
| Ceiling | Never above the act's rarity ceiling: in Act I a Rare pawn always promotes to Rare. A Legendary pawn promotes to Legendary |
| Legendary queen | A result that would be a Legendary queen keeps that tier only 20% of the time, else it is a Unique queen ([07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)) |

**Over capacity.** The deck holds at most 8 pieces. If the new piece pushes it above 8, the stage
continues normally; at stage end, before the shop, the player must merge
([06 §4.5](06-deck-durability-and-permadeath.md#45-merging)), sell (half the piece's current price,
[07 §4](07-shop-phase.md#4-purchases)) or cut pieces until the deck fits (I9).

Promotion is a tempo trade, exactly as pillar 2 requires: every move spent pushing a pawn is a move
not spent mating, and the coin preview drops one rate step per turn. The reward is a permanent piece
for a stage's worth of turns.

### 2.3 Rarity movement abilities

Bishops, knights, rooks and queens gain abilities by rarity. Abilities are **cumulative**: each tier
keeps everything below it. Data lives in `content/examples/pieces.yaml → rarityAbilities`.

**Bishop**

| Tier | Ability |
|---|---|
| Normal | Standard bishop. |
| Rare | **Leaps allies.** Its diagonal path may pass over the player's own pieces. Enemy pieces still block. A move that passed over at least one ally must end on an **empty** square: it cannot capture. A move that passed over no ally captures normally. |
| Unique | **Captures after a leap.** As Rare, but a move that passed over allies may end by capturing an enemy piece. |
| Legendary | **Moves like a queen.** As Unique, along orthogonal lines as well as diagonals — still leaping allies and capturing after a leap. Its spawn cost is **5**, not 3 — a rook's (§5). |

**Knight**

| Tier | Ability |
|---|---|
| Normal | Standard knight (the L leap). |
| Rare | **Straight leap.** May also leap exactly two squares orthogonally (from f3: f5, f1, d3, h3). |
| Unique | **Diagonal leap.** May also leap exactly two squares diagonally (from f3: d5, h5, d1, h1). |
| Legendary | **Moves twice.** After this knight makes a `MOVE`, it may make one more `MOVE` this turn at **no credit cost** (§4). |

**Rook**

| Tier | Ability |
|---|---|
| Normal | Standard rook. |
| Rare | **Leaps allies.** As the Rare bishop, along orthogonal lines: a move that passed over an ally cannot capture. |
| Unique | **Diagonal step.** May also step exactly one square diagonally, capturing normally. |
| Legendary | **Battering ram.** A move that passed over allies may now capture **one** enemy piece. A move that passed over **no** ally may **multi-capture** (below). Durability stays 2. |

**Queen**

| Tier | Ability |
|---|---|
| Normal | Standard queen. |
| Rare | **Leaps allies.** As the Rare bishop, in all eight directions: a move that passed over an ally cannot capture. |
| Unique | **Lifeline.** Once per run, when this queen is captured, it is not destroyed: it returns to the deck at stage end with 1 durability (below). |
| Legendary | **Full sweep.** A move that passed over allies may capture, and **any** move — with or without a leap — may **multi-capture**. Its durability is **1**, the one exception to flat durability ([06 §1](06-deck-durability-and-permadeath.md#1-the-piece-table)). The Legendary queen is the rarest piece in the game ([07 §2.1](07-shop-phase.md#21-rarity-pool-and-progression-gating)). |

#### Multi-capture (Legendary rook and queen)

1. The piece moves along one straight line and captures the first enemy piece it reaches, on square
   **X**, exactly like a normal capture.
2. If the square **directly beyond X** in the same direction, **Y**, holds another enemy piece, the
   player may continue: that piece is captured too and the mover ends on **Y**. Stopping on X is
   always allowed — the second capture is a choice, not forced.
3. The two enemies must be **connected**. If Y is empty, holds an allied piece, or is off the board,
   only the single capture on X happens. There is no capture across a gap.
4. **King exception.** If Y holds the **enemy king**, it is not captured (I3). The move ends on X,
   and the king is in check from the mover in the ordinary way.
5. A multi-capture is **one `MOVE`**: one move credit, one entry in the queue. Both captured pieces
   each pay their salvage.
6. **When it is allowed.** A Legendary queen may multi-capture on any move, including one that passed
   over allies. A Legendary rook may multi-capture only on a move that passed over **no** ally; after a
   leap it captures one piece at most.
7. At most two pieces are ever captured by one move. Multi-capture never chains a third.

#### Lifeline (Unique and Legendary queen)

- Triggers the first time in the run that this queen instance is captured.
- The queen leaves the board as usual.
- Instead of being destroyed, the instance returns to the deck **at stage end** with **1 durability**,
  and cannot return to the board during the stage in which it was captured (the deck is locked anyway).
- The instance records `usedOnce: [lifeline]`; the next capture destroys it normally.

Rules that apply to every ability:

- **Leaps are leaps.** Knight leaps of every kind ignore what lies between, like the standard L. They
  capture normally and land on any square not occupied by an allied piece.
- **Attacks follow moves.** A piece gives check and controls squares along exactly the moves it could
  make. A Rare bishop, rook or queen does **not** attack through an ally (its leaping moves cannot
  capture); a Unique or Legendary bishop and a Legendary rook or queen do. Multi-capture never adds
  attacked squares beyond Y.
- **The king is never captured — by any ability.** No rarity ability can capture or land on a king's
  square (I3). In particular, a **Legendary knight that gives check with its first move can never use
  its bonus move to capture the king**: the king's square is simply not a legal destination. After
  giving check, the knight may still spend its bonus move elsewhere, and the turn is judged on its
  end state as always.
- **Transforms suspend rarity.** A transformed piece (e.g. Ascension) moves as a Normal piece of its
  temporary type until the transform reverts, then regains its abilities.
- **Only the player has them.** Enemy pieces are always Normal, so the enemy policy never moves with
  rarity abilities — but it must respect the squares the player's abilities attack.
- **Abilities are never forced.** A piece with extra moves may always make a standard move instead.

### Deliberately ignored chess rules

| Rule | Status | Why |
|---|---|---|
| Threefold repetition | Ignored | Stages are short and decisive; repetition cannot stall a decision |
| Fifty-move rule | Ignored | Turn limits dominate |
| Insufficient material | Ignored | The turn limit handles "no progress": a stage that cannot be mated in time is lost |
| Draw by agreement | Doesn't exist | There is only win or loss |
| Stalemate | **Loss for the player**, on either side (see §7) | The enemy is always the losing side, so a draw would be an unearned escape; mate must be exact |

## 3. Stage flow and turn structure — "Plan & Commit"

A stage runs in a fixed order. Each step ends before the next begins, and none can be revisited.

| # | Phase | What happens |
|---|---|---|
| 1 | **Shop** | The player buys pieces and skills ([07](07-shop-phase.md)). The last chance to change the deck before the stage. |
| 2 | **Enter stage** | The stage is generated ([04 §3](04-stage-generation-and-authoring.md#3-generation-pipeline)): the enemy army and the player's spawned pawns are placed, and every spawned pawn's promotion result is shown. No Hero Piece is on the board yet. |
| 3 | **Analysis & Deployment** | The player studies the board, places the King, and summons deck pieces whose total spawn cost fits the stage's spawn points, all on ranks 1–4 (§5). Placements can be moved or taken back freely; nothing is paid yet. |
| 4 | **Start → Action** | Pressing **Start** commits the deployment, pays durability, and **locks the deck**. The player's first move follows at once, and turns run until the stage ends (§7). From here on, no piece can be summoned. |

Each turn of the Action phase has five steps:

1. **Plan.** The player assembles an ordered action queue. All costs are accounted sequentially.
2. **Validate.** The engine simulates the entire queue plus end-of-turn expiry (R1) and checks the
   result against the legality invariants (§9). Failure blocks the commit and explains why.
3. **Commit.** The queue becomes immutable.
4. **Resolve.** Actions execute in order. Captures, transforms and promotions apply **immediately**
   as each action executes.
5. **Reply.** End-of-turn resolution (§6) runs, then the enemy takes one move per its policy (§8).

**There is no pass.** Every queue contains at least one `MOVE` (`rules.minMovesPerQueue`). A
player who has no legal queue at the start of a turn has lost the stage (§7) — checkmated if the King
is in check, stalemated if it is not.

**Nothing is evaluated mid-queue.** A queue is not required to be legal at any intermediate point —
only at its end. This is a core mechanic, not a loophole:

- You may move your king *through* an attacked square to reach a safe one in two moves.
- You may give a "check" with your first move and then move the checker away; no check ever existed.
- A piece may temporarily occupy a square that would normally be impossible.

**What is *not* deferred:** each individual `MOVE` must still be a legal move *for that piece in the
board state at that moment* — blocking, path, and occupancy rules still apply. Skills break exactly
one named rule each. "Move twice" is two real moves, not a teleport.

## 4. Action types and costs

| Action | Payload | Costs | Notes |
|---|---|---|---|
| `MOVE` | `{ from, to }` | 1 move credit (0 for a Legendary knight's bonus move) | Must be legal for that piece right now, including its rarity abilities (§2.3) |
| `ACTIVATE_SKILL` | `{ skillId, target? }` | Focus equal to the skill's cost | Does **not** cost a move credit; may grant credits |

A `MOVE` names its piece by its square: the piece on `from` at that moment of the queue. Stage Pieces
have no id, and a square is unambiguous at every step.

There is no `DEPLOY` action. Pieces enter the board only in the Deployment phase (§5).

Cost accounting is **sequential**: walking the queue, each action must be affordable *at the moment
it executes*. A skill that grants a move credit cannot retroactively pay for a move already committed
earlier in the queue.

- **Move credits** start at 1 per turn (`freeMovesPerTurn`). Only skills grant more. Credits pay
  only for `MOVE`.
- **Focus** starts at the pool value (default 3) each turn, does not carry over, and **can never buy
  a move credit**. This is the balance anchor: exceeding one action per turn requires a skill — or a
  Legendary knight.
- **Legendary knight bonus move.** Once per turn, after a Legendary knight has made a paid `MOVE`, its
  *next* `MOVE` that turn costs 0 credits. The bonus belongs to that knight: it cannot pay for any
  other piece's move, and it does not carry over. With two Legendary knights, each has its own bonus.
- **Skill charges** are per stage, not per turn (see [03](03-skill-framework.md)). A skill with 2
  charges may be activated twice in the same stage — including twice in one turn, Focus permitting.

## 5. Deployment

Deployment is how the deck becomes an army, and it happens **once per stage, before the first
move**. The decision it asks is *who comes*: the enemy board is fully visible, the stage's spawn
points cannot pay for the whole deck, and every piece brought costs durability.

**Rules**

1. The player places the **King** on any empty square of the **deployment ranks: ranks 1–4**, the
   player's half of the board (`rules.deploymentRanks`, the same for every stage). Ranks 5–8 are enemy
   territory: nothing is ever deployed there. The King is mandatory and free.
2. The player may **summon** deck pieces whose total **spawn cost** fits the stage's **spawn points**:

   | Spawn cost | Knight | Bishop | Rook | Queen | King |
   |---|---|---|---|---|---|
   | Points | 3 | 3 (Legendary **5**) | 5 | 9 | 0 |

   | Spawn points | Normal stage | Boss |
   |---|---|---|
   | Act I | 9 | 12 |
   | Act II | 12 | 15 |
   | Act III | 15 | 18 |

   Costs follow chess value and do not change with rarity, with one exception: a Legendary bishop
   moves like a queen and costs 5. A template may lower its stage's budget, never raise it. Summoning
   none is allowed; points left unspent are lost.
3. Each summon goes on an **empty** square in the deployment ranks. A spawned pawn on rank 3 or 4
   simply occupies its square.
4. A summoned piece must have **durability ≥ 1**; summoning decrements it by exactly 1.
5. Until **Start**, placements may be moved, swapped or taken back without cost. Spawn points and
   durability are paid only when Start commits the deployment.
6. Start is refused if the King would begin in check (I2), or if the summons cost more than the
   stage's spawn points. A refused Start costs nothing.
7. After Start the **deck is locked** for the stage (I15). Nothing — no action, no skill, no
   promotion — brings another deck piece onto the board until the next stage.

Because the cheapest summon costs 3, a normal stage fits at most 3 / 4 / 5 summons by act, and a boss
one more. The budget is the ceiling, not the target: with durability this scarce
([06 §1](06-deck-durability-and-permadeath.md#1-the-piece-table)), bringing less is often right.

There is no randomness in deployment: no piece is placed for the player, and no square is chosen for
them. Spawned pawns are not summons; they are already on the board when the phase begins (§2.1).

**Summoned pieces are removed from the deck's available pool for the stage** but remain in the deck
for the run. A piece that survives the stage returns to the deck with its reduced durability. A piece
captured during the stage is destroyed permanently (see [06](06-deck-durability-and-permadeath.md)).
Pieces left in the deck are untouched: they spend no durability and cannot be lost.

**Why before the first move.** Mid-stage reinforcement made the strongest plan "start small, add
pieces as the position demands", which turned deployment into a reaction instead of a commitment.
Choosing the whole army up front, against a board you can fully read, makes the analysis phase the
puzzle's first move — and every piece left behind a deliberate saving of durability.

## 6. End-of-turn resolution order

This order is fixed and load-bearing. Changing it changes the game.

| Step | Name | What happens |
|---|---|---|
| **R1** | Expire temporary modifiers | All modifiers with duration `this_turn` revert. A bishop-turned-queen becomes a bishop again. |
| **R2** | Illegal end-state assertion | The post-R1 state must satisfy §9. At runtime this should never fire (commit-time validation already covered it); if it does, it is an engine bug and the turn is rolled back. |
| **R3** | Terminal evaluation | If the enemy king is in check and the enemy has no legal move, the player **wins by checkmate**. If the enemy king is *not* in check and the enemy has no legal move, the enemy is **stalemated and the player loses**. |
| **R4** | Stage end and economy evaluation | Stage end conditions checked (§7); turn counter advanced; coin reward computed on a win (see [05](05-run-structure-and-economy.md)). |
| **R5** | Enemy turn | The enemy makes one move per its policy, then the turn ends: Focus and credits refill, and the player's position is checked for a legal queue (§7) before the new turn begins. |

**Consequence worth calling out explicitly:** a temporarily transformed piece that delivers mate
does **not** deliver mate, because R1 reverts it *before* R3 evaluates. Burst transformations cannot
win the stage; they win *position and material* — clearing defenders out of a mating net and
earning salvage — which is exactly the intended use. The same revert can also *create* a stalemate
that R3 then scores as a loss; the preview shows it (§7).

Similarly, an end state in which reverting a transform would expose the player's own king is illegal
and cannot be committed. A "free" transform is never free of positional consequence.

## 7. Stage end evaluation

**Checkmate is the only way to clear a stage.** There is no material win, no domination route, no
swing metric — and no draw: **a stalemate on either side is a loss for the player.**

Evaluated in this order; the first match ends the stage:

| Priority | When | Condition | Outcome (`endReason`) |
|---|---|---|---|
| 1 | R3 | Enemy king in check, enemy has no legal move | **WIN** — `checkmate`; stage reward ([05 §2](05-run-structure-and-economy.md#2-income-stage-reward--turns--coins)) |
| 2 | R3 | Enemy king not in check, enemy has no legal move | **LOSS** — `enemy_stalemated` |
| 3 | R4 | Turns remaining = 0 | **LOSS** — `out_of_turns`; the enemy does not move |
| 4 | after R5 | Player king in check, the player has no legal queue | **LOSS** — `player_mated` |
| 5 | after R5 | Player king not in check, the player has no legal queue | **LOSS** — `player_stalemated` |

Any loss ends the run. A **legal queue** is any queue that satisfies §3–§4 and the invariants of
§9: at least one `MOVE`, every action legal and affordable, and the player's King not in check at the
end. The deck is locked, so only moves and skills count. The player can never be mated or stalemated
at the end of their own turn — I2 forbids ending a turn in check, and the check after R5 catches the
rest — so priorities 4 and 5 are only ever reached through the enemy's move.

**Stalemate is visible before commit.** The preview evaluates R3 like everything else (I10), so a
queue that would stalemate the enemy shows **STALEMATE — YOU LOSE** and asks for confirmation. The
rule never springs on the player; it shapes what they plan.

**Stage reward:**

```
coins = baseReward(act, tier) + (turnLimit − turnsUsed) × coinRate(act) + salvage
```

The base reward is paid in full for every cleared stage, even one cleared on its final turn; every
unused turn adds bonus coins on top. Salvage for captured enemy pieces is paid as it happens.

**What captures are for.** Capturing no longer wins anything by itself. It is worth doing for three
reasons: it removes defenders from the mating net, it removes attackers from the player's pieces, and
it pays salvage. Losing a piece costs the run that piece; it does not move any win condition. A
capture can also *cost* the stage: taking the enemy's last mobile piece next to a boxed-in king is
the classic way to stalemate it.

**Why checkmate only.** A fallback material win let a player trade down slowly and still clear the
stage. Without it, every stage is a mating problem against the clock, the solver proves exactly one
thing (a mate exists within the limit, [04 §5](04-stage-generation-and-authoring.md#5-the-solver)),
and the turn counter is the only pressure the player has to read.

**Why stalemate loses.** In chess a stalemate rescues the losing side. Here the enemy is always the
losing side, so a draw would be a consolation the puzzle never earns — and "enemy passes", the old
rule, let a player freeze the enemy with no risk. Making stalemate a loss turns it into the oldest
constraint in mating puzzles: overwhelming force is not enough; the net must leave the king exactly
one way to be checkmated, and no way to be smothered into a draw.

## 8. Enemy behavior

- The enemy is **standard-move-only** in MVP: it never summons, never uses skills, and never gains
  reinforcement mid-stage. (Boss skills are an M6 feature; the schema already reserves
  `enemyLoadout`.)
- Every enemy piece is a **Stage Piece** at Normal rarity. Enemy rarity is never rolled or authored,
  so the enemy never uses rarity abilities. Enemy pawns that reach rank 1 promote to a Normal queen.
- The enemy takes exactly **one standard move** per turn.
- The enemy's policy is one of:
  - `best_move` — fixed-depth alpha-beta minimax with a seeded tie-break (§8.1). Deterministic for a given
    seed and position.
  - `scripted` — a fixed authored line, used for teaching and boss stages.
- **The enemy AI is our own code.** `best_move` is a small minimax in `packages/engine`, written
  against *these* rules — multi-action player turns, rarity abilities, stalemate-as-loss, the turn
  limit. No external chess engine plays the enemy: a standard engine would misread every one of those
  rules, and could not be called the hundreds of thousands of times the solver needs. Stockfish has a
  role only as an offline design tool ([09 §1](09-technical-architecture.md#1-stack)).
- **The enemy never passes.** R5 runs only after R3, and R3 has already ended the stage if the enemy
  has no legal move — by checkmate (a win) or by stalemate (a loss). So whenever the enemy is asked to
  move, it has at least one legal move.

### 8.1 Enemy AI

The enemy is one pure function, `enemyMove(stage, seed, config) → { move | null, policy }` (`move` is null only when the enemy has no legal move), used unchanged by the engine,
the solver and replay. Same position + same seed → same move, always. Every constant below lives in
[`data/economy.yaml`](../data/economy.yaml) → `enemyAI`.

**What the enemy wants.** The enemy "wins" when the player runs out of turns, is mated, or causes a
stalemate on either side, so its job is to **defend first and punish mistakes**: survive the clock,
keep its king safe, take the player's pieces when that is safe, mate the player's king whenever it
can — and steer toward positions where the player's only remaining moves would stalemate it. It does
not launch risky attacks.

**Search.**

| Element | Rule |
|---|---|
| Algorithm | Alpha-beta minimax with **iterative deepening** (depth 1, 2, … up to the policy depth) and a deterministic **transposition table** |
| Depth | The template's `enemyPolicy.depth`: Act I 2, Act II–III 3, bosses 4 ([04 §6](04-stage-generation-and-authoring.md#6-difficulty-curve)) |
| One ply | One enemy move, or one player reply |
| The player's reply | **One standard move**, including rarity movement abilities (leaps, multi-capture). The enemy does **not** imagine skills or a Legendary knight's bonus move — those stay genuine surprises, which is what makes them feel like breaking the rules |
| Quiescence | At the horizon, keep searching **captures only**, at most 2 more plies, so the enemy never hangs a piece just past its depth |
| The clock | The search knows how many turns the player has left. A line where the player runs out of turns is a win for the enemy |

The enemy's model of the player is deliberately simpler than the player. The solver is not: it
searches the player's full action set ([04 §5](04-stage-generation-and-authoring.md#5-the-solver)),
so every stage stays provably clearable however the enemy misjudges the player.

**Evaluation** — scores from the enemy's point of view; higher is better for the enemy.

| Outcome (always outranks any position) | Score |
|---|---|
| Player king mated | +100,000, minus plies to reach it (sooner is better) |
| Either side stalemated (enemy with no move, or player with no move, neither in check) | Same as player king mated: the player has lost |
| Player out of turns | +50,000 |
| Enemy king mated | −100,000, plus plies to reach it (an unavoidable mate is delayed as long as possible) |

| Positional term | Weight |
|---|---|
| Each legal move of the enemy king (escape square) | +30 |
| Each square next to the enemy king that the player attacks | −25 |
| Enemy king in check | −60 |
| Material: enemy minus player on-board value (P1 N3 B3 R5 Q9) | ±10 per point |
| Each legal enemy move (mobility) | +2 |

King safety outweighs material — one escape square is worth three pawns — so the enemy gives up a
pawn to keep its king mobile, but grabs a piece the moment it is free. "Attacked" uses the player's
real attack map, rarity abilities included (§2.3).

**Tie-break.** Moves with exactly equal scores are first ordered stably (captures, then checks, then
by from- and to-square), and one is then picked with `hash(stageSeed, turnsUsed)`. Runs differ;
replays do not.

**Scripted enemies.** A `scripted` policy plays its `line` move by move, tracking its position in
`StageState.enemyPolicy.cursor`. If the next scripted move is illegal — its piece was captured, the
path is blocked, or it would leave the enemy king in check — or the line has run out, the enemy
**falls back permanently** to `best_move` at the template's `fallbackDepth` (default 3) for the rest
of the stage, and `fellBack` is set. A script never "skips ahead" to a later move.

## 9. Legality invariants

These are the contract the engine, the generator, and the tests all share.

| ID | Invariant |
|---|---|
| **I1** | From Start until the stage ends, exactly one white king and one black king are on the board. (In the Deployment phase only the black king is; the player places theirs before Start.) |
| **I2** | The end state of every queue — and the position at Start — has the player's king **not** in check. |
| **I3** | A king is never captured and never removed by any effect — including multi-capture and the Legendary knight's bonus move. |
| **I4** | Every `MOVE` was legal for its piece — including its rarity abilities (§2.3) — in the position at the moment it executed. |
| **I5** | The number of paid `MOVE` actions in a queue never exceeds the credits earned in it, and every queue has at least one `MOVE`; each Legendary knight makes at most one free bonus move per turn. |
| **I6** | Total Focus spent in a queue never exceeds the pool plus Focus granted during that queue. |
| **I7** | A piece's durability never goes below 0; summoning requires durability ≥ 1 and spends exactly 1. |
| **I8** | No placement in the Deployment phase — King or summon — is on an occupied square or outside the deployment ranks (1–4). |
| **I9** | Outside a stage, deck size never exceeds the fixed capacity of 8 (a promotion may overflow it during a stage; the cut happens at stage end); the king is never destroyed or removed from the deck; the deck never holds a pawn. |
| **I10** | The coin payout shown in the preview equals the payout at evaluation, for the same plan. |
| **I11** | Given identical `(RunState, seed)`, generation and all enemy decisions are reproducible. |
| **I12** | The King has no rarity (`null`); every other piece has exactly one tier, fixed for the life of the instance (a merge creates a new instance; it never changes an existing one). |
| **I13** | Every enemy piece is Normal rarity. |
| **I14** | Nothing — shop offer, spawned pawn, or promotion result — is above its act's rarity ceiling; the Act I ceiling is Rare. |
| **I15** | Hero Pieces enter the board only in the Deployment phase: the King plus summons whose total spawn cost fits the stage's spawn points, and none after Start. |

## 10. Worked example: deployment and the first turn

Stage: Act I template, 8 turns, 9 spawn points. The deck holds a Rook and a Bishop (durability 2
each) and two Knights. Board after generation: enemy king on `g8`, enemy rook on `d5`. The enemy rook
controls the `d`-file down to `d1`, and the fifth rank.

**Deployment phase.** The player reads the board before placing anything. The rook belongs on the
seventh rank, next to the enemy king — but a rook on `h7` is adjacent to `g8` and would simply be
taken unless something defends it. The long diagonal `b1`–`h7` is open. So the player places:

| Placement | Why | Paid at Start |
|---|---|---|
| King → `e1` | Off the `d`-file | free |
| Rook → `h1` | Clear run up the `h`-file to `h7` | durability 2 → 1 |
| Bishop → `b1` | Guards `h7` along `b1`–`h7` | durability 2 → 1 |

The rook and bishop cost 5 + 3 = 8 of 9 spawn points, so no knight fits; both stay in the deck and
spend nothing. Start: the King on `e1` is not in check (I2 ✓), every square was empty and inside
ranks 1–4 (I8 ✓), 8 points ≤ 9 (I15 ✓). The deck is now locked.

**Turn 1.** The queue is one action:

| # | Action | Cost | Running state |
|---|---|---|---|
| 1 | `MOVE h1 → h7` | 1 credit (0 left) | Rook on `h7`, defended by the bishop on `b1` |

Validation: the player king on `e1` is not in check (I2 ✓), 1 credit spent of 1 (I5 ✓), at least one
`MOVE` (✓).

R1: no `this_turn` modifiers to expire.
R2: end-state legality assertion passes.
R3: the enemy king on `g8` is not in check. It is not stalemated either: `f8` is free, and the enemy
rook has moves. Play continues.
R4: turn 1 of 8 used — play continues.
R5: the enemy replies; `best_move` sees that `g8xh7` walks into the bishop and keeps its king on the
`f8` side.

Note what the player *didn't* do: summon onto the `d`-file (`d1`–`d4`) and hand the enemy a free rook — lost for
the run, and one less piece for the mating net. And note the trap one step ahead: if the enemy rook
ever leaves the board while the king is boxed on `g8`/`f8`, a careless quiet move could leave it with
no legal move at all — a stalemate, and a lost stage (§7).

The freedom deferred validation buys still applies inside every turn: the same king may **step into
check on one action and out of it on the next**, because check is evaluated only on the end state.
That is not a loophole — it is the mechanic that makes extra moves worth buying.

## 11. Rules that are out of scope for MVP

- Playing as Black; any color asymmetry.
- Castling, en passant, underpromotion.
- Enemy deployment, enemy skills, enemy reinforcement waves.
- Obstacles, terrain, walls, or special squares.
- Multi-king or non-standard variants.

Each of these has a reserved extension point in
[09 — Technical Architecture](09-technical-architecture.md) and a row in
[11 — Open Decisions](11-open-decisions.md).
