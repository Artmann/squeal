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
    // What the keychain actually said. `message` is the copy the user reads and
    // is the same sentence however decryption failed, so without this the log
    // cannot tell a mode gate refusing to touch the keychain from a key that no
    // longer opens the value. For the log only — never returned to the renderer.
    cause: Schema.optional(Schema.String),
    // Attached by whoever knows which row this was, so a handler can name the
    // connection in a user-facing error without a second lookup.
    databaseName: Schema.optional(Schema.String),
    message: Schema.String
  }
) {}
