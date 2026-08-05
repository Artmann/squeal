import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'

import { HealthResponse } from '../schemas'

// Unauthenticated on purpose: the renderer probes it before it has a token.
// It answers from nothing at all — no database, no OS keychain — which is what
// keeps an unauthenticated route from being able to raise a keychain prompt.
export const healthGroup = HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('get', '/health').addSuccess(HealthResponse)
)
