# Placement Clue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free **Show a winning setup** button to Deployment. It reveals the solver's proven deployment (every piece's square, the King included) as ghost pieces. The button is disabled on stages the solver could not prove.

**Architecture:** The generation worker already gets the solver's `solution` back from `generateStage` and throws it away. Instead, it now sends `solution.placements` (never the move line) as `clue`.

- **Run layer:** `provideStage` resolves each clue entry's piece type and rarity from the request's deck snapshot. It keeps the clue in `next.clue` (shop) or moves it into `RunSession.clue` when Deployment begins. The clue is saved and validated like the rest of the session.
- **Web:** the Deployment screen only draws the stored data through a new board overlay layer.

**Tech Stack:** TypeScript npm workspaces (`packages/run`, `apps/web`), React 18, Vite 8, Vitest 5 (jsdom), Testing Library.

**Spec:** [docs/superpowers/specs/2026-11-25-placement-clue-design.md](../specs/2026-11-25-placement-clue-design.md) (decisions C1–C7).

## Global Constraints

- Work on branch `M5.1` in the worktree `D:\art\.claude\worktrees\M5`. Commit after each task. Never push or merge.
- Stage files by explicit path only. **Never stage `deepseek-subagent/` or `.superpowers/`.**
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No rules logic in `apps/web`: the UI only draws the clue. `apps/web/test/boundaries.test.ts` must stay green.
- `SAVE_VERSION` stays `2` and the storage key stays `checkbreaker.save.1`.
- The clue is free: it changes no coins, no award and no `deploymentStatus` verdict. The player places every piece; nothing is auto-placed.
- The solution's move line (`solution.line`) never leaves the worker. The UI shows no moves (C7).
- **Copy:**
  - The button reads `Show a winning setup` when the clue is hidden and `Hide the winning setup` when it is shown.
  - On an unproven stage the button is disabled, with `No proven solution for this stage.`, followed by ` Use Skip stage (dev) if you are stuck.` only when the dev toggle is on (the Skip button exists only then).
  - The labels on a clue square are `you no longer have this piece` (instance not in the deck) and `this piece is spent` (instance status `spent`).
- `npm test`, `npm run typecheck`, `npm run validate`, `npm run check:links` and `npm run build` pass, and the main chunk stays under 250 KB gzip.

## Plan calls beyond the spec

These are my calls, made while planning; the user can overturn any of them.

1. **Clue entries carry the piece's type and rarity**, copied from the request's deck snapshot when `provideStage` runs: `ClueSquare = { instanceId, to, pieceType, rarity? }`. The spec asks for ghosts of a sold piece's type and rarity, but the snapshot (`next.request.run`) is gone once Deployment begins. Copying the two fields keeps the UI free of lookups.
2. **An entry naming an instance missing from the snapshot makes the whole clue `null`.** This cannot happen with a real solver answer; this way the button falls back to its disabled state instead of drawing half a setup.
3. **A version-2 save without the `clue` keys loads them as `null`.** It is not refused, so a save from the user's M5.1 replay survives this change.
4. **A clue piece that START spent (and that `restartStage` brought back) is labelled `this piece is spent`.** This sits beside the spec's `you no longer have this piece`.
5. **The second sentence of the disabled text appears only with the dev toggle on**, since the Skip stage button exists only then.

## Review Focus

