---
title: 'yarn test and yarn format:check fail on a clean Windows checkout'
severity: 'minor'
---

### Expected Behavior

`yarn test` and `yarn format:check` pass on a clean checkout of `main` on
Windows, so a failure means the change under test broke something.

### Current Behavior

On a clean Windows checkout with `core.autocrlf=true` (the Git for Windows
default):

- `yarn format:check` reports format issues in 424 of 425 files, because every
  file is checked out with CRLF line endings.
- 8 backend tests fail: `connects and executes SELECT 1` in
  `src/databases/sqlite-adapter.test.ts`, all six in
  `src/databases/sqlite-adapter.foreign-keys.test.ts`, and `loads the schema of
  a SQLite file with a foreign key that names no column` in
  `src/server/http/databases.test.ts`. The adapter builds
  `file:///C:/path/to/database.sqlite` from a POSIX path, and the tests expect
  `file:///path/to/database.sqlite`.

Both drown out a real failure, so every Windows run starts with working out
which failures are yours.

### Possible Solution

Add a `.gitattributes` with `* text=auto eol=lf` so checkouts match what oxfmt
writes. Make the SQLite tests build their expected URL with `pathToFileURL` from
the same input instead of hard-coding a POSIX one.

### Minimal Reproducible Example

On Windows: `git worktree add ../x origin/main`, then in it
`yarn install --frozen-lockfile && yarn format:check && yarn test`.
