# 08 — Progression & UX

The UI's job is to make a hard planning game feel effortless and fair. Everything here serves one
goal: **the player should always know three numbers — turns left, what winning is worth, and what
their army can still do.**

---

## 1. Information hierarchy

Priority order when two elements compete for space or attention:

1. **Turns remaining** — the clock the player fears.
2. **Coin preview** — what winning *right now* is worth. This number is the game's whole incentive
   structure and must never be hidden behind a tooltip.
3. **Board threats** — what can capture what. Always visible, never "discoverable."
4. **Focus and move credits** — what this turn can afford.
5. **Durability and charges** — what the rest of the run can afford.
6. **Everything else** — hints, history, help.

If a screen cannot show 1–4 simultaneously, the screen is wrong.

## 2. Screen inventory

| Screen | Purpose | Reached from |
|---|---|---|
| **Run Map** | Act/stage progress, seed code, deck peek | Run start, stage end |
| **Stage** | The game | Run Map / shop exit |
| **Shop** | Spending coins | Automatic after a win |
| **Deck** | Full deck management, durability detail | Stage overlay, shop panel |
| **Results** | Run summary, cause of death, retry | Run end |
| **Codex** | Rules reference, piece movement, skill glossary | Anywhere (paused) |

No screen has a timer. The game is turn-based; urgency is diegetic (the counter), never real.

## 3. The Stage screen

### 3.1 Coin preview — the load-bearing number

```
preview = baseReward(act, tier) + (turnLimit − (turnsUsed + 1)) × coinRate(act)
```

`turnsUsed` includes the turn currently being played, so the final turn of a stage previews the
**base reward only** (e.g. **+4** in Act I). Salvage is shown separately as it is earned.

The HUD shows a live, per-plan value:

- **Checkmate available in this plan** → `+14 ◈` in full color.
- **No mate in this plan** → shows the *next-turn* potential in muted text, so the player always sees
  the decay.
- On the last turn it shows **`+4 ◈`** with the label `FINAL TURN` — an explicit, unmissable "mate
  now or lose the run; every saved turn would have paid more."

### 3.2 HUD layout

