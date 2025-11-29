import { Hono } from 'hono'
import { z } from 'zod'

import { PostgresAdapter } from './postgres-adapter'
import { createDatabaseSchema, postgresConnectionInfoSchema } from './schemas'
import { ValidationError } from '@/errors'
import { DatabaseService } from '@/main/databases/database-service'

export const supportedDatabases = ['postgres'] as const

export const connectionTestRouter = new Hono()
export const databaseRouter = new Hono()

const connectionTestSchema = z.object({
  connectionInfo: postgresConnectionInfoSchema
})

export interface CreateConnectionTestResponse {
  message?: string
  success: boolean
}

connectionTestRouter.post('/', async (context) => {
  const body = await context.req.json()
  const result = await connectionTestSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const adapter = new PostgresAdapter(result.data.connectionInfo)

  try {
    await adapter.testConnection()
  } catch (error) {
    return context.json(
      {
        message: error instanceof Error ? error.message : String(error),
        success: false
      },
      500
    )
  }

  return context.json({ success: true })
})

databaseRouter.post('/', async (context) => {
  const body = await context.req.json()
  const result = await createDatabaseSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const service = new DatabaseService()
  const record = await service.createDatabase(
    result.data.name,
    result.data.connectionInfo,
    'postgres'
  )

  return context.json(record, 201)
})
