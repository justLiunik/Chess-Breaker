/**
 * Freezes `packages/gen/test/fixtures/solver-known.json` (spec §11, Solver): four positions whose mate
 * the brute-force oracle `bruteMate` proves, for the beam solver's tests (Tasks 15 and 16). Run by hand:
 *
 *   npx tsx packages/gen/test/solver/freeze-fixtures.ts
 *
 * The scan walks stages from `generateWith` with a solver that never proves, rotating the Act II
 * normal (stage indices 0 and 1) and Act III boss slots, one run seed per stage. Each stage is tried
 * from its first `CANDIDATES` deployment candidates, with the test config `rules.deploymentRanks:
 * [1, 2]`, and with `stage.mateIn` set to the mating turn tried, because the par is the enemy's clock
 * (`enemyClock`) and so changes its replies. The first (stage, candidate, turn) meeting a fixture's
 * condition is frozen. A fixture the scan does not find in `MAX_STAGES` stages is hand-built
 * and must pass the same condition.
 *
 * Conditions (`meets`):
 * - mate2, mate3: the shortest mate is on turn 2, or 3.
 * - bonus: a mate on turn `mateIn` with the bonus move, and none within it without, from this
 *   deployment and from every deployment candidate of the stage.
 * - promotion: the same with a pawn reaching rank 8.
 * The "every candidate" part is beyond the brief's condition: the solver (Task 15) deploys from
 * `deploymentCandidates`, so its line must then use the bonus move, or the promotion.
 *
 * The turns tried (`KINDS`) are 2 for bonus (a Legendary knight's turn-3 tree costs ~25 s a stage)
 * and 2 and 3 for promotion. The first run (2026-11-11) took about 40 minutes, almost all of it in
 * the mate3 search over the Act III boss; it found mate2, mate3 and bonus by scan and hand-built
 * promotion after 2,000 stages without one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadFormations, loadGenConfig, loadTemplates } from '@checkbreaker/content';
import type { GenConfig } from '@checkbreaker/content';
import { durabilityMaxOf, hash } from '@checkbreaker/engine';
import type { Action, BoardPiece, PieceInstance, RunState, StageState } from '@checkbreaker/engine';
import { generateWith } from '../../src/generate';
import { deploymentCandidates } from '../../src/solver/deployment';
import type { Placement } from '../../src/types';
import { deckRun } from '../helpers';
import { bruteMate, bruteSearch } from './brute';
import type { BruteFilter, BruteOpts } from './brute';

type Name = 'mate2' | 'mate3' | 'bonus' | 'promotion';
type Fixture = {
  name: Name;
  run: RunState;
  stage: StageState;
  placements: Placement[];
  mateTurn: number;
  deploymentRanks: number[];
};

const DEPLOYMENT_RANKS = [1, 2];
/** Stages scanned before a fixture is hand-built. */
const MAX_STAGES = 2000;
/** Deployment candidates tried per stage. */
const CANDIDATES = 10;
/** The wall-clock cap: the scan stops with an error past it (nothing is written). */
const MAX_MINUTES = 120;
const SLOTS = [
  { actIndex: 1, stageIndex: 0 },
  { actIndex: 1, stageIndex: 1 },
  { actIndex: 2, stageIndex: 2 },
] as const;

const FULL: BruteOpts = { bonus: true, pawnToRank8: true };
const NO_BONUS: BruteOpts = { bonus: false, pawnToRank8: true };
const NO_PROMOTION: BruteOpts = { bonus: true, pawnToRank8: false };

const base = loadGenConfig();
const config: GenConfig = { ...base, rules: { ...base.rules, deploymentRanks: DEPLOYMENT_RANKS } };
const content = { templates: loadTemplates(), formations: loadFormations() };
const neverProves = () => ({
  win: null, stats: { screenNodes: 0, deepNodes: 0, deployments: 0, enemyCalls: 0, memoHits: 0 },
});

