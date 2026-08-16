import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'

import {
  CompletionRequest,
  CompletionResponse,
  CompletionStatusResponse
} from '../schemas'
import { Authorization } from '../security'

// No error channel in this group, on purpose. A suggestion is an offer: if
// Ollama is missing, turned off, slow, or answers with nothing, the honest
// response is `completion: null` and silence in the editor. The same rule makes
// a failed connection test a 200.
export const completionsGroup = HttpApiGroup.make('completions')
  .add(
    HttpApiEndpoint.get('status', '/status').addSuccess(
      CompletionStatusResponse
    )
  )
  .add(
    HttpApiEndpoint.post('create', '/')
      .setPayload(CompletionRequest)
      .addSuccess(CompletionResponse)
  )
  .middleware(Authorization)
  .prefix('/completions')
