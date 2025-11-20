import { eq } from 'drizzle-orm'
import { safeStorage } from 'electron'
import { Hono } from 'hono'
import { log } from 'tiny-typescript-logger'
import { z } from 'zod'

import { database } from '../../database'
import { providersTable } from '../../database/schema'
import { ValidationError } from '@/errors'
import { ProviderDto, providerTypes } from '@/glue/providers'

export const providerRouter = new Hono()

providerRouter.get('/', async (context) => {
  const providers = await database.select().from(providersTable)

  log.info(`Fetched ${providers.length} providers from database.`)

  return context.json({ providers: providers.map(transformProvider) })
})

const upsertProviderSchema = z.object({
  token: z.string(),
  type: z.enum(providerTypes)
})

providerRouter.put('/:id', async (context) => {
  const { id } = context.req.param()
  const body = await context.req.json()

  const result = await upsertProviderSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const encryptedToken = safeStorage
    .encryptString(result.data.token)
    .toString('base64')

  log.info(`Upserting provider with id: ${id} of type: ${result.data.type}.`)

  await database
    .insert(providersTable)
    .values({
      id,
      token: result.data.token,
      type: result.data.type
    })
    .onConflictDoUpdate({
      target: providersTable.id,
      set: {
        token: encryptedToken,
        type: result.data.type
      },
      where: eq(providersTable.id, id)
    })

  const [provider] = await database
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, id))
    .limit(1)

  return context.json({ provider: transformProvider(provider) })
})

function transformProvider(provider: any): ProviderDto {
  const buffer = Buffer.from(provider.token ?? '', 'base64')

  return {
    id: provider.id,
    token: safeStorage.decryptString(buffer),
    type: provider.type
  }
}
