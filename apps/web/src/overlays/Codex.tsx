import { pieceTexts, skillTexts } from '../config';
import { RARITY_NAME } from '../board/pieces';
import { Modal } from './Modal';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What every skill breaks and what every deck piece gains with its tier. Reads only the content YAML. */
export function Codex({ onClose }: { onClose(): void }) {
  return (
    <Modal label="Codex" onClose={onClose}>
      <h2>Skills</h2>
      <ul className="codex">
        {skillTexts.map((s) => (
          <li key={s.id} data-testid={`codex-skill-${s.id}`}>
            <strong>{s.name}</strong>
            <br />
            <em>{s.ruleBroken}</em> {s.text}
          </li>
        ))}
      </ul>
      <h2>Pieces</h2>
      <ul className="codex">
        {pieceTexts.map((p) => (
          <li key={p.pieceType} data-testid={`codex-piece-${p.pieceType}`}>
            <strong>{cap(p.pieceType)}</strong>
            <ul>
              <li>{RARITY_NAME.normal}: moves as a standard {p.pieceType}.</li>
              {(['rare', 'unique', 'legendary'] as const).map((t) => (
                p.tiers[t] ? <li key={t}>{RARITY_NAME[t]}: {p.tiers[t]!.join(' ')}</li> : null
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
