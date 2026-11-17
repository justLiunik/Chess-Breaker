import { describe, expect, it } from 'vitest';
import { skillUnavailable } from '../src/view';
import { checkSkill } from '../src/skills/check';
import type { Action, EngineConfig } from '../src/types';
import { config, deepFreeze, runOf, stageOf } from './helpers';

const skill = (skillId: string, target?: string): Action => ({ type: 'ACTIVATE_SKILL', skillId, ...(target ? { target } : {}) });
const stage = deepFreeze(stageOf({ e1: 'K', a1: 'R', e8: 'k', h7: 'p' }));
const twice = deepFreeze(runOf({ loadout: [{ skillId: 'twin_step' }, { skillId: 'twin_step' }] }));

describe('skillUnavailable', () => {
  it('a second copy of a once_per_turn skill is unavailable once the queue used the first', () => {
    expect(config.skills['twin_step']!.restrictions).toContain('once_per_turn');
    expect(skillUnavailable(twice, stage, [], 'twin_step', config)).toBeNull();
    expect(skillUnavailable(twice, stage, [skill('twin_step')], 'twin_step', config)).toBe('once_per_turn');
  });

  it('a skill without once_per_turn stays available while a copy is left', () => {
    const loose: EngineConfig = {
      ...config,
      skills: { ...config.skills, twin_step: { ...config.skills['twin_step']!, restrictions: [] } },
    };
    expect(skillUnavailable(twice, stage, [skill('twin_step')], 'twin_step', loose)).toBeNull();
    // Both copies used: none is left in the queue's loadout.
    expect(skillUnavailable(twice, stage, [skill('twin_step'), skill('twin_step')], 'twin_step', loose)).toBe('not_in_loadout');
  });

  it('names a skill outside the loadout and one not implemented yet', () => {
    expect(skillUnavailable(runOf(), stage, [], 'twin_step', config)).toBe('not_in_loadout');
    const future = Object.entries(config.skills).find(([, d]) => d.status !== 'mvp')?.[0];
    expect(future).toBeDefined();
    expect(skillUnavailable(runOf({ loadout: [{ skillId: future! }] }), stage, [], future!, config)).toBe('not_implemented');
  });

  it('leaves the target and Focus to the preview: a targeted skill without a target, or too little Focus, is not unavailable', () => {
    const lockdown = runOf({ loadout: [{ skillId: 'lockdown' }] });
    expect(config.skills['lockdown']!.target.kind).not.toBe('none');
    expect(skillUnavailable(lockdown, stage, [], 'lockdown', config)).toBeNull();
    expect(skillUnavailable(twice, { ...stage, focus: 0 }, [], 'twin_step', config)).toBeNull();
  });

  it('gives no verdict (null) when the queue is already refused before the new entry', () => {
    const bad: Action = { type: 'MOVE', from: 'c3', to: 'c4' };
    expect(skillUnavailable(twice, stage, [skill('twin_step'), bad], 'twin_step', config)).toBeNull();
  });

  it('agrees with checkSkill on every catalogue skill for a fresh queue', () => {
    for (const id of Object.keys(config.skills)) {
      const run = runOf({ loadout: [{ skillId: id }] });
      const ctx = {
        run, board: stage.board, focus: stage.focus, moveCredits: stage.moveCredits,
        modifiers: stage.modifiers, skillLog: stage.skillLog, turn: stage.turnsUsed + 1,
      };
      const e = checkSkill(ctx, { type: 'ACTIVATE_SKILL', skillId: id }, 0, config);
      expect(skillUnavailable(run, stage, [], id, config)).toBe(e?.kind === 'skill_unavailable' ? e.reason : null);
    }
  });
});
