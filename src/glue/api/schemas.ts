// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.
import { Schema } from 'effect'

import { isValidSpanId, isValidTraceId } from '../tracing/traceparent'

// --- Request ids ---------------------------------------------------------------
// Validated but deliberately unbranded: ids round-trip through DTOs and the
// typed client as plain strings, and a brand here would force a decode at
// every call site. They only require non-emptiness — rows created by older
// app versions are not guaranteed to be UUIDs.

export const DatabaseId = Schema.String.pipe(Schema.minLength(1))

export const QueryId = Schema.String.pipe(Schema.minLength(1))

export const TraceId = Schema.String.pipe(
  Schema.filter(isValidTraceId, {
    message: () => 'Expected a 32-character hexadecimal trace id.'
  })
)

export const WorksheetId = Schema.String.pipe(Schema.minLength(1))

// --- Connection info ---------------------------------------------------------

const DatabaseType = Schema.Literal('mysql', 'postgres', 'sqlite')
export type DatabaseType = Schema.Schema.Type<typeof DatabaseType>

const SslMode = Schema.Literal('disable', 'require', 'verify-ca', 'verify-full')
export type SslMode = Schema.Schema.Type<typeof SslMode>

// Forms submit the port as a number, a string, or nothing at all — normalize
// to a number or undefined, matching the previous zod transform.
const Port = Schema.transform(
  Schema.Union(Schema.Null, Schema.Number, Schema.String, Schema.Undefined),
  Schema.UndefinedOr(Schema.Number),
  {
    decode: (value) => {
      if (value === undefined || value === null || value === '') {
        return undefined
      }

      return typeof value === 'number' ? value : Number(value)
    },
    encode: (value) => value,
    strict: true
  }
)

const serverConnectionInfoFields = {
  database: Schema.String.pipe(
    Schema.minLength(1, { message: () => 'Database name is required.' })
  ),
  host: Schema.String.pipe(
    Schema.minLength(1, { message: () => 'Host is required.' })
  ),
  port: Schema.optional(Port),
  sslMode: Schema.optional(SslMode),
  sslRootCert: Schema.optional(Schema.String),
  username: Schema.String.pipe(
    Schema.minLength(1, { message: () => 'Username is required.' })
  )
}

// MySQL and PostgreSQL connections share the same shape.
const ServerConnectionInfo = Schema.Struct({
  ...serverConnectionInfoFields,
  password: Schema.String.pipe(
    Schema.minLength(1, { message: () => 'Password is required.' })
  )
})
export type ServerConnectionInfo = Schema.Schema.Type<
  typeof ServerConnectionInfo
>

const SqliteConnectionInfo = Schema.Struct({
  path: Schema.String.pipe(
    Schema.minLength(1, { message: () => 'File path is required.' })
  )
})
export type SqliteConnectionInfo = Schema.Schema.Type<
  typeof SqliteConnectionInfo
>

const ConnectionInfo = Schema.Union(ServerConnectionInfo, SqliteConnectionInfo)
export type ConnectionInfo = Schema.Schema.Type<typeof ConnectionInfo>

// Updates and connection tests may omit the password to mean "use the stored
// one" — the main process merges it back in server-side.
const UpdateServerConnectionInfo = Schema.Struct({
  ...serverConnectionInfoFields,
  password: Schema.optional(Schema.String)
})

// --- Database connections ------------------------------------------------------

// `type` and `connectionInfo` only mean anything as a pair: SQLite needs a file
// path, a server needs a host and credentials. Validating them independently let
// `{ type: 'sqlite', connectionInfo: { host, … } }` decode cleanly and then
// reach the SQLite adapter with no path at all. Discriminating on `type` turns
// that into a decode failure at the boundary instead of a crash deeper in.
const serverConnectionFields = {
  connectionInfo: ServerConnectionInfo,
  type: Schema.Literal('mysql', 'postgres')
} as const

const sqliteConnectionFields = {
  connectionInfo: SqliteConnectionInfo,
  type: Schema.Literal('sqlite')
} as const

// SQLite has no password to omit, so it reuses the same member here.
const updateServerConnectionFields = {
  connectionInfo: UpdateServerConnectionInfo,
  type: Schema.Literal('mysql', 'postgres')
} as const

// Only the types are consumed — the payload schemas below are what the routes
// decode against, so these two stay module-private like ConnectionInfo above.
const DatabaseConnection = Schema.Union(
  Schema.Struct(serverConnectionFields),
  Schema.Struct(sqliteConnectionFields)
)
export type DatabaseConnection = Schema.Schema.Type<typeof DatabaseConnection>

