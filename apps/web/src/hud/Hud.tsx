import { hudEconomy } from '@checkbreaker/engine';
import type { previewSteps } from '@checkbreaker/engine';
import type { RunSession } from '@checkbreaker/run';
import { engineConfig } from '../config';

export type Preview = ReturnType<typeof previewSteps>;

export const STALEMATE_TEXT = 'STALEMATE — YOU LOSE';

const LOSS_TEXT: Record<string, string> = {
  player_mated: 'THIS QUEUE LOSES — YOUR KING IS MATED',
  player_stalemated: 'THIS QUEUE LOSES — YOU ARE STALEMATED',
  out_of_coins: 'THIS QUEUE LOSES — OUT OF COINS',
};

/** What the queue ends in when it loses the stage, or null. */
export function lossBanner(preview: Preview): string | null {
  const end = preview.result?.stage;
  if (!end || end.status !== 'lost') return null;
  if (end.endReason === 'enemy_stalemated') return STALEMATE_TEXT;
  return LOSS_TEXT[end.endReason ?? ''] ?? 'THIS QUEUE LOSES THE STAGE';
}

/** Turn, Focus, and the coin figures. Every number comes from the engine (`hudEconomy`, the preview's own award). */
export function Hud({ session, preview, focus, credits }: { session: RunSession; preview: Preview; focus: number; credits: number }) {
  const { run, stage } = session;
  if (!stage) return null;
  const eco = hudEconomy(run, stage, engineConfig);
  const mates = preview.result?.stage.status === 'won';
  const award = preview.result?.award ?? null;
  const pastPar = eco.freeTurnsLeft === 0;
  const loss = lossBanner(preview);
  return (
    <section className="action-hud" aria-label="Turn status">
      <p data-testid="hud-turn">
        Turn {eco.turn} of {eco.mateIn}
        {' · '}Focus {focus} / {stage.focusPool}
        {' · '}Free moves {credits}
      </p>
      {eco.lastParTurn && <p className="hud-warn" data-testid="hud-lastpar"><strong>LAST PAR TURN</strong></p>}
      {pastPar && (
        <p className="hud-warn" data-testid="hud-overtime">
          <strong>OVERTIME −{eco.overtimeCost} ◈ / turn</strong>
          {' '}(pending reward {eco.pendingBase} ◈, wallet {run.coins} ◈)
        </p>
      )}
      {loss && <p className="hud-loss" role="alert" data-testid="hud-loss"><strong>{loss}</strong></p>}
      {mates && award
        ? <p className="hud-win" data-testid="hud-win"><strong>WIN NOW +{award.coins} ◈</strong></p>
        : <p className="hud-muted" data-testid="hud-next">Mate next turn: about +{eco.nextTurnPotential} ◈</p>}
    </section>
  );
}
