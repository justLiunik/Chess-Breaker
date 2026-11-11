import type { EngineConfig, RunState } from './types';

/**
 * The amounts of the stage the run is playing (docs/05 §2): the full base reward and par bonus,
 * boss-scaled on the boss stage, and the per-turn overtime cost, which is never boss-scaled.
 */
export function stageEconomy(
  run: RunState,
  config: EngineConfig,
): { baseFull: number; parBonusFull: number; overtimeCost: number } {
  const act = `act${run.actIndex + 1}` as 'act1' | 'act2' | 'act3';
  const { baseReward, parBonus, overtimeCost } = config.economy;
  const scale = run.stageIndex === 2 ? baseReward.bossMultiplier : 1;
  return {
    baseFull: Math.round(baseReward[act] * scale),
    parBonusFull: Math.round(parBonus[act] * scale),
    overtimeCost: overtimeCost[act],
  };
}
