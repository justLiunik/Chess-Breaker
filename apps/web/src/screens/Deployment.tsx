import { useMemo, useState } from 'react';
import { deploymentStatus, threatMap } from '@checkbreaker/engine';
import type { BoardPiece, PieceInstance, Square, StageState } from '@checkbreaker/engine';
import { Board } from '../board/Board';
import type { Arrow, Mark } from '../board/Board';
import { PIECE_NAME, PieceGlyph, RARITY_NAME } from '../board/pieces';
import { engineConfig } from '../config';
import { Header } from '../hud/Header';
import { Pips } from '../hud/Pips';
import { useShortcuts } from '../input/shortcuts';
import { dropRefusalText } from '../messages';
import { useRun } from '../state/store';

type Placement = { instanceId: string; to: Square };

const TRAY_REASON = { spent: 'spent', too_expensive: 'too expensive', placed: 'placed (click to pick up)' } as const;

const tierName = (i: PieceInstance): string => (i.rarity ? RARITY_NAME[i.rarity] : 'King');

export function Deployment() {
  const { session, dispatch, error, dev } = useRun();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<Square | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Which problem is the latest: a refused drop here, or the run layer's refusal of START.
  const [latest, setLatest] = useState<'local' | 'run'>('local');

  useShortcuts({ escape: () => setSelected(null) });

  const run = session?.run;
  const stage = session?.stage ?? null;
  const status = useMemo(
    () => (run && stage ? deploymentStatus(run, stage, placements, engineConfig) : null),
    [run, stage, placements],
  );
  // The planned pieces as they would stand on the board; display only, the engine judges them.
  const planned = useMemo(() => {
    const out: Record<Square, BoardPiece> = {};
    for (const p of placements) {
      const inst = run?.deck.find((i) => i.instanceId === p.instanceId);
      if (!inst) continue;
      out[p.to] = { pieceType: inst.pieceType, color: 'white', instanceId: inst.instanceId, ...(inst.rarity ? { rarity: inst.rarity } : {}) };
    }
    return out;
  }, [run, placements]);
  const plannedBoard = useMemo(() => (stage ? { ...stage.board, ...planned } : {}), [stage, planned]);
  const threats = useMemo(
    () => (run && stage ? threatMap(run, { ...stage, board: plannedBoard }, engineConfig) : {}),
    [run, stage, plannedBoard],
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

  /** The status to judge a drop of `id` by: without `id`'s own placement, so moving a placed piece is judged as a fresh drop. */
  const statusFor = (id: string) => (placements.some((p) => p.instanceId === id)
    ? deploymentStatus(run, stage, placements.filter((p) => p.instanceId !== id), engineConfig)
    : status);

  const fail = (text: string): void => { setMessage(text); setLatest('local'); };
  const clear = (): void => { setMessage(null); setLatest('local'); };

  const place = (instanceId: string, to: Square): void => {
    const verdict = statusFor(instanceId).drop(instanceId, to);
    if (!verdict.ok) {
      fail(dropRefusalText(verdict.reason));
      return;
    }
    clear();
    setSelected(null);
    setPlacements((ps) => [...ps.filter((p) => p.instanceId !== instanceId), { instanceId, to }]);
  };
  const unplace = (instanceId: string): void => {
    clear();
    setPlacements((ps) => ps.filter((p) => p.instanceId !== instanceId));
  };
  const pickUp = (sq: Square): void => {
    clear();
    setPlacements((ps) => ps.filter((p) => p.to !== sq));
  };
  const onSquare = (sq: Square): void => {
    if (selected) place(selected, sq);
    else if (planned[sq]) pickUp(sq);
  };

  // While the King is selected or dragged, mark the deployment squares where it would start in check.
  const king = run.deck.find((i) => i.pieceType === 'king');
  const kingActive = king !== undefined && (selected === king.instanceId || dragging === king.instanceId);
  const marks: Mark[] = [];
  if (king && kingActive) {
    const judge = statusFor(king.instanceId);
    for (const sq of hatch) {
      const v = judge.drop(king.instanceId, sq);
      if (!v.ok && v.reason === 'king_in_check') marks.push({ square: sq, kind: 'king-unsafe', label: 'King would start in check here' });
    }
  }

  const stagePieces = Object.entries(stage.board)
    .filter(([, p]) => p.color === 'white' && p.pieceType === 'pawn')
    .map(([sq, p]) => `${RARITY_NAME[p.rarity ?? 'normal']} pawn on ${sq}, promotes to any piece`);
  const problem = latest === 'local' ? message : error;

  return (
    <main className="screen deployment" data-testid="deployment-screen">
      <Header session={session} />
      <div className="deployment-body">
        <Board
          stage={stage}
          overlays={{ ghost: plannedBoard, threats, hatch, arrows, marks }}
          onSquare={onSquare}
          onSquareContext={pickUp}
          onHover={setHover}
          draggable={(sq) => planned[sq] !== undefined}
          onDragStart={(sq, e) => {
            const id = planned[sq]?.instanceId;
            if (!id) return;
            e.dataTransfer.setData('text/plain', id);
            setDragging(id);
          }}
          onDragEnd={() => setDragging(null)}
          onDrop={(sq, e) => {
            const id = e.dataTransfer.getData('text/plain');
            setDragging(null);
            if (id) place(id, sq);
          }}
        />
        <aside className="side">
          <p data-testid="spawn-counter">Spawn points {status.spawnUsed} / {status.spawnBudget}</p>
          <h2>Your pieces</h2>
          <ul
            className="tray"
            data-testid="tray"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              setDragging(null);
              if (id && placements.some((p) => p.instanceId === id)) unplace(id);
            }}
          >
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
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', id); setDragging(id); }}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => {
                      if (t.reason === 'placed') unplace(id);
                      else {
                        setSelected(selected === id ? null : id);
                        clear();
                      }
                    }}
                  >
                    <span className="tray-glyph"><PieceGlyph piece={{ pieceType: inst.pieceType, color: 'white' }} rarity={inst.rarity} /></span>
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
          {problem && <p role="alert" className="error">{problem}</p>}
          {stagePieces.length > 0 && (
            <div data-testid="stage-pieces">
              <h2>Stage pieces</h2>
              <ul>{stagePieces.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          <button
            type="button"
            className="start"
            disabled={!kingPlaced}
            onClick={() => { setMessage(null); setLatest('run'); dispatch({ type: 'start', placements }); }}
          >
            START
          </button>
          {dev && (
            <>
              {' '}
              <button type="button" onClick={() => { setMessage(null); setLatest('run'); dispatch({ type: 'skip' }); }}>Skip stage (dev)</button>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
