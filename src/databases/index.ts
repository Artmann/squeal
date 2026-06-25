import { Hono } from 'hono'
import invariant from 'tiny-invariant'
import { log } from 'tiny-typescript-logger'

import { MysqlAdapter } from './mysql-adapter'
import { PostgresAdapter } from './postgres-adapter'
import { SqliteAdapter } from './sqlite-adapter'
import {
  connectionTestSchema,
  createDatabaseSchema,
  type ConnectionInfo,
  type DatabaseType,
  type MysqlConnectionInfo,
  type PostgresConnectionInfo,
  type SqliteConnectionInfo
} from './schemas'
import { ApiError, ValidationError } from '@/errors'
import { DatabaseService } from '@/main/databases/database-service'

export const supportedDatabases = ['mysql', 'postgres', 'sqlite'] as const

export const connectionTestRouter = new Hono()
export const databaseRouter = new Hono()

export interface CreateConnectionTestResponse {
  message?: string
  success: boolean
}

function createAdapter(type: DatabaseType, connectionInfo: ConnectionInfo) {
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
    log.error('Connection test failed:', error)

    return context.json(
      {
        message: error instanceof Error ? error.message : String(error),
        success: false
      },
      200
    )
  }

  return context.json({ success: true })
})

databaseRouter.get('/', async (context) => {
  const service = new DatabaseService()
  const databases = await service.listDatabases()

  return context.json({ databases })
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

databaseRouter.get('/:id/schema', async (context) => {
  const { id } = context.req.param()

  invariant(id, 'Database ID is required')

  const service = new DatabaseService()
  const databaseRecord = await service.getDatabase(id)

  if (!databaseRecord) {
    throw new ApiError(404, 'Database not found')
  }

  const adapter = createAdapter(
    databaseRecord.type,
    databaseRecord.connectionInfo
  )

  try {
    const schema = await adapter.getSchema()

    return context.json({ schema })
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'Failed to connect to database'

    throw new ApiError(
      503,
      `Failed to load schema for "${databaseRecord.name}": ${reason}`
    )
  }
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
