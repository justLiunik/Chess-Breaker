import { useMemo, useState } from 'react';
import { deploymentStatus, threatMap } from '@checkbreaker/engine';
import type { BoardPiece, PieceInstance, Square, StageState } from '@checkbreaker/engine';
import { Board } from '../board/Board';
import type { Arrow } from '../board/Board';
import { PIECE_NAME, RARITY_NAME } from '../board/pieces';
import { engineConfig } from '../config';
import { Header } from '../hud/Header';
import { dropRefusalText } from '../messages';
import { useRun } from '../state/store';

type Placement = { instanceId: string; to: Square };

const TRAY_REASON = { spent: 'spent', too_expensive: 'too expensive', placed: 'placed (click to pick up)' } as const;

const tierName = (i: PieceInstance): string => (i.rarity ? RARITY_NAME[i.rarity] : 'King');

function Pips({ instance }: { instance: PieceInstance }) {
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

export function Deployment() {
  const { session, dispatch, error } = useRun();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<Square | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = session?.run;
  const stage = session?.stage ?? null;
  const status = useMemo(
    () => (run && stage ? deploymentStatus(run, stage, placements, engineConfig) : null),
    [run, stage, placements],
  );
  // The planned pieces as they would stand on the board; display only, the engine judges them.
  const ghost = useMemo(() => {
    const out: Record<Square, BoardPiece> = {};
    for (const p of placements) {
      const inst = run?.deck.find((i) => i.instanceId === p.instanceId);
      if (!inst) continue;
      out[p.to] = { pieceType: inst.pieceType, color: 'white', instanceId: inst.instanceId, ...(inst.rarity ? { rarity: inst.rarity } : {}) };
    }
    return out;
  }, [run, placements]);
  const threats = useMemo(
    () => (run && stage ? threatMap(run, { ...stage, board: { ...stage.board, ...ghost } } as StageState, engineConfig) : {}),
    [run, stage, ghost],
  );

  if (!session || !run || !stage || !status) return null;

  const ranks = engineConfig.rules.deploymentRanks;
  const hatch: Square[] = [];
  for (const f of 'abcdefgh') for (const r of ranks) hatch.push(`${f}${r}`);

  const kingPlaced = placements.some((p) => run.deck.find((i) => i.instanceId === p.instanceId)?.pieceType === 'king');
  const attackers = hover ? threats[hover]?.attackers ?? [] : [];
  const arrows: Arrow[] = hover ? attackers.map((from) => ({ from, to: hover, kind: 'capture' })) : [];
  const nameOf = (id: string): string => {
    const i = run.deck.find((d) => d.instanceId === id);
    return i ? `${tierName(i)} ${PIECE_NAME[i.pieceType]}` : id;
  };

  const place = (instanceId: string, to: Square): void => {
    const verdict = status.drop(instanceId, to);
    if (!verdict.ok) {
      setMessage(dropRefusalText(verdict.reason));
      return;
    }
    setMessage(null);
    setSelected(null);
    setPlacements((ps) => [...ps.filter((p) => p.instanceId !== instanceId), { instanceId, to }]);
  };
  const pickUp = (sq: Square): void => {
    setMessage(null);
    setPlacements((ps) => ps.filter((p) => p.to !== sq));
  };
  const onSquare = (sq: Square): void => {
    if (selected) place(selected, sq);
    else if (ghost[sq]) pickUp(sq);
  };
  const stagePieces = Object.entries(stage.board)
    .filter(([, p]) => p.color === 'white' && p.promotesTo)
    .map(([sq, p]) => `${PIECE_NAME[p.pieceType]} on ${sq} promotes to ${PIECE_NAME[p.promotesTo!.pieceType]} (${p.promotesTo!.rarity})`);

  return (
    <main className="screen deployment">
      <Header session={session} />
      <div className="deployment-body">
        <Board
          stage={stage}
          overlays={{ ghost, threats, hatch, arrows }}
          onSquare={onSquare}
          onSquareContext={pickUp}
          onHover={setHover}
          onDragStart={(sq, e) => {
            const id = ghost[sq]?.instanceId;
            if (id) e.dataTransfer.setData('text/plain', id);
          }}
          onDrop={(sq, e) => {
            const id = e.dataTransfer.getData('text/plain');
            if (id) place(id, sq);
          }}
        />
        <aside className="side">
          <p data-testid="spawn-counter">Spawn points {status.spawnUsed} / {status.spawnBudget}</p>
          <h2>Your pieces</h2>
          <ul className="tray" data-testid="tray">
            {run.deck.map((inst) => {
              const t = status.tray[inst.instanceId]!;
              const id = inst.instanceId;
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-testid={`tray-${id}`}
                    className={selected === id ? 'tray-piece selected' : 'tray-piece'}
                    aria-pressed={selected === id}
                    disabled={!t.placeable && t.reason !== 'placed'}
                    draggable={t.placeable}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', id)}
                    onClick={() => {
                      if (t.reason === 'placed') {
                        setPlacements((ps) => ps.filter((p) => p.instanceId !== id));
                      } else {
                        setSelected(selected === id ? null : id);
                      }
                      setMessage(null);
                    }}
                  >
                    <span className="tray-name">{PIECE_NAME[inst.pieceType]}</span>{' '}
                    <span className="tray-tier">{tierName(inst)}</span>{' '}
                    <Pips instance={inst} />
                    {t.reason && <span className="tray-reason"> {TRAY_REASON[t.reason]}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {status.startCost.length > 0 && (
            <p data-testid="start-cost">
              START costs: {status.startCost.map((c) => `${nameOf(c.instanceId)} ${c.from}→${c.to}`).join(', ')}
            </p>
          )}
          {hover && attackers.length > 0 && (
            <p data-testid="attackers">
              {hover} is attacked by {attackers.map((a) => `${a} (${stage.board[a] ? `black ${PIECE_NAME[stage.board[a]!.pieceType]}` : 'black piece'})`).join(', ')}
            </p>
          )}
          {(message ?? error) && <p role="alert" className="error">{message ?? error}</p>}
          {stagePieces.length > 0 && (
            <div data-testid="stage-pieces">
              <h2>Stage pieces</h2>
              <ul>{stagePieces.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          <button type="button" className="start" disabled={!kingPlaced} onClick={() => dispatch({ type: 'start', placements })}>
            START
          </button>
        </aside>
      </div>
    </main>
  );
}
