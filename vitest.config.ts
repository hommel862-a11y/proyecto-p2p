import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    alias: {
      '@p2p/core': path.resolve(__dirname, './projects/core/src/public-api.ts'),
    },
  },
});
