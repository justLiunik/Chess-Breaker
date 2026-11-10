import { describe, expect, it } from 'vitest';
import { applyPlayerMove } from '../src/queue';
import { config, stageOf } from './helpers';

describe('applyPlayerMove', () => {
  const cases: [string, string, number][] = [
    ['n', 'knight', 1], ['p', 'pawn', 0], ['q', 'queen', 3], ['r', 'rook', 1],
  ];
  for (const [letter, type, salvage] of cases) {
    it(`capturing a black ${type} pays salvage ${salvage}`, () => {
      const s = stageOf({ e1: 'K', a1: 'R', a5: letter, h8: 'k' });
      const r = applyPlayerMove(s.board, 'a1', 'a5', config);
      expect(r.salvage).toBe(salvage);
      expect(r.board['a5']).toMatchObject({ pieceType: 'rook', color: 'white' });
      expect(r.board['a1']).toBeUndefined();
      expect(r.events).toEqual([
        { type: 'move', from: 'a1', to: 'a5', pieceType: 'rook', color: 'white' },
        { type: 'capture', square: 'a5', pieceType: type, color: 'black', salvage, stageId: s.board['a5']!.stageId },
      ]);
    });
  }

  it('leaves the frozen input board untouched', () => {
    const s = stageOf({ e1: 'K', a1: 'R', a5: 'n', h8: 'k' });
    const r = applyPlayerMove(s.board, 'a1', 'a5', config);
    expect(r.board).not.toBe(s.board);
    expect(s.board['a1']).toBeDefined();
    expect(s.board['a5']).toMatchObject({ pieceType: 'knight' });
  });

  it('plain move emits only a move event with zero salvage', () => {
    const s = stageOf({ e1: 'K', a1: 'R', h8: 'k' });
    const r = applyPlayerMove(s.board, 'a1', 'a4', config);
    expect(r.salvage).toBe(0);
    expect(r.events.map((e) => e.type)).toEqual(['move']);
  });

  it('white pawn c7 to c8 vanishes and reports the promotion (resolveQueue emits pawn_promoted)', () => {
    const s = stageOf({ e1: 'K', c7: 'P', h8: 'k' });
    const r = applyPlayerMove(s.board, 'c7', 'c8', config);
    expect(r.board['c8']).toBeUndefined();
    expect(r.board['c7']).toBeUndefined();
    expect(r.events).toEqual([
      { type: 'move', from: 'c7', to: 'c8', pieceType: 'pawn', color: 'white' },
    ]);
    expect(r.promoted).toEqual({ square: 'c8', promotesTo: { pieceType: 'knight', rarity: 'normal' } });
  });

  it('pawn capturing onto rank 8 emits move, capture and reports the promotion', () => {
    const s = stageOf({ e1: 'K', c7: 'P', d8: 'r', h8: 'k' });
    const r = applyPlayerMove(s.board, 'c7', 'd8', config);
    expect(r.board['d8']).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(['move', 'capture']);
    expect(r.promoted?.square).toBe('d8');
    expect(r.salvage).toBe(1);
  });

  it('white pawn without promotesTo still leaves the board, move event only', () => {
    const s = stageOf({ e1: 'K', c7: 'P', h8: 'k' });
    const bare = { ...s.board, c7: { pieceType: 'pawn' as const, color: 'white' as const } };
    const r = applyPlayerMove(bare, 'c7', 'c8', config);
    expect(r.board['c8']).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(['move']);
  });

  it('salvage disabled: capture event still emitted with salvage 0', () => {
    const s = stageOf({ e1: 'K', a1: 'R', a5: 'q', h8: 'k' });
    const off = { ...config, economy: { ...config.economy, salvage: { enabled: false, divisor: 3 } } };
    const r = applyPlayerMove(s.board, 'a1', 'a5', off);
    expect(r.salvage).toBe(0);
    expect(r.events[1]).toMatchObject({ type: 'capture', salvage: 0 });
  });
});