/** The run seed of scanned stage `i`, in the run schema's XXXX-XXXX format. */
function seedOf(i: number): string {
  const h = hash('solver-known', i).toString(16).toUpperCase().padStart(8, '0');
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

const instance = (instanceId: string, pieceType: 'knight' | 'rook' | 'queen', rarity: 'normal' | 'legendary'): PieceInstance => {
  const max = durabilityMaxOf(pieceType, rarity, config);
  return {
    instanceId, pieceType, rarity, durability: max, durabilityMax: max, origin: 'shop', acquiredAtStage: 0, status: 'in_deck',
  };
};

/** The starter run at (act, stage) with its King and `pieces` as the whole deck. */
function smallRun(seed: string, actIndex: number, stageIndex: number, pieces: PieceInstance[]): RunState {
  const starter = deckRun('starter', actIndex, stageIndex);
  const king = starter.deck.find((p) => p.pieceType === 'king')!;
  return { ...starter, seed, deck: [king, ...pieces] };
}

/** King, Normal queen and Normal rook: Act II's 12 spawn points take one of them, Act III's boss 18 both. */
const heavyRun = (seed: string, actIndex: number, stageIndex: number): RunState =>
  smallRun(seed, actIndex, stageIndex, [instance('p_queen_06', 'queen', 'normal'), instance('p_rook_07', 'rook', 'normal')]);

/** King and the starter knight p_knight_02 raised to Legendary: the only piece with a bonus move. */
const legendaryRun = (seed: string, actIndex: number, stageIndex: number): RunState =>
  smallRun(seed, actIndex, stageIndex, [instance('p_knight_02', 'knight', 'legendary')]);

const KINDS: { name: Name; deck: 'heavy' | 'legendary'; turns: number[] }[] = [
  { name: 'mate2', deck: 'heavy', turns: [2] },
  { name: 'mate3', deck: 'heavy', turns: [3] },
  { name: 'bonus', deck: 'legendary', turns: [2] },
  { name: 'promotion', deck: 'heavy', turns: [2, 3] },
];

/** Whether no deployment candidate of `stage` (nor `placements`) mates within `turn` with `opts`. */
function noneWithin(run: RunState, stage: StageState, placements: Placement[], turn: number, opts: BruteOpts): boolean {
  for (const c of [placements, ...deploymentCandidates(run, stage, config)]) {
    if (bruteMate(run, stage, c, turn, opts, config) !== null) return false;
  }
  return true;
}

/** The highest rank (1-8) of a White pawn on `stage`, or 0. */
function topPawnRank(stage: StageState): number {
  let top = 0;
  for (const [sq, p] of Object.entries(stage.board)) {
    if (p.pieceType === 'pawn' && p.color === 'white') top = Math.max(top, Number(sq[1]));
  }
  return top;
}

/**
 * The scan's pre-check for a promotion mate on turn T when the top pawn rank is exactly 8 − T: a pawn
 * moves one rank per turn, so a line that promotes by turn T plays, on each turn t, a MOVE of a pawn on
 * rank ≥ 7 − T + t (the pawn that is to promote). Every other queue is pruned.
 */
const zeroSlack: BruteFilter = (stage: StageState, queue: Action[], turn: number, target: number): boolean => {
  const a = queue[0]!;
  if (queue.length !== 1 || a.type !== 'MOVE') return false;
  const p = stage.board[a.from];
  return p !== undefined && p.pieceType === 'pawn' && p.color === 'white' && Number(a.from[1]) >= 7 - target + turn;
};

/** Whether the fixture `name` holds for deploying `placements` on `stage` (whose `mateIn` is `turn`). */
function meets(name: Name, run: RunState, stage: StageState, placements: Placement[], turn: number, scan: boolean): boolean {
  switch (name) {
    case 'mate2':
    case 'mate3':
      return bruteMate(run, stage, placements, turn, FULL, config) === turn;
    case 'bonus':
      return bruteMate(run, stage, placements, turn, FULL, config) === turn
        && noneWithin(run, stage, placements, turn, NO_BONUS);
    case 'promotion': {
      // A pawn must reach rank 8 by `turn`; pawns advance one rank per turn.
      const top = topPawnRank(stage);
      if (top < 8 - turn) return false;
      if (scan && top === 8 - turn && bruteSearch(run, stage, placements, turn, FULL, config, zeroSlack).mate?.turn !== turn) {
        return false;
      }
      return noneWithin(run, stage, placements, turn, NO_PROMOTION)
        && bruteMate(run, stage, placements, turn, FULL, config) === turn;
    }
  }
}

/**
 * The hand-built promotion mate in 2 (Act II Fortress fields, its board replaced; deck King + rook).
 * Black Ka8 Bb8, pawns b7 b6 f6; White spawned pawns a7 c7; the King on e1, the rook on d1 (the
 * stage's first deployment candidate). The a7 pawn blocks the a-file and can leave it only by
 * capturing on b8, where it vanishes: 1. a7xb8 (pawn_promoted), any reply (Ka7, b5 or f5), 2. Rd1-a1
 * mate (b8 is covered by c7, b7 and b6 hold Black's own pawns, the king's other squares lie on the
 * a-file). Without the promotion the a-file stays shut and the rook has no check: no deployment
 * candidate mates within 2 turns. The f6 pawn only keeps Black from being stalemated.
 */
function handBuiltPromotion(): Omit<Fixture, 'deploymentRanks'> {
  const run = smallRun('7F3A-2210', 1, 0, [instance('p_rook_07', 'rook', 'normal')]);
  const { stage: generated } = generateWith({ run, actIndex: 1, stageIndex: 0 }, content, config, neverProves);
  const black = (pieceType: BoardPiece['pieceType'], stageId: string): BoardPiece => ({ pieceType, color: 'black', stageId });
  const pawn = (stageId: string, promotesTo: BoardPiece['promotesTo']): BoardPiece => ({
    pieceType: 'pawn', color: 'white', spawned: true, stageId, rarity: 'normal', promotesTo,
  });
  const board: Record<string, BoardPiece> = {
    b6: black('pawn', 's01'),
    f6: black('pawn', 's02'),
    b7: black('pawn', 's03'),
    a8: black('king', 's04'),
    b8: black('bishop', 's05'),
    a7: pawn('s06', { pieceType: 'rook', rarity: 'rare' }),
    c7: pawn('s07', { pieceType: 'knight', rarity: 'rare' }),
  };
  const { provenance: _, ...rest } = generated;
  const stage: StageState = { ...rest, board, mateIn: 2 };
  const placements = deploymentCandidates(run, stage, config)[0]!;
  return { name: 'promotion', run, stage, placements, mateTurn: 2 };
}

const HAND_BUILT: Partial<Record<Name, () => Omit<Fixture, 'deploymentRanks'>>> = { promotion: handBuiltPromotion };

const LETTER: Record<BoardPiece['pieceType'], string> = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };

