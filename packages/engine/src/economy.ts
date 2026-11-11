import type { EngineConfig, RunState, StageState } from './types';

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

/** The part of the base reward still unspent by overtime (docs/05 §2). */
export function pendingBase(run: RunState, stage: StageState, config: EngineConfig): number {
  return Math.max(0, stageEconomy(run, config).baseFull - stage.overtimePaid);
}

/**
 * How many turns the enemy's search should assume the player has left. Within the par it is the
 * turns to the par and never reads the wallet, so a proof found before the shop survives whatever
 * the player buys. Past the par it is the overtime turns still affordable (at least 1).
 */
export function enemyClock(run: RunState, stage: StageState, config: EngineConfig): number {
  if (stage.turnsUsed < stage.mateIn) return stage.mateIn - stage.turnsUsed;
  const { overtimeCost } = stageEconomy(run, config);
  return Math.max(1, Math.floor((pendingBase(run, stage, config) + run.coins) / overtimeCost));
}
