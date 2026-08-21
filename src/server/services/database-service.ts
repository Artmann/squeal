import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import { databasesTable, worksheetsTable } from '@/database/schema'
import {
  DatabaseNotFoundError,
  DifferentServerError,
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

// What a request asking to reuse a stored password can get back: the connection
// to open, a refusal because the password would leave the server it was saved
// for or travel there differently, or a refusal because there is no stored
// password to reuse.
export type ResolvedConnection =
  | { readonly _tag: 'resolved'; readonly connection: DatabaseConnection }
  | { readonly _tag: 'differentServer' }
  | { readonly _tag: 'passwordRequired' }

// The fields that decide where a password goes — the ones targetsSameServer
// compares. Both the requested and the stored server connection info satisfy
// this shape.
interface ConnectionTarget {
  readonly host: string
  readonly port?: number | undefined
}

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
                `Could not read connection info for database ${record.id}: ${describeSecretDecryptError(error)}`
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

          // Named here because this is the last frame that knows which row it
          // was: callers get an id at best, and a handler answering the user
          // should be able to say which connection to go and repair.
          const connectionInfo = yield* parseConnectionInfo(
            record.value.connectionInfo
          ).pipe(Effect.mapError(withDatabaseName(record.value.name)))

          const connection = yield* toDatabaseConnection(
            record.value.type as DatabaseType,
            connectionInfo
          ).pipe(Effect.mapError(withDatabaseName(record.value.name)))

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

        // The purge and the soft delete are already one statement; the
        // transaction is here for the unlink, which has to land with them. Run
        // separately, a failure between the two left live worksheets holding
        // the id of a soft-deleted row. Neither surface draws that as
        // connected — both resolve the name through list(), which excludes
        // deleted rows — they draw it as unconnected while the row still points
        // at the dead id, so create's auto-link never adopts it (that matches
        // only databaseId IS NULL) and a query run from it answers "database
        // not found".
        //
        // Unlinking first would leave a more benign torn state and need no
        // transaction. All-or-nothing is stronger, and create already takes the
        // same BEGIN on the shared connection, so remove joins a hazard rather
        // than inventing one.
        yield* appDatabase.transaction(async (client) => {
          await client
            .update(databasesTable)
            .set({ connectionInfo: purged, deletedAt: Date.now() })
            .where(eq(databasesTable.id, id))

          await client
            .update(worksheetsTable)
            .set({ databaseId: null })
            .where(
              and(
                eq(worksheetsTable.databaseId, id),
                isNull(worksheetsTable.deletedAt)
              )
            )
        })
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

        // An ordering is one fact, not N per-row facts. Written as N
        // statements, a failure at row k persisted a torn order while the caller
        // got AppDatabaseError and the renderer reverted — and list()'s
        // ordering below then interleaved renumbered and stale rows.
        //
        // One statement rather than a transaction, matching
        // WorksheetService.reorder and for the reason written there:
        // AppDatabase.transaction issues BEGIN on the single shared connection,
        // so a concurrent write would either fail its own BEGIN and surface as
        // "restart Squeal", or be swept into this transaction and rolled back
        // with it after its own handler had already answered. A single UPDATE
        // needs none of that to be atomic.
        //
        // Non-empty by contract: ReorderDatabasesRequest requires minItems(1),
        // and sql.join([]) would emit `case "id" end`, a syntax error.
        const positions = sql.join(
          databaseIds.map((id, index) => sql`when ${id} then ${index}`),
          sql` `
        )

        yield* appDatabase.execute((client) =>
          client
            .update(databasesTable)
            .set({
              sortOrder: sql`case ${databasesTable.id} ${positions} end`
            })
            .where(inArray(databasesTable.id, [...databaseIds]))
        )

        return yield* list()
      })

      // A request without a password means "use the stored one" — the renderer
      // never sees passwords, so neither an edit nor a connection test can send
      // one back. Both callers resolve here so the lending rules are written
      // once: the update route used to merge the secret in on its own, without
      // the same-server check, which made a PATCH the two-step way around the
      // connection test's refusal.
      const resolveConnection = Effect.fn('DatabaseService.resolveConnection')(
        function* (
          databaseId: string | undefined,
          connection: UpdateDatabaseConnection
        ) {
          // SQLite carries no password, so there is nothing to look up. The
          // pair is rebuilt rather than passed along: a ConnectionTestRequest
          // arrives here carrying a databaseId as well, and a
          // DatabaseConnection is meant to be one discriminated value — the
          // type and the info that goes with it, nothing else.
          if (connection.type === 'sqlite') {
            return {
              _tag: 'resolved',
              connection: {
                connectionInfo: connection.connectionInfo,
                type: connection.type
              }
            } as const
          }

          const { connectionInfo, type } = connection

          if (connectionInfo.password) {
            return {
              _tag: 'resolved',
              connection: {
                connectionInfo: {
                  ...connectionInfo,
                  password: connectionInfo.password
                },
                type
              }
            } as const
          }

          if (databaseId === undefined) {
            return { _tag: 'passwordRequired' } as const
          }

          // A stored secret this build cannot read must not block the edit that
          // repairs it, so an unreadable row behaves like one with no stored
          // password rather than failing the request.
          const stored = yield* getWithSecrets(databaseId).pipe(
            Effect.catchTag('SecretDecryptError', () =>
              Effect.succeed(Option.none<DatabaseWithSecrets>())
            )
          )

          if (Option.isNone(stored)) {
            return { _tag: 'passwordRequired' } as const
          }

          const storedConnection = stored.value.connection

          // Excluding sqlite also narrows the stored info to the server shape,
          // which is the only one carrying a password to lend. An empty stored
          // password is no secret: rows repaired after an unreadable secret
          // hold one, as do rows written before the field had to be non-empty.
          // Asking for a password is the honest answer there — refusing the
          // edit would demand one that does not exist.
          if (
            storedConnection.type === 'sqlite' ||
            storedConnection.type !== type ||
            !storedConnection.connectionInfo.password
          ) {
            return { _tag: 'passwordRequired' } as const
          }

          // Without this an authenticated caller could aim a saved password at
          // a server they control, or strip its TLS, and have the app hand it
          // over during the handshake.
          if (
            !targetsSameServer(
              connectionInfo,
              storedConnection.connectionInfo
            )
          ) {
            return { _tag: 'differentServer' } as const
          }

          return {
            _tag: 'resolved',
            connection: {
              connectionInfo: {
                ...connectionInfo,
                password: storedConnection.connectionInfo.password
              },
              type
            }
          } as const
        }
      )

      const update = Effect.fn('DatabaseService.update')(function* (
        id: string,
        name: string,
        connection: UpdateDatabaseConnection
      ) {
        const resolved: ResolvedConnection = yield* resolveConnection(
          id,
          connection
        )

        if (resolved._tag === 'differentServer') {
          return yield* new DifferentServerError({
            message: 'Enter the password to change the host or port.'
          })
        }

        // There is no stored password to keep, so the edit saves a blank one.
        // That is what repairs a row whose secret this build cannot read: the
        // user re-enters the password afterwards.
        const target: DatabaseConnection =
          resolved._tag === 'passwordRequired'
            ? withBlankPassword(connection)
            : resolved.connection

        const encrypted = yield* secrets.encrypt(
          JSON.stringify(target.connectionInfo)
        )

        const [record] = yield* appDatabase.execute((client) =>
          client
            .update(databasesTable)
            .set({ connectionInfo: encrypted, name, type: target.type })
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
        resolveConnection,
        update
      } as const
    })
  }
) {}

