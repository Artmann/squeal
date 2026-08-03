// Deliberately untraced requests, mirroring the renderer's shouldTrace list:
// /health (noise), everything under /traces (self-tracing feedback loop),
// the 250ms result poller (GET /queries/:id) which would drown the trace
// list, and the update-status poll, which answers from memory every minute
// for the life of the app and would quietly eat a fifth of the span
// retention budget. POST /updates/install stays traced — it happens once and
// is worth seeing.
const queryPollPattern = /^\/queries\/[^/]+$/

export function shouldSkipTracing(method: string, path: string): boolean {
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