1. **A clue piece that START spent, then `restartStage`.** Its clue square stays marked and is labelled `this piece is spent`, so the player knows why it cannot be followed (Task 3 test).
2. **A clue piece sold in the shop before the worker answered.** The entry still resolves (from the request's snapshot deck, not the live deck), reaches Deployment, and is labelled `you no longer have this piece` (Task 1 and Task 3 tests).
3. **A version-2 save written before this change (no `clue` keys).** It loads with `clue: null` and `next.clue: null` instead of being refused (Task 1 test).
4. **A reload in the middle of Deployment.** The clue comes back from the save without asking the worker again (Task 2 test).
5. **A clue square the player already filled with a different piece.** The player's piece is shown; the square's label still names the clue piece, and the clue changes no tray or drop verdict (Task 3 test).

---

### Task 1: Run layer — store, carry and save the clue

**Files:**
- Modify: `packages/run/src/types.ts` (new types, `RunSession.clue`, `next.clue`)
- Modify: `packages/run/src/session.ts` (`newRun`, `enterDeployment`, `provideStage`, `leave`, `finishWin`, `proceed`, `endRun`)
- Modify: `packages/run/src/save.ts` (`checkSession`, new `checkClue`)
- Modify: `packages/run/test/bot-policy.test.ts`, `packages/run/test/dev-skip.test.ts`, `packages/run/test/session.test.ts` (add `clue: null` to hand-built `RunSession` / `next` literals so typecheck passes)
- Modify: `docs/09-technical-architecture.md` lines 118–123 (the clue entries carry type and rarity; `next.clue`)
- Create: `packages/run/test/clue.test.ts`
- Modify: `packages/run/test/save.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // packages/run/src/types.ts
  export type CluePlacement = { instanceId: string; to: Square };
  export type ClueSquare = CluePlacement & { pieceType: PieceInstance['pieceType']; rarity?: Rarity }; // rarity absent for the King
  RunSession.clue: ClueSquare[] | null;
  RunSession.next: { request: GenRequest; stage: StageState | null; clue: ClueSquare[] | null } | null;
  // packages/run/src/session.ts
  export function provideStage(s: RunSession, stage: StageState, c: RunConfig, clue: CluePlacement[] | null = null): RunResult;
  ```
- Behaviour later tasks rely on:
  - In `deployment` and `action`, `session.clue` is the resolved clue, or `null` for an unproven stage.
  - In every other phase it is `null`.

- [ ] **Step 1: Write the failing run-layer tests** in `packages/run/test/clue.test.ts`.
  - Use `newRun('7F3A-2210', runConfig)` and `mateInOneStage(seed)` from `./fixtures`.
  - Copy the small `value`/`seedOf` helpers from `session.test.ts`.
  - `CLUE` is `[{ instanceId: 'p_king_01', to: 'e1' }, { instanceId: 'p_bishop_04', to: 'a3' }]`.
  - Tests:
    - `provideStage in awaiting_stage resolves the clue into session.clue`:
      ```ts
      expect(s.phase).toBe('deployment');
      expect(s.clue).toEqual([
        { instanceId: 'p_king_01', to: 'e1', pieceType: 'king' },
        { instanceId: 'p_bishop_04', to: 'a3', pieceType: 'bishop', rarity: 'normal' },
      ]);
      ```
    - `provideStage without a clue gives clue null`: calling it with three arguments gives `s.clue === null`.
    - `a clue naming an instance missing from the request deck becomes null`: `[{ instanceId: 'p_nope_99', to: 'e1' }]` gives `s.clue === null`, and the phase is still `deployment`.
    - `start and restartStage keep the clue`:
      - `start` with `CLUE`'s placements gives `phase === 'action'` and the same `clue`;
      - `restartStage` gives `phase === 'deployment'` and the same `clue`.
    - `the clue is cleared when the stage ends`:
      - after `devSkipStage`, `clue === null` and `next.clue === null` (shop);
      - after `abandon` from Deployment, `clue === null`.
    - `in the shop the clue waits in next.clue and survives a sale made before the worker answered`:
      1. `devSkipStage` to reach the shop.
      2. `sell(s, 'p_bishop_04', c)`.
      3. `provideStage(s, mateInOneStage(seedOf(s)), c, CLUE)`. Expect `phase === 'shop'`, `s.clue === null`, and `s.next.clue` holding the bishop entry with `pieceType: 'bishop'`.
      4. `leave`. Expect `phase === 'deployment'`, `s.next === null`, `s.clue` equal to the shop's `next.clue`, and `s.run.deck.some(p => p.instanceId === 'p_bishop_04') === false`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run packages/run/test/clue.test.ts`
  Expected: FAIL. The tests do not compile against the current types, or `clue` is `undefined`.

- [ ] **Step 3: Implement the run layer.**
  - **Types:**
    - Add `CluePlacement`, `ClueSquare`, `RunSession.clue` and `next.clue` as in Interfaces.
    - Doc comment for `RunSession.clue`: "The solver's proven deployment for the current stage (M5.1 placement clue); null for an unproven stage and outside deployment/action."
  - **`provideStage(s, stage, c, clue = null)`:**
    - After the existing checks, resolve each entry against `next.request.run.deck`: copy the instance's `pieceType`, and its `rarity` only when the instance has one.
    - Any entry whose instance is missing from that deck makes the whole resolved clue `null`.
    - In awaiting_stage, pass the resolved clue to `enterDeployment`.
    - In the shop, store `{ ...next, stage, clue: resolved }`.
  - **`enterDeployment(s, request, stage, clue, c)`:** sets `clue` beside `stage`/`entryStage`.
  - **`leave`:** passes `s.next.clue`.
  - **Clearing:**
    - `newRun` and `proceed` build `next` with `clue: null`;
    - `newRun` sets `clue: null`;
    - `finishWin` and `endRun` set `clue: null` wherever they null `stage`/`entryStage`;
    - `start` and `restartStage` leave `clue` untouched.
  - **Test literals:** add `clue: null` to the hand-built `RunSession` and `next` literals in the three test files listed above.

- [ ] **Step 4: Run the run-layer tests**

  Run: `npx vitest run packages/run`
  Expected: PASS (all run tests, including the existing ones, which now carry `clue: null`).

- [ ] **Step 5: Write the failing save tests** in `packages/run/test/save.test.ts`.
  - Use the file's `saveWith`, `refusal` and `loaded` helpers.
  - The base session is a Deployment session made with `provideStage(newRun(SEED, c), mateInOneStage(seed), c, [{ instanceId: 'p_king_01', to: 'e1' }])`.
  - Tests:
    - `a clue round-trips through the save`: `loaded(serializeSave(s))` deep-equals `s`.
    - `a save without clue keys loads with null clues (version 2 saves written before the clue)`:
      - delete `x.session.clue` and give `clue: null`;
      - do the same for `x.session.next.clue` on a shop session.
    - `loadSave refuses a malformed clue`, one `refusal(...)` per edit. Each gives `{ kind: 'invalid_session' }` with `detail` matching `/session\.clue/`:
      - `instanceId: 7`
      - `to: 'e5'` (outside `rules.deploymentRanks`)
      - `to: 'z9'`
      - `pieceType: 'pawn'`
      - `rarity: 'shiny'`
      - two entries with the same `instanceId`
      - two entries on the same square
      - `clue` not an array
    - `loadSave refuses a clue outside deployment and action`: a shop session with `x.session.clue = [entry]` gives `detail` containing `session.clue: must be null in phase shop`.
    - `loadSave refuses a malformed next.clue`: a shop session with `x.session.next.clue = [{ ...entry, to: 'e5' }]` gives `detail` matching `/session\.next\.clue/`.

- [ ] **Step 6: Run them to see them fail**

  Run: `npx vitest run packages/run/test/save.test.ts`
  Expected: FAIL. The clue is dropped on load (the checkers rebuild only known keys), and nothing is refused.

- [ ] **Step 7: Implement `checkClue(v: unknown, path: string, c: RunConfig): ClueSquare[]` in `save.ts`.**
  - Build it from the existing helpers:
    - `arr`, `obj`, `str`;
    - `isSquare` plus `c.rules.deploymentRanks` for `to`;
    - `oneOf(..., INSTANCE_TYPES)` for `pieceType`;
    - `put(..., tier)` for an optional `rarity`.
  - Duplicate `instanceId` or `to` gives `bad(path, ...)`.
  - In `checkSession`, read both `session.clue` and `next.clue` as: an absent key gives `null`, otherwise `nullable(..., checkClue)`.
  - Add the invariant beside the `entryStage` one: outside deployment/action, a non-null `session.clue` gives `session.clue: must be null in phase ${phase}`.

- [ ] **Step 8: Run the run-layer tests and typecheck**

  Run: `npx vitest run packages/run` then `npm run typecheck`
  Expected: PASS, and typecheck clean. `apps/web` still compiles: its `provideStage` call has three arguments.

- [ ] **Step 9: Update docs/09** lines 118–123 so they state all of the following:
  - the worker's `clue` is `{ instanceId, to }[]` or `null`;
  - `provideStage` resolves each entry's `pieceType` and `rarity` from the request's deck snapshot (a missing instance gives `null`) and keeps the result in `next.clue` while in the shop;
  - `RunSession.clue` entries are `{ instanceId, to, pieceType, rarity? }`;
  - a version-2 save without the keys loads them as `null`.

  Then run `npm run check:links` and expect 0 broken links.

- [ ] **Step 10: Commit**

  ```bash
  git add packages/run/src/types.ts packages/run/src/session.ts packages/run/src/save.ts packages/run/test/clue.test.ts packages/run/test/save.test.ts packages/run/test/bot-policy.test.ts packages/run/test/dev-skip.test.ts packages/run/test/session.test.ts docs/09-technical-architecture.md
  git commit -m "feat(run): carry and save the placement clue (M5.1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  (`packages/run/src/index.ts` re-exports `./types` with `export *`, so the new types need no export edit.)

---

### Task 2: Web plumbing — worker, StageSource, store, test double

**Files:**
- Modify: `apps/web/src/state/stageSource.ts` (`StageAnswer.clue`, new `clueOf`)
- Modify: `apps/web/src/state/generation.worker.ts:34`
- Modify: `apps/web/src/state/store.tsx:128`
- Modify: `apps/web/test/doubles.ts` (`testStageSource` returns a clue)
- Modify: `apps/web/test/bench.test.tsx:26` (add `clue: null`)
- Test: `apps/web/test/doubles.test.ts`, `apps/web/test/store.test.tsx`

**Interfaces:**
- Consumes: `CluePlacement`, `provideStage(s, stage, c, clue)`, and `RunSession.clue` from Task 1.
- Produces:
  ```ts
  // apps/web/src/state/stageSource.ts
  export type StageAnswer =
    | { id: number; ok: true; stage: StageState; provenance: unknown; ms: number; clue: CluePlacement[] | null }
    | { id: number; ok: false; message: string };
  /** The placements only: a fresh `{ instanceId, to }` per entry, so nothing else of the solution (its move line) is posted. */
  export function clueOf(solution: { placements: CluePlacement[] } | null): CluePlacement[] | null;
  ```
- `testStageSource()` returns `clue: STARTER_MATE.placements` for stage 0 (act 0, stage 0) and `clue: null` for every other stage, so tests see both a proven and an unproven stage.

- [ ] **Step 1: Write the failing tests.**
  - In `doubles.test.ts` (or a new `apps/web/test/stageSource.test.ts`):
    - `clueOf keeps only instanceId and to`:
      ```ts
      expect(clueOf(null)).toBeNull();
      const out = clueOf({ placements: [{ instanceId: 'p_king_01', to: 'e1', extra: 1 } as never], line: [[]] } as never);
      expect(out).toEqual([{ instanceId: 'p_king_01', to: 'e1' }]);
      expect(Object.keys(out![0]!)).toEqual(['instanceId', 'to']);
      ```
    - `testStageSource gives stage 0 the starter clue and later stages none`.
  - In `store.test.tsx`:
    - `the source's clue reaches session.clue`: after `continue` into stage 0, `api.session!.clue` equals `STARTER_MATE.placements` with `pieceType` `'king'` / `'bishop'` (bishop `rarity: 'normal'`).
    - `a reload in Deployment keeps the clue without a new request`:
      1. Save the Deployment session from the previous test's flow.
      2. Re-render `RunProvider` over the same storage with a `StageSource` whose `request` throws.
      3. Dispatch `continue`.
      4. Expect `api.session!.phase === 'deployment'` and `api.session!.clue` deep-equal to the saved one.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run apps/web/test/doubles.test.ts apps/web/test/store.test.tsx`
  Expected: FAIL (`clueOf` is not exported; `clue` is null).

- [ ] **Step 3: Implement the plumbing.**
  - `clueOf` and the `StageAnswer` field go in `stageSource.ts`, which imports the `CluePlacement` type from `@checkbreaker/run`.
  - The worker answers with `clue: clueOf(out.solution)`.
  - `store.tsx` calls `provideStage(sessionRef.current!, answer.stage, runConfig, answer.clue)`.
  - `testStageSource` returns `clue: STARTER_MATE.placements` for stage 0 and `null` otherwise.
  - `bench.test.tsx` adds `clue: null` to its literal answer.
  - `workerSource.ts` needs no change (it forwards `StageAnswer` whole). Confirm that by typecheck.

- [ ] **Step 4: Run the web tests and typecheck**

  Run: `npx vitest run apps/web` then `npm run typecheck`
  Expected: PASS, including `boundaries.test.ts`.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/state/stageSource.ts apps/web/src/state/generation.worker.ts apps/web/src/state/store.tsx apps/web/test/doubles.ts apps/web/test/doubles.test.ts apps/web/test/store.test.tsx apps/web/test/bench.test.tsx
  git commit -m "feat(web): pass the solver's placements from the worker to the run (M5.1 clue)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  (Add `apps/web/test/stageSource.test.ts` instead of `doubles.test.ts` if the test went there.)

---

### Task 3: Deployment UI — the button and the clue layer

**Files:**
- Modify: `apps/web/src/board/Board.tsx` (`Overlays.clue`, the clue glyph and label per square)
- Modify: `apps/web/src/screens/Deployment.tsx` (button, disabled text, building the clue marks)
- Modify: `apps/web/src/styles.css` (a `--clue` colour token for light and dark, `.clue-ghost` styling)
- Test: `apps/web/test/board.test.tsx`, `apps/web/test/deployment.test.tsx`

**Interfaces:**
- Consumes:
  - `RunSession.clue: ClueSquare[] | null` from Task 1;
  - `testStageSource` from Task 2 (stage 0 has the clue `p_king_01@e1`, `p_bishop_04@a3`; later stages have `null`).
- Produces:
  ```ts
  // apps/web/src/board/Board.tsx
  /** A ghost of a piece the solver's proven setup puts here (the placement clue). `note` is appended to the square's aria-label. */
  export type ClueMark = { square: Square; piece: BoardPiece; note?: string };
  Overlays.clue?: ClueMark[];
  ```
- **Board rendering:**
  - Each clue square gets a translucent `PieceGlyph` in a `.clue-ghost` element carrying `data-clue` (the piece type).
  - The element sits under any real or planned piece on that square.
  - The square's aria-label gains `clue: ${describeOccupant(piece)}`, then `, ${note}` when a note is set.
  - The clue colour (`--clue`) must differ from `--highlight`, `--threat` and the plan colours. The exact hue is the builder's call (spec, Left to the builder).

- [ ] **Step 1: Write the failing board test** in `board.test.tsx`:
  - `the clue overlay draws a ghost and names it in the label`:
    1. Render `<Board stage={{ board: {} }} overlays={{ clue: [{ square: 'a3', piece: { pieceType: 'bishop', color: 'white', rarity: 'normal' }, note: 'you no longer have this piece' }] }} />`.
    2. Expect the `a3` button's aria-label to contain `clue: white bishop` and `you no longer have this piece`.
    3. Expect the square to contain an element with `data-clue="bishop"`.

- [ ] **Step 2: Write the failing Deployment tests** in `deployment.test.tsx`, using the file's `setup()` (stage 0, proven).
  - `Show a winning setup marks every clue square`:
    1. Click the button named `Show a winning setup`.
    2. Expect `square('e1')` to have an aria-label containing `clue: white king` and `square('a3')` one containing `clue: white bishop`. This is `describeOccupant`'s wording: `PIECE_NAME` is lowercase, and a Normal tier adds nothing.
    3. Expect the button's name to be `Hide the winning setup` and `aria-pressed="true"`.
    4. Click it again; the clue labels are gone.
  - `the clue changes no verdict and places nothing`:
    1. Record the `spawn-counter` text and the START button's disabled state.
    2. Show the clue. The counter text is equal, START is still disabled, and no tray piece shows the `placed` reason.
    3. Drop the rook on e1. The square shows the rook (the player's piece wins). Its label still contains `clue: white king`. The counter moves by the rook's cost, as in the existing rook test.
  - `following the clue reaches the Action phase`: place `p_king_01` on e1 and `p_bishop_04` on a3 (select, then click the square), press START, and expect `api.session!.phase === 'action'`.
  - `an unproven stage disables the button and says why`:
    1. Use a source whose stage-0 answer has `clue: null`, wrapping `testStageSource()`.
    2. The button is disabled.
    3. With the dev toggle off, the text `No proven solution for this stage.` is shown and `Use Skip stage (dev)` is not.
    4. With `localStorage.setItem(DEV_KEY, '1')`, the full sentence `No proven solution for this stage. Use Skip stage (dev) if you are stuck.` is shown.
  - `a sold clue piece is labelled`:
    1. Build a Deployment session with `provideStage(newRun('7F3A-2210', runConfig), starterMateStage(expectedSeed('7F3A-2210', 0, 0)), runConfig, STARTER_MATE.placements)`.
    2. Remove `p_bishop_04` from `session.run.deck`.
    3. Write it with `serializeSave`, render, and `continue`.
    4. After showing the clue, `square('a3')`'s label contains `you no longer have this piece`.
  - `a clue piece spent by START is labelled after a restart`:
    1. Same construction, but set the bishop's `status: 'spent'` and `durability: 0` instead of removing it.
    2. After showing the clue, `square('a3')`'s label contains `this piece is spent`.

- [ ] **Step 3: Run them to see them fail**

  Run: `npx vitest run apps/web/test/board.test.tsx apps/web/test/deployment.test.tsx`
  Expected: FAIL (no clue overlay, no button).

- [ ] **Step 4: Implement the overlay and the button.**
  - **Deployment state:** `showClue` (default `false`, reset when the stage changes).
  - **Building the marks (display only):** for each `session.clue` entry, make a `ClueMark`:
    - `square`: the entry's `to`;
    - `piece`: `{ pieceType, color: 'white', rarity? }` from the entry;
    - `note`: `you no longer have this piece` when no deck instance has the `instanceId`, `this piece is spent` when that instance's status is `spent`, and nothing otherwise.
  - Pass them as `overlays.clue` only while `showClue`.
  - Put the button and the disabled text in the side panel above START (the placement is the builder's call).
  - No `deploymentStatus`, `threatMap` or `placements` input changes because of the clue.

- [ ] **Step 5: Run the web tests and typecheck**

  Run: `npx vitest run apps/web` then `npm run typecheck`
  Expected: PASS, including `boundaries.test.ts` and the existing Deployment tests.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/web/src/board/Board.tsx apps/web/src/screens/Deployment.tsx apps/web/src/styles.css apps/web/test/board.test.tsx apps/web/test/deployment.test.tsx
  git commit -m "feat(web): Show a winning setup on Deployment (M5.1 placement clue)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: Acceptance and docs

**Files:**
- Modify: `docs/10-roadmap-and-milestones.md` (tick the "Placement clue" box, ~line 485, with evidence)

**Interfaces:**
- Consumes: Tasks 1–3 committed.

- [ ] **Step 1: Run the full gate**

  Run each, in order: `npm test`, `npm run typecheck`, `npm run validate`, `npm run check:links`, `npm run build`.
  Expected:
  - every test passes (write down the file and test counts);
  - typecheck is clean;
  - the validator reports 0 failures (write down the check count);
  - 0 broken links;
  - the build's main chunk is under 250 KB gzip (write down the size).

  If `bulk.test.ts` times out under parallel load, re-run it alone: its 240 s limit is ruling R9.

- [ ] **Step 2: Tick the docs/10 box**

  Change `- [ ] Placement clue:` to `- [x] Placement clue:`. Under it, add one evidence line in the style of the M5.1 boxes above it: the commit range, the test and file counts, the validator count, links, and the chunk size with today's date.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/10-roadmap-and-milestones.md
  git commit -m "docs: placement clue acceptance" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
