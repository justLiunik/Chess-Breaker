# 00 — Vision & Pillars

## Elevator pitch

> Checkbreaker is a run-based chess-puzzle roguelike. Each stage is a tight, sparse-board mating
> problem on a strict turn limit. Your army is a deck: durable pieces you deploy turn by turn, and
> fragile pieces that die permanently when captured. Every checkmate pays coins, and every turn you
> save pays more; coins buy new pieces and the skills that let you break chess. You have 9 stages to
> prove you can mate faster than you lose your army.

## The one-sentence design thesis

**Every gain in efficiency is paid for with permanence.**

Deploying a piece burns one of its finite deployments. Rushing a stage for coins means spending
durability you cannot get back. Losing a piece to a capture removes it from the run forever. Every
system in the game is a consequence of that sentence.

## Genre positioning

| Comparable | What we borrow | What we do differently |
|---|---|---|
| **Pawnbarian** | Chess moves as a roguelike deck; charges that refresh per encounter | Durability is *per piece instance* and permanent, not per-card-per-fight |
| **Shotgun King** | Rules-breaking as the core fantasy; tight runs | We break rules through an explicit, data-driven, category-organized skill system |
| **Slay the Spire** | Shop economy, deck churn, act structure | The tactical layer is real chess, not an abstract card combat |
| **Chess puzzle apps** | Authentic legality, mate-in-N craft | Randomized boards, a persistent deck, and economic stakes |
| **Into the Breach** | Perfect information and preview clarity | Applied to action-queue planning |

**Positioning statement:** for players who like chess but find puzzles static, and players who like
roguelike deckbuilders but find their combat abstract — a game where the puzzle is chess and the
build is a deck.

## Audience

- **Primary:** tactical roguelike players (StS, Into the Breach, Shotgun King) who know how chess
  pieces move and enjoy tight planning. No competitive-chess knowledge required.
- **Secondary:** chess-club players who want a reason to think about tempo rather than opening theory.
- **Not for:** players who want a 40-move tournament game, an opening-repertoire trainer, or a
  real-time game.

Chess literacy is a *soft* requirement: the game teaches piece movement in the first run and never
requires reading algebraic notation. Hints describe intent, not coordinates.

## Four pillars

### 1. A stage is the puzzle; a run is the deck
Puzzle craft lives at stage scale — few pieces, tight turn limit, one best line. Depth lives at run
scale: what you brought, what you can afford to spend, what you can survive losing. Mechanics that
only serve one scale get cut.

### 2. Every efficiency costs permanence
Tempo is bought with durability. Durability is bought with coins. Coins are bought with tempo.
That closed loop is the game. No free reinforcements, no free durability, no free extra moves.
**Design test:** if a mechanic lets the player gain tempo without spending lasting resource, or gain
lasting resource without spending tempo, it is wrong.

### 3. One rule at a time
Each skill breaks exactly one named rule of chess and says which one on its card. Skills compose
because each is individually legible: "move twice" + "bishop is a queen" is predictable; "ignore
blockers, teleport, and capture twice" is not. **Design test:** a new skill must name the single
rule it violates in one short sentence.

### 4. Fair and provable
Every stage is provably solvable with the army the player actually owns (see
[04 — Stage Generation](04-stage-generation-and-authoring.md)). The enemy is deterministic. Coin
preview matches payout exactly. When a player loses, they can see the line that beat them. No
hidden information, no dice, no rubber-banding.

## Anti-pillars (deliberate non-goals)

- **Not a real-time game.** No clocks, no reflexes, no execution difficulty.
- **Not a competitive chess game.** No full 40-move games, no repetition rules, no openings.
- **Not a content treadmill.** Runs are procedural from authored templates; there is no plan for
  hundreds of hand-made levels.
- **Not roguelite-first.** Meta-progression, unlocks, and permanent upgrades are deferred
  ([11 — Open Decisions](11-open-decisions.md)); the run is the unit of meaning.

## Tone & art direction brief

- **2D top-down, high-contrast, legible at a glance.** This is a planning game; clarity outranks
  spectacle. Traditional piece silhouettes (Staunton-derived geometry) plus a distinct visual
  language for *modified* pieces — a transformed bishop-as-queen must be unmistakable.
- **Palette:** calm board, hot accents reserved exclusively for threat and for rule-breaking.
  If it glows, it breaks a rule or it will kill you.
- **Motion:** short, decisive, cancellable. Animations never delay the player's planning.
- **Sound:** wooden and tactile; no bombast. Audio confirms state changes, never announces them
  first.
- **Copy voice:** dry and confident. Skills read like rulebook footnotes that shouldn't be legal.

## Working title

**Checkbreaker** — provisional. A trademark and storefront availability pass is tracked in
[11 — Open Decisions](11-open-decisions.md).

## Success looks like

- A new player clears Act I of their first run and dies in Act II, and immediately wants to retry
  with a different deck shape.
- Experienced players talk about *durability budgets* and *coin-per-turn rates*, not about move
  memorization.
- Two players describe beating the same template in visibly different ways.
