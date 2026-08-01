import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { QueryRunner } from '@/server/services/query-runner'
import { orDieInternal } from '../internal-errors'

export const QueriesLive = HttpApiBuilder.group(
  SquealApi,
  'queries',
  (handlers) =>
    handlers
      .handle('list', () =>
        Effect.gen(function* () {
          const runner = yield* QueryRunner

          const queries = yield* runner.list()

          return { queries }
        }).pipe(orDieInternal)
      )
      .handle('get', ({ path }) =>
        Effect.gen(function* () {
          const runner = yield* QueryRunner

          const query = yield* runner.get(path.id)

          return { query }
        }).pipe(orDieInternal)
      )
      .handle('create', ({ payload }) =>
        Effect.gen(function* () {
          const runner = yield* QueryRunner

          const query = yield* runner.createAndRun(payload)

          return { query }
        }).pipe(orDieInternal)
      )
      .handle('cancel', ({ path }) =>
        Effect.gen(function* () {
          const runner = yield* QueryRunner

          yield* runner.cancel(path.id)

          return { success: true as const }
        })
      )
)
