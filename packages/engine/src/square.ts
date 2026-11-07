import type { Square } from './types';

const FILES = 'abcdefgh';

export function toIndex(sq: Square): number {
  return FILES.indexOf(sq[0]!) + 8 * (Number(sq[1]) - 1);
}

export function toSquare(i: number): Square {
  return `${FILES[i % 8]}${Math.floor(i / 8) + 1}`;
}

export function fileOf(i: number): number {
  return i % 8;
}

export function rankOf(i: number): number {
  return Math.floor(i / 8);
}

export function isSquare(s: string): boolean {
  return /^[a-h][1-8]$/.test(s);
}
