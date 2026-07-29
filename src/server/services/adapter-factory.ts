// Adapter construction as a service so tests can inject mock adapters with a
// layer instead of vi.mocking the three adapter modules.
import { Effect } from 'effect'

import type { DatabaseAdapter } from '@/databases/adapter'
import { createAdapter } from '@/databases/create-adapter'
import type * as legacy from '@/databases/schemas'
import type { ConnectionInfo, DatabaseType } from '@/glue/api/schemas'

export class AdapterFactory extends Effect.Service<AdapterFactory>()(
  'AdapterFactory',
  {
    accessors: true,
    sync: () => ({
      create: (
        type: DatabaseType,
        connectionInfo: ConnectionInfo
      ): DatabaseAdapter =>
        // The glue schema types and the adapters' own types are runtime-
        // identical; the adapters keep their historical typings until they
        // are re-pointed at the glue schemas.
        createAdapter(type, connectionInfo as legacy.ConnectionInfo)
    })
  }
) {}
