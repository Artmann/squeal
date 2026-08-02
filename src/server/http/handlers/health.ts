import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { SecretStorage } from '@/server/services/secret-storage'

export const HealthLive = HttpApiBuilder.group(
  SquealApi,
  'health',
  (handlers) =>
    handlers.handle('get', () =>
      Effect.gen(function* () {
        const secrets = yield* SecretStorage
        const encryptionAvailable = yield* secrets.isEncryptionAvailable

        return { encryptionAvailable, status: 'ok' as const }
      })
    )
)
