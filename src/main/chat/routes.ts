import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { streamText, convertToModelMessages } from 'ai'
import { log } from 'tiny-typescript-logger'
import { z } from 'zod'

import { database } from '../../database'
import { ValidationError } from '@/errors'
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
