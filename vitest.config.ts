import react from '@vitejs/plugin-react'
import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

import { backendTestPatterns } from './vitest.projects'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    // Off unless asked for with `--coverage` (`yarn test:coverage`), so a plain
    // `yarn test` stays as fast as it was.
    coverage: {
      exclude: ['**/*.test.{ts,tsx}', '**/test-*.{ts,tsx}'],
      include: ['scripts/**/*.ts', 'src/**/*.{ts,tsx}'],
      provider: 'v8',
      // CI puts the totals on the run summary even when a test failed.
      reportOnFailure: true,
      reporter: ['html', 'json-summary', 'text-summary']
    },
    globals: true,
    // The default 5s is generous for these tests in isolation but not under
    // load: with several vitest processes competing for CPU, unrelated tests
    // start timing out and look like a flake in whatever changed last.
    testTimeout: 20000,
    projects: [
      {
        extends: true,
        test: {
          environment: 'node',
          include: backendTestPatterns,
          name: 'backend',
          setupFiles: ['./vitest.setup.ts']
        }
      },
      {
        extends: true,
        test: {
          environment: 'jsdom',
          exclude: [...configDefaults.exclude, ...backendTestPatterns],
          name: 'renderer',
          setupFiles: ['./vitest.setup.ts']
        }
      }
    ]
  }
})
