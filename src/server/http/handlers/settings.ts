import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { AppSettings } from '@/server/services/app-settings'
import { orDieInternal } from '../internal-errors'

export const SettingsLive = HttpApiBuilder.group(
  SquealApi,
  'settings',
  (handlers) =>
    handlers
      .handle('get', () =>
        Effect.gen(function* () {
          const settings = yield* AppSettings

          return yield* settings.read()
        }).pipe(orDieInternal)
      )
      .handle('update', ({ payload }) =>
        Effect.gen(function* () {
          const settings = yield* AppSettings

          return yield* settings.update(payload)
        }).pipe(orDieInternal)
      )
)
