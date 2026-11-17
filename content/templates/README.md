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

spawnedPawns are free, stage-only pawns for the player (docs/02 §2.1). Their
ranks must stay outside enemyZone; a spawned pawn near rank 8 is a real
promotion option that competes with chasing the par: on rank 8 the player
chooses a knight, bishop, rook or queen at the pawn's rarity, and it stays on
the board (docs/02 §2.2). Generation rolls only each pawn's square and rarity,
never a promotion result, so no template or stage carries `promotesTo`.

Every template lists the `no_start_check` precondition: no spawned pawn may
attack the black king, because no check may stand at START (I16, docs/04 §4).
