import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { Updater } from '@/server/services/updater'

export const UpdatesLive = HttpApiBuilder.group(
  SquealApi,
  'updates',
  (handlers) =>
    handlers
      .handle('get', () =>
        Effect.gen(function* () {
          const updater = yield* Updater

          return yield* updater.status
        })
      )
      .handle('install', () =>
        Effect.gen(function* () {
          const updater = yield* Updater

          return yield* updater.install()
        })
      )
)
