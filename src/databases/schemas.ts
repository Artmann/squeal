import { z } from 'zod'

export const postgresConnectionInfoSchema = z.object({
  database: z.string().min(1, 'Database name is required.'),
  host: z.string().min(1, 'Host is required.'),
  password: z.string().min(1, 'Password is required.'),
  port: z.coerce.number().min(1, 'Port is required.').default(5432),
  username: z.string().min(1, 'Username is required.')
})

export type PostgresConnectionInfo = z.infer<
  typeof postgresConnectionInfoSchema
>

export const createDatabaseSchema = z.object({
  connectionInfo: postgresConnectionInfoSchema,
  name: z.string().min(1, 'Name is required.')
})

export type CreateDatabaseRequest = z.infer<typeof createDatabaseSchema>
