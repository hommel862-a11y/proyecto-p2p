import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  test: {
    include: ['**/*.spec.ts'],
    environment: 'node',
  },
});
