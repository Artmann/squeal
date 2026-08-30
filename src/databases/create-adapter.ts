import type { DatabaseAdapter } from './adapter'
import type { DatabaseConnection } from './schemas'

// Each driver is loaded when a connection of its kind is first made, rather
// than when this module is evaluated. That evaluation happens in the main
// process's import graph, before Electron's `ready` and so before any window
// exists: `pg`, `pg-cursor` and `mysql2` together are around 90ms of `require`
// that every launch paid for, whatever kinds of database the user actually had.
//
// A dynamic import is enough to defer it because all four packages are Vite
// externals (see `src/build/native-packages.ts`) — the import stays a real
// runtime resolution instead of being folded back into the bundle.
//
// It also narrows a failure that module-level imports widened, which is the
// case `native-packages.ts` warns about: a package missing from a packaged
// build now breaks connections of its own type, not every type.
export async function createAdapter(
  connection: DatabaseConnection
): Promise<DatabaseAdapter> {
  // Takes the type and its connection info as one discriminated value rather
  // than two independent arguments, so `switch` narrows the shape and no cast
  // is needed: a SQLite connection can only arrive carrying a SQLite path.
  switch (connection.type) {
    case 'mysql': {
      const { MysqlAdapter } = await import('./mysql-adapter')

      return new MysqlAdapter(connection.connectionInfo)
    }
    case 'postgres': {
      const { PostgresAdapter } = await import('./postgres-adapter')

      return new PostgresAdapter(connection.connectionInfo)
    }
    case 'sqlite': {
      const { SqliteAdapter } = await import('./sqlite-adapter')

      return new SqliteAdapter(connection.connectionInfo)
    }
    default: {
      // Unreachable for validated input. It still guards a stored row whose
      // `type` column holds something this build does not know about.
      throw new Error(
        `Unsupported database type: ${String(
          (connection as { type: unknown }).type
        )}`
      )
    }
  }
}
