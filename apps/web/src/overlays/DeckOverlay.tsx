import { skillNames } from '../config';
import { useRun } from '../state/store';
import { DeckList } from '../screens/DeckList';
import { Modal } from './Modal';

export function DeckOverlay({ onClose }: { onClose(): void }) {
  const { session } = useRun();
  if (!session) return null;
  const { run } = session;
  return (
    <Modal label="Deck" onClose={onClose}>
      <h2>Deck</h2>
      <DeckList mode="view" />
      <h2>Skills</h2>
      {run.loadout.length === 0 ? <p>No skills yet.</p> : (
        <ol>{run.loadout.map((l, i) => <li key={i}>{skillNames[l.skillId] ?? l.skillId}</li>)}</ol>
      )}
    </Modal>
  );
}
