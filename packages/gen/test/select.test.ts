import { describe, expect, it } from 'vitest';
import { selectTemplates } from '../src/select';
import { tpl } from './helpers';

const templates = [tpl({ id: 'c' }), tpl({ id: 'a' }), tpl({ id: 'b' }), tpl({ id: 'boss', tier: 'boss' }), tpl({ id: 'act2', act: 2 })];

describe('selectTemplates', () => {
  it('returns every template of the act and tier, no others', () => {
    expect(selectTemplates(templates, 1, 'normal', 's').map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
    expect(selectTemplates(templates, 1, 'boss', 's').map((t) => t.id)).toEqual(['boss']);
  });

  it('never puts previousTemplateId first when another template exists', () => {
    for (let i = 0; i < 40; i++) {
      for (const prev of ['a', 'b', 'c']) {
        expect(selectTemplates(templates, 1, 'normal', `seed${i}`, prev)[0]!.id).not.toBe(prev);
      }
    }
  });

  it('allows the previous template when it is the only one', () => {
    expect(selectTemplates(templates, 1, 'boss', 's', 'boss').map((t) => t.id)).toEqual(['boss']);
  });

  it('is deterministic, input-order independent, and the rest follow by id', () => {
    const a = selectTemplates(templates, 1, 'normal', 'x');
    const b = selectTemplates([...templates].reverse(), 1, 'normal', 'x');
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(a.slice(1).map((t) => t.id)).toEqual(a.slice(1).map((t) => t.id).sort());
  });

  it('throws on an empty act and tier', () => {
    expect(() => selectTemplates(templates, 3, 'normal', 's')).toThrow('no template for act 3 normal');
  });
});
