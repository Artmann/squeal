import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { EnvironmentService } from '@/server/services/environment-service'
import { orDieInternal } from '../internal-errors'
import { answerRemoved } from '../remove-route'

export const EnvironmentsLive = HttpApiBuilder.group(
  SquealApi,
  'environments',
  (handlers) =>
    handlers
      .handle('list', () =>
        Effect.gen(function* () {
          const service = yield* EnvironmentService

          const environments = yield* service.list()

          return { environments }
        }).pipe(orDieInternal)
      )
      .handle('create', ({ payload }) =>
        Effect.gen(function* () {
          const service = yield* EnvironmentService

          const environment = yield* service.create(payload.name, payload.hue)

          return { environment }
        }).pipe(orDieInternal)
      )
      .handle('remove', ({ path }) =>
        answerRemoved(EnvironmentService.remove(path.id))
      )
      .handle('update', ({ path, payload }) =>
        Effect.gen(function* () {
          const service = yield* EnvironmentService

          const environment = yield* service.update(
            path.id,
            payload.name,
            payload.hue
          )

          return { environment }
        }).pipe(orDieInternal)
      )
)
