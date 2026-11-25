import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Spec M5 §9.1: every enum list `loadSave` checks against must fail typecheck when its union gains a
 * member. The check itself is compile-time (`Exclude<Union, typeof LIST[number]> extends never`); this test
 * keeps it that way, so no list is written inline in a `oneOf` call where no such check can sit.
 */
const source = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src', 'save.ts'), 'utf8');

/** Lists pinned to a type that is not a finite union (`RunState['version']` is `number`): no completeness check exists. */
const OPEN_TYPED = new Set(['RUN_STATE_VERSIONS']);

describe('save.ts enum lists', () => {
  it('no oneOf call passes an inline array literal', () => {
    // `exactly(value)` pins a field to one given value; it is not an enum list.
    const calls = source.split('\n').filter((l) => l.includes('oneOf(') && !l.includes('function oneOf') && !l.includes('[value]'));
    expect(calls.length).toBeGreaterThan(5);
    const inline = calls.filter((l) => /,\s*\[[^\]]*\]\s*(as const)?\s*\)/.test(l));
    expect(inline).toEqual([]);
  });

  it('the phase list has no chooser (M5.1: a won stage goes straight to the shop)', () => {
    const phases = /^const PHASES = \[([^\]]*)\] as const satisfies readonly RunPhase\[\];\r?$/m.exec(source);
    expect(phases).not.toBeNull();
    expect(phases![1]!.split(',').map((p) => p.trim().replace(/'/g, ''))).toEqual(['awaiting_stage', 'deployment', 'action', 'shop', 'ended']);
    expect(source).not.toMatch(/chooser/i);
  });

  it('every named list is `as const satisfies` its type and has a completeness check', () => {
    const lists = [...source.matchAll(/^const ([A-Z_]+) = \[[^\]]*\] as const satisfies readonly .+;\r?$/gm)].map((m) => m[1]!);
    expect(lists.length).toBeGreaterThanOrEqual(16);
    for (const name of lists) {
      if (OPEN_TYPED.has(name)) continue;
      expect(source, name).toMatch(new RegExp(`Exclude<[^\\n]+, typeof ${name}\\[number\\]> extends never \\? true : never = true;`));
    }
  });
});
