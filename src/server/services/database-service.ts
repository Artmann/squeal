import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import { databasesTable, worksheetsTable } from '@/database/schema'
import { DatabaseNotFoundError, UnknownDatabaseIdsError } from '@/glue/api/errors'
import type {
  ConnectionInfo,
  DatabaseDto,
  DatabaseType,
  PublicConnectionInfo,
  UpdateConnectionInfo,
  WorksheetDto
} from '@/glue/api/schemas'
import { SecretDecryptError } from '../errors'
import { AppDatabase } from './app-database'
import { SecretStorage } from './secret-storage'

interface CreateDatabaseResult {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
}

interface DatabaseWithSecrets {
  connectionInfo: ConnectionInfo
  id: string
  name: string
  type: DatabaseType
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

        return yield* Effect.forEach(records, transformDatabase)
      })

      const create = Effect.fn('DatabaseService.create')(function* (
        name: string,
        connectionInfo: ConnectionInfo,
        type: DatabaseType
      ) {
        const encrypted = yield* secrets.encrypt(JSON.stringify(connectionInfo))

        const [record] = yield* appDatabase.execute((client) =>
          client
            .insert(databasesTable)
            .values({ connectionInfo: encrypted, name, type })
            .returning()
        )

        const databaseDto = yield* transformDatabase(record)

        // If this is the first database and there's a worksheet without a
        // database, connect it.
        const existingDatabases = yield* appDatabase.execute((client) =>
          client
            .select()
            .from(databasesTable)
            .where(isNull(databasesTable.deletedAt))
        )

        let updatedWorksheet: WorksheetDto | undefined

        if (existingDatabases.length === 1) {
          const worksheetsWithoutDatabase = yield* appDatabase.execute((client) =>
            client
              .select()
              .from(worksheetsTable)
              .where(
                and(
                  isNull(worksheetsTable.deletedAt),
                  isNull(worksheetsTable.databaseId)
                )
              )
          )

          if (worksheetsWithoutDatabase.length === 1) {
            const [updated] = yield* appDatabase.execute((client) =>
              client
                .update(worksheetsTable)
                .set({ databaseId: databaseDto.id })
                .where(eq(worksheetsTable.id, worksheetsWithoutDatabase[0].id))
                .returning()
            )

            updatedWorksheet = {
              content: updated.content,
              createdAt: updated.createdAt,
              databaseId: updated.databaseId ?? null,
              id: updated.id,
              lastOpenedAt: updated.lastOpenedAt ?? null,
              name: updated.name,
              sortOrder: updated.sortOrder ?? null
            }
          }
        }

        const result: CreateDatabaseResult = {
          database: databaseDto,
          ...(updatedWorksheet === undefined ? {} : { updatedWorksheet })
        }

        return result
      })

      const get = Effect.fn('DatabaseService.get')(function* (id: string) {
        const record = yield* findActiveRecord(id)

        if (Option.isNone(record)) {
          return Option.none<DatabaseDto>()
        }

        return Option.some(yield* transformDatabase(record.value))
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

          return Option.some<DatabaseWithSecrets>({
            connectionInfo,
            id: record.value.id,
            name: record.value.name,
            type: record.value.type as DatabaseType
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
      const resolveConnectionInfo = (
        id: string,
        connectionInfo: UpdateConnectionInfo,
        type: DatabaseType
      ) =>
        Effect.gen(function* () {
          if (!('username' in connectionInfo) || connectionInfo.password) {
            return connectionInfo as ConnectionInfo
          }

          const existing = yield* getWithSecrets(id)
          const storedPassword =
            Option.isSome(existing) &&
            existing.value.type === type &&
            'password' in existing.value.connectionInfo
              ? existing.value.connectionInfo.password
              : ''

          return { ...connectionInfo, password: storedPassword }
        })

      const update = Effect.fn('DatabaseService.update')(function* (
        id: string,
        name: string,
        connectionInfo: UpdateConnectionInfo,
        type: DatabaseType
      ) {
        const resolved = yield* resolveConnectionInfo(id, connectionInfo, type)
        const encrypted = yield* secrets.encrypt(JSON.stringify(resolved))

        const [record] = yield* appDatabase.execute((client) =>
          client
            .update(databasesTable)
            .set({ connectionInfo: encrypted, name, type })
            .where(eq(databasesTable.id, id))
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
        get,
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
