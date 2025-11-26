import { Hono } from 'hono'
import { z } from 'zod'

export const chatRouter = new Hono()

// Validation schemas
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  toolInvocations: z.array(z.any()).optional()
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const chatRequestSchema = z.object({
  messages: z.array(messageSchema),
  chatId: z.string()
})
