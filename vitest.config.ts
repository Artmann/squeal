import react from '@vitejs/plugin-react'
import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

// The split is by environment, and this list is the whole of it: everything
// named here runs in a plain node environment, and the renderer project is
// whatever is left, under jsdom. So it has to name the main process too --
// `src/main.ts` and `src/main/**` are the least renderer-like code in the
// repository, and leaving them out put them in the project called `renderer`
// while `--project backend src/main.test.ts` answered `No test files found`.
//
// One array for both sides: it is the backend project's `include` and the
// renderer project's `exclude`, so a path added here moves rather than
// duplicates.
const backendTestPatterns = [
  'scripts/**/*.test.ts',
  'src/build/**/*.test.ts',
  'src/glue/**/*.test.ts',
  'src/main.test.ts',
  'src/main/**/*.test.ts',
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
