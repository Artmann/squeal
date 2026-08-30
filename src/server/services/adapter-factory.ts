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
      //
      // An Effect rather than the adapter itself because `createAdapter` loads
      // its driver on demand now. `Effect.promise` is right despite the import
      // being able to fail: a driver missing from the build is not a condition
      // any caller can handle or any user can act on, so it belongs in the
      // defect channel with the rest of `src/server/errors.ts` — a 500 — rather
      // than in the contract.
      create: (
        connection: DatabaseConnection
      ): Effect.Effect<DatabaseAdapter> =>
        Effect.promise(() => createAdapter(connection))
    })
  }
) {}
