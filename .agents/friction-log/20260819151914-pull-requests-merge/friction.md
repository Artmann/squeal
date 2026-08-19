---
title:
  'Pull requests merge green and land red, because nothing rebases them onto the
  main they will sit on'
severity: 'major'
---

## Expected Behavior

A pull request whose checks are green is a pull request that is safe to merge.
If `main` is green and the pull request is green, `main` stays green afterwards.

## Current Behavior

Checks run against the pull request's own base, and nothing re-runs them against
the `main` the branch will actually land on. So two pull requests that rename in
one and use the old name in the other are both green, git reports no conflict —
they touch different files — and `main` breaks the moment the second one merges.

Merging today's 22 green pull requests broke `main` in three separate places at
once:

- `makeSquealTracer`'s sink became `emit`, one span at a time, in
  `refactor(tracing): give the tracer one span sink it cannot fail`. A test
  added in `refactor(tracing): delete the unused traceparent parser` still
  passed `persist`.
- The renderer's response helper became `jsonResponse` in
  `src/app/test-fetch.ts`. A span test added elsewhere still called
  `respondWith`.
- `truncated` moved onto the result in
  `refactor(queries): drop the duplicated truncated flag`. Two fixtures for a
  running query still set it at the top level.

The first two broke `tsc` on the backend project, which short-circuits before
the renderer project runs — so the third stayed hidden until the first two were
fixed, and the repair took three rounds of `yarn typecheck` rather than one.

## Possible Solution

Turn on "Require branches to be up to date before merging" on `main`. Every pull
request then has to be rebased onto current `main` and re-checked before it can
merge, which is exactly the run that catches this. The cost is a re-check per
merge, which matters more the more pull requests are open at once.

Failing that, a merge queue does the same thing without the manual rebase.

## Minimal Reproducible Example

Open two pull requests off the same `main`. In one, rename an exported symbol
and update its callers. In the other, add a test that calls the old name. Both
go green. Merge both. `main` is red.

## Context

Nothing warns you. The pull request page shows all checks passing and a green
merge button right up to the moment you use it, and the breakage surfaces on
`main`, after the fact, attributed to whichever pull request happened to merge
second.
