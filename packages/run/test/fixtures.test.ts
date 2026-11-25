import { commitQueue, startStage } from '@checkbreaker/engine';
import { describe, expect, it } from 'vitest';
import { ROOK_ID, losingStage, mateInOneStage, promotionOverflowStage, runConfig, runWithRook, starterRun } from './fixtures';

const place = (...p: [string, string][]) => p.map(([instanceId, to]) => ({ instanceId, to }));
const start = (stage: ReturnType<typeof mateInOneStage>, placements: { instanceId: string; to: string }[]) => {
  const r = startStage(runWithRook(starterRun()), stage, placements, runConfig);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const mv = (from: string, to: string, promotion?: 'queen' | 'rook' | 'bishop' | 'knight') =>
  [{ type: 'MOVE' as const, from, to, ...(promotion !== undefined && { promotion }) }];

describe('run fixtures play through the engine', () => {
  it('starterRun matches the starter deck', () => {
    const run = starterRun();
    expect(run.deck.filter((p) => p.pieceType !== 'king')).toHaveLength(4);
    expect(run.coins).toBe(runConfig.run.starterCoins);
  });

  it('mateInOneStage: Re1-e8 mates on turn 1', () => {
    const v = start(mateInOneStage('AAAA-0001'), place(['p_king_01', 'd1'], [ROOK_ID, 'e1']));
    const r = commitQueue(v.run, v.stage, mv('e1', 'e8'), runConfig);
    expect(r.ok && r.value.stage.status).toBe('won');
  });

  it('losingStage: the stage is lost', () => {
    const v = start(losingStage('AAAA-0002'), place(['p_king_01', 'e1']));
    const r = commitQueue(v.run, v.stage, mv('e1', 'f1'), runConfig);
    expect(r.ok && r.value.stage.status).toBe('lost');
  });

  it('promotionOverflowStage: promotion on turn 1, mate on turn 2', () => {
    const v = start(promotionOverflowStage('AAAA-0003'), place(['p_king_01', 'd1'], [ROOK_ID, 'e1']));
    const t1 = commitQueue(v.run, v.stage, mv('b7', 'b8', 'knight'), runConfig);
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;
    expect(t1.value.events.some((e) => e.type === 'pawn_promoted')).toBe(true);
    expect(t1.value.stage.status).toBe('active');
    const t2 = commitQueue(t1.value.run, t1.value.stage, mv('e1', 'e8'), runConfig);
    expect(t2.ok && t2.value.stage.status).toBe('won');
  });
});
