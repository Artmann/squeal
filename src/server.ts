import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

export function startServer(port: number = 3000) {
  serve({
    fetch: app.fetch,
    port
  })

  console.log(`API server running on http://localhost:${port}`)
  return port
}
