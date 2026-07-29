import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'

import { Authorization } from '../security'
import { ConnectionTestRequest, ConnectionTestResponse } from '../schemas'

// A failed connection test answers 200 with { success: false, message } —
// failure is data the form shows inline, not an error channel.
export const connectionTestsGroup = HttpApiGroup.make('connectionTests')
  .add(
    HttpApiEndpoint.post('create', '/')
      .setPayload(ConnectionTestRequest)
      .addSuccess(ConnectionTestResponse)
  )
  .middleware(Authorization)
  .prefix('/connection-tests')
