import { defineConfig } from 'vitest/config';

const exclude = ['**/node_modules/**', '**/bench.test.ts'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'tools/**/*.test.ts'],
          exclude,
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/test/**/*.test.{ts,tsx}'],
          exclude,
        },
      },
    ],
  },
});
