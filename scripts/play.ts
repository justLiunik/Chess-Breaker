// Terminal playground: one Act I stage. Deployment phase (startStage), then one move per turn;
// endStage on a win. `npm run play`.
import { createInterface } from 'node:readline';
import { loadEngineConfig, loadTemplates } from '@checkbreaker/content';
import { commitQueue, endStage, simulate, stageEconomy, startStage } from '@checkbreaker/engine';
import type {
  Action, BoardPiece, CommitError, GameEvent, PieceInstance, PieceType, RunState, Square, StageState,
} from '@checkbreaker/engine';

const config = loadEngineConfig();

const GLYPH: Record<PieceType, string> = {
  king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p',
};
const PIECE_NAMES: Record<string, PieceType> = {
  king: 'king', queen: 'queen', rook: 'rook', bishop: 'bishop', knight: 'knight', pawn: 'pawn',
};

function buildStage(): StageState {
  const tpl = loadTemplates().find((t) => t.id === 'tpl-act1-first-steps');
  if (!tpl?.fixedEnemy || tpl.enemyPolicy.line === undefined) throw new Error('tpl-act1-first-steps not found in content/templates');
  const board: Record<Square, BoardPiece> = {};
  for (const [sq, name] of Object.entries(tpl.fixedEnemy)) {
    board[sq] = { pieceType: name, color: 'black' };
  }
  // No White Hero Pieces yet: the player places them in the Deployment phase.
  for (const sq of ['c3', 'f3']) {
    board[sq] = {
      pieceType: 'pawn', color: 'white', spawned: true, rarity: 'normal',
      promotesTo: { pieceType: 'knight', rarity: 'normal' },
    };
  }
  // Stage Pieces get stageIds s01, s02, ... in square-index order (a1 first).
  const index = (sq: Square): number => 'abcdefgh'.indexOf(sq[0]!) + 8 * (Number(sq[1]) - 1);
  let stageCount = 0;
  for (const sq of Object.keys(board).sort((a, b) => index(a) - index(b))) {
    const piece = board[sq]!;
    if (piece.instanceId === undefined) piece.stageId = `s${String(++stageCount).padStart(2, '0')}`;
  }
  return {
    stageSeed: '9C41-0B77',
    templateId: tpl.id,
    playerColor: 'white',
    phase: 'deployment',
    board,
    turnsUsed: 0,
    mateIn: tpl.mateIn[0],
    overtimePaid: 0,
    focus: tpl.focusPool,
    focusPool: tpl.focusPool,
    moveCredits: 1,
    spawnPoints: tpl.spawnPoints ?? 6,
    modifiers: [],
    skillLog: [],
    enemyPolicy: { type: 'scripted', line: tpl.enemyPolicy.line, fallbackDepth: tpl.enemyPolicy.fallbackDepth ?? 2 },
    status: 'active',
  };
}

// The King and two starter minors (3 + 3 spawn points = the template's budget of 6).
const DECK: PieceInstance[] = [
  { instanceId: 'p_king_01', pieceType: 'king', rarity: null, durability: null, durabilityMax: null, origin: 'starter', acquiredAtStage: 0, status: 'in_deck' },
  { instanceId: 'p_knight_02', pieceType: 'knight', rarity: 'normal', durability: 2, durabilityMax: 2, origin: 'starter', acquiredAtStage: 0, status: 'in_deck' },
  { instanceId: 'p_bishop_03', pieceType: 'bishop', rarity: 'normal', durability: 2, durabilityMax: 2, origin: 'starter', acquiredAtStage: 0, status: 'in_deck' },
];
const DEFAULT_PLACEMENTS = 'e1 king, b1 knight, f1 bishop';

