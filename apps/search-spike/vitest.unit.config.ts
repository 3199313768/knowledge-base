import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts'],
    exclude: ['src/**/*.cloud.test.ts', 'src/**/*.external.test.ts']
  }
});
