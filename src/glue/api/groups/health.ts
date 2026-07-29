import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'

import { HealthResponse } from '../schemas'

// Unauthenticated on purpose: the renderer probes it before it has a token,
// and it carries no data beyond encryption availability.
export const healthGroup = HttpApiGroup.make('health', { topLevel: true }).add(
  HttpApiEndpoint.get('get', '/health').addSuccess(HealthResponse)
)
