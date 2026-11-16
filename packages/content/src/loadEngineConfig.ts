import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EngineConfig } from '@checkbreaker/engine';
import { parseEngineConfig } from './parse';
import type { ConfigTexts } from './parse';

export const DEFAULT_PATH = fileURLToPath(new URL('../../../data/economy.yaml', import.meta.url));
export const DEFAULT_PIECES_PATH = fileURLToPath(new URL('../../../content/examples/pieces.yaml', import.meta.url));
export const DEFAULT_SKILLS_PATH = fileURLToPath(new URL('../../../content/examples/skills.yaml', import.meta.url));

export function readText(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${label} not found: ${path}`);
    }
    throw e;
  }
}

/** Reads the three config files from disk, in the old loaders' order (economy, pieces, skills). */
export function readConfigTexts(
  path: string = DEFAULT_PATH,
  piecesPath: string = DEFAULT_PIECES_PATH,
  skillsPath: string = DEFAULT_SKILLS_PATH,
): ConfigTexts {
  return {
    economy: readText(path, 'economy.yaml'),
    pieces: readText(piecesPath, 'pieces.yaml'),
    skills: readText(skillsPath, 'skills.yaml'),
  };
}

export function loadEngineConfig(
  path: string = DEFAULT_PATH,
  piecesPath: string = DEFAULT_PIECES_PATH,
  skillsPath: string = DEFAULT_SKILLS_PATH,
): EngineConfig {
  return parseEngineConfig(readConfigTexts(path, piecesPath, skillsPath));
}
