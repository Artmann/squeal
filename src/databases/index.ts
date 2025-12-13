import { Hono } from 'hono'

import { MysqlAdapter } from './mysql-adapter'
import { PostgresAdapter } from './postgres-adapter'
import {
  connectionTestSchema,
  createDatabaseSchema,
  type ConnectionInfo,
  type DatabaseType
} from './schemas'
import { ValidationError } from '@/errors'
import { DatabaseService } from '@/main/databases/database-service'

export const supportedDatabases = ['mysql', 'postgres'] as const

export const connectionTestRouter = new Hono()
export const databaseRouter = new Hono()

export interface CreateConnectionTestResponse {
  message?: string
  success: boolean
}

function createAdapter(type: DatabaseType, connectionInfo: ConnectionInfo) {
  switch (type) {
    case 'mysql':
      return new MysqlAdapter(connectionInfo)
    case 'postgres':
      return new PostgresAdapter(connectionInfo)
    default:
      throw new Error(`Unsupported database type: ${type}`)
  }
}

connectionTestRouter.post('/', async (context) => {
  const body = await context.req.json()
  const result = await connectionTestSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const adapter = createAdapter(result.data.type, result.data.connectionInfo)

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
  const { database, updatedWorksheet } = await service.createDatabase(
    result.data.name,
    result.data.connectionInfo,
    result.data.type
  )

  return context.json({ database, updatedWorksheet }, 201)
})

databaseRouter.patch('/:id', async (context) => {
  const { id } = context.req.param()
  const body = await context.req.json()
  const result = await createDatabaseSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const service = new DatabaseService()
  const database = await service.updateDatabase(
    id,
    result.data.name,
    result.data.connectionInfo,
    result.data.type
  )

  return context.json({ database })
})
