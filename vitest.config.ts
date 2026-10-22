import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    pool: 'forks',
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
