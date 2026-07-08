import type { DatabaseAdapter } from './adapter'
import { MysqlAdapter } from './mysql-adapter'
import { PostgresAdapter } from './postgres-adapter'
import { SqliteAdapter } from './sqlite-adapter'
import type {
  ConnectionInfo,
  DatabaseType,
  MysqlConnectionInfo,
  PostgresConnectionInfo,
  SqliteConnectionInfo
} from './schemas'

export function createAdapter(
  type: DatabaseType,
  connectionInfo: ConnectionInfo
): DatabaseAdapter {
  switch (type) {
    case 'mysql':
      return new MysqlAdapter(connectionInfo as MysqlConnectionInfo)
    case 'postgres':
      return new PostgresAdapter(connectionInfo as PostgresConnectionInfo)
    case 'sqlite':
      return new SqliteAdapter(connectionInfo as SqliteConnectionInfo)
    default:
      throw new Error(`Unsupported database type: ${type}`)
  }
}
