import { pieceTexts, skillTexts } from '../config';
import { RARITY_NAME } from '../board/pieces';
import { Modal } from './Modal';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What every skill breaks and what every deck piece gains with its tier. Reads only the content YAML. */
export function Codex({ onClose }: { onClose(): void }) {
  return (
    <Modal label="Codex" onClose={onClose}>
      <h2>Rules</h2>
      <ul className="codex rules" data-testid="codex-rules">
        <li>A turn is a queue of moves you plan first. It needs at least one move.</li>
        <li>Each move spends a free move credit; skills and extra moves spend Focus. You cannot queue more than you can pay for.</li>
        <li>COMMIT is final: the whole queue is played at once and cannot be taken back.</li>
        <li>After your queue, the enemy replies with one move of its own.</li>
        <li>Checkmate is the only way to win a stage. Pieces are tools, not the goal.</li>
        <li>Stalemating the enemy is not a draw: it loses the stage. Being stalemated yourself loses too.</li>
        <li>The par (MATE IN X) is the number of turns that pays in full. Past it, every extra turn is an overtime bill taken from your reward and your coins.</li>
        <li>Placing a piece at START costs one durability. A piece with none left is spent and leaves your deck after the stage.</li>
        <li>You can restart a stage only before the first COMMIT.</li>
        <li>Pieces move as in chess; Rare and better pieces add the extra abilities listed below. Each skill breaks one rule, as listed here.</li>
      </ul>
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