/** Parses 'e1 king, b1 knight' into placements (the next unused deck instance of each type), or returns a message. */
function parsePlacements(text: string, run: RunState): { instanceId: string; to: Square }[] | string {
  const out: { instanceId: string; to: Square }[] = [];
  for (const part of text.split(',')) {
    const m = /^\s*([a-h][1-8])\s+([a-z]+)\s*$/.exec(part.toLowerCase());
    if (!m) return `not a placement: '${part.trim()}' (use e.g. e1 king)`;
    const type = PIECE_NAMES[m[2]!];
    if (!type) return `unknown piece '${m[2]}'`;
    const used = out.map((p) => p.instanceId);
    const inst = run.deck.find((d) => d.pieceType === type && !used.includes(d.instanceId));
    if (!inst) return `no ${type} left in the deck`;
    out.push({ instanceId: inst.instanceId, to: m[1]! });
  }
  return out;
}

function buildRun(): RunState {
  return {
    version: 1, seed: '7F3A-2210', actIndex: 0, stageIndex: 0, coins: 0, deckCapacity: 8,
    deck: DECK, loadout: [], history: [], rngCursor: 0, status: 'in_progress',
  };
}

function boardText(stage: StageState): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = `${rank}  `;
    for (const f of 'abcdefgh') {
      const p = stage.board[`${f}${rank}`];
      const g = p ? (p.color === 'white' ? GLYPH[p.pieceType].toUpperCase() : GLYPH[p.pieceType]) : '.';
      row += `${g} `;
    }
    rows.push(row.trimEnd());
  }
  rows.push('   a b c d e f g h');
  return rows.join('\n');
}

function eventText(e: GameEvent): string {
  switch (e.type) {
    case 'move': return `${e.color} ${e.pieceType} ${e.from}-${e.to}`;
    case 'capture': return `capture on ${e.square}: ${e.color} ${e.pieceType}` + (e.salvage ? ` (salvage ${e.salvage})` : '');
    case 'pawn_promoted': return `pawn reaches the last rank at ${e.square}; promotes to ${e.promotesTo.pieceType} (${e.promotesTo.rarity})`;
    case 'enemy_promoted': return `enemy pawn promoted on ${e.square}`;
    case 'check': return `check on the ${e.king} king (${e.square})`;
    case 'stage_won': return `stage won: ${e.award.coins} coins (base ${e.award.base} + par bonus ${e.award.parBonus})`;
    case 'overtime_paid': return `overtime on turn ${e.turn}: ${e.fromReward} from the reward, ${e.fromWallet} from your coins`;
    case 'stage_lost': return `stage lost: ${e.endReason}`;
    case 'enemy_move': return `enemy moves ${e.from}-${e.to}`;
    case 'enemy_fell_back': return `enemy script ended or was blocked (cursor ${e.cursor}); it now searches`;
    case 'turn_started': return `turn ${e.turn} begins`;
    case 'piece_summoned': return `${e.instanceId} is summoned to ${e.square}`;
    case 'lifeline_saved': return `${e.instanceId} is saved by its lifeline`;
    case 'piece_returned': return `${e.instanceId} returns to the deck`;
    case 'piece_removed': return `${e.instanceId} is spent and removed from the deck`;
    case 'stage_started': return 'the stage begins';
    case 'skill_activated': return `skill ${e.skillId} activated` + (e.target ? ` on ${e.target}` : '');
    case 'piece_transformed': return `${e.target} becomes a ${e.pieceType}`;
    case 'piece_suppressed': return `${e.target} is suppressed`;
    case 'transform_reverted': return `${e.target} reverts to its own type`;
    case 'modifier_expired': return `modifier ${e.modifierId} expires`;
  }
}

function errorText(err: CommitError): string {
  const { kind, ...rest } = err;
  const detail = Object.entries(rest).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
  return `refused: ${kind}${detail ? ` (${detail})` : ''}`;
}

const HELP = [
  'Type a move as from+to, e.g. f1d3, then answer y or n to the commit prompt.',
  'Commands: help | undo-plan (discard the pending move) | quit',
].join('\n');

