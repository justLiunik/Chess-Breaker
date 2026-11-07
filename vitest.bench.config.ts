import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/bench.test.ts'],
    fileParallelism: false,
  },
});
