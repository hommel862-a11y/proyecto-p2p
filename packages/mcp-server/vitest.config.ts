import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  root: '.',
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: ['src/test/**', 'src/**/*.spec.ts', 'src/**/*.test.ts', 'dist/**', '.mcp/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    testTimeout: 30000,
    hookTimeout: 10000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    reporters: ['verbose', 'json'],
    outputFile: {
      json: './test-results.json',
    },
  },
  resolve: {
    alias: {
      '@p2p/mcp-server': path.resolve(__dirname, 'src'),
    },
  },
});
