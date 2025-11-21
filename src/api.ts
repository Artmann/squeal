import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { requestId } from 'hono/request-id'
import { serve } from '@hono/node-server'

import { authRouter } from './main/auth/routes'
import { folderRouter } from './main/folders/routes'
import { errorHandler } from './main/middleware/error-handler'
import { providerRouter } from './main/providers/routes'

const app = new Hono()

app.use('*', requestId())
app.use('*', logger())
app.use('*', prettyJSON())
app.use('*', cors())

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.route('/auth', authRouter)
app.route('/folders', folderRouter)
app.route('/providers', providerRouter)

app.onError(errorHandler)

export function startServer(port = 3000) {
  serve({
    fetch: app.fetch,
    port
  })

  console.log(`API server running on http://localhost:${port}`)

  return port
}
