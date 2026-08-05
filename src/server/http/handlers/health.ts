import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'

// Answers from nothing at all. It used to report keychain availability, but
// asking that question reaches into the keychain, which would let the one
// unauthenticated route raise an OS prompt before the user has agreed to one.
export const HealthLive = HttpApiBuilder.group(
  SquealApi,
  'health',
  (handlers) =>
    handlers.handle('get', () => Effect.succeed({ status: 'ok' as const }))
)
