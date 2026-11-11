export function hash(...parts: (string | number)[]): number {
  const bytes = new TextEncoder().encode(parts.map(String).join('|'));
  let h = 2166136261;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: string, cursor: number): { value: number; next: number } {
  return { value: hash(seed, cursor) / 2 ** 32, next: cursor + 1 };
}

export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function draw(seed: string, ...parts: (string | number)[]): number {
  return mix32(hash(seed, ...parts)) / 2 ** 32;
}
