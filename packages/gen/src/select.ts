import { draw } from '@checkbreaker/engine';
import type { Template } from '@checkbreaker/content';

const byId = (a: Template, b: Template): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** G1: the try order of templates for an act and tier. All weights are equal (the schema has no weight field). */
export function selectTemplates(
  templates: Template[],
  act: 1 | 2 | 3,
  tier: 'normal' | 'boss',
  stageSeed: string,
  previousTemplateId?: string,
): Template[] {
  const all = templates.filter((t) => t.act === act && t.tier === tier).sort(byId);
  if (all.length === 0) throw new Error(`no template for act ${act} ${tier}`);
  const others = all.filter((t) => t.id !== previousTemplateId);
  const pool = others.length > 0 ? others : all;
  const first = pool[Math.floor(draw(stageSeed, 'template') * pool.length)]!;
  return [first, ...all.filter((t) => t !== first)];
}
