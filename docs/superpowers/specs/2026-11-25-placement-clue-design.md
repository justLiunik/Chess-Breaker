# Placement clue — short design (M5.1 addition)

Status: approved by the user 2026-11-25. Branch: `M5.1` (PR #3, open; added there so the user's replay
can use it).

## Why

The user, the only playtester, cannot find mates with knights and bishops from a blank deployment.
A clue that shows where the pieces go in a setup that is proven to mate lets them get through a stage
and learn the pattern.

## Decisions

| # | Decision | Source |
|---|---|---|
| C1 | The Deployment screen gets a **"Show a winning setup"** button. One click marks the square of every piece in the solver's proven deployment, all at once. | User, 2026-11-25 (option A) |
| C2 | The clue is **free**: no coins, no effect on the award. | User, 2026-11-25 (option 1) |
| C3 | The marks are translucent ghost pieces in their own clue colour, distinct from the threat colours, the plan arrows and the rule accents. The player still places every piece; there is no auto-place. | My call |
| C4 | A stage the solver could not prove (`generateStage` returned no solution; about 3% of stages in M5.1's `gen:report`) disables the button and says why: "No proven solution for this stage. Use Skip stage (dev) if you are stuck." | My call |
| C5 | The solution is solved against the deck as the shop opened. If a piece the clue uses is no longer in the deck because it was sold, cut or merged, its square is still marked, labelled "you no longer have this piece". | My call (matches docs/07: "the preview is proven against the deck the shop opened with") |
| C6 | The clue is stored with the session and in the save, so it survives a reload. It is never recomputed, since that would cost seconds and need every generation input. | My call |
| C7 | Move hints stay out. docs/08's "no auto-solver, no 'hint: play Rxf7'" still holds for moves; only the placement is revealed. Intent hints remain M6. | User intent; my wording |

## Approaches

- **Pass the solver's solution through (chosen).** The worker already gets `solution` back from
  `generateStage` and throws it away. Instead, it sends the placements with the stage; the run
  session stores them; the Deployment screen draws them. This is cheap and exact.
- **Recompute on click.** Runs the solver again in the worker when the button is pressed. It is
  slower (seconds), needs the full generation inputs on demand, and would give the same answer.
  Rejected.

## What changes

- **Worker protocol (docs/09):** the answer becomes `{ id, ok: true, stage, provenance, ms, clue }`.
  `clue` is `solution.placements` (`{ instanceId, to }[]`, the King included), or `null` when the
  stage is unproven. The solution's move line is not sent.
- **Run layer:**
  - `provideStage(s, stage, c, clue?)` stores the clue beside `next.stage`;
  - entering Deployment moves it to `RunSession.clue: { instanceId: string; to: Square }[] | null`;
  - it is cleared wherever `stage` and `entryStage` are cleared, and kept by `restartStage`;
  - `loadSave` validates it: `instanceId` is a string, `to` is a square on deployment ranks 1–4, and
    there are no duplicates;
  - the save stays version 2, because version 2 has not shipped yet (PR #3).
- **Web:**
  - the Deployment button;
  - the clue layer on the board (ghost glyphs of the clue pieces' type and rarity, taken from the run
    deck for instances still present and from the deck snapshot otherwise);
  - the disabled state and its text;
  - a "you no longer have this piece" label for missing instances.

  No rules logic is involved: the UI only draws the data.
- **Test double:** `testStageSource` can return a clue.
- **Docs:**
  - docs/08 §6–7: placement clue allowed, moves still intent-only;
  - docs/09: worker protocol and `RunSession.clue`;
  - docs/10: M5.1 scope and an acceptance box;
  - docs/11: a decision entry.

## Acceptance

- The worker and `StageSource` pass the clue. An unproven stage gives `null`.
- The run layer stores the clue, keeps it across `restartStage` and save/load, clears it on stage
  end, and `loadSave` refuses a malformed clue.
- Web:
  - the button marks every clue square with the right piece;
  - it is disabled with the reason on an unproven stage;
  - a sold piece's square is labelled;
  - the marks do not change any `deploymentStatus` verdict.
- `npm test`, `typecheck`, `validate`, `check:links` and `build` pass, and the main chunk stays under
  250 KB gzip.

## Left to the builder

The exact clue colour and label wording, the button placement on the Deployment screen, and how the
King's clue square is drawn.
