// Zod schemas for the database form. The API contract itself is Effect
// Schema (`src/glue/api/schemas.ts`) — these exist only because
// react-hook-form's resolver validates the form with zod, and the shapes
// are kept in step with the contract by the adapters that consume both.
import { z } from 'zod'

import type {
  ConnectionInfo,
  DatabaseType,
  ServerConnectionInfo,
  SqliteConnectionInfo
} from '@/glue/api/schemas'

export type { ConnectionInfo, DatabaseType, SqliteConnectionInfo }

// MySQL and PostgreSQL connections share the same shape.
export type MysqlConnectionInfo = ServerConnectionInfo
export type PostgresConnectionInfo = ServerConnectionInfo

export type SslMode = NonNullable<ServerConnectionInfo['sslMode']>

const databaseTypeSchema = z.enum(['mysql', 'postgres', 'sqlite'])

const portSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return typeof value === 'number' ? value : Number(value)
  })

const sslModeSchema = z.enum(['disable', 'require', 'verify-ca', 'verify-full'])

const serverConnectionInfoSchema = z.object({
  database: z.string().min(1, 'Database name is required.'),
  host: z.string().min(1, 'Host is required.'),
  password: z.string().min(1, 'Password is required.'),
  port: portSchema,
  sslMode: sslModeSchema.optional(),
  sslRootCert: z.string().optional(),
  username: z.string().min(1, 'Username is required.')
})

const sqliteConnectionInfoSchema = z.object({
  path: z.string().min(1, 'File path is required.')
})

const connectionInfoSchema = z.union([
  serverConnectionInfoSchema,
  sqliteConnectionInfoSchema
])

// Updates may omit the password to mean "use the stored one" — the main
// process merges it back in server-side.
const updateServerConnectionInfoSchema = serverConnectionInfoSchema.extend({
  password: z.string().optional()
})

const updateConnectionInfoSchema = z.union([
  updateServerConnectionInfoSchema,
  sqliteConnectionInfoSchema
])

export { databaseTypeSchema }

export const createDatabaseSchema = z.object({
  connectionInfo: connectionInfoSchema,
  name: z.string().min(1, 'Name is required.'),
  type: databaseTypeSchema
})

export const updateDatabaseSchema = z.object({
  connectionInfo: updateConnectionInfoSchema,
  name: z.string().min(1, 'Name is required.'),
  type: databaseTypeSchema
})
