export function formatDuration(durationMs: number): string {
  if (durationMs < 1) {
    return `${durationMs.toFixed(1)}ms`
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`
  }

  return `${(durationMs / 1000).toFixed(2)}s`
}