**Deployment phase** — the board as generated, the deck tray, and the summon counter. Nothing is paid
until START.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ACT I · STAGE 2 · DEPLOYMENT     TURNS 8      SUMMON ●●○  2/3        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│     8  ┌──┬──┬──┬──┬──┬──┬──┬──┐                                     │
│     7  │  │  │  │♚ │  │  │  │  │                                     │
│     6  │  │  │  │  │  │♞ │  │  │      ENEMY  ♟♟♟♞  9                 │
│     5  │  │  │  │  │  │  │  │  │                                     │
│     4  │  │  │  │  │  │  │  │  │                                     │
│     3  │  │  │♙ │  │  │  │  │  │      SPAWNED ♙c3 → Rare Knight      │
│     2  │  │  │  │  │  │  │  │  │                                     │
│     1  │♖ │  │  │♔ │  │♝ │  │  │                                     │
│        └──┴──┴──┴──┴──┴──┴──┴──┘    DEPLOYMENT RANKS ▓▓ (1,2)        │
│         a  b  c  d  e  f  g  h                                       │
├──────────────────────────────────────────────────────────────────────┤
│  DECK  [♔ placed] [♖ ●● placed] [♝ Rar ●● placed] [♞ ●●] [♞ ●○]      │
│        paid at START:  ♖ 2→1   ♝ 2→1        ♞ ♞ stay safe in the deck│
│                                                       [ START ▶ ]    │
└──────────────────────────────────────────────────────────────────────┘
```

**Action phase** — after START the deck tray is gone; the queue takes its place.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ACT I · STAGE 2         TURNS ●●●●●●○○      WIN NOW  +14 ◈           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│     8  ┌──┬──┬──┬──┬──┬──┬──┬──┐                                     │
│     7  │  │  │  │♚ │  │  │  │  │                                     │
│     6  │  │  │  │  │  │♞ │  │  │      ENEMY  ♟♟♟♞  9                 │
│     5  │  │  │  │  │  │  │  │  │      SALVAGE  +1 ◈ this stage       │
│     4  │  │  │  │  │  │  │  │  │                                     │
│     3  │  │  │  │  │  │  │  │  │                                     │
│     2  │  │  │♙ │  │  │  │  │  │      YOU    ♖♙  6                   │
│     1  │♖ │  │  │♔ │  │  │  │  │                                     │
│        └──┴──┴──┴──┴──┴──┴──┴──┘    DECK LOCKED · 1/3 summoned       │
│         a  b  c  d  e  f  g  h                                       │
├──────────────────────────────────────────────────────────────────────┤
│  FOCUS ◉◉○  2/3      MOVES ●○  1 credit                              │
│                                                                      │
│  QUEUE: [Twin Step] → [♖ a1→a7] → [♔ d1→e2]          +1 credit       │
│                                                       pending        │
│  [ Twin Step ◈1 ●●● ] [ Ascension ◈2 ●● ]        [ COMMIT ]  [UNDO]  │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.3 The Action Queue builder

This is the signature UI and the game's main skill-expression surface.

- **Queue is a left-to-right strip** under the board. Each entry shows its action icon, cost, and
  the square it targets.
- **Append by clicking** the board (move) or a skill card (activate). There is no deploy entry: the
  army was chosen before START.
  Order is click order; entries can be dragged to reorder, and dragging re-validates in real time.
- **Live preview:** the board renders the *result of the whole queue* as a ghosted overlay, with the
  intermediate steps available as a step-through (arrow keys) that highlights each entry.
- **Affordability is inline:** an entry that cannot be afforded at its position turns red and
  blocks COMMIT with a reason (`Not enough Focus at step 3`).
- **Illegal end state** blocks COMMIT with the specific invariant (`Your king would be in check
  after Ascension reverts`). This is the single most important error message in the game — it must
  name the *cause*, never just say "invalid."
- **A queue needs a move.** An empty queue, or one holding only skills, blocks COMMIT (`Add a move —
  there is no pass`).
- **Stalemate is called out.** If the previewed end state leaves the enemy with no legal move and not
  in check, the preview shows `STALEMATE — YOU LOSE` and COMMIT asks for confirmation
  ([02 §7](02-rules-framework.md#7-stage-end-evaluation)).
- **UNDO is free and total before COMMIT.** After commit there is no undo (§6).

**Deliberate non-feature:** no auto-solver, no "hint: play Rxf7." Hints describe *intent*
([§7](#7-hints-and-chess-literacy)).

### 3.4 Deployment interaction

The Deployment phase is a screen of its own, between entering the stage and the first move
([02 §3](02-rules-framework.md#3-stage-flow-and-turn-structure--plan--commit)). The enemy army and the spawned
pawns are already on the board; the player's side is empty.

- Deployment squares are tinted for the whole phase. Dragging a piece from the deck tray onto one
  places it; dragging it back, or onto another square, is free. The King must be placed before START
  is enabled.
- The **summon counter** (`SUMMON ●●○ 2/3`) fills as pieces are placed; once full, the remaining
  tray pieces are dimmed, not hidden. The King never counts.
- Hovering a square shows the threat overlay: which enemy pieces attack it, and the capture line
  that would follow (see [06 §9](06-deck-durability-and-permadeath.md#9-communication-rules-ui-contract)).
- A square where the King would start in check is marked invalid with a king-safety icon; START names
  the cause if pressed.
- **START** summarises what it will cost (`♖ 2→1  ♝ 2→1`) and states that the deck locks. After
  START the tray disappears for the rest of the stage.
- The tray shows durability pips and the rarity marker (tier name + frame shape), and disables pieces
  with `spent` status. On the board, Hero Pieces and spawned pawns keep their rarity frame; enemy
  pieces have none.
- Each spawned pawn always shows its promotion result ("→ Rare Knight") and the number of moves it
  still needs, so promotion competes visibly with the coin preview.
- Selecting a Rare+ bishop or knight highlights the extra squares its abilities reach; leap-only
  (non-capturing) squares are marked differently from capture squares. A Legendary knight shows
  "bonus move available" after its first move each turn.
- A Legendary rook or queen that can multi-capture shows both targets on the line; choosing the
  second target is a separate, explicit click, so stopping on the first is always one click away.
  When the second square holds the king, it is marked "check" — never as a capture.
- A Unique+ queen shows its lifeline as available or used on its deck tile.

## 4. The Run Map

Minimal — this is a puzzle game with a run wrapper, not a map crawl.

```
        ACT I            ACT II           ACT III
   ┌──┐ ┌──┐ ┌────┐  ┌──┐ ┌──┐ ┌────┐  ┌──┐ ┌──┐ ┌────┐
   │✔ │→│✔ │→│ ★  │  │✔ │→│▶ │ │ ★  │  │ ▢│ │ ▢│ │ ★  │
   └──┘ └──┘ └────┘  └──┘ └──┘ └────┘  └──┘ └──┘ └────┘
   SEED 7F3A-2210        ◈ 18 coins        DECK 4/8
