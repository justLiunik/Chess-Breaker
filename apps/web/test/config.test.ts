// @vitest-environment node
// Needs the Node loader (fs); the jsdom environment gives import.meta.url a non-file scheme.
import { describe, expect, it } from 'vitest';
import { loadRunConfig } from '@checkbreaker/content';
import { engineConfig, genTexts, runConfig } from '../src/config';

describe('web config', () => {
  it('runConfig deep-equals the Node loader result', () => {
    expect(runConfig).toEqual(loadRunConfig());
  });

  it('engineConfig is the engine part of runConfig', () => {
    expect(engineConfig.rules).toEqual(runConfig.rules);
    expect(engineConfig.deck).toEqual(runConfig.deck);
  });

  it('genTexts carries economy, pieces, skills, templates and formations', () => {
    expect(genTexts.texts.economy.length).toBeGreaterThan(0);
    expect(genTexts.texts.pieces.length).toBeGreaterThan(0);
    expect(genTexts.texts.skills.length).toBeGreaterThan(0);
    expect(genTexts.templates.length).toBeGreaterThan(0);
    for (const t of genTexts.templates) expect(t.name.endsWith('.yaml')).toBe(true);
    expect(Object.keys(genTexts.formations).length).toBeGreaterThan(0);
    for (const id of Object.keys(genTexts.formations)) expect(id.includes('/')).toBe(false);
  });
});