const UpdateDatabaseConnection = Schema.Union(
  Schema.Struct(updateServerConnectionFields),
  Schema.Struct(sqliteConnectionFields)
)
export type UpdateDatabaseConnection = Schema.Schema.Type<
  typeof UpdateDatabaseConnection
>

// The renderer never receives stored passwords — API responses use this
// shape, which has no password field at all.
const PublicServerConnectionInfo = Schema.Struct(serverConnectionInfoFields)

const PublicConnectionInfo = Schema.Union(
  PublicServerConnectionInfo,
  SqliteConnectionInfo
)
export type PublicConnectionInfo = Schema.Schema.Type<
  typeof PublicConnectionInfo
>

// --- Databases ---------------------------------------------------------------

export const DatabaseDto = Schema.Struct({
  // Null when the stored secret could not be decrypted — for example after the
  // OS keychain was reset. The row still has to be listed so the user can see
  // it, repair it, or delete it.
  connectionInfo: Schema.NullOr(PublicConnectionInfo),
  createdAt: Schema.Number,
  id: Schema.String,
  name: Schema.String,
  sortOrder: Schema.NullOr(Schema.Number),
  type: DatabaseType
})
export type DatabaseDto = Schema.Schema.Type<typeof DatabaseDto>

const databaseName = Schema.String.pipe(
  Schema.minLength(1, { message: () => 'Name is required.' })
)

export const CreateDatabaseRequest = Schema.Union(
  Schema.Struct({ ...serverConnectionFields, name: databaseName }),
  Schema.Struct({ ...sqliteConnectionFields, name: databaseName })
)
export type CreateDatabaseRequest = Schema.Schema.Type<
  typeof CreateDatabaseRequest
>

export const UpdateDatabaseRequest = Schema.Union(
  Schema.Struct({ ...updateServerConnectionFields, name: databaseName }),
  Schema.Struct({ ...sqliteConnectionFields, name: databaseName })
)
export type UpdateDatabaseRequest = Schema.Schema.Type<
  typeof UpdateDatabaseRequest
>

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length

export const ReorderDatabasesRequest = Schema.Struct({
  databaseIds: Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(
    Schema.minItems(1, {
      message: () => 'At least one database id is required.'
    }),
    Schema.filter((ids) => uniqueIds(ids) || 'Database ids must be unique.')
  )
})

// --- Worksheets ----------------------------------------------------------------

export const WorksheetDto = Schema.Struct({
  content: Schema.String,
  createdAt: Schema.Number,
  databaseId: Schema.NullOr(Schema.String),
  id: Schema.String,
  lastOpenedAt: Schema.NullOr(Schema.Number),
  name: Schema.String,
  sortOrder: Schema.NullOr(Schema.Number)
})
export type WorksheetDto = Schema.Schema.Type<typeof WorksheetDto>

export const CreateWorksheetRequest = Schema.Struct({
  content: Schema.optional(Schema.String),
  databaseId: Schema.optional(Schema.String),
  name: Schema.String
})
export type CreateWorksheetRequest = Schema.Schema.Type<
  typeof CreateWorksheetRequest
>

export const UpdateWorksheetRequest = Schema.Struct({
  content: Schema.optional(Schema.String),
  databaseId: Schema.optional(Schema.NullOr(Schema.String)),
  lastOpenedAt: Schema.optional(Schema.Number),
  name: Schema.optional(Schema.String)
})
export type UpdateWorksheetRequest = Schema.Schema.Type<
  typeof UpdateWorksheetRequest
>

export const ReorderWorksheetsRequest = Schema.Struct({
  worksheetIds: Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(
    Schema.minItems(1, {
      message: () => 'At least one worksheet id is required.'
    }),
    Schema.filter((ids) => uniqueIds(ids) || 'Worksheet ids must be unique.')
  )
})

// --- Queries -------------------------------------------------------------------

const QueryResultDto = Schema.Struct({
  fields: Schema.mutable(Schema.Array(Schema.Struct({ name: Schema.String }))),

  // Number of rows returned (at most the adapter row cap) for row-returning
  // statements, or the driver-reported affected-row count for DML. When
  // truncated is true the true total is unknown.
  rowCount: Schema.Number,

  rows: Schema.mutable(
    Schema.Array(
      Schema.mutable(
        Schema.Record({ key: Schema.String, value: Schema.Unknown })
      )
    )
  ),
  truncated: Schema.Boolean
})
export type QueryResultDto = Schema.Schema.Type<typeof QueryResultDto>