```

Shows: act/stage progress, coins, deck size, and the **seed code** (for bug reports and sharing).
Clicking the seed copies it. The map is a between-stage checkpoint, not a branching path — branching
is deferred ([11](11-open-decisions.md)).

## 5. Onboarding ramp

Chess literacy is not assumed. The ramp is content, not a tutorial wall.

| Moment | Teaching | Mechanism |
|---|---|---|
| Run 1, Act I stage 1 | Piece movement, capture, the turn counter | Fixed set-piece template (`tpl-act1-first-steps`) with a scripted enemy; tooltip on the coin preview |
| Run 1, Act I stage 2 | Choosing who to summon, and durability | The deck holds more pieces than the summon limit; the first START is prompted with its durability cost |
| Run 1, Act I stage 3 | The first skill (Twin Step) | Granted free for Act I; card text highlighted once |
| Act I boss | Mating under turn pressure | One turn less than the rest of Act I; the coin preview's decay is highlighted once |
| Act II, stage 1 | Promotion | A spawned pawn starts close to rank 8; the result is highlighted once |
| Act II | Deckbuilding, shopping, attrition | Shop tutorial appears once, dismissible |
| First time three identical pieces are owned | Merging | The shop highlights the set and its `[MERGE]` action once |
| First plan whose preview would stalemate the enemy | Stalemate is a loss | The `STALEMATE — YOU LOSE` warning is explained once, in one sentence |
| First Rare+ piece acquired | That tier's ability | The piece card shows the ability sentence once; its first selection previews the new squares |
| Act III | Everything composes | No scaffolding |

Rules for teaching:
- **One new concept per stage.** Never two.
- **Teach by forcing, not explaining.** A prompt that requires the action beats a text box.
- **No modal tutorial longer than two sentences.** The codex holds the depth.
- **Never teach with notation.** "The knight can reach that square in one hop," not "Nf5."

## 6. Commit, undo, and honesty

| Moment | Allowed |
|---|---|
| Before COMMIT | Free, unlimited undo and reordering |
| After COMMIT, during animation | Nothing (input locked) |
| After the enemy replies | Nothing. The turn is spent. |
| Piece captured | Nothing. It is gone. |

**No takebacks.** The game's tension comes entirely from the commit being real. Any "undo turn"
feature would collapse the durability economy to zero. This is a hard design rule, not a UI choice.

| Before START | Free placement, swapping and taking back |
| After START | The deck is locked for the stage |

The only concession: **restart stage** is available. A restarted stage returns to its generated state
and the Deployment phase, *without refunding durability already paid at START* — summoning again pays
again. Restarting is for mis-clicked plans, not for scouting the enemy's replies.

## 7. Hints and chess literacy

- **Two hints per stage**, each a sentence of intent: "Your rook is doing nothing. The enemy queen
  is the only defender of f6."
- Hints **do not** name coordinates or moves.
- Hints may be disabled in a run for a discipline option (deferred; see [11](11-open-decisions.md)).
- The Codex contains a piece-movement reference with diagrams, the full rules of
  [02](02-rules-framework.md), and a searchable skill glossary.
- Algebraic notation appears nowhere in required UI; it is available as an optional overlay for
  chess-literate players.

## 8. Accessibility

| Concern | Requirement |
|---|---|
| Color blindness | Threat = icon + shape, never color alone. Deployment ranks = hatch pattern. |
| Motion | Reduced-motion setting disables piece travel animation; state changes become fades. |
| Timing | No timed inputs anywhere. |
| Keyboard | Full play without a mouse: board focus grid, arrow keys to navigate, `Enter` to select, `Q`/`E` for queue reorder, `Space` to commit. |
| Text scale | UI scales to 150% without clipping the HUD numbers. |
| Contrast | HUD numbers meet WCAG AA against the board background. |
| Screen reader | Queue entries and HUD counters are live regions; the board exposes square coordinates and occupant description. |

## 9. UX anti-patterns to avoid

- ❌ A win-condition tooltip the player must hover to discover — the only win, checkmate, is stated on the stage intro.
- ❌ Animating the enemy reply before showing the player's resolved position.
- ❌ Hiding an unaffordable price.
- ❌ Free-form "invalid move" errors without a named cause.
- ❌ A shop that pressures with a timer.
- ❌ Sorting the deck by durability (it reshuffles under the player's hand).
- ❌ Any screen where the coin preview is not visible.
- ❌ A promotion result revealed only when the pawn arrives — it is always shown in advance.
- ❌ A stalemate the player discovers only after COMMIT — the preview always says so first.
- ❌ Rarity shown by glow or by the threat/rule-breaking accent colors — rarity must never read as
  danger. Tier name plus frame shape, never color alone.
