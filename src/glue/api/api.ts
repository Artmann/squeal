// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.
//
// The single source of truth for the HTTP contract: the server implements it
// with HttpApiBuilder and the renderer derives a typed client from it with
// HttpApiClient.
import { HttpApi } from '@effect/platform'

import { completionsGroup } from './groups/completions'
import { connectionTestsGroup } from './groups/connection-tests'
import { databasesGroup } from './groups/databases'
import { healthGroup } from './groups/health'
import { queriesGroup } from './groups/queries'
import { secretStorageGroup } from './groups/secret-storage'
import { settingsGroup } from './groups/settings'
import { tracesGroup } from './groups/traces'
import { updatesGroup } from './groups/updates'
import { worksheetsGroup } from './groups/worksheets'

export const SquealApi = HttpApi.make('SquealApi')
  .add(completionsGroup)
  .add(connectionTestsGroup)
  .add(databasesGroup)
  .add(healthGroup)
  .add(queriesGroup)
  .add(secretStorageGroup)
  .add(settingsGroup)
  .add(tracesGroup)
  .add(updatesGroup)
  .add(worksheetsGroup)
