import {
  Cause,
  Context,
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
import { firstSweepDelay, RetentionLive } from './retention'
import { AppDatabase, type AppDatabaseClient } from './services/app-database'

// The sweeps are the subject of their own tests, against their own databases.
// What is being checked here is the fiber around them — the order, the
// schedule, and what a failure does to both — so they are mocked out to
// something that resolves on command. That leaves the shipped RetentionLive
// running exactly as `runtime.ts` builds it.
const { deleteExpiredQueries, deleteExpiredSpans } = vi.hoisted(() => ({
  deleteExpiredQueries: vi.fn<(client: AppDatabaseClient) => Promise<number>>(),
  deleteExpiredSpans: vi.fn<(client: AppDatabaseClient) => Promise<number>>()
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

        // Past the startup delay, so the cases below all start from the first
        // pass having run. The delay itself is its own case.
        yield* TestClock.adjust(firstSweepDelay)
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

  // The sweeps used to start the instant the layer built, which put two
  // synchronous DELETEs on the event loop while the window was still being
  // created — the driver blocks the main process, so that was first paint
  // waiting on retention. Nothing may run before the delay is up.
  it('sweeps nothing until the startup delay is up', async () => {
    const swept = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            RetentionLive.pipe(Layer.provide(makeTestAppDatabase()))
          )

          // Everything the runtime has to offer short of moving the clock: if
          // a sweep were still unscheduled, this is where it would run.
          yield* settle

          const beforeDelay = counts()

          yield* TestClock.adjust(firstSweepDelay)
          yield* settle

          return { afterDelay: counts(), beforeDelay }
        })
      ).pipe(Effect.provide(captureLogs), Effect.provide(TestContext))
    )

    expect(swept).toEqual({
      afterDelay: { queries: 1, spans: 1 },
      beforeDelay: { queries: 0, spans: 0 }
    })
  })

  // The client the sweeps are handed, rather than one they went and found.
  // A sweep reaching a module singleton would pass every case in its own file,
  // where the two are the same database — this is the seam where they are not.
  it('sweeps the client the app database built', async () => {
    const swept = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(makeTestAppDatabase())

          yield* Layer.build(
            RetentionLive.pipe(Layer.provide(Layer.succeedContext(context)))
          )

          yield* TestClock.adjust(firstSweepDelay)
          yield* settle

          const { client } = Context.get(context, AppDatabase)

          // Identity rather than `toEqual`, which is the exception to the
          // project's default: two drizzle instances over two empty in-memory
          // databases differ only in the client object each holds, so a shape
          // comparison would answer for an implementation detail instead of
          // the question. The cost is a failure that reports `false` without
          // saying what was passed — read the mock's calls if it ever does.
          return {
            queries: deleteExpiredQueries.mock.calls[0]?.[0] === client,
            spans: deleteExpiredSpans.mock.calls[0]?.[0] === client
          }
        })
      ).pipe(Effect.provide(captureLogs), Effect.provide(TestContext))
    )

    expect(swept).toEqual({ queries: true, spans: true })
  })

  it('refuses to build without the app database', async () => {
    // Dropping the dependency is now a type error rather than a silent
    // reordering, because the sweeps need the client it carries — but the
    // layer is still what creates the schema, and retention still must not run
    // before it has. The cast is the only way to ask for a build the type
    // system is meant to refuse.
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

        yield* TestClock.adjust(firstSweepDelay)
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
