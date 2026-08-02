// Adapter construction as a service so tests can inject mock adapters with a
// layer instead of vi.mocking the three adapter modules.
import { Effect } from 'effect'

import type { DatabaseAdapter } from '@/databases/adapter'
import { createAdapter } from '@/databases/create-adapter'
import type { DatabaseConnection } from '@/glue/api/schemas'

export class AdapterFactory extends Effect.Service<AdapterFactory>()(
  'AdapterFactory',
  {
    accessors: true,
    sync: () => ({
      // One discriminated value, not a (type, connectionInfo) pair that could
      // disagree — see DatabaseConnection in the contract.
      create: (connection: DatabaseConnection): DatabaseAdapter =>
        createAdapter(connection)
    })
  }
) {}
