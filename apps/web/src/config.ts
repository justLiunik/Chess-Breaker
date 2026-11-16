import { parseEngineConfig, parsePieceTexts, parseRunConfig, parseSkillTexts } from '@checkbreaker/content/parse';
import type { PieceText, SkillText } from '@checkbreaker/content/parse';
import type { ConfigTexts } from '@checkbreaker/content/parse';
import type { EngineConfig } from '@checkbreaker/engine';
import type { RunConfig } from '@checkbreaker/content/parse';
import economy from '../../../data/economy.yaml?raw';
import pieces from '../../../content/examples/pieces.yaml?raw';
import skills from '../../../content/examples/skills.yaml?raw';

export const texts: ConfigTexts = { economy, pieces, skills };

export const engineConfig: EngineConfig = parseEngineConfig(texts);
export const runConfig: RunConfig = parseRunConfig(texts);

/** UI-only text (names and rule sentences) read from the same YAML; never used for rules. */
export const skillTexts: SkillText[] = parseSkillTexts(skills);
export const skillNames: Record<string, string> = Object.fromEntries(skillTexts.map((s) => [s.id, s.name]));
export const pieceTexts: PieceText[] = parsePieceTexts(pieces);
