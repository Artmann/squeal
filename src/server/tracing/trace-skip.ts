// Deliberately untraced requests, mirroring the renderer's shouldTrace list:
// /health (noise), everything under /traces (self-tracing feedback loop),
// the 250ms result poller (GET /queries/:id) which would drown the trace
// list, and the update-status poll, which answers from memory every minute
// for the life of the app and would quietly eat a fifth of the span
// retention budget. POST /updates/install stays traced — it happens once and
// is worth seeing. CORS preflights are skipped outright; the browser makes them,
// not the renderer, so they are not in that list.
const queryPollPattern = /^\/queries\/[^/]+$/

export function shouldSkipTracing(method: string, path: string): boolean {
  // A preflight is not a request the user made, and it carries no traceparent,
  // so tracing one produces a parentless root trace sitting next to the real
  // request's. They are also the most numerous requests there are, since every
  // route is preflighted — every request carries an Authorization header — and a
  // preflight of an otherwise-untraced route was still being traced, which is
  // how OPTIONS came to be a sixth of every span in the table.
  if (method === 'OPTIONS') {
    return true
  }

  if (path === '/health') {
    return true
  }

  if (path === '/traces' || path.startsWith('/traces/')) {
    return true
  }

  if (method === 'GET' && queryPollPattern.test(path)) {
    return true
  }

  if (method === 'GET' && path === '/updates') {
    return true
  }

  return false
}
