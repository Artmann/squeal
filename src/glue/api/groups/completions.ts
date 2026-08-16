import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'

import {
  CompletionRequest,
  CompletionResponse,
  CompletionStatusResponse,
  ModelDownloadResponse
} from '../schemas'
import { Authorization } from '../security'

// No error channel in this group, on purpose. A suggestion is an offer: if
// Ollama is missing, turned off, slow, or answers with nothing, the honest
// response is `completion: null` and silence in the editor. The same rule makes
// a failed connection test a 200.
//
// The download endpoints keep the rule for the same reason update checks do: a
// download that failed is described by `state: 'error'` and a message, and
// starting one that is already running answers with the download in progress
// rather than a conflict — the state the caller asked for is the state they get.
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
  // No payload: the one model Squeal offers to fetch is `suggestedModel`, so
  // there is no name to take from the caller and none to validate.
  .add(
    HttpApiEndpoint.post('startDownload', '/download').addSuccess(
      ModelDownloadResponse
    )
  )
  .add(
    HttpApiEndpoint.get('downloadStatus', '/download').addSuccess(
      ModelDownloadResponse
    )
  )
  .add(
    HttpApiEndpoint.del('cancelDownload', '/download').addSuccess(
      ModelDownloadResponse
    )
  )
  .middleware(Authorization)
  .prefix('/completions')
