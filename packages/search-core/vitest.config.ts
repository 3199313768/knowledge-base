import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['src/**/*.model.test.ts']
  }
});
