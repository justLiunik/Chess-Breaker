import type { RunSession } from '@checkbreaker/run';

/** The top strip: where the run is, the wallet, and the stage's par. */
export function Header({ session }: { session: RunSession }) {
  const { run, stage } = session;
  return (
    <header className="hud">
      <span className="hud-where">Act {run.actIndex + 1}, stage {run.stageIndex + 1}</span>
      <span className="hud-coins" aria-label={`${run.coins} coins`}>Coins {run.coins}</span>
      {stage && <strong className="hud-mate">MATE IN {stage.mateIn}</strong>}
    </header>
  );
}
