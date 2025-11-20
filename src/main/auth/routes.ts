import { shell } from 'electron'
import { Hono } from 'hono'

import { AnthropicAuthManager } from './anthropic-auth-manager'

export const authRouter = new Hono()

authRouter.post('/anthropic/initiate', async (c) => {
  try {
    const authManager = AnthropicAuthManager.getInstance()
    const authUrl = authManager.buildAuthorizationUrl()

    await shell.openExternal(authUrl)

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: error.message }, 500)
  }
})
