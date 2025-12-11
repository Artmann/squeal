import { z } from 'zod'

export const postgresConnectionInfoSchema = z.object({
  database: z.string().min(1, 'Database name is required.'),
  host: z.string().min(1, 'Host is required.'),
  password: z.string().min(1, 'Password is required.'),
  port: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === undefined || value === null || value === '') {
        return undefined
      }

      return typeof value === 'number' ? value : Number(value)
    }),
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
