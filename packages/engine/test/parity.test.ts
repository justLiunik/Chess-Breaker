import { describe, expect, it } from 'vitest';
import { commitQueue, simulate } from '../src/rules';
import type { GameEvent, RunState } from '../src/types';
import { config, deepFreeze } from './helpers';
import { makeCase } from './fuzzgen';

/**
 * The deck `simulate`'s run leaves after the enemy reply's `events`: each captured Hero Piece leaves
 * the deck, unless `lifeline_saved` follows its capture, when it stays `captured` with the lifeline used.
 */
function deckAfterReply(run: RunState, events: GameEvent[]): RunState['deck'] {
  let deck = run.deck;
  events.forEach((e, i) => {
    if (e.type !== 'capture' || e.color !== 'white' || e.instanceId === undefined) return;
    const id = e.instanceId;
    const next = events[i + 1];
    deck = next?.type === 'lifeline_saved' && next.instanceId === id
      ? deck.map((p) => (p.instanceId === id ? { ...p, status: 'captured', usedOnce: [...(p.usedOnce ?? []), 'lifeline'] } : p))
      : deck.filter((p) => p.instanceId !== id);
  });
  return deck;
}

describe('parity: simulate is the first half of commitQueue', () => {
  it('holds on 1,000 random accepted queues (skills, rarity and R5 deck changes included)', () => {
    let checked = 0;
    let ended = 0;
    let withSkills = 0;
    let deckChanged = 0;
    for (let i = 0; checked < 1000; i++) {
      const { run, stage, queue } = makeCase('parity', i);
      deepFreeze(run);
      deepFreeze(stage);
      const s = simulate(run, stage, queue, config);
      if (!s.ok) continue;
      const c = commitQueue(run, stage, queue, config);
      if (!c.ok) throw new Error(`commitQueue refused what simulate accepted at ${i}: ${JSON.stringify(c.error)}`);
      checked++;
      if (s.value.events.some((e) => e.type === 'skill_activated')) withSkills++;
      expect(c.value.events.slice(0, s.value.events.length)).toEqual(s.value.events);
      expect(c.value.award).toEqual(s.value.award);
      expect(c.value.run.coins).toBeGreaterThanOrEqual(s.value.run.coins);
      if (s.value.stage.status !== 'active') {
        ended++;
        expect(c.value.stage).toEqual(s.value.stage);
        expect(c.value.events).toEqual(s.value.events);
        expect(c.value.run).toEqual(s.value.run);
      } else {
        expect(c.value.stage.turnsUsed).toBe(s.value.stage.turnsUsed);
        const deck = deckAfterReply(s.value.run, c.value.events.slice(s.value.events.length));
        if (deck !== s.value.run.deck) deckChanged++;
        expect(c.value.run).toEqual({ ...s.value.run, deck });
      }
    }
    expect(ended).toBeGreaterThan(0);
    expect(withSkills).toBeGreaterThan(20);
    expect(deckChanged, 'replies that captured a Hero Piece').toBeGreaterThan(20);
  }, 30_000);
});
