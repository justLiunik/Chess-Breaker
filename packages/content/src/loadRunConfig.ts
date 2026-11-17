import { DEFAULT_PATH, readConfigTexts } from './loadEngineConfig';
import { parseRunConfig } from './parse';
import type { RunConfig } from './parse';

export type { RunConfig, RunSettings } from './parse';

export function loadRunConfig(path: string = DEFAULT_PATH): RunConfig {
  return parseRunConfig(readConfigTexts(path));
}
