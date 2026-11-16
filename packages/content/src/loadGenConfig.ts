import { DEFAULT_PATH, readConfigTexts } from './loadEngineConfig';
import { parseGenConfig } from './parse';
import type { GenConfig } from './parse';

export { enemyArmyValue, solverSettingsFor, valueBandFor } from './parse';
export type { ActKey, GenConfig, GenSettings, SolverBlock, SolverOverride } from './parse';

export function loadGenConfig(path: string = DEFAULT_PATH): GenConfig {
  return parseGenConfig(readConfigTexts(path));
}
