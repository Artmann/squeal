import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { requestId } from 'hono/request-id'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { connectionTestRouter, databaseRouter } from './databases'
import { chatRouter } from './main/chat/routes'
import { errorHandler } from './main/middleware/error-handler'
import { queryRouter } from './main/queries'
import { traceRouter } from './main/tracing/routes'
import { traceMiddleware } from './main/tracing/trace-middleware'
import { worksheetRouter } from './main/worksheets'

export const apiPort = 7847

// 'null' is the Origin a packaged renderer sends when loaded from file://.
const defaultAllowedOrigins = ['null']

export interface CreateAppOptions {
  allowedOrigins?: string[]
  enableLogging?: boolean
  encryptionAvailable?: boolean
  publicTraceReads?: boolean
  token: string
}

export interface StartServerOptions {
  allowedOrigins?: string[]
  encryptionAvailable?: boolean
  publicTraceReads?: boolean
}

export function createApp(options: CreateAppOptions) {
  const {
    allowedOrigins = defaultAllowedOrigins,
    enableLogging = true,
    encryptionAvailable = true,
    publicTraceReads = false,
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
      allowHeaders: ['Authorization', 'Content-Type', 'traceparent'],
      origin: allowedOrigins
    })
  )

  app.use('*', async (context, next) => {
    if (context.req.path === '/health') {
      return next()
    }

    // In development agents read traces with plain curl; the server binds
    // loopback only, and span ingest stays authenticated.
    if (
      publicTraceReads &&
      context.req.method === 'GET' &&
      (context.req.path === '/traces' ||
        context.req.path.startsWith('/traces/'))
    ) {
      return next()
    }

    if (!isAuthorized(context.req.header('Authorization'), token)) {
      return context.json(
        { error: { message: 'Unauthorized', status: 401 } },
        401
      )
    }

    return next()
  })

  // After auth so unauthorized probes are not traced.
  app.use('*', traceMiddleware())

  // encryptionAvailable tells the renderer whether the OS keychain can
  // protect stored connection secrets, so it can warn before saving one.
  app.get('/health', (c) => {
    return c.json({ encryptionAvailable, status: 'ok' })
  })

  app.route('/connection-tests', connectionTestRouter)
  app.route('/databases', databaseRouter)
  app.route('/chat', chatRouter)
  app.route('/queries', queryRouter)
  app.route('/traces', traceRouter)
  app.route('/worksheets', worksheetRouter)

  app.onError(errorHandler)

  return app
}

// Hashing both sides first makes timingSafeEqual usable for tokens of unequal
// length without leaking the length through an early return.
function isAuthorized(header: string | undefined, token: string): boolean {
  const presented = header?.startsWith('Bearer ') ? header.slice(7) : ''

  const presentedDigest = createHash('sha256').update(presented).digest()
  const tokenDigest = createHash('sha256').update(token).digest()

  return timingSafeEqual(presentedDigest, tokenDigest)
}

export function startServer(port = 3000, options: StartServerOptions = {}) {
  const token = randomBytes(32).toString('hex')
  const app = createApp({
    allowedOrigins: options.allowedOrigins,
    encryptionAvailable: options.encryptionAvailable,
    publicTraceReads: options.publicTraceReads,
    token
  })

  serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port
  })

  console.log(`API server running on http://127.0.0.1:${port}`)

  return { port, token }
}
