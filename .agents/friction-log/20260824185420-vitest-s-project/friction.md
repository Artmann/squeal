---
title:
  "vitest's project split puts src/main.test.ts in the renderer project, so
  --project backend cannot run it"
severity: 'minor'
---

## Expected Behavior

Running a main-process test file names the project its environment implies:
`src/main.test.ts` declares `// @vitest-environment node`, so
`npx vitest run --project backend src/main.test.ts` runs it.

## Current Behavior

It answers `No test files found, exiting with code 1`. The projects in
`vitest.config.ts` are split by path glob, not by environment, and
`backendTestPatterns` names `scripts/**`, `src/build/**`, `src/glue/**` and
`src/server/**`. `src/main.test.ts` and `src/main/**/*.test.ts` match none of
them, so they fall into the `renderer` project's exclude-everything-else branch
and run there — under `jsdom`, except that each file overrides the environment
back to node with a pragma.

So the main process, which is the least renderer-like code in the repo, is
tested by the project called `renderer`, and the project called `backend` cannot
see it. The failure mode is the misleading part: exit code 1 with
`No test files found` reads as "your filter has a typo", not as "right file,
wrong project", and the filter it prints back is correct.

## Possible Solution

Add `src/main.test.ts` and `src/main/**/*.test.ts` to `backendTestPatterns` and
drop the `// @vitest-environment node` pragmas they carry, or name the projects
after the glob they actually hold rather than after a process.

## Minimal Reproducible Example

```
$ npx vitest run --project backend src/main.test.ts
No test files found, exiting with code 1
filter: src/main.test.ts
projects: backend

$ npx vitest run --project renderer src/main.test.ts
Test Files  1 passed (1)
```

## Context

Hit while adding cases to `src/main.test.ts` for a new `ipcMain.handle` channel.
The first run looked like the new cases had broken the file's discovery, so the
next move was to go and re-read what had just been written rather than to try
the other project.
