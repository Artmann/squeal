import { z } from 'zod'

export const databaseTypeSchema = z.enum(['mysql', 'postgres', 'sqlite'])

export type DatabaseType = z.infer<typeof databaseTypeSchema>

const portSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return typeof value === 'number' ? value : Number(value)
  })

const sslModeSchema = z.enum(['disable', 'require', 'verify-full'])

export type SslMode = z.infer<typeof sslModeSchema>

// MySQL and PostgreSQL connections share the same shape.
const serverConnectionInfoSchema = z.object({
  database: z.string().min(1, 'Database name is required.'),
  host: z.string().min(1, 'Host is required.'),
  password: z.string().min(1, 'Password is required.'),
  port: portSchema,
  sslMode: sslModeSchema.optional(),
  sslRootCert: z.string().optional(),
  username: z.string().min(1, 'Username is required.')
})

export type MysqlConnectionInfo = z.infer<typeof serverConnectionInfoSchema>
export type PostgresConnectionInfo = z.infer<typeof serverConnectionInfoSchema>

const sqliteConnectionInfoSchema = z.object({
  path: z.string().min(1, 'File path is required.')
})

export type SqliteConnectionInfo = z.infer<typeof sqliteConnectionInfoSchema>

export type ConnectionInfo =
  | MysqlConnectionInfo
  | PostgresConnectionInfo
  | SqliteConnectionInfo

// The renderer never receives stored passwords — API responses use this shape.
export type PublicConnectionInfo =
  | Omit<MysqlConnectionInfo, 'password'>
  | Omit<PostgresConnectionInfo, 'password'>
  | SqliteConnectionInfo

const connectionInfoSchema = z.union([
  serverConnectionInfoSchema,
  sqliteConnectionInfoSchema
])

// Updates and connection tests may omit the password to mean "use the stored
// one" — the main process merges it back in server-side.
const updateServerConnectionInfoSchema = serverConnectionInfoSchema.extend({
  password: z.string().optional()
})

const updateConnectionInfoSchema = z.union([
  updateServerConnectionInfoSchema,
  sqliteConnectionInfoSchema
])

export type UpdateConnectionInfo = z.infer<typeof updateConnectionInfoSchema>

export const createDatabaseSchema = z.object({
  connectionInfo: connectionInfoSchema,
  name: z.string().min(1, 'Name is required.'),
  type: databaseTypeSchema
})

export type CreateDatabaseRequest = z.infer<typeof createDatabaseSchema>

export const updateDatabaseSchema = z.object({
  connectionInfo: updateConnectionInfoSchema,
  name: z.string().min(1, 'Name is required.'),
  type: databaseTypeSchema
})

export type UpdateDatabaseRequest = z.infer<typeof updateDatabaseSchema>

export const connectionTestSchema = z.object({
  connectionInfo: updateConnectionInfoSchema,
  databaseId: z.string().optional(),
  type: databaseTypeSchema
})
