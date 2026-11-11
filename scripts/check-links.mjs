// Checks relative markdown links and #anchors (GitHub slug rules) across the repo's docs.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ?? '.';
const files = ['README.md', ...readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

const slug = (h) =>
  h.trim().toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const anchorsOf = (file) => {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  const seen = new Map();
  const out = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
};

let bad = 0;
let total = 0;
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const text = readFileSync(abs, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    total += 1;
    const [p, anchor] = target.split('#');
    const dest = p ? path.resolve(path.dirname(abs), p) : abs;
    if (!existsSync(dest)) {
      console.log(`MISSING FILE  ${rel}: ${target}`);
      bad += 1;
      continue;
    }
    if (anchor && dest.endsWith('.md') && !anchorsOf(dest).has(anchor)) {
      console.log(`MISSING ANCHOR  ${rel}: ${target}`);
      bad += 1;
    }
  }
}
console.log(`${total} links checked, ${bad} broken`);
process.exit(bad ? 1 : 0);
