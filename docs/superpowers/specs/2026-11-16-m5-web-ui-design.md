# M5 — Web UI Vertical Slice: Design

Status: **approved by the user 2026-11-16** (brainstorm 2026-11-16; builder check done).
Context: [docs/10 M5](../../10-roadmap-and-milestones.md#m5--web-ui-vertical-slice), the UX in
[docs/08](../../08-progression-and-ux.md), the shop screen in [docs/07 §6](../../07-shop-phase.md#6-screen-layout),
the architecture in [docs/09](../../09-technical-architecture.md), the run layer in the
[M4 spec](2026-11-13-m4-run-loop-design.md). M4 is merged into `main` (PR #1, da81786).

---

## 1. Intent

M5 puts the first browser UI on the pure run layer: `apps/web`, a React app in which **one complete run
is playable from the title screen to the run's Results**.

**Why now (user, U1):** the user is the first and, for now, only playtester. They want to *feel one
whole run*: Act I through the Act III boss, every shop, the chooser, and the Results. M5 is judged by
whether that experience works and reads clearly, not by how a stranger copes with it. Onboarding
polish, hints and a third-party playtest move to M6.

**The constraint that shapes it:** the M4 bot won 0 of 20 runs. Every loss came on a stage the solver
could not prove (an accepted M3 gap), and no run got past II-2. A human may also hit an unwinnable
stage before seeing Act III, so M5 ships a **dev "skip stage"** (U2) that keeps the run going without
changing a rule of the game.

## 2. Goals, non-goals, anti-goals

**Goals**
- `apps/web`: Title, Run Map, Stage (Deployment and Action phases), the Action Queue builder, the
  stage-end Chooser, Shop, Deck, Results and Codex, wired to `@checkbreaker/run`.
- The Stage screen's information contract of docs/08 §1–3: par and overtime bill, live coin preview,
  threats, Focus and credits, durability and skills, all visible together.
- The queue builder: click to append, drag to reorder, ghost preview of the whole queue, step-through,
  inline affordability, named commit errors and the `STALEMATE — YOU LOSE` confirm.
- Planning arrows and square marks (U8), drawn with the right mouse button.
- Stage generation in one Web Worker, off the main thread; save/resume through `localStorage`.
- The M3 carry-overs (a Node-free content entry; generation wall time measured in the browser worker)
  and the M4 "before M5" hygiene items (§9).
- Docs, data, schemas and the validator updated with every rule change (§6), per the project workflow.

**Non-goals**
- Full keyboard parity and the "full run without a mouse" criterion (moved to M6, U7). M5 has the
  shortcuts of §7.6 only.
- Hints (docs/08 §7), the one-time onboarding highlights (docs/08 §5) except the free Twin Step the run
  layer already grants, and the "third-party playtester completes Act I" criterion: all M6.
- Art and audio: M5 visuals are functional (simple SVG or glyph pieces, flat colours). Art is M6.
- Any change to generation, the solver or the proving rate.
- A backend, accounts or telemetry (docs/09 §1).

**Anti-goals** (would make M5 a failure even if it "works")
- **Any rules logic in `apps/web`.** Legality, threats, costs, payouts, stalemate detection and
  deployment validity all come from the engine or the run layer. A number the UI computes itself is a
  bug, even when it is right today.
- A coin preview that differs from the payout actually awarded (I10).
- A free-form "invalid" message: every refusal names its cause.
- `gen` (and with it the solver) imported by the main thread.
- The dev skip leaking into normal play: it is hidden unless the dev toggle is on, and a run that used
  it is marked as one everywhere it is shown.
- Planning arrows that can be confused with engine information (ghost preview, threat lines).

## 3. Constraints

- docs/09 stack: Vite, React 18, `useReducer` + Context, no global state library, Vitest, `localStorage`.
- Boundaries (docs/09 §2): the main thread imports `engine`, `run` and the Node-free `content` parsers;
  only `generation.worker.ts` imports `gen`. `run` still never imports `gen`.
- Every tuning number stays in `data/economy.yaml`. M5 adds no tuning number (§6).
- Engine and run layer stay pure and total: no I/O, no clock, typed errors, no throws on player input.
- Determinism: the same seed and actions give the same run, before and after a reload.
- Personal, non-commercial project (docs/11 H): no store, licence or monetization constraints.

## 4. Decisions

### 4.1 User decisions (this brainstorm)

| # | Decision |
|---|---|
| U1 | M5's purpose: the user plays one full run themself, to feel it. They are the only playtester for now. |
| U2 | Unwinnable stages are handled by a **dev "skip stage"** button (option B), not by retrying generation (C) or by nothing (A). |
| U3 | Scope: every screen on the roadmap, preview and step-through, named errors, stalemate warning, reduced motion, colour-blind-safe threat icons, restart stage. Hints, onboarding highlights, the third-party playtest criterion and art move to M6. Codex is short static pages. |
| U4 | Config reaches the browser through **Node-free parsers** in `content` fed with YAML text by Vite (approach 1a), not a build-time JSON snapshot (1b). |
| U5 | The board is a **DOM grid** of 64 buttons with an SVG overlay (approach 2a), not a canvas (2b). |
| U6 | **Restart stage only before the first COMMIT** (option A): back to Deployment, durability paid at START is not refunded. |
| U7 | **Mouse first.** Full keyboard play and the "run without a mouse" criterion move to M6; M5 keeps a few shortcuts (§7.6). |
| U8 | **Planning arrows** like chess.com/lichess: right-drag draws an arrow, right-click marks a square, modifiers pick a colour, a left click or COMMIT clears them. |
| U9 | The architecture (§7), the screen flow (§8), the carry-over handling (§9) and the acceptance criteria (§11) as played back in the brainstorm. |
| U10 | On restart, a piece that START took to 0 durability **stays `spent`**: shown in the tray, not placeable, removed if the stage is won (option A, after the builder check). |

### 4.2 Calls made by the designer (the user may override)

- Dev skip pays the stage's **pending base reward only**: no par bonus, no interest, no salvage (§6.2).
- `opts.replace` on a buy when the loadout has room is **refused** with a new `RunError`
  `replace_not_needed`, instead of being ignored (§9).
- `SAVE_VERSION` stays **1**: there are no saves in the wild to migrate; the new session fields are
  added to version 1.
- Generation timing is shown on a dev bench page; a miss of the M3 target is recorded as a gap, not a
  blocker (§9.2).
- Tests: Vitest + React Testing Library in jsdom; no Playwright (no browser download for a personal
  project). The generation worker is replaced by a test double in tests (§10).
- The dev toggle is a **runtime switch in every build** (stored in `localStorage` as a per-browser
  convenience, off by default), not a dev-build-only feature: there is no public deployment, and the
  user plays the production build too. Tests turn it on through the same switch.
- **COMMIT runs on the main thread.** docs/08 §6 already locks input from COMMIT until the reply has
  played, so the enemy search and `hasLegalQueue` (worst case ≈ 0.24 s, M2 notes) fall inside a
  locked moment; the app shows a "thinking" state if it takes longer than ~100 ms. Preview never calls
  the enemy search, so the 60 fps criterion is about preview only. If the browser measurement (§9.2)
  shows commits regularly over ~0.5 s, moving `commit` into a worker is an M6 item, not M5 scope.

## 5. Approaches considered

**Config in the browser.**
- **(1a) Node-free parsers, chosen.** `content` splits each loader into a pure `parse…(text)` and a
  thin Node reader. Web and worker import the YAML as text (`?raw`, `import.meta.glob`) and call the
  same parsers, so the browser validates exactly as tests and the bot do, and an edit to
  `economy.yaml` shows on refresh. Cost: the `yaml` library in the bundle (≈30 KB gzipped).
- (1b) Build-time JSON snapshot. Smaller bundle, but a derived artefact that silently goes stale when
  not rebuilt, and two load paths to keep equal. Rejected: the user will tune numbers while playing.

**Board rendering.**
- **(2a) DOM grid + SVG overlay, chosen.** Focus, labels, text scaling and screen-reader exposure come
  free; 64 elements are no load at 60 fps.
- (2b) Canvas. Freer animation, but focus, accessibility and hit-testing rebuilt from scratch, against
  docs/08 §8, for effects only art (M6) would need.

**Unwinnable stages.** (A) nothing: honest but the full run may be unreachable; (B) dev skip, chosen;
(C) regenerate until proven: changes gen, adds wall time that already misses its target, reopens an
accepted M3 gap.

**Restart.** (A) before the first COMMIT only, chosen: one rule, no scouting of enemy replies;
(B) any time with every loss kept: opens scouting and needs a rule per kind of loss; (C) defer to M6.

## 6. Rule changes (docs, data, schemas, validator)

### 6.1 Restart stage (U6)

docs/08 §6 gains the precise rule: **restart is available only in the Action phase before the stage's
first COMMIT** (`turnsUsed === 0`). It returns the stage to the state it was provided in and to the
Deployment phase. Durability paid at START stays paid; pieces that were placed return to the deck tray
with their reduced durability; a new START pays again. **A piece that START took to 0 stays `spent`
(U10):** the tray shows it but it cannot be placed, and it leaves the deck if the stage is won, exactly
as if it had played. A restart can therefore leave too few usable pieces to win the stage; that cost
is intended. Nothing else changed before the first COMMIT, so
nothing else needs a rule: no turn, overtime, salvage, capture, promotion or skill use has happened.
After the first COMMIT there is no restart.

### 6.2 Dev skip stage (U2)

A development tool, documented in docs/09 (not a player rule in docs/05):
- Available in Deployment and Action when the app's dev toggle is on.
- The stage counts as won through the same post-win path as a mate (history record, chooser when the
  deck overflows, shop, next request). The award is the stage's **pending base reward** at that moment
  (base reward less overtime already paid): no par bonus, no interest, no salvage beyond what was
  already earned. In Deployment, nothing was paid at START, so no durability changes.
- The session gets `debug: true`, kept in the save and never cleared. Results, Run Map and the save's
  resume screen show **DEBUG RUN**.

### 6.3 Data, schemas, validator

- `data/economy.yaml`: no new constant (the skip reuses the base reward; arrow colours are UI, not
  tuning).
- `schemas/run.schema.json`: unchanged (`RunState` and `History` do not change; `debug` and the entry
  stage live on `RunSession`, which `loadSave` validates, not the content schemas).
- Validator: no new rule to check. `npm run validate` and `npm run check:links` must still pass.

### 6.4 Docs touched

- **docs/08:** §6 restart rule (6.1); §8 keyboard row marked "M6: full parity; M5 ships the shortcuts of
  the M5 spec §7.6"; planning arrows added to §3.3; §5/§7 note hints and highlights land in M6.
- **docs/09:** `apps/*` in workspaces; `npm run dev`; the Node-free content entry (parsers + Node
  readers); the engine view helpers (§7.3); the worker protocol (§7.4); the `localStorage` adapter;
  `restartStage`, `devSkipStage`, `replace_not_needed`, the new session fields; the boundary allowlist.
- **docs/10:** M5 scope and acceptance replaced by §11; M1's browser enemy-timing box points to §9.3; the M6 list gains full keyboard parity, hints,
  onboarding highlights and the third-party playtest criterion.
- **docs/11:** a decision entry for the dev skip and for restart-before-first-commit.

## 7. Architecture

### 7.1 Packages and boundaries

```
apps/web/                       Vite + React 18 app (workspace "apps/*")
  src/main.tsx, App.tsx         screens, reducer, Context
  src/config.ts                 YAML text (?raw / import.meta.glob) → content parsers → RunConfig etc.
  src/storage.ts                localStorageRunStorage(): RunStorage
  src/generation.worker.ts      the only importer of @checkbreaker/gen
  src/messages.ts               CommitError / RunError / SaveError → text (exhaustive switches)
```

`packages/run/test/boundaries.test.ts` becomes an **import allowlist** for `run` and gains the same
check for `apps/web`: main-thread files may import `@checkbreaker/engine` (not `/internal`),
`@checkbreaker/run`, the Node-free `@checkbreaker/content` entry, React and the app's own files; the
worker may also import `@checkbreaker/gen`. Anything else fails the test.

### 7.2 Content: Node-free entry (M3 carry-over, U4)

`@checkbreaker/content` exposes a browser entry (for example `@checkbreaker/content/parse`) with pure
functions over text: `parseEngineConfig({ economy, pieces, skills })`, `parseRunConfig(…)`,
`parseGenConfig(…)`, `parseTemplates(files)`, `parseFormations(files)`, plus the pure helpers `gen`
needs (`solverSettingsFor`, `valueBandFor`, `enemyArmyValue`). The existing `load…` functions keep
their signatures and become a file read followed by the parser, so tests, the bot and the scripts do
not change. Nothing in the browser entry imports `node:*`; a test asserts it.

### 7.3 Engine view helpers (new, public, pure)

The UI needs answers it must not compute itself. New engine exports (`engine/src/view.ts`):
- `threatMap(run, stage, config)`: for each square, the enemy pieces attacking it (with rarity
  abilities), and for a player piece on it, the capture line that would follow. Feeds the threat
  overlay and the Deployment hover.
- `deploymentStatus(run, stage, placements, config)`: per square, whether a given deck piece may be
  dropped there and, if not, the cause (`outside_zone`, `occupied`, `king_in_check`, …); spawn points
  used and left; which tray pieces no longer fit; the START cost summary (`♖ 2→1`).
- `previewSteps(run, stage, queue, config)`: the board after each queue entry (for step-through and the
  ghost of a queue that has no move yet), each entry's affordability at its position, and the first
  failing step with its `CommitError`. When the queue is complete it also carries `simulate`'s result,
  so the ghost, the end-state verdict (`enemy_stalemated`) and the award come from the same code path
  as `commitQueue` (I10).
- `hudEconomy(run, stage, config)`: the par, free turns left, overtime per turn and what is left to pay
  it, and the next-turn coin potential when the queue has no mate (docs/08 §3.1).

Existing exports already cover legal destinations (`legalPlayerMoves`) and costs (`spawnCostOf`,
`durabilityMaxOf`). Each helper gets unit tests, and a property test that `previewSteps`' final result
equals `simulate` for complete queues.

### 7.4 Generation worker

- The main thread posts `{ id, request: GenRequest }`; the worker answers
  `{ id, ok: true, stage, provenance, ms }` or `{ id, ok: false, message }`. `ms` is measured inside the
  worker around `generateStage` (the worker may read a clock; `gen` itself never does).
- The app posts a request whenever the session has `next.request` and `next.stage === null`, and hands
  the answer to `provideStage`. A stale answer (session moved on) is dropped by `id`.
- Generation overlaps the stage's Results and the shop; if the player leaves the shop first, the
  session is in `awaiting_stage` and the app shows "Building the next stage…" until it arrives.
- Worker failure: the app shows the message and a Retry button; the session is untouched.

### 7.5 State and persistence

- One `RunSession` in a `useReducer`. Each player action calls the matching `@checkbreaker/run`
  function; `ok` replaces the session and autosaves; an error is shown through `messages.ts` and the
  session is unchanged.
- Transient UI state is not saved: the queue being built, Deployment placements before START, the
  step-through position, planning arrows, open overlays.
- `localStorageRunStorage()` implements `RunStorage` with key `checkbreaker.save.1`. On launch: a valid
  save offers **Continue**; a save `loadSave` refuses shows its `SaveError` message once, with
  **New run** (which clears it). `savedAt` comes from the app.
- `RunSession` gains `debug?: true` (§6.2) and `entryStage: StageState | null` (the stage as provided,
  for restart). `loadSave` validates both.

### 7.6 Input

Mouse first (U7):
- **Deployment:** drag from the tray to a square (or click a tray piece, then a square); drag back or
  elsewhere to move; dimmed tray pieces show why.
- **Action:** click a piece, then a highlighted destination, to append a move; click a skill card,
  then its target, to append an activation; drag queue entries to reorder; click an entry to remove it.
- **Planning arrows (U8):** right-drag square to square draws an arrow; right-click a square marks it;
  Shift / Ctrl / Alt while drawing pick one of four colours (none = default); repeating the same arrow
  or mark removes it; a left click on the board or a COMMIT clears all. Drawn dashed in their own
  palette, under the ghost preview and never in the threat accent colours. Not saved.
- **Shortcuts:** `Space` COMMIT, `Z` undo the last queue entry, `←`/`→` step through the preview,
  `C` Codex, `D` Deck, `Esc` close an overlay or cancel a selection.
- Reduced motion (a setting, defaulting to the OS preference) turns piece travel into fades. No
  animation blocks input except the committed turn's playback, which a click or `Space` skips.

## 8. Screens and flow

```
Title (Continue / New run [seed]) → Run Map → Deployment → Action
  → (win) stage Results → Chooser (non-king deck > 8) → Shop → Run Map → …
  → (loss, abandon, or the Act III boss won) run Results
Deck and Codex: overlays reachable from any screen
```

- **Title:** Continue (with DEBUG RUN when flagged), New run with an optional seed, a dev toggle.
- **Run Map:** docs/08 §4: act and stage progress, coins, deck size, seed code (click copies).
- **Deployment:** docs/08 §3.2/§3.4: tray with durability pips and rarity frames, spawn counter, tinted
  and hatched deployment ranks, threat hover, invalid squares with their cause, spawned pawns'
  promotion results, START with its durability summary, `MATE IN X`. Dev: Skip stage.
- **Action:** HUD of docs/08 §3.2 (par and pips, coin preview with `LAST PAR TURN` and the overtime
  bill, salvage, Focus, credits, skills), the queue strip, ghost preview and step-through, named
  errors, the stalemate confirm, COMMIT, UNDO, Restart (only while `turnsUsed === 0`). Dev: Skip stage.
  After COMMIT the player's resolved position is shown before the enemy reply is animated.
- **Stage Results:** the award broken down (base, par bonus, interest, salvage), pieces lost.
- **Chooser:** the over-capacity count and the deck with merge / sell / cut until it fits.
- **Shop:** docs/07 §6: four offers plus repair, reroll (cost and remaining shown), merge, sell, the
  next-stage board preview without its par, Leave. The recovery offer reads as live only while
  `shop.recovery && !shop.slots[0].sold`. Buying a skill with a full loadout asks which slot to replace.
- **Deck overlay:** every piece with rarity, durability, status and ability sentence, in a stable
  order (never sorted by durability, docs/08 §9).
- **Run Results:** won or lost, the end reason, stages cleared, coins, history, seed; DEBUG RUN when
  flagged; New run.
- **Codex:** static pages: piece movement (including rarity abilities from `pieces.yaml`), the core
  rules of docs/02 in short form, and a skill glossary built from `skills.yaml`.
- **Dev bench (`/#bench`):** §9.2.

## 9. Carry-overs

### 9.1 From M4 (`packages/run`)

- Exhaustiveness checks for the hand-copied enum lists in `save.ts` (a type-level check that each list
  covers its union, so a new variant fails typecheck).
- `loadSave` rebuilds the session from the fields it checked, dropping unknown keys, so deep nesting in
  an unknown key can no longer make a later `serializeSave` throw (test with a deeply nested unknown
  key).
- `boundaries.test.ts` becomes an import allowlist (§7.1).
- `buy` with `opts.replace` while the loadout has room is refused with
  `{ kind: 'replace_not_needed' }`.
- The UI treats the recovery offer as live only when `recovery && !slots[0].sold` (§8).
- `localStorage` sits behind `RunStorage` (§7.5).
- New run-layer functions: `restartStage(s, c)` (§6.1; `wrong_phase` outside Action, a new
  `RunError` `{ kind: 'restart_unavailable' }` once a turn was committed) and `devSkipStage(s, c)`
  (§6.2), each with tests including a save round trip.

### 9.2 From M3

- The Node-free content entry (§7.2).
- **Generation wall time in the browser:** the dev bench page runs N stages per template (default 10,
  fixed deck per act as in `gen:report`) through the same worker and shows median and p95 per template.
  The figures are recorded in docs/10 M5. A miss of median ≤ 3 s / p95 ≤ 15 s is recorded as a gap and
  does not block M5.

### 9.3 From M1

- **Enemy search in the browser:** docs/10 M1's open box ("depth-4 enemy move < 50 ms in the browser",
  open until M5) is closed in M5. The bench page also times `enemyMove` on the golden-position suite and
  the rarity bench boards, on the main thread, and shows median and max. The figures are recorded in
  docs/10 M1; a miss is recorded as a gap (the depth-3 rarity cap already exists) and does not block M5.

## 10. Testing

- Engine view helpers: unit tests and the `previewSteps` = `simulate` property test (§7.3).
- Run layer: the §9.1 items, `restartStage`, `devSkipStage`, save round trips.
- Content: parsers produce configs deep-equal to the Node loaders' on the repo data; the browser entry
  imports no `node:*`.
- `apps/web` (Vitest + React Testing Library, jsdom). The generation worker sits behind a small
  `StageSource` interface; tests use a double that builds small hand-made stages carrying the expected
  `stageSeed` (as `packages/run/test/fixtures.ts` already does), so `npm test` never runs the solver
  and no generated snapshot is committed. Real generation is covered by `gen`'s own tests and the bench.
  - a **full-run test** that starts a run and, clicking only, plays it to the run Results with dev skip;
  - the HUD coin preview equals the award on a mating commit (several stages, including overtime and
    interest);
  - `messages.ts` gives a distinct, cause-naming text for every `CommitError`, `RunError` and
    `SaveError` variant (exhaustive switch + a test that no two texts are equal);
  - restart and skip buttons appear only when allowed;
  - the recovery offer's live state;
  - a corrupt save shows its message and New run.
- Boundary allowlist test (§7.1).

## 11. Acceptance criteria (replaces the docs/10 M5 list)

- [ ] A full run can be played in the browser from the title screen to the run Results (automated
      full-run test, dev skip allowed).
- [ ] **The user completes one full run in the browser** (dev skip allowed).
- [ ] The coin preview in the HUD always equals the payout actually awarded (engine I10 + UI test).
- [ ] Every `CommitError`, `RunError` and `SaveError` variant surfaces a distinct, cause-naming message.
- [ ] No rules logic exists in `apps/web` (import allowlist test + code review).
- [ ] 60 fps during queue preview on a mid-range laptop; no animation blocks input (manual check,
      recorded).
- [ ] Generation runs only in the Web Worker; its browser wall times (median, p95 per template) are
      recorded in docs/10.
- [ ] The browser enemy-search timing (M1's open box) is measured and recorded in docs/10.
- [ ] Every M4 "before M5" item of §9.1 is done and tested.
- [ ] `npm test`, `npm run typecheck`, `npm run validate` and `npm run check:links` pass.

Moved to M6: "a full run can be completed without touching a mouse" and "a third-party playtester
completes Act I of a first run without verbal instruction".

## 12. Left to the builder

- Component structure, styling approach and file layout inside `apps/web`.
- The exact shapes of the §7.3 view-helper results, as long as the UI computes no rule.
- Piece graphics (simple SVG or glyphs) and the arrow palette, within §7.6's constraints.
- Animation timings; how drag-and-drop is implemented.
- The bench page's layout and its default N.
- Codex wording.
