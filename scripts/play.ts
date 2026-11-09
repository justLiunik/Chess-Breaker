// Terminal playground for the M1 engine: one Act I stage, one move per turn. `npm run play`.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { loadEngineConfig } from '@checkbreaker/content';
import { commitQueue, simulate } from '@checkbreaker/engine';
import type {
  Action, BoardPiece, CommitError, GameEvent, PieceType, RunState, Square, StageState,
} from '@checkbreaker/engine';

const config = loadEngineConfig();

const GLYPH: Record<PieceType, string> = {
  king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p',
};
const PIECE_NAMES: Record<string, PieceType> = {
  king: 'king', queen: 'queen', rook: 'rook', bishop: 'bishop', knight: 'knight', pawn: 'pawn',
};

function buildStage(): StageState {
  const doc = parse(readFileSync(new URL('../content/examples/templates.yaml', import.meta.url), 'utf8')) as {
    templates: {
      id: string; turnLimit: number; focusPool: number; spawnPoints: number;
      fixedEnemy: Record<string, string>;
      enemyPolicy: { type: 'scripted'; line: string[]; fallbackDepth: number };
    }[];
  };
  const tpl = doc.templates.find((t) => t.id === 'tpl-act1-first-steps');
  if (!tpl) throw new Error('tpl-act1-first-steps not found in templates.yaml');
  const board: Record<Square, BoardPiece> = {};
  for (const [sq, name] of Object.entries(tpl.fixedEnemy)) {
    board[sq] = { pieceType: PIECE_NAMES[name]!, color: 'black' };
  }
  board.e1 = { pieceType: 'king', color: 'white', instanceId: 'p_king_01' };
  // Two starter minors: 3 + 3 spawn points, the template's whole budget of 6.
  board.b1 = { pieceType: 'knight', color: 'white', instanceId: 'p_knight_02' };
  board.f1 = { pieceType: 'bishop', color: 'white', instanceId: 'p_bishop_03' };
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
    phase: 'action',
    board,
    turnsUsed: 0,
    turnLimit: tpl.turnLimit,
    focus: tpl.focusPool,
    focusPool: tpl.focusPool,
    moveCredits: 1,
    spawnPoints: tpl.spawnPoints,
    modifiers: [],
    skillLog: [],
    enemyPolicy: { type: 'scripted', line: tpl.enemyPolicy.line, fallbackDepth: tpl.enemyPolicy.fallbackDepth },
    status: 'active',
  };
}

function buildRun(): RunState {
  return {
    version: 1, seed: '7F3A-2210', actIndex: 0, stageIndex: 0, coins: 0, deckCapacity: 8,
    deck: [], loadout: [], history: [], rngCursor: 0, status: 'in_progress',
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
    case 'stage_won': return `stage won: ${e.award.coins} coins (base ${e.award.base} + turn bonus ${e.award.turnBonus})`;
    case 'stage_lost': return `stage lost: ${e.endReason}`;
    case 'enemy_move': return `enemy moves ${e.from}-${e.to}`;
    case 'enemy_fell_back': return `enemy script ended or was blocked (cursor ${e.cursor}); it now searches`;
    case 'turn_started': return `turn ${e.turn} begins`;
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
  const rl = createInterface({ input: process.stdin });

  const show = (): void => {
    console.log(`\n${boardText(stage)}`);
    console.log(`turn ${stage.turnsUsed + 1}/${stage.turnLimit}   coins ${run.coins}   you are White (upper case)`);
  };
  const prompt = (): void => console.log(pending ? 'commit? (y/n)' : 'move (e.g. f1d3), help, quit:');
  const finish = (): void => {
    console.log(`\nstage ${stage.status}: ${stage.endReason}`);
    rl.close();
    process.exit(stage.status === 'won' ? 0 : 1);
  };

  console.log('Checkbreaker playground: tpl-act1-first-steps');
  console.log(HELP);
  show();
  prompt();

  rl.on('line', (raw) => {
    const line = raw.trim().toLowerCase();
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
      console.log(`  award: ${sim.value.award.coins} coins (base ${sim.value.award.base}, turn bonus ${sim.value.award.turnBonus})`);
    }
    pending = queue;
    prompt();
  });
  rl.on('close', () => process.exit(0));
}

main();
