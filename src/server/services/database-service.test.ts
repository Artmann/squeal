import { eq } from 'drizzle-orm'
import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'

import { databasesTable, worksheetsTable } from '@/database/schema'
import type { ConnectionInfo } from '@/glue/api/schemas'
import {
  makeTestAppDatabase,
  testEncryptionPrefix,
  TestSecretStorage
} from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { DatabaseService } from './database-service'
import { WorksheetService } from './worksheet-service'

const connectionInfo: ConnectionInfo = {
  database: 'pagila',
  host: 'localhost',
  password: 'secret',
  username: 'postgres'
}

function makeLayer() {
  return Layer.mergeAll(
    DatabaseService.DefaultWithoutDependencies,
    WorksheetService.DefaultWithoutDependencies
  ).pipe(
    Layer.provideMerge(makeTestAppDatabase()),
    Layer.provideMerge(TestSecretStorage)
  )
}

function run<A, E>(
  effect: Effect.Effect<
    A,
    E,
    AppDatabase | DatabaseService | WorksheetService
  >
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, makeLayer()))
}

describe('DatabaseService', () => {
  it('stores connection info encrypted and never returns the password', async () => {
    const { row, result } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        const result = yield* service.create('Pagila', connectionInfo, 'postgres')

        const [row] = yield* appDatabase.execute((client) =>
          client.select().from(databasesTable)
        )

        return { result, row }
      })
    )

    expect(row.connectionInfo.startsWith(testEncryptionPrefix)).toEqual(true)
    expect(
      JSON.parse(row.connectionInfo.slice(testEncryptionPrefix.length))
    ).toEqual({
      database: 'pagila',
      host: 'localhost',
      password: 'secret',
      username: 'postgres'
    })
    expect(result.database.connectionInfo).toEqual({
      database: 'pagila',
      host: 'localhost',
      username: 'postgres'
    })
  })

  it('links the only unassigned worksheet to the first database', async () => {
    const result = await run(
      Effect.gen(function* () {
        const worksheets = yield* WorksheetService
        const service = yield* DatabaseService

        yield* worksheets.create({ name: 'My First Worksheet' })

        return yield* service.create('Pagila', connectionInfo, 'postgres')
      })
    )

    expect(result.updatedWorksheet?.databaseId).toEqual(result.database.id)
  })

  it('keeps the stored password when an update sends a blank one', async () => {
    const row = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        const created = yield* service.create('Pagila', connectionInfo, 'postgres')

        yield* service.update(
          created.database.id,
          'Renamed',
          {
            database: 'pagila',
            host: 'other-host',
            password: '',
            username: 'postgres'
          },
          'postgres'
        )

        const [row] = yield* appDatabase.execute((client) =>
          client.select().from(databasesTable)
        )

        return row
      })
    )

    expect(
      JSON.parse(row.connectionInfo.slice(testEncryptionPrefix.length))
    ).toEqual({
      database: 'pagila',
      host: 'other-host',
      password: 'secret',
      username: 'postgres'
    })
    expect(row.name).toEqual('Renamed')
  })

  it('fails with DatabaseNotFoundError when updating an unknown id', async () => {
    const error = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService

        return yield* service
          .update('missing', 'Name', connectionInfo, 'postgres')
          .pipe(Effect.flip)
      })
    )

    expect(error._tag).toEqual('DatabaseNotFoundError')
  })

  it('purges the secret, soft deletes, and unlinks worksheets on remove', async () => {
    const { databaseRow, worksheetRow, remaining } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const worksheets = yield* WorksheetService
        const appDatabase = yield* AppDatabase

        yield* worksheets.create({ name: 'My First Worksheet' })

        const created = yield* service.create('Pagila', connectionInfo, 'postgres')

        yield* service.remove(created.database.id)

        const [databaseRow] = yield* appDatabase.execute((client) =>
          client.select().from(databasesTable)
        )
        const [worksheetRow] = yield* appDatabase.execute((client) =>
          client.select().from(worksheetsTable)
        )
        const remaining = yield* service.list()

        return { databaseRow, remaining, worksheetRow }
      })
    )

    expect(
      databaseRow.connectionInfo.slice(testEncryptionPrefix.length)
    ).toEqual('{}')
    expect(databaseRow.deletedAt).not.toBeNull()
    expect(worksheetRow.databaseId).toBeNull()
    expect(remaining).toEqual([])
  })

  it('fails with DatabaseNotFoundError when removing an unknown id', async () => {
    const error = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService

        return yield* service.remove('missing').pipe(Effect.flip)
      })
    )

    expect(error._tag).toEqual('DatabaseNotFoundError')
  })

  it('reports the unknown ids when reordering fails', async () => {
    const error = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService

        const created = yield* service.create('Pagila', connectionInfo, 'postgres')

        return yield* service
          .reorder([created.database.id, 'missing'])
          .pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'UnknownDatabaseIdsError',
        unknownIds: ['missing']
      })
    )
  })

  it('reorders without touching stored connection info', async () => {
    const { before, after, ordered } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        const first = yield* service.create('First', connectionInfo, 'postgres')
        const second = yield* service.create('Second', connectionInfo, 'postgres')

        const before = yield* appDatabase.execute((client) =>
          client
            .select()
            .from(databasesTable)
            .where(eq(databasesTable.id, first.database.id))
        )

        const ordered = yield* service.reorder([
          second.database.id,
          first.database.id
        ])

        const after = yield* appDatabase.execute((client) =>
          client
            .select()
            .from(databasesTable)
            .where(eq(databasesTable.id, first.database.id))
        )

        return { after: after[0], before: before[0], ordered }
      })
    )

    expect(after.connectionInfo).toEqual(before.connectionInfo)
    expect(ordered.map((database) => database.name)).toEqual([
      'Second',
      'First'
    ])
  })

  // A keychain reset makes every stored secret unreadable. Failing the whole
  // list would leave the user unable to see, repair, or delete anything.
  it('lists a database whose stored connection info cannot be read', async () => {
    const databases = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        yield* service.create('Readable', connectionInfo, 'postgres')

        yield* appDatabase.execute((client) =>
          client.insert(databasesTable).values({
            connectionInfo: 'not-decryptable',
            name: 'Unreadable',
            type: 'postgres'
          })
        )

        return yield* service.list()
      })
    )

    expect(
      databases
        .map((database) => ({
          connectionInfo: database.connectionInfo,
          name: database.name
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    ).toEqual([
      {
        connectionInfo: {
          database: 'pagila',
          host: 'localhost',
          username: 'postgres'
        },
        name: 'Readable'
      },
      { connectionInfo: null, name: 'Unreadable' }
    ])
  })

  it('refuses to update a deleted database', async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService

        const created = yield* service.create(
          'Pagila',
          connectionInfo,
          'postgres'
        )

        yield* service.remove(created.database.id)

        const result = yield* Effect.either(
          service.update(
            created.database.id,
            'Renamed',
            { ...connectionInfo, password: 'new-secret' },
            'postgres'
          )
        )

        const [row] = yield* (yield* AppDatabase).execute((client) =>
          client
            .select()
            .from(databasesTable)
            .where(eq(databasesTable.id, created.database.id))
        )

        return { connectionInfo: row.connectionInfo, result }
      })
    )

    expect(outcome.result._tag).toEqual('Left')

    // The purged secret must stay purged.
    expect(outcome.connectionInfo).toEqual(`${testEncryptionPrefix}{}`)
  })

  it('returns none for a missing or deleted database', async () => {
    const { missing, deleted } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService

        const missing = yield* service.getWithSecrets('missing')

        const created = yield* service.create('Pagila', connectionInfo, 'postgres')

        yield* service.remove(created.database.id)

        const deleted = yield* service.getWithSecrets(created.database.id)

        return { deleted, missing }
      })
    )

    expect(Option.isNone(missing)).toEqual(true)
    expect(Option.isNone(deleted)).toEqual(true)
  })

  it('returns decrypted secrets through getWithSecrets', async () => {
    const secrets = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService

        const created = yield* service.create('Pagila', connectionInfo, 'postgres')

        return yield* service.getWithSecrets(created.database.id)
      })
    )

    expect(Option.isSome(secrets)).toEqual(true)

    if (Option.isSome(secrets)) {
      expect(secrets.value.connectionInfo).toEqual({
        database: 'pagila',
        host: 'localhost',
        password: 'secret',
        username: 'postgres'
      })
    }
  })
})
