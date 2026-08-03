import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'

import { UpdateNotReadyError } from '../errors'
import { Authorization } from '../security'
import { UpdateStatusResponse } from '../schemas'

// There is deliberately no check endpoint: the backend checks on a schedule of
// its own, and nothing in the UI asks for one, so a route for it would be
// contract surface with no caller.
//
// `get` never fails — a failed check comes back as `state: 'error'` with a
// message, the same way a failed connection test is a 200. `install` can fail,
// because the update it is asked to install may no longer be the one that was
// ready when the popover opened.
export const updatesGroup = HttpApiGroup.make('updates')
  .add(HttpApiEndpoint.get('get', '/').addSuccess(UpdateStatusResponse))
  .add(
    HttpApiEndpoint.post('install', '/install')
      .addSuccess(UpdateStatusResponse)
      .addError(UpdateNotReadyError)
  )
  .middleware(Authorization)
  .prefix('/updates')
