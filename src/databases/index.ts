import { Hono } from 'hono'
import invariant from 'tiny-invariant'
import { log } from 'tiny-typescript-logger'

import { createAdapter } from './create-adapter'
import {
  connectionTestSchema,
  createDatabaseSchema,
  reorderDatabasesSchema,
  updateDatabaseSchema,
  type ConnectionInfo,
  type DatabaseType,
  type UpdateConnectionInfo
} from './schemas'
import { ApiError, ValidationError } from '@/errors'
import { DatabaseService } from '@/main/databases/database-service'

export const connectionTestRouter = new Hono()
export const databaseRouter = new Hono()

export interface CreateConnectionTestResponse {
  message?: string
  success: boolean
}

// A test without a password uses the stored one — the renderer never sees
// passwords, so testing an existing connection sends its databaseId instead.
async function resolveTestConnectionInfo(
  connectionInfo: UpdateConnectionInfo,
  type: DatabaseType,
  databaseId?: string
): Promise<ConnectionInfo | null> {
  const hasPassword = !('username' in connectionInfo) || connectionInfo.password

  if (hasPassword) {
    return connectionInfo as ConnectionInfo
  }

  if (!databaseId) {
    return null
  }

  const service = new DatabaseService()
  const stored = await service.getDatabaseWithSecrets(databaseId)

  if (
    !stored ||
    stored.type !== type ||
    !('password' in stored.connectionInfo)
  ) {
    return null
  }

  return { ...connectionInfo, password: stored.connectionInfo.password }
}

connectionTestRouter.post('/', async (context) => {
  const body = await context.req.json()
  const result = await connectionTestSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const connectionInfo = await resolveTestConnectionInfo(
    result.data.connectionInfo,
    result.data.type,
    result.data.databaseId
  )

  if (!connectionInfo) {
    return context.json(
      { message: 'Password is required.', success: false },
      200
    )
  }

  const adapter = createAdapter(result.data.type, connectionInfo)

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

databaseRouter.put('/order', async (context) => {
  const body = await context.req.json()
  const result = await reorderDatabasesSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const service = new DatabaseService()
  const databases = await service.reorderDatabases(result.data.databaseIds)

  return context.json({ databases })
})

databaseRouter.get('/:id/schema', async (context) => {
  const { id } = context.req.param()

  invariant(id, 'Database ID is required')

  const service = new DatabaseService()
  const databaseRecord = await service.getDatabaseWithSecrets(id)

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
  const result = await updateDatabaseSchema.safeParseAsync(body)

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
