---
title:
  'Three timing-sensitive tests flake in the full suite but pass in isolation'
severity: 'minor'
---

## Expected Behavior

`yarn test` on an unchanged tree passes every time, so a failure means the diff
in front of you broke something.

## Current Behavior

The full run fails intermittently in tests that assert on wall-clock behaviour.
Three have been seen, each in a different file, each passing 3/3 when its own
file is run alone:

- `src/server/tracing/effect-tracer.test.ts` > "writes spans that end within the
  linger window as one batch" — `expected [ 2, 2 ] to deeply equal [ 4 ]`. The
  batch splits when the worker stalls mid-window.
- `src/app/components/traces/TraceDashboard.test.tsx` > "shows an error state
  and recovers on retry".
- `src/app/components/DatabaseForm.test.tsx` > "drops a verdict that arrives
  after the connection changed".

They are load-sensitive rather than order-sensitive, so re-running with a
different `--sequence.seed` does not reproduce them and a plain retry always
passes.

## Possible Solution

Assert on the observable outcome rather than on how work was divided across a
real time window — for the tracer test, drive the linger window with fake timers
so a stalled worker cannot split the batch. Failing that, `retry: 2` on the
three tests would at least stop them reading as regressions.

## Minimal Reproducible Example

    for i in 1 2 3 4 5 6 7; do yarn test --run | grep -E '^ +Tests '; done

Two of seven runs failed on one machine, in two different files, while six
baseline runs on the same tree passed.

## Context

A failure in one of these looks exactly like a regression from whatever you just
changed, and none of the three is anywhere near the code under change. Ruling it
out means stashing the work, running the whole suite several times on the
baseline, unstashing, and running it several times again — about ten minutes
before you can trust your own diff.

Suite duration on the same machine varies from 19s to 40s run to run with no
change in the tree, which is what makes these fail.
