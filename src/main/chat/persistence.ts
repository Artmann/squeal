import { eq } from 'drizzle-orm'
import { log } from 'tiny-typescript-logger'

import { database } from '../../database'
import { chatsTable, messagesTable } from '../../database/schema'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolInvocations?: any[]
}

interface SaveChatParams {
  chatId: string
  messages: Message[]
}

/**
 * Save chat messages to the database
 * This function deletes existing messages and saves all messages from scratch
 * to ensure consistency with the current conversation state
 */
export async function saveChat({ chatId, messages }: SaveChatParams) {
  log.info(`Saving chat with id: ${chatId}, ${messages.length} messages`)

  // Update chat's updatedAt timestamp
  await database
    .update(chatsTable)
    .set({ updatedAt: new Date() })
    .where(eq(chatsTable.id, chatId))

  // Delete existing messages for this chat
  await database.delete(messagesTable).where(eq(messagesTable.chatId, chatId))

  // Insert all messages
  if (messages.length > 0) {
    await database.insert(messagesTable).values(
      messages.map((msg) => ({
        id: msg.id,
        chatId,
        role: msg.role,
        content: msg.content,
        toolInvocations: msg.toolInvocations
          ? JSON.stringify(msg.toolInvocations)
          : null
      }))
    )
  }

  log.info(
    `Successfully saved ${messages.length} messages for chatId: ${chatId}`
  )
}
