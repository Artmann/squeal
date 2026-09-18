import { eq, sql } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { databasesTable, environmentsTable } from '@/database/schema'
import {
  makeTestAppDatabase,
  TestSecretStorage
} from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { DatabaseService } from './database-service'
import { EnvironmentService } from './environment-service'

function makeLayer() {
  return Layer.mergeAll(
    DatabaseService.DefaultWithoutDependencies,
    EnvironmentService.DefaultWithoutDependencies
  ).pipe(
    Layer.provideMerge(makeTestAppDatabase()),
    Layer.provideMerge(TestSecretStorage)
  )
}

function run<A, E>(
  effect: Effect.Effect<
    A,
    E,
    AppDatabase | DatabaseService | EnvironmentService
  >
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, makeLayer()))
}

// A real write failure rather than a mocked one, the same way
// `database-service.test.ts` does it: RAISE(ABORT) backs the offending
// statement out and leaves the transaction open, which is the state a rollback
// has to clean up.
function failUpdatesToDatabases() {
  return Effect.gen(function* () {
    const appDatabase = yield* AppDatabase

    yield* appDatabase.execute((client) =>
      client.run(
        sql.raw(
          'CREATE TRIGGER fail_updates_databases BEFORE UPDATE ON databases ' +
            "BEGIN SELECT RAISE(ABORT, 'injected write failure'); END"
        )
      )
    )
  })
}

const notFoundError = expect.objectContaining({
  _tag: 'EnvironmentNotFoundError',
  message: 'This environment no longer exists.'
})

function createDatabaseIn(environmentId: string | null) {
  return DatabaseService.create(
    'Pagila',
    {
      connectionInfo: {
        database: 'pagila',
        host: 'localhost',
        password: 'secret',
        username: 'postgres'
      },
      type: 'postgres'
    },
    environmentId
  )
}

describe('EnvironmentService', () => {
  it('lists the seeded environments in the order they ship', async () => {
    const environments = await run(EnvironmentService.list())

    expect(
      environments.map((environment) => ({
        hue: environment.hue,
        id: environment.id,
        name: environment.name
      }))
    ).toEqual([
      { hue: 152, id: 'local', name: 'Local' },
      { hue: 70, id: 'staging', name: 'Staging' },
      { hue: 25, id: 'production', name: 'Production' }
    ])
  })

  it('appends a created environment to the end of the list', async () => {
    const environments = await run(
      Effect.gen(function* () {
        yield* EnvironmentService.create('Sandbox', 195)

        return yield* EnvironmentService.list()
      })
    )

    expect(environments.map((environment) => environment.name)).toEqual([
      'Local',
      'Staging',
      'Production',
      'Sandbox'
    ])
  })

  it('updates only the fields the request carries', async () => {
    const environment = await run(
      EnvironmentService.update('production', 'Live', undefined)
    )

    expect(environment).toEqual({
      createdAt: 3,
      hue: 25,
      id: 'production',
      name: 'Live'
    })
  })

  it('answers an empty update with the row as it stands', async () => {
    const environment = await run(
      EnvironmentService.update('local', undefined, undefined)
    )

    expect(environment).toEqual({
      createdAt: 1,
      hue: 152,
      id: 'local',
      name: 'Local'
    })
  })

  // The row stays behind a deletedAt so that re-seeding at the next boot sees
  // it and skips it. A hard delete would bring every deleted default back.
  it('soft deletes, so the row is gone from the list but still in the table', async () => {
    const { environments, rows } = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase

        yield* EnvironmentService.remove('staging')

        return {
          environments: yield* EnvironmentService.list(),
          rows: yield* appDatabase.execute((client) =>
            client
              .select()
              .from(environmentsTable)
              .where(eq(environmentsTable.id, 'staging'))
          )
        }
      })
    )

    expect(environments.map((environment) => environment.id)).toEqual([
      'local',
      'production'
    ])
    expect(rows.length).toEqual(1)
    expect(rows[0]?.deletedAt).toEqual(expect.any(Number))
  })

  it('detaches the connections that used a deleted environment', async () => {
    const rows = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase

        const { database } = yield* createDatabaseIn('production')

        yield* EnvironmentService.remove('production')

        return yield* appDatabase.execute((client) =>
          client
            .select()
            .from(databasesTable)
            .where(eq(databasesTable.id, database.id))
        )
      })
    )

    expect(rows[0]?.environmentId).toEqual(null)
  })

  // The delete and the detach are one transaction. If the detach fails, the
  // environment has to still be there — a connection pointing at a row that
  // list() hides is invisible until someone recreates that id.
  it('leaves the environment live when detaching the connections fails', async () => {
    const environments = await run(
      Effect.gen(function* () {
        yield* createDatabaseIn('production')
        yield* failUpdatesToDatabases()

        yield* Effect.flip(EnvironmentService.remove('production'))

        return yield* EnvironmentService.list()
      })
    )

    expect(environments.map((environment) => environment.id)).toEqual([
      'local',
      'staging',
      'production'
    ])
  })

  it('refuses to delete an environment twice', async () => {
    const error = await run(
      Effect.gen(function* () {
        yield* EnvironmentService.remove('local')

        return yield* Effect.flip(EnvironmentService.remove('local'))
      })
    )

    expect(error).toEqual(notFoundError)
  })

  // A PATCH that resurrected a deleted row would put it back in the list with
  // no delete to blame.
  it('refuses to update a deleted environment', async () => {
    const error = await run(
      Effect.gen(function* () {
        yield* EnvironmentService.remove('local')

        return yield* Effect.flip(
          EnvironmentService.update('local', 'Back', undefined)
        )
      })
    )

    expect(error).toEqual(notFoundError)
  })

  it('reports an unknown environment as not found', async () => {
    const error = await run(
      Effect.flip(EnvironmentService.update('nope', 'Nope', undefined))
    )

    expect(error).toEqual(notFoundError)
  })
})
