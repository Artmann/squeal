import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import { databasesTable, worksheetsTable } from '@/database/schema'
import {
  DatabaseNotFoundError,
  UnknownDatabaseIdsError
} from '@/glue/api/errors'
import type {
  ConnectionInfo,
  DatabaseConnection,
  DatabaseDto,
  DatabaseType,
  PublicConnectionInfo,
  UpdateDatabaseConnection,
  WorksheetDto
} from '@/glue/api/schemas'
import { SecretDecryptError } from '../errors'
import { AppDatabase } from './app-database'
import { SecretStorage } from './secret-storage'
import { toWorksheetDto } from './worksheet-dto'

interface CreateDatabaseResult {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
}

interface DatabaseWithSecrets {
  connection: DatabaseConnection
  id: string
  name: string
}

type DatabaseRow = typeof databasesTable.$inferSelect

export class DatabaseService extends Effect.Service<DatabaseService>()(
  'DatabaseService',
  {
    accessors: true,
    dependencies: [AppDatabase.Default, SecretStorage.Default],
    effect: Effect.gen(function* () {
      const appDatabase = yield* AppDatabase
      const secrets = yield* SecretStorage

      const parseConnectionInfo = (value: string) =>
        secrets.decrypt(value).pipe(
          Effect.flatMap((decrypted) =>
            Effect.try({
              catch: () =>
                new SecretDecryptError({
                  message:
                    'Stored connection info could not be read. Edit the connection and save it again.'
                }),
              try: () => JSON.parse(decrypted) as ConnectionInfo
            })
          )
        )

      // The stored blob is only JSON.parsed, never decoded against a schema, so
      // its shape can disagree with the row's `type` — a row saved as SQLite
      // whose info carries a host instead of a path. Check just enough to build
      // the adapter safely: validating the whole shape here would reject rows
      // that older builds wrote with fields this one no longer requires.
      const toDatabaseConnection = (
        type: DatabaseType,
        connectionInfo: ConnectionInfo
      ): Effect.Effect<DatabaseConnection, SecretDecryptError> => {
        if (type === 'sqlite') {
          if ('path' in connectionInfo && connectionInfo.path) {
            return Effect.succeed({ connectionInfo, type })
          }

          return Effect.fail(
            new SecretDecryptError({
              message:
                'This connection is saved as SQLite but has no database file. Edit the connection and choose a file.'
            })
          )
        }

        if ('host' in connectionInfo) {
          return Effect.succeed({ connectionInfo, type })
        }

        return Effect.fail(
          new SecretDecryptError({
            message: `This connection is saved as ${type} but has no host. Edit the connection and save it again.`
          })
        )
      }

      const transformDatabase = (record: DatabaseRow) =>
        parseConnectionInfo(record.connectionInfo).pipe(
          Effect.map(
            (connectionInfo): DatabaseDto => ({
              connectionInfo: toPublicConnectionInfo(connectionInfo),
              createdAt: record.createdAt,
              id: record.id,
              name: record.name,
              sortOrder: record.sortOrder ?? null,
              type: record.type as DatabaseType
            })
          )
        )

      const toUnreadableDatabase = (record: DatabaseRow): DatabaseDto => ({
        connectionInfo: null,
        createdAt: record.createdAt,
        id: record.id,
        name: record.name,
        sortOrder: record.sortOrder ?? null,
        type: record.type as DatabaseType
      })

      const findActiveRecord = (id: string) =>
        appDatabase
          .execute((client) =>
            client
              .select()
              .from(databasesTable)
              .where(
                and(eq(databasesTable.id, id), isNull(databasesTable.deletedAt))
              )
              .limit(1)
          )
          .pipe(Effect.map((records) => Option.fromNullable(records[0])))

      const list = Effect.fn('DatabaseService.list')(function* () {
        const records = yield* appDatabase.execute((client) =>
          client
            .select()
            .from(databasesTable)
            .where(isNull(databasesTable.deletedAt))
            .orderBy(
              sql`${databasesTable.sortOrder} is null`,
              asc(databasesTable.sortOrder),
              asc(databasesTable.createdAt)
            )
        )

        // Per row, not fail-fast: one unreadable secret must not take down the
        // whole list, or a keychain reset would leave the user unable to see,
        // repair, or delete any connection at all. Mirrors the same treatment
        // stored query results already get in transformQueryRow.
        return yield* Effect.forEach(records, (record) =>
          transformDatabase(record).pipe(
            Effect.catchTag('SecretDecryptError', (error) =>
              Effect.logWarning(
                `Could not read connection info for database ${record.id}: ${error.message}`
              ).pipe(Effect.as(toUnreadableDatabase(record)))
            )
          )
        )
      })

      const create = Effect.fn('DatabaseService.create')(function* (
        name: string,
        connection: DatabaseConnection
      ) {
        const encrypted = yield* secrets.encrypt(
          JSON.stringify(connection.connectionInfo)
        )

        // One transaction: the row and the worksheet it gets connected to have
        // to land together or not at all. Run as separate statements, a failure
        // after the insert left the database created while the caller saw the
        // whole request fail — which is exactly what happened when the worksheet
        // probe below hit a database missing its `databaseId` column.
        const { record, linkedWorksheet } = yield* appDatabase.transaction(
          async (client) => {
            const [created] = await client
              .insert(databasesTable)
              .values({
                connectionInfo: encrypted,
                name,
                type: connection.type
              })
              .returning()

            // If this is the first database and there's a worksheet without a
            // database, connect it.
            const existingDatabases = await client
              .select()
              .from(databasesTable)
              .where(isNull(databasesTable.deletedAt))

            if (existingDatabases.length !== 1) {
              return { record: created, linkedWorksheet: undefined }
            }

            const worksheetsWithoutDatabase = await client
              .select()
              .from(worksheetsTable)
              .where(
                and(
                  isNull(worksheetsTable.deletedAt),
                  isNull(worksheetsTable.databaseId)
                )
              )

            if (worksheetsWithoutDatabase.length !== 1) {
              return { record: created, linkedWorksheet: undefined }
            }

            const [updated] = await client
              .update(worksheetsTable)
              .set({ databaseId: created.id })
              .where(eq(worksheetsTable.id, worksheetsWithoutDatabase[0].id))
              .returning()

            return { record: created, linkedWorksheet: updated }
          }
        )

        const databaseDto = yield* transformDatabase(record)

        const result: CreateDatabaseResult = {
          database: databaseDto,
          ...(linkedWorksheet === undefined
            ? {}
            : { updatedWorksheet: toWorksheetDto(linkedWorksheet) })
        }

        return result
      })

      // Returns the decrypted connection info, password included. Main-
      // process use only (adapter construction) — never send this to the
      // renderer.
      const getWithSecrets = Effect.fn('DatabaseService.getWithSecrets')(
        function* (id: string) {
          const record = yield* findActiveRecord(id)

          if (Option.isNone(record)) {
            return Option.none<DatabaseWithSecrets>()
          }

          const connectionInfo = yield* parseConnectionInfo(
            record.value.connectionInfo
          )

          const connection = yield* toDatabaseConnection(
            record.value.type as DatabaseType,
            connectionInfo
          )

          return Option.some<DatabaseWithSecrets>({
            connection,
            id: record.value.id,
            name: record.value.name
          })
        }
      )

      const remove = Effect.fn('DatabaseService.remove')(function* (
        id: string
      ) {
        const record = yield* findActiveRecord(id)

        if (Option.isNone(record)) {
          return yield* new DatabaseNotFoundError({
            databaseId: id,
            message: 'This database connection no longer exists.'
          })
        }

        const purged = yield* secrets.encrypt('{}')

        // The secret purge and the soft delete are one write, so a deleted
        // row never retains a password.
        yield* appDatabase.execute((client) =>
          client
            .update(databasesTable)
            .set({ connectionInfo: purged, deletedAt: Date.now() })
            .where(eq(databasesTable.id, id))
        )

        yield* appDatabase.execute((client) =>
          client
            .update(worksheetsTable)
            .set({ databaseId: null })
            .where(
              and(
                eq(worksheetsTable.databaseId, id),
                isNull(worksheetsTable.deletedAt)
              )
            )
        )
      })

      // Only writes sortOrder — reordering must never touch connectionInfo,
      // which update would re-encrypt.
      const reorder = Effect.fn('DatabaseService.reorder')(function* (
        databaseIds: readonly string[]
      ) {
        const records = yield* appDatabase.execute((client) =>
          client
            .select({ id: databasesTable.id })
            .from(databasesTable)
            .where(
              and(
                inArray(databasesTable.id, [...databaseIds]),
                isNull(databasesTable.deletedAt)
              )
            )
        )

        if (records.length !== databaseIds.length) {
          const knownIds = new Set(records.map((record) => record.id))

          return yield* new UnknownDatabaseIdsError({
            message: 'One or more database ids are unknown.',
            unknownIds: databaseIds.filter((id) => !knownIds.has(id))
          })
        }

        for (const [index, id] of databaseIds.entries()) {
          yield* appDatabase.execute((client) =>
            client
              .update(databasesTable)
              .set({ sortOrder: index })
              .where(eq(databasesTable.id, id))
          )
        }

        return yield* list()
      })

      // An update without a password means "keep the stored one" — the
      // renderer never sees passwords, so edits can't send them back.
      const resolveConnection = (
        id: string,
        connection: UpdateDatabaseConnection
      ) =>
        Effect.gen(function* () {
          // SQLite has no password to merge back in.
          if (connection.type === 'sqlite') {
            return connection
          }

          const { connectionInfo, type } = connection

          if (connectionInfo.password) {
            return {
              connectionInfo: {
                ...connectionInfo,
                password: connectionInfo.password
              },
              type
            }
          }

          // A stored secret this build cannot read must not block the edit that
          // repairs it, so an unreadable row behaves like one with no stored
          // password rather than failing the update.
          const existing = yield* getWithSecrets(id).pipe(
            Effect.catchTag('SecretDecryptError', () =>
              Effect.succeed(Option.none<DatabaseWithSecrets>())
            )
          )
          const storedPassword =
            Option.isSome(existing) &&
            existing.value.connection.type === type &&
            'password' in existing.value.connection.connectionInfo
              ? existing.value.connection.connectionInfo.password
              : ''

          return {
            connectionInfo: { ...connectionInfo, password: storedPassword },
            type
          }
        })

      const update = Effect.fn('DatabaseService.update')(function* (
        id: string,
        name: string,
        connection: UpdateDatabaseConnection
      ) {
        const resolved: DatabaseConnection = yield* resolveConnection(
          id,
          connection
        )
        const encrypted = yield* secrets.encrypt(
          JSON.stringify(resolved.connectionInfo)
        )

        const [record] = yield* appDatabase.execute((client) =>
          client
            .update(databasesTable)
            .set({ connectionInfo: encrypted, name, type: resolved.type })
            // Soft-deleted rows are excluded like everywhere else: without this
            // a PATCH would re-encrypt a password onto a row whose secret
            // remove() deliberately purged, and answer 200 for a database that
            // appears in no list.
            .where(
              and(eq(databasesTable.id, id), isNull(databasesTable.deletedAt))
            )
            .returning()
        )

        if (record === undefined) {
          return yield* new DatabaseNotFoundError({
            databaseId: id,
            message: 'This database connection no longer exists.'
          })
        }

        return yield* transformDatabase(record)
      })

      return {
        create,
        getWithSecrets,
        list,
        remove,
        reorder,
        update
      } as const
    })
  }
) {}

function toPublicConnectionInfo(
  connectionInfo: ConnectionInfo
): PublicConnectionInfo {
  if (!('password' in connectionInfo)) {
    return connectionInfo
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _password, ...publicInfo } = connectionInfo

  return publicInfo
}
