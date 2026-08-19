import {
  Cause,
  Duration,
  Effect,
  Exit,
  Layer,
  Logger,
  Scope,
  TestClock
} from 'effect'
import { TestContext } from 'effect/TestContext'
import invariant from 'tiny-invariant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeTestAppDatabase } from '@/test/effect-test-helper'
import { RetentionLive } from './retention'

// The sweeps reach SQLite through the `@/database` singleton rather than
// through AppDatabase, so there is no layer to substitute for them yet — see
// issue #85. Mocking the two modules is what lets the shipped RetentionLive run
// exactly as `runtime.ts` builds it.
const { deleteExpiredQueries, deleteExpiredSpans } = vi.hoisted(() => ({
  deleteExpiredQueries: vi.fn<() => Promise<number>>(),
  deleteExpiredSpans: vi.fn<() => Promise<number>>()
}))

vi.mock('@/main/queries/query-retention', () => ({ deleteExpiredQueries }))

vi.mock('@/main/tracing/trace-retention', () => ({ deleteExpiredSpans }))

const logMessages: string[] = []

const captureLogs = Logger.replace(
  Logger.defaultLogger,
  Logger.make(({ message }) => {
    const parts = Array.isArray(message) ? message : [message]

    logMessages.push(String(parts[0]))
  })
)

// Hands control back to the runtime so the sweeps can make progress, without
// moving the clock. Written as a zero adjustment rather than a fixed number of
// yields because how many yields a pass needs grows with the list of sweeps —
// a count that is right today turns into false failures the day someone adds
// a line to it.
const settle = TestClock.adjust(Duration.zero)

function counts(): { queries: number; spans: number } {
  return {
    queries: deleteExpiredQueries.mock.calls.length,
    spans: deleteExpiredSpans.mock.calls.length
  }
}

function withRetention<A>(body: Effect.Effect<A, never, never>): Promise<A> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(
          RetentionLive.pipe(Layer.provide(makeTestAppDatabase()))
        )

        yield* settle

        return yield* body
      })
    ).pipe(Effect.provide(captureLogs), Effect.provide(TestContext))
  )
}

describe('RetentionLive', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    logMessages.length = 0

    deleteExpiredQueries.mockResolvedValue(0)
    deleteExpiredSpans.mockResolvedValue(0)
  })

  it('sweeps everything once when the layer is built', async () => {
    const swept = await withRetention(Effect.sync(counts))

    expect(swept).toEqual({ queries: 1, spans: 1 })
  })

  it('refuses to build without the app database', async () => {
    // Nothing in the fiber reads the client, so dropping the dependency would
    // still compile and still pass every other test here -- and retention
    // would be free to sweep a schema that has not been created yet. The cast
    // is the only way to ask for a build the type system is meant to refuse.
    const withoutTheDatabase = RetentionLive as unknown as Layer.Layer<never>

    const exit = await Effect.runPromiseExit(
      Effect.scoped(Layer.build(withoutTheDatabase)).pipe(
        Effect.provide(TestContext)
      )
    )

    invariant(Exit.isFailure(exit), 'The layer does not build.')

    expect(String(Cause.squash(exit.cause))).toContain('AppDatabase')
  })

  it('starts a sweep only once the one before it has finished', async () => {
    let releaseQueries: () => void = () => undefined

    deleteExpiredQueries.mockReturnValue(
      new Promise<number>((resolve) => {
        releaseQueries = () => resolve(0)
      })
    )

    const swept = await withRetention(
      Effect.gen(function* () {
        // A pass is one point in time, not two: the sweeps share the app
        // database and the schedule they run on, so they run in the order the
        // list gives them.
        const whileBlocked = counts()

        yield* Effect.sync(releaseQueries)
        yield* settle

        return { onceReleased: counts(), whileBlocked }
      })
    )

    expect(swept).toEqual({
      onceReleased: { queries: 1, spans: 1 },
      whileBlocked: { queries: 1, spans: 0 }
    })
  })

  it('runs the remaining sweeps after one of them fails', async () => {
    deleteExpiredQueries.mockRejectedValue(new Error('database is locked'))

    const swept = await withRetention(Effect.sync(counts))

    expect(swept).toEqual({ queries: 1, spans: 1 })
  })

  it('names the sweep that failed in the log', async () => {
    deleteExpiredSpans.mockRejectedValue(new Error('database is locked'))

    const swept = await withRetention(Effect.sync(counts))

    // The fiber has no other output. A failure nobody can attribute to a sweep
    // is the same as a failure nobody reported.
    expect({ logMessages: [...logMessages], swept }).toEqual({
      logMessages: ['Trace span cleanup failed'],
      swept: { queries: 1, spans: 1 }
    })
  })

  it('sweeps again a day later', async () => {
    const swept = await withRetention(
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.days(1))
        yield* settle

        return counts()
      })
    )

    expect(swept).toEqual({ queries: 2, spans: 2 })
  })

  it('does not sweep again before the day is up', async () => {
    const swept = await withRetention(
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.hours(23))
        yield* settle

        return counts()
      })
    )

    expect(swept).toEqual({ queries: 1, spans: 1 })
  })

  it('does not let a slow pass push the following days back', async () => {
    let releaseQueries: () => void = () => undefined

    deleteExpiredQueries.mockResolvedValueOnce(0)
    deleteExpiredQueries.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        releaseQueries = () => resolve(0)
      })
    )

    const swept = await withRetention(
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.hours(24))
        yield* settle

        const whenTheSecondPassStalls = counts()

        yield* TestClock.adjust(Duration.hours(1))
        yield* Effect.sync(releaseQueries)
        yield* settle

        const afterTheSecondPass = counts()

        // Two days in, with one pass having taken an hour. A cadence measured
        // from the end of each pass would be an hour late here, and an hour
        // later again after every slow pass -- so a machine that is busy every
        // day walks its maintenance around the clock.
        yield* TestClock.adjust(Duration.hours(23))
        yield* settle

        return {
          afterTheSecondPass,
          atTheSecondDayMark: counts(),
          whenTheSecondPassStalls
        }
      })
    )

    expect(swept).toEqual({
      afterTheSecondPass: { queries: 2, spans: 2 },
      atTheSecondDayMark: { queries: 3, spans: 3 },
      whenTheSecondPassStalls: { queries: 2, spans: 1 }
    })
  })

  it('keeps to the schedule after a sweep fails', async () => {
    deleteExpiredQueries.mockRejectedValue(new Error('database is locked'))

    const swept = await withRetention(
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.days(1))
        yield* settle

        return counts()
      })
    )

    expect(swept).toEqual({ queries: 2, spans: 2 })
  })

  it('stops sweeping when the scope closes', async () => {
    const swept = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()

        yield* Layer.buildWithScope(
          RetentionLive.pipe(Layer.provide(makeTestAppDatabase())),
          scope
        )

        yield* settle

        // The runtime scope closes on before-quit, and a sweep left running
        // would hold the app database open past disposal.
        yield* Scope.close(scope, Exit.void)

        yield* TestClock.adjust(Duration.days(2))
        yield* settle

        return counts()
      }).pipe(Effect.provide(captureLogs), Effect.provide(TestContext))
    )

    expect(swept).toEqual({ queries: 1, spans: 1 })
  })
})
