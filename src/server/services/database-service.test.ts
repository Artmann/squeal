import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'

import { databasesTable, worksheetsTable } from '@/database/schema'
import type {
  DatabaseConnection,
  ServerConnectionInfo
} from '@/glue/api/schemas'
import {
  makeTestAppDatabase,
  testEncryptionPrefix,
  TestSecretStorage
} from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { DatabaseService } from './database-service'
import { WorksheetService } from './worksheet-service'

const connectionInfo: ServerConnectionInfo = {
  database: 'pagila',
  host: 'localhost',
  password: 'secret',
  username: 'postgres'
}

// The type and its connection info travel as one value now, so a mismatched
// pair cannot be constructed by accident.
const connection: DatabaseConnection = { connectionInfo, type: 'postgres' }

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
  effect: Effect.Effect<A, E, AppDatabase | DatabaseService | WorksheetService>
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, makeLayer()))
}

// A real write failure rather than a mocked one. SQLite's RAISE(ABORT) backs
// the offending statement out and leaves the transaction open, which is the
// state a rollback actually has to clean up — a stubbed client would prove
// only that the code called `transaction`, not that the rollback works.
function failUpdatesTo(table: 'databases' | 'worksheets', when = '1 = 1') {
  return Effect.gen(function* () {
    const appDatabase = yield* AppDatabase

    yield* appDatabase.execute((client) =>
      client.run(
        sql.raw(
          `CREATE TRIGGER fail_updates_${table} BEFORE UPDATE ON ${table} WHEN ${when} ` +
            `BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`
        )
      )
    )
  })
}

const differentServerError = expect.objectContaining({
  _tag: 'DifferentServerError',
  message: 'Enter the password to change the server or its SSL settings.'
})

function storedConnectionInfo(row: { connectionInfo: string }): unknown {
  return JSON.parse(row.connectionInfo.slice(testEncryptionPrefix.length))
}

// Every field that decides where the password goes, or how it travels, is
// tested the same way: save a connection, edit one of those fields with the
// blank password the renderer sends, and read the row before and after.
function updateWithBlankPassword(
  saved: ServerConnectionInfo,
  changes: Partial<ServerConnectionInfo>
) {
  return run(
    Effect.gen(function* () {
      const service = yield* DatabaseService
      const appDatabase = yield* AppDatabase

      const created = yield* service.create('Pagila', {
        connectionInfo: saved,
        type: 'postgres'
      })

      const [before] = yield* appDatabase.execute((client) =>
        client.select().from(databasesTable)
      )

      const result = yield* Effect.either(
        service.update(created.database.id, 'Renamed', {
          connectionInfo: { ...saved, ...changes, password: '' },
          type: 'postgres'
        })
      )

      const [after] = yield* appDatabase.execute((client) =>
        client.select().from(databasesTable)
      )

      return { after, before, result }
    })
  )
}

