import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'

import { SettingsResponse, UpdateSettingsRequest } from '../schemas'
import { Authorization } from '../security'

// The app-wide preferences row. Both routes answer with the whole settings
// object, so the Settings screen writes what came back rather than what it
// hoped it sent.
//
// The keychain decision has its own group (`/secret-storage`) and stays there:
// it is a one-time consent flow with its own screen, not a preference.
export const settingsGroup = HttpApiGroup.make('settings')
  .add(HttpApiEndpoint.get('get', '/').addSuccess(SettingsResponse))
  .add(
    HttpApiEndpoint.patch('update', '/')
      .setPayload(UpdateSettingsRequest)
      .addSuccess(SettingsResponse)
  )
  .middleware(Authorization)
  .prefix('/settings')
