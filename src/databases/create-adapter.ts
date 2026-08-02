import type { DatabaseAdapter } from './adapter'
import { MysqlAdapter } from './mysql-adapter'
import { PostgresAdapter } from './postgres-adapter'
import type { DatabaseConnection } from './schemas'
import { SqliteAdapter } from './sqlite-adapter'

// Takes the type and its connection info as one discriminated value rather than
// two independent arguments, so `switch` narrows the shape and no cast is
// needed: a SQLite connection can only arrive carrying a SQLite path.
export function createAdapter(connection: DatabaseConnection): DatabaseAdapter {
  switch (connection.type) {
    case 'mysql':
      return new MysqlAdapter(connection.connectionInfo)
    case 'postgres':
      return new PostgresAdapter(connection.connectionInfo)
    case 'sqlite':
      return new SqliteAdapter(connection.connectionInfo)
    default:
      // Unreachable for validated input. It still guards a stored row whose
      // `type` column holds something this build does not know about.
      throw new Error(
        `Unsupported database type: ${String(
          (connection as { type: unknown }).type
        )}`
      )
  }
}
