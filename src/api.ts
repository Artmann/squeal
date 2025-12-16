import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { requestId } from 'hono/request-id'

import { connectionTestRouter, databaseRouter } from './databases'
import { chatRouter } from './main/chat/routes'
import { errorHandler } from './main/middleware/error-handler'
import { queryRouter } from './main/queries'
import { worksheetRouter } from './main/worksheets'

export const apiPort = 7847

export interface CreateAppOptions {
  enableLogging?: boolean
}

export function createApp(options: CreateAppOptions = {}) {
  const { enableLogging = true } = options

  const app = new Hono()

  app.use('*', requestId())

  if (enableLogging) {
    app.use('*', logger())
  }

  app.use('*', prettyJSON())
  app.use('*', cors())

  app.get('/health', (c) => {
    return c.json({ status: 'ok' })
  })

  app.route('/connection-tests', connectionTestRouter)
  app.route('/databases', databaseRouter)
  app.route('/chat', chatRouter)
  app.route('/queries', queryRouter)
  app.route('/worksheets', worksheetRouter)

  app.onError(errorHandler)

  return app
}

export function startServer(port = 3000) {
  const app = createApp()

  serve({
    fetch: app.fetch,
    port
  })

  console.log(`API server running on http://localhost:${port}`)

  return port
}