function main(): void {
  let run = buildRun();
  let stage = buildStage();
  let pending: Action[] | null = null;
  let deploying = true;
  const rl = createInterface({ input: process.stdin });

  const show = (): void => {
    console.log(`\n${boardText(stage)}`);
    const turn = stage.turnsUsed + 1;
    const overtime = turn > stage.mateIn ? `   OVERTIME −${stageEconomy(run, config).overtimeCost} ◈ / turn` : '';
    console.log(`turn ${turn}  MATE IN ${stage.mateIn}${overtime}   coins ${run.coins}   you are White (upper case)`);
  };
  const prompt = (): void => console.log(deploying
    ? `place your pieces (Enter = ${DEFAULT_PLACEMENTS}), or quit:`
    : pending ? 'commit? (y/n)' : 'move (e.g. f1d3), help, quit:');
  const finish = (): void => {
    console.log(`\nstage ${stage.status}: ${stage.endReason}`);
    if (stage.status === 'won') {
      const end = endStage(run, stage, config);
      if (end.ok) for (const e of end.value.events) console.log(`  ${eventText(e)}`);
      else console.log(errorText(end.error));
    }
    rl.close();
    process.exit(stage.status === 'won' ? 0 : 1);
  };

  console.log('Checkbreaker playground: tpl-act1-first-steps');
  console.log(HELP);
  console.log(`Deployment: ranks 1-4; the King is free, summons cost spawn points (knight 3, bishop 3; budget ${stage.spawnPoints}).`);
  show();
  prompt();

  rl.on('line', (raw) => {
    const line = raw.trim().toLowerCase();
    if (deploying) {
      if (line === 'quit') { console.log('bye'); rl.close(); process.exit(0); }
      const parsed = parsePlacements(line === '' ? DEFAULT_PLACEMENTS : line, run);
      if (typeof parsed === 'string') { console.log(parsed); prompt(); return; }
      const res = startStage(run, stage, parsed, config);
      if (!res.ok) { console.log(errorText(res.error)); prompt(); return; }
      for (const e of res.value.events) console.log(`  ${eventText(e)}`);
      run = res.value.run;
      stage = res.value.stage;
      deploying = false;
      show();
      prompt();
      return;
    }
    if (line === '') { prompt(); return; }
    if (line === 'quit') { console.log('bye'); rl.close(); process.exit(0); }
    if (line === 'help') { console.log(HELP); prompt(); return; }
    if (line === 'undo-plan') {
      console.log(pending ? 'pending move discarded' : 'nothing to discard');
      pending = null;
      prompt();
      return;
    }

    if (pending) {
      if (line === 'y') {
        const res = commitQueue(run, stage, pending, config);
        pending = null;
        if (!res.ok) { console.log(errorText(res.error)); prompt(); return; }
        for (const e of res.value.events) console.log(`  ${eventText(e)}`);
        run = res.value.run;
        stage = res.value.stage;
        show();
        if (stage.status !== 'active') finish();
      } else if (line === 'n') {
        pending = null;
        console.log('not committed');
      } else {
        console.log('answer y or n (or undo-plan)');
      }
      prompt();
      return;
    }

    const m = /^([a-h][1-8])([a-h][1-8])$/.exec(line);
    if (!m) { console.log(`not a move: '${line}' (try f1d3, or help)`); prompt(); return; }
    const queue: Action[] = [{ type: 'MOVE', from: m[1]!, to: m[2]! }];
    const sim = simulate(run, stage, queue, config);
    if (!sim.ok) { console.log(errorText(sim.error)); prompt(); return; }
    console.log('preview:');
    for (const e of sim.value.events) console.log(`  ${eventText(e)}`);
    if (sim.value.award) {
      console.log(`  award: ${sim.value.award.coins} coins (base ${sim.value.award.base}, par bonus ${sim.value.award.parBonus})`);
    }
    pending = queue;
    prompt();
  });
  rl.on('close', () => process.exit(0));
}

main();
