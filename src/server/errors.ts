// Internal tagged errors: raised inside services and either remapped to the
// wire errors in src/glue/api/errors.ts or left to the 500 backstop. They
// never appear in the HTTP contract.
import { Schema } from 'effect'

export class AppDatabaseError extends Schema.TaggedError<AppDatabaseError>()(
  'AppDatabaseError',
  {
    cause: Schema.optional(Schema.String),
    message: Schema.String
  }
) {}

export class ConnectionFailedError extends Schema.TaggedError<ConnectionFailedError>()(
  'ConnectionFailedError',
  {
    // Driver messages only — the full error object embeds the connection
    // config (host, user), which must never be logged or serialized.
    message: Schema.String
  }
) {}

// Never remapped and never reaches a handler: Completions catches it and
// answers with no suggestion, because a local model that did not answer is not
// something to interrupt someone typing with.
export class OllamaError extends Schema.TaggedError<OllamaError>()(
  'OllamaError',
  {
    message: Schema.String
  }
) {}

export class QueryExecutionError extends Schema.TaggedError<QueryExecutionError>()(
  'QueryExecutionError',
  {
    message: Schema.String
  }
) {}

export class SecretDecryptError extends Schema.TaggedError<SecretDecryptError>()(
  'SecretDecryptError',
  {
    message: Schema.String
  }
) {}
