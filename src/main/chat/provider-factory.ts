import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { safeStorage } from 'electron'
import { log } from 'tiny-typescript-logger'

import { database } from '../../database'
import { providersTable } from '../../database/schema'
import { ApiError } from '@/errors'

/**
 * Get the configured AI model for chat
 * Returns the first configured provider's model
 */
export async function getModelForProvider() {
  const providers = await database.select().from(providersTable)

  if (providers.length === 0) {
    throw new ApiError(400, 'No AI provider configured. Please configure a provider first.')
  }

  // Use the first provider
  const provider = providers[0]
  log.info(`Using provider: ${provider.type}`)

  // Decrypt token
  const buffer = Buffer.from(provider.token, 'base64')
  const apiKey = safeStorage.decryptString(buffer)

  // Return the appropriate model based on provider type
  switch (provider.type) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      return anthropic('claude-3-5-sonnet-20241022')
    }

    case 'openai': {
      const openai = createOpenAI({ apiKey })
      return openai('gpt-4-turbo')
    }

    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey })
      return google('gemini-1.5-pro')
    }

    default:
      throw new ApiError(400, `Unsupported provider type: ${provider.type}`)
  }
}
