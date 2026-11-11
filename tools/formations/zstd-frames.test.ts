import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dataFrames, readLines } from './extract';

const skippable = (nibble: number, payload: number): Buffer => {
  const b = Buffer.alloc(8 + payload, 0xa5);
  b.writeUInt32LE(0x184d2a50 + nibble, 0);
  b.writeUInt32LE(payload, 4);
  return b;
};
const frame = (text: string): Buffer => zlib.zstdCompressSync(Buffer.from(text));
const ROWS = ['PuzzleId,FEN,Moves,Rating', 'aaaaa,fen one,e2e4 e7e5,1500', 'bbbbb,fen two,d2d4 d7d5,1600', 'ccccc,fen three,g1f3 g8f6,1700'];

function withFile<T>(buf: Buffer, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'zstd-frames-'));
  const path = join(dir, 'x.csv.zst');
  writeFileSync(path, buf);
  return fn(path).finally(() => rmSync(dir, { recursive: true, force: true }));
}
const collect = async (path: string, hwm?: number): Promise<string[]> => {
  const out: string[] = [];
  for await (const l of readLines(path, hwm)) out.push(l);
  return out;
};

describe('multi-frame .zst reading', () => {
  // Row "bbbbb" is cut in the middle between the two data frames.
  const text = `${ROWS.join('\n')}\n`;
  const cut = text.indexOf('bbbbb') + 3;
  const buf = Buffer.concat([skippable(0, 4), frame(text.slice(0, cut)), skippable(0, 4), frame(text.slice(cut)), skippable(0, 4)]);

  it('finds the two data frames between skippable frames', async () => {
    await withFile(buf, async (path) => {
      const frames = await dataFrames(path);
      expect(frames).toHaveLength(2);
      expect(frames[0]![0]).toBe(12);
      expect(frames[1]![1]).toBe(buf.length - 12);
    });
  });

  it('round-trips the lines, including a row split across frames', async () => {
    await withFile(buf, async (path) => expect(await collect(path)).toEqual(ROWS));
  });

  it('survives tiny read chunks that straddle the skippable header', async () => {
    await withFile(buf, async (path) => {
      for (const hwm of [1, 3, 7, 8, 13]) {
        expect(await collect(path, hwm)).toEqual(ROWS);
        expect(await dataFrames(path, hwm)).toEqual(await dataFrames(path));
      }
    });
  });

  it('accepts any skippable magic nibble and payload size', async () => {
    const odd = Buffer.concat([frame(`${ROWS[0]}\n${ROWS[1]}\n`), skippable(15, 0), frame(`${ROWS[2]}\n`), skippable(7, 37), frame(`${ROWS[3]}\n`)]);
    await withFile(odd, async (path) => {
      expect(await dataFrames(path)).toHaveLength(3);
      expect(await collect(path, 5)).toEqual(ROWS);
    });
  });

  it('reads a file with no skippable frames as one frame', async () => {
    await withFile(frame(`${ROWS.join('\n')}\n`), async (path) => {
      expect(await dataFrames(path)).toHaveLength(1);
      expect(await collect(path)).toEqual(ROWS);
    });
  });

  it('ignores skippable-looking bytes inside compressed data', async () => {
    const fake = Buffer.from([0x5f, 0x2a, 0x4d, 0x18, 0xff, 0xff, 0xff, 0x7f]);
    const body = Buffer.concat([Buffer.from(`${ROWS[0]}\n${ROWS[1]}\n`), fake, Buffer.from('\n'), Buffer.from(`${ROWS[2]}\n`)]);
    await withFile(Buffer.concat([zlib.zstdCompressSync(body), skippable(0, 4), frame(`${ROWS[3]}\n`)]), async (path) => {
      expect(await dataFrames(path)).toHaveLength(2);
      const got = await collect(path);
      expect(got[0]).toBe(ROWS[0]);
      expect(got.at(-1)).toBe(ROWS[3]);
      expect(got).toHaveLength(5);
    });
  });
});
