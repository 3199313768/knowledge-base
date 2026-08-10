import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts'],
    exclude: ['src/**/*.cloud.test.ts'],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
