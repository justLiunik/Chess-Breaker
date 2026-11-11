# Stage templates

One file per template, named `<id>.yaml` (for example `tpl-act1-open-field.yaml`).
Each file is a single top-level mapping validated by `schemas/template.schema.json`;
the validator fails a file whose name differs from its `id`. Load them with
`loadTemplates()` from `@checkbreaker/content`.

A template fixes the SHAPE of an encounter (enemy composition, par,
board sparsity) and leaves enemy placement to generation. The player's army
is never generated: in the Deployment phase the player places the King and
summons deck pieces whose total spawnCost fits the stage's spawn points, on
empty squares of ranks 1-4 (docs/02 §5). Both the budget (by act and tier)
and the deployment ranks are global rules in data/economy.yaml; a template may
only lower its budget with spawnPoints.

Checkmate is the only way to clear a stage (docs/02 §7), so the one material
rule every template must satisfy is that enemyArmyValue sits inside the act
band from docs/04 §6; the solver then proves a mate exists within the par (mateIn).

spawnedPawns are free, stage-only pawns for the player (docs/02 §2.2). Their
ranks must stay outside enemyZone; a spawned pawn near rank 8 is a real
promotion option that competes with chasing the par.
