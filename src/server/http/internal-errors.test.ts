import { Cause, Effect, Exit, Option } from 'effect'
import invariant from 'tiny-invariant'
import { describe, expect, it } from 'vitest'

import {
  DatabaseNotFoundError,
  DifferentServerError,
  NoDatabaseAvailableError,
  QueryNotFoundError,
  SchemaLoadFailedError,
  UnauthorizedError,
  UnknownDatabaseIdsError,
  UnknownWorksheetIdsError,
  UpdateNotReadyError,
  WorksheetNotFoundError
} from '@/glue/api/errors'
import {
  AppDatabaseError,
  QueryExecutionError,
  SecretDecryptError
} from '../errors'
import { orDieInternal } from './internal-errors'

describe('orDieInternal', () => {
  // The taxonomy is a list of classes and an `instanceof` chain that has to
  // name every one of them. Nothing links the two, so a class added to
  // `errors.ts` and forgotten here reaches the renderer as a typed failure the
  // contract never declared.
  it.each([
    [
      'an app database error',
      new AppDatabaseError({ message: 'no such table' })
    ],
    [
      'a query execution error',
      new QueryExecutionError({ message: 'syntax error at or near "SELCT"' })
    ],
    [
      'a secret decrypt error',
      new SecretDecryptError({
        message: 'The stored password could not be read.'
      })
    ]
  ])('turns %s into a defect', async (_description, error) => {
    const exit = await Effect.runPromiseExit(orDieInternal(Effect.fail(error)))

    invariant(Exit.isFailure(exit), 'The effect fails.')

    expect(Cause.dieOption(exit.cause)).toEqual(Option.some(error))
    expect(Cause.failureOption(exit.cause)).toEqual(Option.none())
  })

  // The mirror image, and the half that costs a user something: the chain
  // widening by one class turns a declared failure into a 500. Every error in
  // the contract is listed, because a handler pipes its whole error channel
  // through here and the chain names classes, not routes.
  it.each([
    [
      'a database not found error',
      new DatabaseNotFoundError({
        databaseId: 'db-123',
        message: 'Database not found.'
      })
    ],
    [
      'a different server error',
      new DifferentServerError({ message: 'Enter the password again.' })
    ],
    [
      'a no database available error',
      new NoDatabaseAvailableError({ message: 'Add a connection first.' })
    ],
    [
      'a query not found error',
      new QueryNotFoundError({
        message: 'Query not found.',
        queryId: 'query-123'
      })
    ],
    [
      'a schema load failed error',
      new SchemaLoadFailedError({
        databaseName: 'pagila',
        message: 'The schema could not be read.'
      })
    ],
    [
      'an unauthorized error',
      new UnauthorizedError({ message: 'Missing session token.' })
    ],
    [
      'an unknown database ids error',
      new UnknownDatabaseIdsError({
        message: 'Unknown databases.',
        unknownIds: ['db-123']
      })
    ],
    [
      'an unknown worksheet ids error',
      new UnknownWorksheetIdsError({
        message: 'Unknown worksheets.',
        unknownIds: ['ws-123']
      })
    ],
    [
      'an update not ready error',
      new UpdateNotReadyError({ message: 'No update is ready to install.' })
    ],
    [
      'a worksheet not found error',
      new WorksheetNotFoundError({
        message: 'Worksheet not found.',
        worksheetId: 'ws-123'
      })
    ]
  ])('leaves %s in the typed channel', async (_description, error) => {
    const exit = await Effect.runPromiseExit(orDieInternal(Effect.fail(error)))

    invariant(Exit.isFailure(exit), 'The effect fails.')

    expect(Cause.failureOption(exit.cause)).toEqual(Option.some(error))
    expect(Cause.dieOption(exit.cause)).toEqual(Option.none())
  })

  it('runs the effect once and passes its value through', async () => {
    let runs = 0

    const value = await Effect.runPromise(
      orDieInternal(
        Effect.sync(() => {
          runs += 1

          return { databases: [] }
        })
      )
    )

    // Every handler is piped through this, so a wrapper that evaluated its
    // effect twice would run the user's query twice.
    expect({ runs, value }).toEqual({ runs: 1, value: { databases: [] } })
  })
})
