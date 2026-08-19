import react from '@vitejs/plugin-react'
import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

// Tests for backend code (pure glue modules and, as the Effect migration
// lands, src/server) run in a plain node environment. Everything else keeps
// the jsdom environment the React tests need.
const backendTestPatterns = [
  'scripts/**/*.test.ts',
  'src/glue/**/*.test.ts',
  'src/server/**/*.test.ts'
]

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
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