/** FEN-like board text, rank 8 first, White upper case. */
function boardText(board: StageState['board']): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (const f of 'abcdefgh') {
      const p = board[`${f}${r}`];
      if (p === undefined) {
        empty++;
        continue;
      }
      if (empty > 0) row += String(empty);
      empty = 0;
      row += p.color === 'white' ? LETTER[p.pieceType].toUpperCase() : LETTER[p.pieceType];
    }
    rows.push(empty > 0 ? row + String(empty) : row);
  }
  return rows.join('/');
}

const lineText = (line: Action[][]): string =>
  line.map((q) => q.map((a) => (a.type === 'MOVE' ? `${a.from}${a.to}` : a.skillId)).join(',')).join(' | ');

function main(): void {
  const t0 = performance.now();
  const elapsed = () => ((performance.now() - t0) / 1000).toFixed(1);
  const found = new Map<Name, Fixture>();
  const origin = new Map<Name, string>();
  const scanned = new Map<Name, number>(KINDS.map((k) => [k.name, 0]));
  let skipped = 0;

  for (let i = 0; i < MAX_STAGES && found.size < KINDS.length; i++) {
    if ((performance.now() - t0) / 60000 > MAX_MINUTES) {
      throw new Error(`freeze-fixtures: over ${MAX_MINUTES} minutes at stage ${i}; nothing written`);
    }
    const slot = SLOTS[i % SLOTS.length]!;
    const seed = seedOf(i);
    const runs = { heavy: heavyRun(seed, slot.actIndex, slot.stageIndex), legendary: legendaryRun(seed, slot.actIndex, slot.stageIndex) };
    const stages = new Map<'heavy' | 'legendary', StageState | null>();
    for (const kind of KINDS) {
      if (found.has(kind.name)) continue;
      const run = runs[kind.deck];
      if (!stages.has(kind.deck)) {
        const g = generateWith({ run, actIndex: slot.actIndex, stageIndex: slot.stageIndex }, content, config, neverProves);
        stages.set(kind.deck, g.provenance.validationFailed ? null : g.stage);
        if (g.provenance.validationFailed) skipped++;
      }
      const stage = stages.get(kind.deck)!;
      if (stage === null) continue;
      scanned.set(kind.name, scanned.get(kind.name)! + 1);
      const cands = deploymentCandidates(run, stage, config).slice(0, CANDIDATES);
      search: for (const [ci, placements] of cands.entries()) {
        for (const turn of kind.turns) {
          const st: StageState = { ...stage, mateIn: turn };
          if (!meets(kind.name, run, st, placements, turn, true)) continue;
          found.set(kind.name, { name: kind.name, run, stage: st, placements, mateTurn: turn, deploymentRanks: DEPLOYMENT_RANKS });
          origin.set(kind.name, `scan: stage ${i} (run seed ${seed}, ${stage.templateId}, stage seed ${stage.stageSeed}), candidate ${ci}`);
          console.log(`[${elapsed()}s] found ${kind.name} at stage ${i}: ${stage.templateId} candidate ${ci}, mate on turn ${turn}`);
          break search;
        }
      }
    }
    if (i % 25 === 24) {
      const status = KINDS.map((k) => `${k.name} ${found.has(k.name) ? 'found' : `${scanned.get(k.name)} scanned`}`).join(', ');
      console.log(`[${elapsed()}s] stage ${i + 1}/${MAX_STAGES}: ${status}; ${skipped} generation failures skipped`);
    }
  }

  for (const kind of KINDS) {
    if (found.has(kind.name)) continue;
    const build = HAND_BUILT[kind.name];
    if (build === undefined) {
      throw new Error(`freeze-fixtures: no ${kind.name} fixture in ${MAX_STAGES} stages and no hand-built position`);
    }
    const f = build();
    if (!meets(f.name, f.run, f.stage, f.placements, f.mateTurn, false)) {
      throw new Error(`freeze-fixtures: the hand-built ${kind.name} position fails its condition`);
    }
    found.set(kind.name, { ...f, deploymentRanks: DEPLOYMENT_RANKS });
    origin.set(kind.name, `hand-built (${f.stage.templateId} fields, stage seed ${f.stage.stageSeed})`);
    console.log(`[${elapsed()}s] ${kind.name}: none in ${scanned.get(kind.name)} scanned stages; hand-built position verified`);
  }

  const fixtures = KINDS.map((k) => found.get(k.name)!);
  const dir = new URL('../fixtures/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('solver-known.json', dir), `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');

  console.log(`\nwrote solver-known.json in ${elapsed()}s; generation failures skipped: ${skipped}`);
  for (const f of fixtures) {
    const line = bruteSearch(f.run, f.stage, f.placements, f.mateTurn, FULL, config).mate!.line;
    const placed = f.placements
      .map((p) => `${f.run.deck.find((d) => d.instanceId === p.instanceId)!.pieceType}@${p.to}`)
      .join(' ');
    console.log(`- ${f.name}: mateTurn ${f.mateTurn}; ${origin.get(f.name)}; scanned ${scanned.get(f.name)}`);
    console.log(`  board ${boardText(f.stage.board)}; deploy ${placed}; line ${lineText(line)}`);
  }
}

main();
