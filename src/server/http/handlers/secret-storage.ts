import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { SecretStorageSettings } from '@/server/services/secret-storage-settings'
import { orDieInternal } from '../internal-errors'

export const SecretStorageLive = HttpApiBuilder.group(
  SquealApi,
  'secretStorage',
  (handlers) =>
    handlers
      .handle('get', () =>
        Effect.gen(function* () {
          const settings = yield* SecretStorageSettings

          return yield* settings.status()
        }).pipe(orDieInternal)
      )
      .handle('grant', () =>
        Effect.gen(function* () {
          const settings = yield* SecretStorageSettings

          return yield* settings.grant()
        }).pipe(orDieInternal)
      )
      .handle('skip', () =>
        Effect.gen(function* () {
          const settings = yield* SecretStorageSettings

          return yield* settings.skip()
        }).pipe(orDieInternal)
      )
)
