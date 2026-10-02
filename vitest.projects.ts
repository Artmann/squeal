// The split is by environment, and this list is the whole of it: everything
// named here runs in a plain node environment, and the renderer project is
// whatever is left, under jsdom. So it has to name the main process too --
// `src/main.ts` and `src/main/**` are the least renderer-like code in the
// repository, and leaving them out put them in the project called `renderer`
// while `--project backend src/main.test.ts` answered `No test files found`.
// `src/database`, `src/databases` and `src/test` were missed the same way: the
// app database, the user-database adapters, and the helpers that build both
// for tests are all imported by `src/server`, and their tests ran under jsdom.
//
// One array for both sides: it is the backend project's `include` and the
// renderer project's `exclude` in `vitest.config.ts`, so a path added here
// moves rather than duplicates.
//
// It lives apart from `vitest.config.ts` so that `src/vitest-projects.test.ts`
// can import it without loading Vite and its plugins. That test fails when a
// folder the backend imports from has a test this list does not cover.
export const backendTestPatterns = [
  'scripts/**/*.test.ts',
  'src/build/**/*.test.ts',
  'src/database/**/*.test.ts',
  'src/databases/**/*.test.ts',
  'src/glue/**/*.test.ts',
  'src/main.test.ts',
  'src/main/**/*.test.ts',
  'src/server/**/*.test.ts',
  'src/test/**/*.test.ts'
]
