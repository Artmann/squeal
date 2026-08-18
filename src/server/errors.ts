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
