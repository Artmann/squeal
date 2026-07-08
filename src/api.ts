import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { requestId } from 'hono/request-id'
import { randomBytes } from 'node:crypto'

import { connectionTestRouter, databaseRouter } from './databases'
import { chatRouter } from './main/chat/routes'
import { errorHandler } from './main/middleware/error-handler'
import { queryRouter } from './main/queries'
import { worksheetRouter } from './main/worksheets'

export const apiPort = 7847

// 'null' is the Origin a packaged renderer sends when loaded from file://.
const defaultAllowedOrigins = ['null']

export interface CreateAppOptions {
  allowedOrigins?: string[]
  enableLogging?: boolean
  token?: string
}

export interface StartServerOptions {
  allowedOrigins?: string[]
}

export function createApp(options: CreateAppOptions = {}) {
  const {
    allowedOrigins = defaultAllowedOrigins,
    enableLogging = true,
    token
  } = options

  const app = new Hono()

  app.use('*', requestId())

  if (enableLogging) {
    app.use('*', logger())
  }

  app.use('*', prettyJSON())

  // CORS runs before auth so OPTIONS preflights (which never carry an
  // Authorization header) still succeed for the allowed origins.
  app.use(
    '*',
    cors({
      allowHeaders: ['Authorization', 'Content-Type'],
      origin: allowedOrigins
    })
  )

  if (token) {
    app.use('*', async (context, next) => {
      if (context.req.path === '/health') {
        return next()
      }

      if (context.req.header('Authorization') !== `Bearer ${token}`) {
        return context.json(
          { error: { message: 'Unauthorized', status: 401 } },
          401
        )
      }

      return next()
    })
  }

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

export function startServer(port = 3000, options: StartServerOptions = {}) {
  const token = randomBytes(32).toString('hex')
  const app = createApp({ allowedOrigins: options.allowedOrigins, token })

  serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port
  })

  console.log(`API server running on http://127.0.0.1:${port}`)

  return { port, token }
}
