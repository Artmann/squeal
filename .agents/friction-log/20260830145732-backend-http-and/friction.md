---
title:
  'Backend HTTP and subprocess tests flake under load, on an unchanged main'
severity: 'minor'
---

## Expected Behavior

`yarn test` on an unchanged tree passes every time, so a failure means the diff
in front of you broke something.

## Current Behavior

A second family of intermittent failures, separate from the three
timing-sensitive renderer tests logged before it, and reproducing on an
unmodified `main`. All of them are in the `backend` project, and all of them
cross a real process boundary rather than asserting on a time window:

- `src/server/http/api.test.ts` > `authentication` > "serves /health without a
  token" —
  `(FiberFailure) ResponseError: Decode error (200 GET http://127.0.0.1:49533/health)`.
  A 200 whose body did not decode, so this is the response rather than a
  timeout.
- `src/server/http/api.test.ts` > `cors` > "allows the origin a packaged
  renderer sends"
- `src/server/http/worksheets.test.ts` > "creates a worksheet with a 201 and
  persists it"
- `src/server/http/worksheets.test.ts` > "updates a worksheet"
- `scripts/seed-config.test.ts` > `the seed targets` > "lets the surrounding
  environment win over .env" and "points the seed itself at the server .env
  names" — these two spawn `tsx` child processes through `execFileSync`.

Measured rates, one failure per run, never the same case twice in a row:

- unmodified `main`, `--project backend`, 8 runs: 1 failure
- a branch touching none of these files, `--project backend`, 6 runs: 1 failure
- full `yarn test`, 8 runs: 3 failures across 3 different files

Like the earlier entry, they are load-sensitive rather than order-sensitive: a
plain re-run always passes, and they cluster when something else is competing
for CPU.

## Possible Solution

Not one fix, because these are two mechanisms:

The HTTP cases stand up a real server on an ephemeral port and make a real
request through `@effect/platform-node`'s client. A `Decode error` on a 200 says
the body arrived wrong, not late, so this wants reading before it wants a longer
timeout — a response the client began decoding before it was complete would
explain it.

The `seed-config` cases spawn `tsx` per case, which is seconds of work each and
the most load-sensitive thing in the suite. Resolving the targets in-process, or
reusing one child across the cases, removes the exposure.

## Minimal Reproducible Example

    for i in $(seq 1 8); do npx vitest run --project backend 2>&1 | grep -E '^ +Tests '; done

One of eight failed on an unmodified `main`. Under eight competing CPU-bound
processes the rate goes up.

## Context

Found while fixing the three tests in `20260819113459-three-timing-sensitive`,
and easy to confuse with them: the symptom is identical — one test in a file
nowhere near your change, passing on the re-run — but none of the three fixes
there touch these, and these reproduce on a stashed tree. Ruling one out does
not rule out the other, so anyone chasing a flake here should check which family
they have before spending time on it.
