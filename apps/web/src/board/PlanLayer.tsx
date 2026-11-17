import { centre } from './arrows';
import type { Plan } from './arrows';

/** The player's planning arrows and square marks: dashed, in their own four-colour palette. Purely visual. */
export function PlanLayer({ plan }: { plan: Plan }) {
  return (
    <svg className="overlay plan-overlay" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      {plan.marks.map((m) => {
        const c = centre(m.square);
        return <circle key={m.square} className={`plan plan-${m.color}`} data-testid={`plan-mark-${m.square}`} data-color={m.color} cx={c.x} cy={c.y} r={0.42} />;
      })}
      {plan.arrows.map((a) => {
        const f = centre(a.from);
        const t = centre(a.to);
        const len = Math.hypot(t.x - f.x, t.y - f.y) || 1;
        const ux = (t.x - f.x) / len;
        const uy = (t.y - f.y) / len;
        const head = 0.28;
        const bx = t.x - ux * head;
        const by = t.y - uy * head;
        return (
          <g key={`${a.from}-${a.to}`} className={`plan plan-${a.color}`} data-testid={`plan-arrow-${a.from}-${a.to}`} data-color={a.color}>
            <line x1={f.x} y1={f.y} x2={bx} y2={by} />
            <polygon points={`${t.x},${t.y} ${bx - uy * 0.14},${by + ux * 0.14} ${bx + uy * 0.14},${by - ux * 0.14}`} />
          </g>
        );
      })}
    </svg>
  );
}
