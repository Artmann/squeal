import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { requestId } from 'hono/request-id'
import { serve } from '@hono/node-server'

import { chatRouter } from './main/chat/routes'
import { errorHandler } from './main/middleware/error-handler'
import { queryRouter } from './main/queries'

export const apiPort = 7847

const app = new Hono()

app.use('*', requestId())
app.use('*', logger())
app.use('*', prettyJSON())
app.use('*', cors())

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.route('/chat', chatRouter)
app.route('/queries', queryRouter)

app.onError(errorHandler)

export function startServer(port = 3000) {
  serve({
    fetch: app.fetch,
    port
  })

  console.log(`API server running on http://localhost:${port}`)

  return port
}
