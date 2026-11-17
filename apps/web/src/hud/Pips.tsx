import type { PieceInstance } from '@checkbreaker/engine';

/** A piece's remaining durability as filled and empty pips (text-labelled for screen readers). */
export function Pips({ instance }: { instance: PieceInstance }) {
  if (instance.durabilityMax === null) return null;
  const filled = instance.durability ?? 0;
  return (
    <span className="pips" data-testid={`pips-${instance.instanceId}`} role="img" aria-label={`durability ${filled} of ${instance.durabilityMax}`}>
      {Array.from({ length: instance.durabilityMax }, (_, i) => (
        <span key={i} className={i < filled ? 'pip pip-full' : 'pip pip-empty'} data-testid="pip" aria-hidden="true">{i < filled ? '●' : '○'}</span>
      ))}
    </span>
  );
}
