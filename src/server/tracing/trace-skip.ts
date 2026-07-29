// Deliberately untraced requests, mirroring the renderer's shouldTrace list:
// /health (noise), everything under /traces (self-tracing feedback loop),
// and the 250ms result poller (GET /queries/:id) which would drown the
// trace list.
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

  return false
}
