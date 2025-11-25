import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { streamText, convertToModelMessages } from 'ai'
import { log } from 'tiny-typescript-logger'
import { z } from 'zod'

import { database } from '../../database'
import { chatsTable, messagesTable } from '../../database/schema'
import { ValidationError } from '@/errors'
import { getModelForProvider } from './provider-factory'
import { saveChat } from './persistence'

export const chatRouter = new Hono()

// Validation schemas
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  toolInvocations: z.array(z.any()).optional()
})

const chatRequestSchema = z.object({
  messages: z.array(messageSchema),
  chatId: z.string()
})

// POST /chat - Stream chat responses with persistence
chatRouter.post('/', async (context) => {
  const body = await context.req.json()

  const result = await chatRequestSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const { messages, chatId } = result.data

  log.info(`Processing chat request for chatId: ${chatId} with ${messages.length} messages`)

  // Ensure chat exists
  const existingChats = await database
    .select()
    .from(chatsTable)
    .where(eq(chatsTable.id, chatId))
    .limit(1)

  if (existingChats.length === 0) {
    log.info(`Creating new chat with id: ${chatId}`)
    await database.insert(chatsTable).values({
      id: chatId
    })
  }

  // Get the configured AI model
  const model = await getModelForProvider()

  // Convert UI messages to model messages format using AI SDK utility
  const modelMessages = convertToModelMessages(messages)

  // Stream the response
  const streamResult = streamText({
    model,
    messages: modelMessages
  })

  // Handle client disconnect - ensure streaming completes for persistence
  context.req.raw.signal.addEventListener('abort', () => {
    log.info(`Client disconnected for chatId: ${chatId}, consuming stream`)
    streamResult.consumeStream()
  })

  // Return streaming response with persistence callback
  return streamResult.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ responseMessages }) => {
      log.info(`Stream finished for chatId: ${chatId}`)

      // Combine original messages with response messages
      const allMessages = [...messages, ...responseMessages]

      // Save all messages
      await saveChat({ chatId, messages: allMessages })
    }
  })
})

// GET /chat/:chatId - Retrieve chat history
chatRouter.get('/:chatId', async (context) => {
  const { chatId } = context.req.param()

  log.info(`Fetching chat history for chatId: ${chatId}`)

  // Check if chat exists
  const chats = await database
    .select()
    .from(chatsTable)
    .where(eq(chatsTable.id, chatId))
    .limit(1)

  if (chats.length === 0) {
    return context.json({ messages: [] })
  }

  // Fetch messages
  const messages = await database
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.chatId, chatId))
    .orderBy(messagesTable.createdAt)

  log.info(`Fetched ${messages.length} messages for chatId: ${chatId}`)

  return context.json({
    messages: messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      toolInvocations: msg.toolInvocations ? JSON.parse(msg.toolInvocations) : undefined,
      createdAt: msg.createdAt
    }))
  })
})