const QueryDto = Schema.Struct({
  content: Schema.String,
  databaseId: Schema.String,
  error: Schema.NullOr(Schema.String),
  finishedAt: Schema.NullOr(Schema.Number),
  id: Schema.String,
  queriedAt: Schema.Number,
  result: Schema.NullOr(QueryResultDto),
  truncated: Schema.Boolean,
  worksheetId: Schema.String
})
export type QueryDto = Schema.Schema.Type<typeof QueryDto>

export const CreateQueryRequest = Schema.Struct({
  content: Schema.String,

  // Absent, null, or empty means "run against the default database".
  databaseId: Schema.optional(
    Schema.transform(
      Schema.NullOr(Schema.String),
      Schema.UndefinedOr(Schema.String),
      {
        decode: (value) => value || undefined,
        encode: (value) => value ?? null,
        strict: true
      }
    )
  ),
  id: Schema.String,
  queriedAt: Schema.Number,
  worksheetId: Schema.String
})
export type CreateQueryRequest = Schema.Schema.Type<typeof CreateQueryRequest>

// --- Database schema introspection ----------------------------------------------

const ColumnInfoDto = Schema.Struct({
  columnName: Schema.String,
  dataType: Schema.String,
  defaultValue: Schema.NullOr(Schema.String),
  isNullable: Schema.Boolean,
  isPrimaryKey: Schema.Boolean,
  ordinalPosition: Schema.Number
})

const ForeignKeyInfoDto = Schema.Struct({
  columnName: Schema.String,
  constraintName: Schema.String,
  referencedColumnName: Schema.String,
  referencedTableName: Schema.String,
  referencedTableSchema: Schema.String
})

const TableInfoDto = Schema.Struct({
  columns: Schema.mutable(Schema.Array(ColumnInfoDto)),
  foreignKeys: Schema.mutable(Schema.Array(ForeignKeyInfoDto)),
  tableName: Schema.String,
  tableSchema: Schema.String
})

const SchemaInfoDto = Schema.Struct({
  databaseName: Schema.String,

  // The database server's product and release ("PostgreSQL 16"), probed
  // alongside the introspection. Optional in both directions on purpose: the
  // probe is best effort, so a response that never carried the field must
  // still decode.
  serverVersion: Schema.optional(Schema.String),

  tables: Schema.mutable(Schema.Array(TableInfoDto))
})
export type SchemaInfoDto = Schema.Schema.Type<typeof SchemaInfoDto>

// --- Connection tests ------------------------------------------------------------

export const ConnectionTestRequest = Schema.Union(
  Schema.Struct({
    ...updateServerConnectionFields,
    databaseId: Schema.optional(Schema.String)
  }),
  Schema.Struct({
    ...sqliteConnectionFields,
    databaseId: Schema.optional(Schema.String)
  })
)
export type ConnectionTestRequest = Schema.Schema.Type<
  typeof ConnectionTestRequest
>

// A failed test is data, not an error — the endpoint always answers 200 so
// the renderer can show the driver message inline.
export const ConnectionTestResponse = Schema.Struct({
  message: Schema.optional(Schema.String),
  success: Schema.Boolean
})
export type ConnectionTestResponse = Schema.Schema.Type<
  typeof ConnectionTestResponse
>

// --- Traces ---------------------------------------------------------------------

// All-zero ids are rejected as well as malformed ones: they are unusable as a
// lookup key, so accepting them would merge unrelated spans into one
// unopenable trace.
const SpanIdField = Schema.String.pipe(
  Schema.filter(isValidSpanId, {
    message: () => 'Expected a 16-character hexadecimal span id.'
  })
)

const TraceIdField = Schema.String.pipe(
  Schema.filter(isValidTraceId, {
    message: () => 'Expected a 32-character hexadecimal trace id.'
  })
)

const SpanAttributesDto = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.Union(Schema.Boolean, Schema.Number, Schema.String)
  })
)

const SpanEventDto = Schema.Struct({
  attributes: Schema.optional(SpanAttributesDto),
  name: Schema.String,
  time: Schema.Number
})

const SpanDto = Schema.Struct({
  attributes: SpanAttributesDto,
  durationMs: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0)),
  events: Schema.mutable(Schema.Array(SpanEventDto)),
  id: SpanIdField,
  kind: Schema.Literal('client', 'internal', 'server'),
  name: Schema.String.pipe(Schema.minLength(1)),
  parentSpanId: Schema.NullOr(SpanIdField),
  serviceName: Schema.Literal('main', 'renderer'),
  startedAt: Schema.Number,
  status: Schema.Literal('error', 'ok', 'unset'),
  statusMessage: Schema.NullOr(Schema.String),
  traceId: TraceIdField
})
export type SpanDto = Schema.Schema.Type<typeof SpanDto>

