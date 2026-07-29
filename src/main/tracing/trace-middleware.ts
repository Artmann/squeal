import type { MiddlewareHandler } from 'hono'
import { routePath } from 'hono/route'

import { parseTraceparent } from '@/glue/tracing/traceparent'

import { runWithContext, startSpan } from './tracer'

const pollPathPattern = /^\/queries\/[^/]+$/

export function traceMiddleware(): MiddlewareHandler {
  return async (context, next) => {
    if (shouldSkip(context.req.method, context.req.path)) {
      return next()
    }

    const parent = parseTraceparent(context.req.header('traceparent'))
    const span = startSpan(`${context.req.method} ${context.req.path}`, {
      attributes: {
        'http.method': context.req.method,
        'http.target': context.req.path
      },
      kind: 'server',
      parent
    })

    try {
      await runWithContext(span.context, next)

      // Hono's onError catches handler errors at the innermost dispatch
      // level, so next() resolves normally and the error surfaces here via
      // context.error, with context.res already holding the mapped response.
      if (context.error) {
        span.recordException(context.error)
      } else {
        span.setStatus(context.res.status >= 500 ? 'error' : 'ok')
      }

      span.setAttribute('http.status_code', context.res.status)
    } catch (error) {
      // Only non-Error throws reach this branch — onError refuses them.
      span.recordException(error)
      span.setAttribute('http.status_code', 500)

      throw error
    } finally {
      // The matched route pattern is only known after routing ran; unmatched
      // requests report this middleware's own wildcard registration, where
      // the raw path is more useful.
      const matchedRoute = routePath(context, -1)
      const route = matchedRoute.includes('*') ? context.req.path : matchedRoute

      // The request id middleware mirrors the id into this response header.
      const requestIdHeader = context.res.headers.get('X-Request-Id')

      if (requestIdHeader) {
        span.setAttribute('request.id', requestIdHeader)
      }

      span.setAttribute('http.route', route)
      span.setName(`${context.req.method} ${route}`)

      await span.end()
    }
  }
}

function shouldSkip(method: string, path: string): boolean {
  if (path === '/health') {
    return true
  }

  // The trace API must not trace itself — renderer span ingest and the
  // dashboard's polling would otherwise generate spans about spans.
  if (path === '/traces' || path.startsWith('/traces/')) {
    return true
  }

  // The renderer polls query results every 250ms; those requests would
  // drown every trace in noise.
  return method === 'GET' && pollPathPattern.test(path)
}