describe('DatabaseService', () => {
  it('stores connection info encrypted and never returns the password', async () => {
    const { row, result } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        const result = yield* service.create('Pagila', connection)

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

        return yield* service.create('Pagila', connection)
      })
    )

    expect(result.updatedWorksheet?.databaseId).toEqual(result.database.id)
  })

  // The stored password is only lent back to the server it was saved for,
  // reached the same way. Without this an authenticated caller walks around the
  // connection-test guard in two steps: PATCH the host with a blank password,
  // and the saved secret is re-encrypted against a server they control, ready
  // to be handed over on the next connection.
  it('refuses to lend the stored password to a different host', async () => {
    const { after, before, result } = await updateWithBlankPassword(
      connectionInfo,
      { host: 'attacker.example' }
    )

    expect(result._tag).toEqual('Left')

    if (result._tag === 'Left') {
      expect(result.left).toEqual(differentServerError)
    }

    // Nothing was written: the row still names the original server.
    expect(after).toEqual(before)
  })

  it('refuses to lend the stored password to a different port', async () => {
    const { after, before, result } = await updateWithBlankPassword(
      connectionInfo,
      { port: 6000 }
    )

    expect(result._tag).toEqual('Left')

    if (result._tag === 'Left') {
      expect(result.left).toEqual(differentServerError)
    }

    expect(after).toEqual(before)
  })

  // Turning TLS off keeps the destination but changes who can read the password
  // on the way there, so it is a different server for lending purposes. Left
  // unguarded, the same PATCH that may no longer move the host could still
  // strip `sslMode` and put the stored secret on the wire in the clear.
  it('refuses to lend the stored password when the SSL mode changes', async () => {
    const { after, before, result } = await updateWithBlankPassword(
      { ...connectionInfo, sslMode: 'verify-full' },
      { sslMode: 'disable' }
    )

    expect(result._tag).toEqual('Left')

    if (result._tag === 'Left') {
      expect(result.left).toEqual(differentServerError)
    }

    expect(after).toEqual(before)
  })

  // Swapping the pinned certificate is a MITM behind a CA the user never chose,
  // which the mode alone does not catch.
  it('refuses to lend the stored password when the SSL root certificate changes', async () => {
    const { after, before, result } = await updateWithBlankPassword(
      {
        ...connectionInfo,
        sslMode: 'verify-full',
        sslRootCert: '/etc/ssl/pagila.pem'
      },
      { sslRootCert: '/tmp/attacker.pem' }
    )

    expect(result._tag).toEqual('Left')

    if (result._tag === 'Left') {
      expect(result.left).toEqual(differentServerError)
    }

    expect(after).toEqual(before)
  })

  // Rows written before the SSL fields existed carry neither key, and the form
  // submits an empty root certificate for "none". Both mean the same transport
  // as `disable`, so an untouched SSL section must not read as a change.
  it('keeps the stored password when absent SSL fields come back empty', async () => {
    const { after, result } = await updateWithBlankPassword(connectionInfo, {
      sslRootCert: ''
    })

    expect(result._tag).toEqual('Right')
    expect(storedConnectionInfo(after)).toEqual({
      database: 'pagila',
      host: 'localhost',
      password: 'secret',
      sslRootCert: '',
      username: 'postgres'
    })
  })

  // Editing the username or the database name still targets the same trusted
  // server, so requiring a re-typed password there would be friction without a
  // security gain.
  it('keeps the stored password when only the username and database name change', async () => {
    const { after, result } = await updateWithBlankPassword(connectionInfo, {
      database: 'other',
      username: 'reader'
    })

    expect(result._tag).toEqual('Right')
    expect(storedConnectionInfo(after)).toEqual({
      database: 'other',
      host: 'localhost',
      password: 'secret',
      username: 'reader'
    })
    expect(after.name).toEqual('Renamed')
  })

  // The guard sits below the "did the request bring its own password" check, so
  // moving a connection is still possible — the user just has to type the
  // password. Tightening the order would lock them out of it entirely.
  it('allows a host change when the update carries its own password', async () => {
    const row = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        const created = yield* service.create('Pagila', connection)

        yield* service.update(created.database.id, 'Moved', {
          connectionInfo: {
            ...connectionInfo,
            host: 'replica.internal',
            password: 'typed-again'
          },
          type: 'postgres'
        })

        const [row] = yield* appDatabase.execute((client) =>
          client.select().from(databasesTable)
        )

        return row
      })
    )

    expect(storedConnectionInfo(row)).toEqual({
      database: 'pagila',
      host: 'replica.internal',
      password: 'typed-again',
      username: 'postgres'
    })
  })

  // An empty stored password is no secret at all, so there is nothing to
  // refuse. Reachable without any fixture surgery: repairing a row whose secret
  // this build cannot read saves a blank password, and the user then has to be
  // able to move the connection like any other.
  it('lets an update move a connection whose stored password is empty', async () => {
    const row = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        const created = yield* service.create('Pagila', connection)

        yield* appDatabase.execute((client) =>
          client
            .update(databasesTable)
            .set({ connectionInfo: 'not-decryptable' })
            .where(eq(databasesTable.id, created.database.id))
        )

        // The repair: a blank password against an unreadable secret stores a
        // blank password.
        yield* service.update(created.database.id, 'Repaired', {
          connectionInfo: { ...connectionInfo, password: '' },
          type: 'postgres'
        })

        yield* service.update(created.database.id, 'Moved', {
          connectionInfo: {
            ...connectionInfo,
            host: 'replica.internal',
            password: ''
          },
          type: 'postgres'
        })

        const [row] = yield* appDatabase.execute((client) =>
          client.select().from(databasesTable)
        )

        return row
      })
    )

    expect(storedConnectionInfo(row)).toEqual({
      database: 'pagila',
      host: 'replica.internal',
      password: '',
      username: 'postgres'
    })
  })

  it('fails with DatabaseNotFoundError when updating an unknown id', async () => {
    const error = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService

        return yield* service
          .update('missing', 'Name', connection)
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

        const created = yield* service.create('Pagila', connection)

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

  // The purge-and-soft-delete and the unlink were two statements, so a failure
  // between them left live worksheets holding the id of a soft-deleted
  // connection: shown as unconnected, never adopted by create's auto-link,
  // and answering "database not found" for every query run from them.
  it('leaves the connection intact when unlinking its worksheets fails', async () => {
    const { databaseRow, error, linked, worksheetRow } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const worksheets = yield* WorksheetService
        const appDatabase = yield* AppDatabase

        yield* worksheets.create({ name: 'My First Worksheet' })

        const created = yield* service.create('Pagila', connection)

        const [linked] = yield* appDatabase.execute((client) =>
          client.select().from(worksheetsTable)
        )

        yield* failUpdatesTo('worksheets')

        const error = yield* Effect.flip(service.remove(created.database.id))

        const [databaseRow] = yield* appDatabase.execute((client) =>
          client.select().from(databasesTable)
        )
        const [worksheetRow] = yield* appDatabase.execute((client) =>
          client.select().from(worksheetsTable)
        )

        return { databaseRow, error, linked, worksheetRow }
      })
    )

    // Without a linked worksheet the unlink matches no rows, the trigger never
    // fires, and the rest of this would pass for the wrong reason.
    expect(linked.databaseId).toEqual(databaseRow.id)

    expect(error._tag).toEqual('AppDatabaseError')
    // The statement the trigger aborted, so an unrelated database error cannot
    // satisfy the tag alone. cause is drizzle's wrapper message; the libsql
    // one carrying "injected write failure" is nested below it.
    expect(error.cause).toContain('update "worksheets"')
    expect(databaseRow.deletedAt).toBeNull()
    expect(
      databaseRow.connectionInfo.slice(testEncryptionPrefix.length)
    ).not.toEqual('{}')
    expect(worksheetRow.databaseId).toEqual(databaseRow.id)
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

        const created = yield* service.create('Pagila', connection)

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

        const first = yield* service.create('First', connection)
        const second = yield* service.create('Second', connection)

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

  // Reordering wrote N rows in N statements, so a failure at row k persisted a
  // partial order while the caller was told the whole thing failed — and
  // list()'s ordering then interleaved renumbered and stale rows.
  it('leaves every position unchanged when a reorder fails partway', async () => {
    const { error, rows } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        const first = yield* service.create('First', connection)
        const second = yield* service.create('Second', connection)
        const third = yield* service.create('Third', connection)

        // Aborts on the row the statement renumbers to 2, so two rows have
        // already been assigned inside the statement when it fires. That is
        // what makes the assertion below about statement-level rollback rather
        // than about failing before anything was written.
        yield* failUpdatesTo('databases', 'NEW.sortOrder = 2')

        const error = yield* Effect.flip(
          service.reorder([
            third.database.id,
            first.database.id,
            second.database.id
          ])
        )

        const rows = yield* appDatabase.execute((client) =>
          client
            .select({
              name: databasesTable.name,
              sortOrder: databasesTable.sortOrder
            })
            .from(databasesTable)
            .orderBy(databasesTable.name)
        )

        return { error, rows }
      })
    )

    expect(error._tag).toEqual('AppDatabaseError')
    expect(error.cause).toContain('update "databases" set "sortOrder"')
    expect(rows).toEqual([
      { name: 'First', sortOrder: null },
      { name: 'Second', sortOrder: null },
      { name: 'Third', sortOrder: null }
    ])
  })

  // A keychain reset makes every stored secret unreadable. Failing the whole
  // list would leave the user unable to see, repair, or delete anything.
  it('lists a database whose stored connection info cannot be read', async () => {
    const databases = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        yield* service.create('Readable', connection)

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

        const created = yield* service.create('Pagila', connection)

        yield* service.remove(created.database.id)

        const result = yield* Effect.either(
          service.update(created.database.id, 'Renamed', {
            connectionInfo: { ...connectionInfo, password: 'new-secret' },
            type: 'postgres'
          })
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

  // A row saved by an older build can pair `type` with the wrong info shape.
  // getWithSecrets refuses it, but editing is how the user repairs it, so the
  // update path has to tolerate a secret it cannot make sense of.
  it('lets an update repair a row whose stored pair is mismatched', async () => {
    const { readBack, unreadable, updated } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService
        const appDatabase = yield* AppDatabase

        const created = yield* service.create('Broken', connection)

        // Rewrite the stored secret as SQLite-shaped while the row says
        // postgres — the disagreement getWithSecrets rejects.
        yield* appDatabase.execute((client) =>
          client
            .update(databasesTable)
            .set({
              connectionInfo: `${testEncryptionPrefix}${JSON.stringify({
                path: '/tmp/stray.sqlite3'
              })}`
            })
            .where(eq(databasesTable.id, created.database.id))
        )

        const unreadable = yield* service
          .getWithSecrets(created.database.id)
          .pipe(Effect.flip)

        // A blank password is what the renderer sends, since it never receives
        // the stored one — so this is the path that has to look the unreadable
        // secret up and carry on regardless.
        const updated = yield* service.update(created.database.id, 'Repaired', {
          connectionInfo: { ...connectionInfo, password: '' },
          type: 'postgres'
        })

        const readBack = yield* service.getWithSecrets(created.database.id)

        return { readBack, unreadable, updated }
      })
    )

    expect(unreadable._tag).toEqual('SecretDecryptError')
    expect(updated.name).toEqual('Repaired')

    // The repaired row is readable again. The password is blank because the
    // stored one was unrecoverable, which is the honest outcome — the user
    // re-enters it.
    expect(Option.isSome(readBack)).toEqual(true)

    if (Option.isSome(readBack)) {
      expect(readBack.value.connection).toEqual({
        connectionInfo: { ...connectionInfo, password: '' },
        type: 'postgres'
      })
    }
  })

  it('returns none for a missing or deleted database', async () => {
    const { missing, deleted } = await run(
      Effect.gen(function* () {
        const service = yield* DatabaseService

        const missing = yield* service.getWithSecrets('missing')

        const created = yield* service.create('Pagila', connection)

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

        const created = yield* service.create('Pagila', connection)

        return yield* service.getWithSecrets(created.database.id)
      })
    )

    expect(Option.isSome(secrets)).toEqual(true)

    if (Option.isSome(secrets)) {
      expect(secrets.value.connection.connectionInfo).toEqual({
        database: 'pagila',
        host: 'localhost',
        password: 'secret',
        username: 'postgres'
      })
    }
  })
})
