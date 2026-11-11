// Offline tool: extract enemy starting formations from the Lichess puzzle database (CC0).
// The defender's pieces (the side that just moved in Moves[0]) become Black; see docs/04 and spec §8.1.
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { Chess } from 'chess.js';
import { enemyArmyValue, loadGenConfig, loadTemplates, valueBandFor } from '@checkbreaker/content';
import type { Formation, GenConfig, Template } from '@checkbreaker/content';
import { hash, mix32 } from '@checkbreaker/engine';
import type { PieceType } from '@checkbreaker/engine';

export type PuzzleRow = { id: string; fen: string; moves: string; rating: number };
export type RejectReason = 'zone' | 'army' | 'value' | 'pawn_rank8';

const TYPE_OF: Record<string, PieceType> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** One CSV line (`PuzzleId,FEN,Moves,Rating,…`); null when it has too few columns or a bad rating. */
export function parseRow(line: string): PuzzleRow | null {
  const cols = line.replace(/\r$/, '').split(',');
  if (cols.length < 4) return null;
  const [id, fen, moves, ratingText] = cols as [string, string, string, string];
  const rating = Number(ratingText);
  if (id === '' || fen === '' || moves === '' || ratingText.trim() === '' || !Number.isFinite(rating)) return null;
  return { id, fen, moves, rating };
}

function expand(placement: string): string[] {
  return placement.split('/').map((r) => r.replace(/[1-8]/g, (d) => '.'.repeat(Number(d))));
}

function compress(ranks: string[]): string {
  return ranks.map((r) => r.replace(/\.+/g, (dots) => String(dots.length))).join('/');
}

/** Black-only FEN placement of the defending side after Moves[0]; null if chess.js rejects the FEN or the move. */
export function defenderPlacement(row: PuzzleRow): string | null {
  try {
    const chess = new Chess(row.fen);
    const m = row.moves.split(' ')[0] ?? '';
    chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length > 4 ? m.slice(4, 5) : undefined });
    const defenderIsWhite = chess.turn() === 'b';
    let ranks = expand(chess.fen().split(' ')[0] ?? '');
    if (defenderIsWhite) {
      ranks = ranks.reverse().map((r) => [...r].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''));
    }
    return compress(ranks.map((r) => [...r].map((c) => (/[a-z]/.test(c) ? c : '.')).join('')));
  } catch {
    return null;
  }
}

/** Left-right mirror of a placement. */
export function mirrorPlacement(black: string): string {
  return compress(expand(black).map((r) => [...r].reverse().join('')));
}

export function rejectReason(black: string, tpl: Template, config: GenConfig): RejectReason | null {
  const ranks = expand(black);
  const counts: Partial<Record<PieceType, number>> = {};
  const pieces: PieceType[] = [];
  let zoneOk = true;
  let pawnOnRank8 = false;
  ranks.forEach((r, i) => {
    const rank = 8 - i;
    for (const c of r) {
      const t = TYPE_OF[c];
      if (!t) continue;
      counts[t] = (counts[t] ?? 0) + 1;
      pieces.push(t);
      if (tpl.enemyZone && !tpl.enemyZone.includes(rank)) zoneOk = false;
      if (t === 'pawn' && rank === 8) pawnOnRank8 = true;
    }
  });
  if (!zoneOk) return 'zone';

  if ((counts.king ?? 0) !== 1) return 'army';
  if (tpl.enemyArmy) {
    const army = tpl.enemyArmy;
    for (const t of Object.keys(counts) as PieceType[]) {
      if (t !== 'king' && !(t in army)) return 'army';
    }
    for (const t of Object.keys(army) as PieceType[]) {
      const [lo, hi] = army[t] as [number, number];
      const n = counts[t] ?? 0;
      if (n < lo || n > hi) return 'army';
    }
  }

  const [lo, hi] = valueBandFor(tpl.act, tpl.tier, config);
  const value = enemyArmyValue(pieces, config);
  if (value < lo || value > hi) return 'value';
  if (pawnOnRank8) return 'pawn_rank8';
  return null;
}

type Survivor = { id: string; rating: number; black: string };

type Stats = { rows: number; malformed: number; rejected: Record<string, Record<string, number>> };
type Extraction = { byTemplate: Record<string, Formation[]>; stats: Stats };

