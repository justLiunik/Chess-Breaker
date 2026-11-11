import { loadGenConfig } from '@checkbreaker/content';
import type { Formation, Template } from '@checkbreaker/content';

export const config = loadGenConfig();

export function tpl(over: Partial<Template> & { id: string }): Template {
  return {
    title: over.id,
    act: 1,
    tier: 'normal',
    mateIn: [3, 4],
    spawnedPawns: { count: [1, 1], ranks: [3] },
    focusPool: 3,
    enemyPolicy: { type: 'best_move', depth: 2 },
    preconditions: [],
    ...over,
  } as Template;
}

export const stubFormations: Formation[] = [
  { id: 'f1', rating: 1000, black: '1n5k/pp3ppp/8/8/8/8/8/8' },
  { id: 'f2', rating: 1100, black: '6k1/5ppp/8/8/8/8/8/3r4' },
  { id: 'f3', rating: 1200, black: 'r5k1/1p3ppp/8/8/8/8/8/8' },
];
