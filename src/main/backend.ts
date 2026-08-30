// The backend behind a promise-shaped door, so `src/main.ts` can reach it
// through a dynamic import.
//
// That indirection is the whole reason this module exists. Everything Effect
// touches lives on this side of it: importing `@/server/runtime` pulls in
// `effect`, `drizzle-orm` and the libsql driver, which together are around half
// a second of module evaluation. Statically imported from `src/main.ts` that
// half second was spent before Electron's `ready` even fired — so before any
// window could exist, whatever else the app was going to do. Loaded from here,
// it happens behind a window that is already on screen.
//
// Keeping it a real module boundary rather than a lazy call inside `runtime.ts`
// is what makes Rollup emit it as its own chunk, which is what actually defers
// the evaluation.
import { Cause, Effect, Exit } from 'effect'

import { makeMainRuntime, type MainRuntimeOptions } from '@/server/runtime'

/**
 * How the boot came back, with Effect's vocabulary already resolved into
 * something `src/main.ts` can branch on without importing any of it.
 */
export type BootOutcome =
  | { error: unknown; status: 'failed' }
  // The layer build was interrupted rather than failing on its own, which is
  // what a quit landing mid-boot looks like. A shutdown, not a boot failure —
  // so nothing to report and no dialog to raise.
  | { status: 'interrupted' }
  | { status: 'ready' }

export interface Backend {
  boot: () => Promise<BootOutcome>
  dispose: () => Promise<void>
}

export function makeBackend(options: MainRuntimeOptions): Backend {
  const runtime = makeMainRuntime(options)

  return {
    // Forces the runtime layer to build: the app database initializes,
    // interrupted queries are reconciled, the encryption migration runs
    // (safeStorage is only reliable once the app is ready), and only then does
    // the HTTP server start listening.
    boot: async () => {
      const exit = await runtime.runPromiseExit(Effect.void)

      if (Exit.isFailure(exit)) {
        if (Cause.isInterruptedOnly(exit.cause)) {
          return { status: 'interrupted' }
        }

        return { error: Cause.squash(exit.cause), status: 'failed' }
      }

      return { status: 'ready' }
    },
    dispose: () => runtime.dispose()
  }
}