const maxIngestBatchSize = 200

export const IngestSpansRequest = Schema.Struct({
  spans: Schema.Array(SpanDto).pipe(Schema.maxItems(maxIngestBatchSize))
})

const TraceSummaryDto = Schema.Struct({
  durationMs: Schema.Number,
  errorMessage: Schema.NullOr(Schema.String),
  hasError: Schema.Boolean,
  name: Schema.String,
  serviceName: Schema.String,
  spanCount: Schema.Number,
  startedAt: Schema.Number,
  traceId: Schema.String
})
export type TraceSummaryDto = Schema.Schema.Type<typeof TraceSummaryDto>

export const ListTracesUrlParams = Schema.Struct({
  before: Schema.optional(Schema.NumberFromString.pipe(Schema.int())),
  errorOnly: Schema.optionalWith(
    Schema.transform(Schema.Literal('false', 'true'), Schema.Boolean, {
      decode: (value) => value === 'true',
      encode: (value) => (value ? 'true' : 'false'),
      strict: true
    }),
    { default: () => false }
  ),
  limit: Schema.optionalWith(
    Schema.NumberFromString.pipe(Schema.int(), Schema.between(1, 200)),
    { default: () => 50 }
  ),
  search: Schema.optional(Schema.String)
})
export type ListTracesUrlParams = Schema.Schema.Type<typeof ListTracesUrlParams>

// --- Health ---------------------------------------------------------------------

// A liveness probe and nothing more. It deliberately carries no data: it used to
// report keychain availability, but answering that question means reaching into
// the keychain, which is what raises the OS prompt this app now asks for
// consent before doing. Whether secrets are encrypted comes from
// GET /secret-storage instead.
export const HealthResponse = Schema.Struct({
  status: Schema.Literal('ok')
})
export type HealthResponse = Schema.Schema.Type<typeof HealthResponse>

// --- Secret storage ---------------------------------------------------------------

// Whether Squeal may use the OS keychain to encrypt stored connection
// passwords. Nothing in the app touches the keychain until this is decided:
//
//   keychain   access granted; passwords are stored as enc:v1:<base64>
//   plaintext  the user skipped; passwords are stored as they were given
//   undecided  no decision yet — the renderer asks before anything else runs
const SecretStorageMode = Schema.Literal('keychain', 'plaintext', 'undecided')
export type SecretStorageMode = Schema.Schema.Type<typeof SecretStorageMode>

// `message` is set only when a grant was refused, so the consent screen can say
// what happened and what to do about it. `storageName` is the platform's name
// for its keychain, filled in by the main process so every string the renderer
// shows about it has a single source.
export const SecretStorageResponse = Schema.Struct({
  message: Schema.NullOr(Schema.String),
  mode: SecretStorageMode,
  storageName: Schema.String
})
export type SecretStorageResponse = Schema.Schema.Type<
  typeof SecretStorageResponse
>

// --- Settings ---------------------------------------------------------------------

// The app-wide preferences, one row in the database and one object here.
// `aiCompletionModel` is null until the user picks one, which means "use the
// best model Ollama has" rather than "no model".
export const SettingsResponse = Schema.Struct({
  aiCompletionModel: Schema.NullOr(Schema.String),
  aiCompletionsEnabled: Schema.Boolean
})
export type SettingsResponse = Schema.Schema.Type<typeof SettingsResponse>

// Every field optional: the Settings screen changes one control at a time and
// must never write back a value it did not touch.
export const UpdateSettingsRequest = Schema.Struct({
  aiCompletionModel: Schema.optional(Schema.NullOr(Schema.String)),
  aiCompletionsEnabled: Schema.optional(Schema.Boolean)
})
export type UpdateSettingsRequest = Schema.Schema.Type<
  typeof UpdateSettingsRequest
>

// --- Completions ---------------------------------------------------------------------

// Enough context for the model to continue any realistic statement, and a hard
// bound on what one keystroke pause can send. The editor slices to this before
// asking, so a long worksheet narrows the window rather than failing.
export const maxCompletionContext = 4_000

// An unavailable Ollama is data, not a fault: `available` is false, `message`
// says what to do about it, and nothing anywhere shows an error.
export const CompletionStatusResponse = Schema.Struct({
  available: Schema.Boolean,
  enabled: Schema.Boolean,
  message: Schema.String,
  models: Schema.mutable(Schema.Array(Schema.String)),
  selectedModel: Schema.NullOr(Schema.String)
})
export type CompletionStatusResponse = Schema.Schema.Type<
  typeof CompletionStatusResponse
