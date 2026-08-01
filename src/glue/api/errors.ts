// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.
//
// Every error a route can answer with lives here as a tagged, serializable
// class with its HTTP status attached. The renderer discriminates on `_tag`,
// so each distinct failure gets its own type instead of a generic catch-all.
import { HttpApiSchema } from '@effect/platform'
import { Schema } from 'effect'

export class DatabaseNotFoundError extends Schema.TaggedError<DatabaseNotFoundError>()(
  'DatabaseNotFoundError',
  {
    databaseId: Schema.String,
    message: Schema.String
  },
  HttpApiSchema.annotations({ status: 404 })
) {}

export class NoDatabaseAvailableError extends Schema.TaggedError<NoDatabaseAvailableError>()(
  'NoDatabaseAvailableError',
  {
    message: Schema.String
  },
  HttpApiSchema.annotations({ status: 400 })
) {}

export class QueryNotFoundError extends Schema.TaggedError<QueryNotFoundError>()(
  'QueryNotFoundError',
  {
    message: Schema.String,
    queryId: Schema.String
  },
  HttpApiSchema.annotations({ status: 404 })
) {}

export class SchemaLoadFailedError extends Schema.TaggedError<SchemaLoadFailedError>()(
  'SchemaLoadFailedError',
  {
    databaseName: Schema.String,
    message: Schema.String
  },
  HttpApiSchema.annotations({ status: 503 })
) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  'UnauthorizedError',
  {
    message: Schema.String
  },
  HttpApiSchema.annotations({ status: 401 })
) {}

export class UnknownDatabaseIdsError extends Schema.TaggedError<UnknownDatabaseIdsError>()(
  'UnknownDatabaseIdsError',
  {
    message: Schema.String,
    unknownIds: Schema.Array(Schema.String)
  },
  HttpApiSchema.annotations({ status: 400 })
) {}

export class UnknownWorksheetIdsError extends Schema.TaggedError<UnknownWorksheetIdsError>()(
  'UnknownWorksheetIdsError',
  {
    message: Schema.String,
    unknownIds: Schema.Array(Schema.String)
  },
  HttpApiSchema.annotations({ status: 400 })
) {}

export class WorksheetNotFoundError extends Schema.TaggedError<WorksheetNotFoundError>()(
  'WorksheetNotFoundError',
  {
    message: Schema.String,
    worksheetId: Schema.String
  },
  HttpApiSchema.annotations({ status: 404 })
) {}
