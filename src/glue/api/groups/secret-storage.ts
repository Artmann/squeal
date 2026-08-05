import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'

import { Authorization } from '../security'
import { SecretStorageResponse } from '../schemas'

// No error channel anywhere in this group. A refused keychain prompt is the
// user's answer, not a server fault, so `grant` answers 200 with
// `mode: 'undecided'` and a message — the same rule that makes a failed
// connection test a 200. Every response carries the authoritative mode, so the
// consent screen never needs a follow-up read.
//
// `grant` is the only route in the app that may raise an OS keychain prompt, and
// only because the user clicked a button asking for it.
export const secretStorageGroup = HttpApiGroup.make('secretStorage')
  .add(HttpApiEndpoint.get('get', '/').addSuccess(SecretStorageResponse))
  .add(
    HttpApiEndpoint.post('grant', '/grant').addSuccess(SecretStorageResponse)
  )
  .add(HttpApiEndpoint.post('skip', '/skip').addSuccess(SecretStorageResponse))
  .middleware(Authorization)
  .prefix('/secret-storage')