// The user-facing sentence is the same however decryption failed, so the log
// gets the keychain's own words appended when there are any.
function describeSecretDecryptError(error: SecretDecryptError): string {
  if (error.cause === undefined) {
    return error.message
  }

  return `${error.message} (${error.cause})`
}

// Rebuilt field by field rather than spread: the error is an Error subclass, so
// a spread would also hand the constructor properties that are not fields.
function withDatabaseName(
  databaseName: string
): (error: SecretDecryptError) => SecretDecryptError {
  return (error) =>
    new SecretDecryptError({
      cause: error.cause,
      databaseName,
      message: error.message
    })
}

// The stored password may only be lent back to the server it was saved for.
// Host and port are where the secret is sent, and that is the whole rule:
// without it an authenticated caller could aim a saved password at a server
// they control and read it straight off the handshake. Nothing else is
// compared — editing the username or the database name still targets the same
// server, so requiring a re-typed password there would be friction without a
// security gain.
//
// sslMode and sslRootCert are deliberately not compared, though they were once.
// They decide how the secret travels rather than where it goes, and weakening
// them only exposes it to someone already sitting on the network path to a host
// the user chose themselves — a far higher bar than being handed the secret
// outright. Comparing them cost a re-typed password on every SSL edit, in both
// directions, including ones that tighten TLS; and the user does not have the
// password to hand, because the app never shows it. Before re-adding them:
// moving the host is still refused, so this is not a way to redirect a secret.
//
// A stored blob is JSON.parsed, never schema-decoded, so a port the form once
// wrote as null has to read the same as one that was never set. Without that,
// an edit changing nothing would be refused.
function targetsSameServer(
  requested: ConnectionTarget,
  stored: ConnectionTarget
): boolean {
  return (
    requested.host === stored.host &&
    (requested.port ?? undefined) === (stored.port ?? undefined)
  )
}

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

function withBlankPassword(
  connection: UpdateDatabaseConnection
): DatabaseConnection {
  if (connection.type === 'sqlite') {
    return connection
  }

  return {
    connectionInfo: { ...connection.connectionInfo, password: '' },
    type: connection.type
  }
}
