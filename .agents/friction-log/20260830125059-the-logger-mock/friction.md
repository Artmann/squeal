---
title:
  'The logger mock in src/main.test.ts omits log.info, so adding one log line
  fails 12 unrelated cases'
severity: 'minor'
---

## Expected Behavior

Adding a `log.info(...)` call to `src/main.ts` should not break tests that have
nothing to do with logging.

## Current Behavior

`src/main.test.ts` mocks `tiny-typescript-logger` with an object literal
carrying only the methods `main.ts` happened to call at the time:

```ts
const logger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn()
}))

vi.mock('tiny-typescript-logger', () => ({ log: logger }))
```

The first `log.info` in `main.ts` therefore failed 12 of the file's cases at
once with `TypeError: log.info is not a function` — including every window,
quit, dispose and dock-click case, none of which log anything. The message names
the logger, but the stack points into `main.ts`, so it reads as a fault in the
code under test rather than a gap in its mock.

## Possible Solution

Give the mock the whole logger surface rather than the subset currently in use,
so adding a log line is not a test change:

```ts
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn()
}))
```

The same shape appears in other suites that mock this logger, so it is worth
doing wherever the partial literal is repeated.

## Minimal Reproducible Example

1. Add `log.info('anything')` anywhere in `src/main.ts`.
2. `yarn test src/main.test.ts`.
3. 12 cases fail with `TypeError: log.info is not a function`.

## Context

Hit while adding one line of boot timing to `main.ts` to measure startup. The
line was correct and the failures were unrelated to it, so the first read was
that the timing change had broken the lifecycle — the actual fix was three words
in the mock.