/** Incremental form of extractFormations, so the CLI can stream millions of rows without holding them. */
export function createExtractor(templates: Template[], config: GenConfig): {
  add(row: PuzzleRow | null): void;
  finish(): Extraction;
} {
  const active = templates.filter((t) => t.placement !== 'fixed');
  const survivors: Record<string, Survivor[]> = {};
  const rejected: Record<string, Record<string, number>> = {};
  for (const t of active) {
    survivors[t.id] = [];
    rejected[t.id] = {};
  }
  let count = 0;
  let malformed = 0;
  return {
    add(row) {
      count++;
      const black = row ? defenderPlacement(row) : null;
      if (!row || black === null) {
        malformed++;
        return;
      }
      for (const t of active) {
        const why = rejectReason(black, t, config);
        if (why === null) survivors[t.id]!.push({ id: row.id, rating: row.rating, black });
        else rejected[t.id]![why] = (rejected[t.id]![why] ?? 0) + 1;
      }
    },
    finish() {
      const max = config.gen.formations.maxPerTemplate;
      const byTemplate: Record<string, Formation[]> = {};
      for (const t of active) {
        const key = (s: Survivor) => mix32(hash(s.id));
        const sorted = survivors[t.id]!.sort((x, y) => key(x) - key(y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
        const seen = new Set<string>();
        const kept: Formation[] = [];
        for (const s of sorted) {
          if (kept.length >= max) break;
          if (seen.has(s.black) || seen.has(mirrorPlacement(s.black))) continue;
          seen.add(s.black);
          kept.push({ id: s.id, rating: s.rating, black: s.black });
        }
        byTemplate[t.id] = kept;
      }
      return { byTemplate, stats: { rows: count, malformed, rejected } };
    },
  };
}

export function extractFormations(rows: Iterable<PuzzleRow | null>, templates: Template[], config: GenConfig): Extraction {
  const ex = createExtractor(templates, config);
  for (const r of rows) ex.add(r);
  return ex.finish();
}

async function* readLines(source: string): AsyncIterable<string> {
  const input = source.endsWith('.csv')
    ? createReadStream(source)
    : createReadStream(source).pipe(zlib.createZstdDecompress());
  yield* createInterface({ input, crlfDelay: Infinity });
}

async function* rowsOf(source: string): AsyncIterable<PuzzleRow | null> {
  for await (const line of readLines(source)) {
    if (line === '' || line.startsWith('PuzzleId,')) continue;
    yield parseRow(line);
  }
}

async function sha256Of(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

function option(argv: string[], name: string, fallback: string): string {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : fallback;
}

export async function main(argv: string[]): Promise<void> {
  const source = resolve(option(argv, '--source', '.cache/lichess/lichess_db_puzzle.csv.zst'));
  const out = resolve(option(argv, '--out', 'content/formations'));
  if (!source.endsWith('.csv') && typeof (zlib as { createZstdDecompress?: unknown }).createZstdDecompress !== 'function') {
    console.error('the extractor needs Node ≥ 22.15 (zlib zstd)');
    process.exit(1);
  }
  const config = loadGenConfig();
  const templates = loadTemplates();
  const ex = createExtractor(templates, config);
  for await (const row of rowsOf(source)) ex.add(row);
  const result = ex.finish();
  const date = statSync(source).mtime.toISOString().slice(0, 10);
  const sha256 = await sha256Of(source);

  mkdirSync(out, { recursive: true });
  for (const t of templates) {
    const formations = result.byTemplate[t.id];
    if (!formations) continue;
    const doc = {
      templateId: t.id,
      source: { url: 'https://database.lichess.org/#puzzles', licence: 'CC0', date, sha256 },
      filters: {
        enemyZone: t.enemyZone,
        enemyArmy: t.enemyArmy,
        valueBand: valueBandFor(t.act, t.tier, config),
        noPawnOnRank8: true,
      },
      formations,
    };
    writeFileSync(join(out, `${t.id}.json`), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    console.log(`${t.id}: ${formations.length} formations`);
  }
  console.log(`rows ${result.stats.rows}, malformed ${result.stats.malformed}`);
  console.log(JSON.stringify(result.stats.rejected));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
