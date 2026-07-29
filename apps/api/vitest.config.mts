/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';

// Named vitest.config (not vite.config) on purpose: @nx/vite/plugin then infers
// only a `test` target and leaves the webpack build/serve targets in
// package.json alone.
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/api',
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
}));
