import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node'
  },
  resolve: {
    alias: {
      '@color-wheel/codec': new URL('./packages/codec/src/index.ts', import.meta.url).pathname
    }
  }
});
