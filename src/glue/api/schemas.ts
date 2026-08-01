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

const UpdateConnectionInfo = Schema.Union(
  UpdateServerConnectionInfo,
  SqliteConnectionInfo
)
export type UpdateConnectionInfo = Schema.Schema.Type<
  typeof UpdateConnectionInfo
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

export const CreateDatabaseRequest = Schema.Struct({
  connectionInfo: ConnectionInfo,
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => 'Name is required.' })
  ),
  type: DatabaseType
})
export type CreateDatabaseRequest = Schema.Schema.Type<
  typeof CreateDatabaseRequest
>

export const UpdateDatabaseRequest = Schema.Struct({
  connectionInfo: UpdateConnectionInfo,
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => 'Name is required.' })
  ),
  type: DatabaseType
})
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
  tables: Schema.mutable(Schema.Array(TableInfoDto))
})
export type SchemaInfoDto = Schema.Schema.Type<typeof SchemaInfoDto>

// --- Connection tests ------------------------------------------------------------

export const ConnectionTestRequest = Schema.Struct({
  connectionInfo: UpdateConnectionInfo,
  databaseId: Schema.optional(Schema.String),
  type: DatabaseType
})
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

// encryptionAvailable tells the renderer whether the OS keychain can protect
// stored connection secrets, so it can warn before saving one.
export const HealthResponse = Schema.Struct({
  encryptionAvailable: Schema.Boolean,
  status: Schema.Literal('ok')
})

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

export const GetTracesResponse = Schema.Struct({
  traces: Schema.mutable(Schema.Array(TraceSummaryDto))
})

export const GetTraceResponse = Schema.Struct({
  spans: Schema.mutable(Schema.Array(SpanDto))
})

export const IngestSpansResponse = Schema.Struct({
  insertedCount: Schema.Number
})
