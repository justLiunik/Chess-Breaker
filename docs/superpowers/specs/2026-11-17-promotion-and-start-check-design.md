# M5.1 — Chess promotion and no check at START: design

Status: draft for the user's approval (2026-11-17). Branch: `M5.1`, cut from `M5` (PR #2, open).

## 1. Why

In the first M5 playtest (2026-11-17), the user could not finish a run. Four things came up:

1. A promoted pawn left the board with no explanation. The rule (docs/02 §2.2) was working as written,
   but it felt like a bug, and the promotion paid nothing during the stage.
2. A summon could give check to the enemy king at START. The user expects that to be illegal.
3. Shop prices felt too high.
4. Every stage felt too hard. The user lost because they "could not find the right mate in X".

The user decided to change two rules now: promotion works like chess, and START may not give check.
Economy and difficulty tuning wait until the user plays again on the new rules (user decision
2026-11-17). Promotion to a queen in the middle of a stage should make stages noticeably easier. Without
a replay, any re-tuning would be a guess.

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| P1 | A spawned pawn that reaches rank 8 **stays on the board** as the promoted piece, on that square, and keeps playing for the rest of the stage. | User, 2026-11-17 |
| P2 | The player **chooses** the piece type: knight, bishop, rook or **queen**. | User, 2026-11-17 (queen allowed) |
| P3 | The promoted piece has the **pawn's rarity**. There is no tier-up and no roll. | User, 2026-11-17 |
| P4 | The promoted piece **also joins the deck**, at once, as a Hero Piece with full durability for its type and tier (`origin: promotion`). | User, 2026-11-17 |
| P5 | The stage-end chooser for an over-full deck is removed. While the deck holds more than 8 pieces, the shop **cannot start the next stage**. The player sells, merges or cuts in the shop until the deck fits. | User, 2026-11-17 |
| P6 | At START, **no white piece may give check to the black king**. | User, 2026-11-17 (playtest finding) |
| P7 | Economy and difficulty are not tuned in M5.1. | User, 2026-11-17 |
| P8 | Saves from before M5.1 are refused with a clear message, not migrated. | User, 2026-11-17 |
| P9 | M5 merges into main first (PR #2). M5.1 is its own branch and its own review. | User, 2026-11-17 |
| P10 | **At most one queen may be summoned per stage** (any rarity). A pawn may still promote to a queen in that stage, even if a queen was summoned. | User, 2026-11-17 |

P2 holds without exception: a pawn of any rarity may become any of the four types, including a
Legendary queen.

P6 rationale (user): the player moves first, so a check that already stands at START is a free
attack that the enemy never got to answer. If the enemy moved first, it could make sense; here it
does not.

## 3. Approaches

- **Where the work lives:** (a) a new branch after M5, reviewed on its own, **chosen**; (b) continue
  on M5, which would mix a reviewed UI milestone with a rule change.
- **Old saves:** (a) refuse them with a version message, **chosen**: the only saves are from the
  user's playtest, and the pawn and deck shapes change. (b) Migrate them, which means conversion code
  for data that does not matter.
- **How the player chooses (user, 2026-11-17: "at the moment the pawn reaches the promotion
  square"):** the picker opens the moment the planned move puts the pawn on rank 8, while building
  the queue. The choice is stored in that `MOVE`. A chooser that appears only during resolution would break the rule
  that the preview equals the outcome (I10), because the queue resolves all at once on COMMIT.
- **Solver (my call):** the solver tries all four piece types on a promotion. In this game stalemate
  is a loss, so a rook or bishop can be right where a queen stalemates. Promotions are rare, so the
  extra branches cost little.

## 4. Rules

### 4.1 Promotion (replaces docs/02 §2.2)

When a spawned pawn reaches rank 8 by a `MOVE`:

1. The `MOVE` names the promotion: `promotion: 'knight' | 'bishop' | 'rook' | 'queen'`. A `MOVE` that
   brings a spawned pawn to rank 8 without a promotion is refused (`CommitError` `illegal_move`, reason
   `promotion_required`). A promotion on a move that does not promote is refused (reason
   `promotion_not_allowed`).
2. The pawn is replaced, on the same square, by a **Hero Piece** of the chosen type with the pawn's
   rarity. A new instance with full durability for that type and tier is created and joins the deck
   at once (`origin: promotion`, `pricePaid: 0`). The board piece carries that `instanceId`.
3. From that point on in the stage, the promoted piece is an ordinary Hero Piece on the board:
   - it moves (and, if it gets a later turn, moves again) with its type's moves and its rarity
     abilities (§2.3);
   - it can be targeted by skills like any other Hero Piece;
   - if the enemy captures it, it is lost from the run, like any captured Hero Piece (docs/06).
4. It paid no summon cost and no durability in this stage. From the next stage on it is summoned like
   any deck piece.
5. A promotion that is also a capture, or that gives check or mate, applies the same way. The
   promoted piece gives check and mates as its new type, immediately (deferred check validation still
   judges only the end of the queue, R1–R3).

The rarity ceiling (I14) is already respected, because spawned pawns are rolled within the act's
ceiling. A Legendary pawn (Act III only) may promote to a Legendary queen (user: "any piece, no
exception"). The Legendary-queen retention roll of 07 §2.1 does not apply, because nothing is rolled.

The pawn's label changes from "→ Rare Knight" to "Rare pawn, promotes to any piece".

Enemy pawns still promote to a Normal queen by the normal chess rule (unchanged).

### 4.2 Deck over capacity (replaces the stage-end chooser)

- A promotion can push the deck above 8 during a stage. The stage continues normally (unchanged).
- After a won stage, the run goes straight to the shop. The `chooser` run phase and its events are
  removed.
- In the shop, while the deck holds more than 8 non-king pieces:
  - buying a piece is refused (`deck_full`, unchanged);
  - selling, merging and cutting work as usual;
  - leaving the shop for the next stage is refused with a new `RunError`
    `{ kind: 'deck_over_capacity'; size: number; capacity: 8 }`.
- I9 becomes: "Outside a stage and outside the shop, the deck holds at most 8 pieces. A promotion may
  overflow it during a stage, and the player must bring it back to 8 in the shop before the next
  stage."
- After the final stage the run ends, and the deck size no longer matters.

### 4.3 No check at START (new)

- New invariant **I16**: "At Start, the black king is not in check."
- `startStage` refuses a deployment whose final position gives check, with `invalid_deployment`
  reason `gives_check` (`to` = the checking piece's square).
- Placing a piece can only block lines, never open them. So the check is done once, on the full
  placement at START, the same way as `king_in_check` (Ruling R9 of M5).
- `deploymentStatus` marks a square **invalid, gives check** for the piece being placed when placing it
  there would attack the black king. The UI shows it like the other invalid reasons, with a named
  message.
- Generation: the stage's own spawned pawns never attack the black king (a new precondition,
  `no_start_check`). The solver's deployment candidates skip placements that give check.
- The King cannot give check (two kings are never adjacent; I2 already refuses that), so the rule is
  really about summons and spawned pawns.

### 4.4 One queen summon per stage (new)

- New data `deployment.maxQueenSummons: 1` in `economy.yaml`, with its schema and validator.
- `startStage` refuses a second summoned queen with `invalid_deployment` reason `queen_limit`.
- `deploymentStatus` marks every further queen in the tray as unavailable, for the reason
  "one queen per stage", once one queen is placed.
- The solver's deployment candidates respect the limit.
- The limit counts only summons. A queen from a promotion during the stage does not count. In the
  next stage, that queen is a deck piece and counts like any other queen.

### 4.5 Settled details (from the builder check)

Some of these the existing rules already answer; the others are marked as my call.

- **Rollback.** `commitQueue` is all-or-nothing. A refused COMMIT adds nothing to the deck. Restart
  is possible only before the first COMMIT, so a restart never undoes a promotion. The deck write
  stays inside queue resolution, where it already is (`queue.ts`).
- **A lost stage.** Any loss ends the run (docs/05 §1), so a promotion in a lost stage cannot be farmed.
- **Moving again in the same queue.** A `MOVE` names its piece by its square at that moment (docs/02
  §4). A later `MOVE` in the same queue may move the promoted piece, if a credit pays for it.
  Preview, deferred check and I10 treat it like any other piece.
- **Durability and losses (my call).** The promoted piece starts at full durability and spends
  nothing in its first stage. If the enemy captures it, it counts as a Hero Piece lost in the stage,
  for the recovery offer (docs/07 §3) as well as for permadeath.
- **Sell value (user-approved 2026-11-17).** This is a change. Before M5.1, a promoted piece had no
  `pricePaid` and sold for half its price. Now it records `pricePaid: 0`, so it sells for 0, which in
  effect is a cut. This stops promotion from becoming a coin source. The deck gate stays a real
  choice, because any other piece sells for its normal price. Prices are revisited in the tuning pass
  after the replay (P7).
- **Capacity.** It counts non-king pieces (`deck.kingOccupiesSlot: false`). Cutting is always
  possible, so the gate cannot soft-lock. The gate blocks only starting the next stage; resume and
  save land in the shop as before.
- **Generation when the filter removes every winning deployment (my call).** This goes through the
  existing path for an unproven stage (retries, then an unproven stage, which the dev skip covers).
  The proven rate per template is re-measured and recorded next to the par curve.
- docs/02 §4 ("Pieces enter the board only in the Deployment phase") and I15 gain the promotion
  exception.

## 5. What changes, by package

| Area | Change |
|---|---|
| `engine` types | `BoardPiece.promotesTo` removed. `Move.promotion` widens to the four types for White. `MOVE` gains `promotion?`. New `MoveRejection` reasons `promotion_required` and `promotion_not_allowed`. `invalid_deployment` gains `gives_check`. The `pawn_promoted` event carries the chosen type, the rarity and the `instanceId`. |
| `engine` move generation and legality | White pawn moves to rank 8 generate one move per piece type and place the piece instead of removing the pawn (`'removed'` goes away). |
| `engine` queue | A promotion places the Hero Piece on the board and adds the instance to the deck (it is already added at once today). |
| `engine` start and view | `startStage` checks I16 and the queen limit. `deploymentStatus` reports `gives_check` and `queen_limit`. `previewSteps` shows the promoted piece on the ghost board. |
| `engine` enemy search | White promotions in the search tree branch on the four types. The depth-4 timing is re-measured on the bench. |
| `gen` | `rollPromotion` and its RNG draw are removed, so every generated stage changes (golden and determinism fixtures are re-recorded). New precondition `no_start_check`. The solver deployment filter skips placements that give check. The solver searches promotion choices. |
| `run` | The `chooser` phase and the `chooser_opened` event are removed; won stages go to the shop. New `deck_over_capacity` on leaving the shop. The save version is bumped, and older versions are refused with `SaveError` version (existing message). |
| `content` and data | `promotion.resultTypeWeights`, `tierUpChance`, `appliesRetention` and `rolledAtGeneration` are removed. `overCapacity` becomes `blocks_next_stage`. New `deployment.maxQueenSummons: 1`. `sell` and `merge` `when` become `[shop]`. Schemas (`stage`, `piece`, `run`) and the validator follow. The YAML examples are updated. |
| `apps/web` | Promotion picker (Q/R/B/N) when a planned move reaches rank 8, as on lichess. The picker is part of building the queue, and the queue entry shows the chosen piece. The Chooser screen is removed. The shop shows "Deck 9/8: sell, merge or cut to continue" and disables the next-stage button with that reason. The Deployment screen marks `gives_check` squares. Every new error variant has a distinct message. |
| Bot (`scripts/run-bot.ts`) | The bot always promotes to a queen and trims the deck in the shop. |

## 6. Docs to update

- docs/02: glossary, §2.2, §4 (no `DEPLOY`; the promotion exception), §5 deployment, §9 invariants
  (I9, I15, the new I16).
- docs/04: promotion roll removed, precondition list, solver.
- docs/05 and 06: over-capacity flow; promotion joins the deck.
- docs/07: shop gate; sell and merge only in the shop.
- docs/08: promotion picker and Deployment marks.
- docs/09: types and errors.
- docs/10: a new M5.1 section with these acceptance criteria.
- docs/11: decision entries for P1–P6.

## 7. Goals, non-goals, anti-goals

- **Goals:** promotion pays during the stage and reads like chess; START never begins in check; the
  user can replay a run on the new rules.
- **Non-goals:** economy prices, par values, enemy strength, hints (M6), the dev "show solution" idea
  (noted for later).
- **Anti-goals:**
  - rules logic in the UI (the picker offers what the engine accepts);
  - a promotion that is a hidden dice roll;
  - a preview that differs from the outcome.

## 8. Acceptance

- [ ] Engine tests:
  - promotion to each of the four types stays on the board with the pawn's rarity and joins the deck;
  - `promotion_required` and `promotion_not_allowed`;
  - a promoted piece captured later in the stage is lost;
  - I10 holds over promotions;
  - I16 is refused at START, and `deploymentStatus` reports `gives_check`;
  - a second summoned queen is refused (`queen_limit`), and a promotion to a queen in the same stage
    is allowed.
- [ ] Generation: 100% of stages satisfy `no_start_check`; the 1,000-stage bulk run still passes; the
      par curve (solver mating turn against par per template) is re-measured with `gen:report` and
      recorded, without re-tuning.
- [ ] Run: no chooser phase; `deck_over_capacity` refuses the next stage at 9 and allows it at 8; a
      pre-M5.1 save is refused with the version message.
- [ ] Web:
  - the promotion picker appears for a move to rank 8, and the preview shows the promoted piece;
  - `gives_check` squares are marked;
  - the shop gate reads and works as described;
  - the full-run test is updated and passes.
- [ ] Data, schemas and the validator agree. `npm test`, `typecheck`, `validate`, `check:links` and
      `build` pass.
- [ ] The user plays again and says whether the stages and the economy now feel right (the input for a
      later tuning pass).

## 9. Left to the builder

- Exact message wording and picker styling.
- How the four-way promotion branching is ordered in the solver and enemy search (queen first is the
  natural choice).
- Fixture re-recording: re-record, do not hand-edit.
