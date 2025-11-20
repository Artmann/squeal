import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { requestId } from 'hono/request-id'
import { serve } from '@hono/node-server'

import { authRouter } from './main/auth/routes'

const app = new Hono()

app.use('*', requestId())
app.use('*', logger())
app.use('*', prettyJSON())
app.use('*', cors())

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.route('/auth', authRouter)

export function startServer(port: number = 3000) {
  serve({
    fetch: app.fetch,
    port
  })

  console.log(`API server running on http://localhost:${port}`)

  return port
}
