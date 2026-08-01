import { Effect } from 'effect'

import {
  AppDatabaseError,
  ConnectionFailedError,
  QueryExecutionError,
  SecretDecryptError
} from '../errors'

type InternalError =
  | AppDatabaseError
  | ConnectionFailedError
  | QueryExecutionError
  | SecretDecryptError

function isInternalError(error: unknown): error is InternalError {
  return (
    error instanceof AppDatabaseError ||
    error instanceof ConnectionFailedError ||
    error instanceof QueryExecutionError ||
    error instanceof SecretDecryptError
  )
}

// Internal errors are not part of the HTTP contract — converting them to
// defects hands them to the platform's 500 backstop while keeping the
// declared, user-actionable errors in the typed channel.
export function orDieInternal<A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, Exclude<E, InternalError>, R> {
  return Effect.catchIf(
    effect,
    (error): error is Extract<E, InternalError> => isInternalError(error),
    (error) => Effect.die(error)
  ) as Effect.Effect<A, Exclude<E, InternalError>, R>
}