>

export const CompletionRequest = Schema.Struct({
  // Absent when the worksheet has no database attached: the suggestion is then
  // made from the statement alone, with no schema to draw names from.
  databaseId: Schema.optional(Schema.String),
  prefix: Schema.String.pipe(Schema.maxLength(maxCompletionContext)),
  suffix: Schema.String.pipe(Schema.maxLength(maxCompletionContext))
})
export type CompletionRequest = Schema.Schema.Type<typeof CompletionRequest>

// Null covers every way a suggestion can fail to arrive — Ollama missing,
// turned off, a model that answered with nothing. None of them are worth
// interrupting someone who is typing.
export const CompletionResponse = Schema.Struct({
  completion: Schema.NullOr(Schema.String)
})
export type CompletionResponse = Schema.Schema.Type<typeof CompletionResponse>

// --- Updates ---------------------------------------------------------------------

// A failed check is data, not an error channel: the renderer shows `message`
// in the update popover and keeps polling, exactly like a failed connection
// test renders inline. `state` is the whole contract the UI branches on:
//
//   available    a newer version exists that this platform cannot self-install
//   checking     a check is in flight
//   downloading  Squirrel is fetching the update
//   error        the check or the download failed; `message` says which
//   idle         no update known
//   ready        downloaded — installing it is one restart away
//   unsupported  no update path from here (development build, DMG mount)
export const UpdateStatusResponse = Schema.Struct({
  currentVersion: Schema.String,
  lastCheckedAt: Schema.NullOr(Schema.Number),
  message: Schema.NullOr(Schema.String),
  releaseNotesUrl: Schema.NullOr(Schema.String),
  state: Schema.Literal(
    'available',
    'checking',
    'downloading',
    'error',
    'idle',
    'ready',
    'unsupported'
  ),
  version: Schema.NullOr(Schema.String)
})

export type UpdateStatusResponse = Schema.Schema.Type<
  typeof UpdateStatusResponse
>

// --- Response envelopes -----------------------------------------------------------

export const ListDatabasesResponse = Schema.Struct({
  databases: Schema.mutable(Schema.Array(DatabaseDto))
})

export const CreateDatabaseResponse = Schema.Struct({
  database: DatabaseDto,
  updatedWorksheet: Schema.optional(WorksheetDto)
})
export type CreateDatabaseResponse = Schema.Schema.Type<
  typeof CreateDatabaseResponse
>

export const UpdateDatabaseResponse = Schema.Struct({
  database: DatabaseDto
})
export type UpdateDatabaseResponse = Schema.Schema.Type<
  typeof UpdateDatabaseResponse
>

export const ReorderDatabasesResponse = Schema.Struct({
  databases: Schema.mutable(Schema.Array(DatabaseDto))
})
export type ReorderDatabasesResponse = Schema.Schema.Type<
  typeof ReorderDatabasesResponse
>

export const GetDatabaseSchemaResponse = Schema.Struct({
  schema: SchemaInfoDto
})

export const DeleteDatabaseResponse = Schema.Struct({
  success: Schema.Literal(true)
})

export const GetQueriesResponse = Schema.Struct({
  queries: Schema.mutable(Schema.Array(QueryDto))
})

export const GetQueryResponse = Schema.Struct({
  query: QueryDto
})

export const CreateQueryResponse = Schema.Struct({
  query: QueryDto
})
export type CreateQueryResponse = Schema.Schema.Type<typeof CreateQueryResponse>

export const CancelQueryResponse = Schema.Struct({
  success: Schema.Literal(true)
})

export const ListWorksheetsResponse = Schema.Struct({
  worksheets: Schema.mutable(Schema.Array(WorksheetDto))
})

export const CreateWorksheetResponse = Schema.Struct({
  worksheet: WorksheetDto
})

export const UpdateWorksheetResponse = Schema.Struct({
  worksheet: WorksheetDto
})

export const ReorderWorksheetsResponse = Schema.Struct({
  worksheets: Schema.mutable(Schema.Array(WorksheetDto))
})
export type ReorderWorksheetsResponse = Schema.Schema.Type<
  typeof ReorderWorksheetsResponse
>

export const DeleteWorksheetResponse = Schema.Struct({
  success: Schema.Literal(true)
})

export const GetTracesResponse = Schema.Struct({
  traces: Schema.mutable(Schema.Array(TraceSummaryDto))
})

export const GetTraceResponse = Schema.Struct({
  spans: Schema.mutable(Schema.Array(SpanDto))
})

export const IngestSpansResponse = Schema.Struct({
  insertedCount: Schema.Number
})
