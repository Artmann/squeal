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

export const sslModeSchema = z.enum(['disable', 'require', 'verify-full'])

export type SslMode = z.infer<typeof sslModeSchema>

export const postgresConnectionInfoSchema = z.object({
  database: z.string().min(1, 'Database name is required.'),
  host: z.string().min(1, 'Host is required.'),
  password: z.string().min(1, 'Password is required.'),
  port: portSchema,
  sslMode: sslModeSchema.optional(),
  sslRootCert: z.string().optional(),
  username: z.string().min(1, 'Username is required.')
})

export type PostgresConnectionInfo = z.infer<
  typeof postgresConnectionInfoSchema
>

export const mysqlConnectionInfoSchema = z.object({
  database: z.string().min(1, 'Database name is required.'),
  host: z.string().min(1, 'Host is required.'),
  password: z.string().min(1, 'Password is required.'),
  port: portSchema,
  sslMode: sslModeSchema.optional(),
  sslRootCert: z.string().optional(),
  username: z.string().min(1, 'Username is required.')
})

export type MysqlConnectionInfo = z.infer<typeof mysqlConnectionInfoSchema>

export const sqliteConnectionInfoSchema = z.object({
  path: z.string().min(1, 'File path is required.')
})

export type SqliteConnectionInfo = z.infer<typeof sqliteConnectionInfoSchema>

export type ConnectionInfo =
  | MysqlConnectionInfo
  | PostgresConnectionInfo
  | SqliteConnectionInfo

export const connectionInfoSchema = z.union([
  mysqlConnectionInfoSchema,
  postgresConnectionInfoSchema,
  sqliteConnectionInfoSchema
])

export const createDatabaseSchema = z.object({
  connectionInfo: connectionInfoSchema,
  name: z.string().min(1, 'Name is required.'),
  type: databaseTypeSchema
})

export type CreateDatabaseRequest = z.infer<typeof createDatabaseSchema>

export const connectionTestSchema = z.object({
  connectionInfo: connectionInfoSchema,
  type: databaseTypeSchema
})
