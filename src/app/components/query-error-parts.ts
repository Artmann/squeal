export interface QueryErrorParts {
  /** The remaining lines — Postgres `LINE`/`HINT` context and equivalents. */
  detail?: string
  /** The first line of the driver error. */
  title: string
}

/**
 * Splits a flat driver error into the design's title/detail pair. Adapters
 * return one string, but the first line is the error proper and everything
 * after it is context, so they get different weight in the error card.
 */
export function toQueryErrorParts(error: string): QueryErrorParts {
  const trimmed = error.trim()

  if (trimmed === '') {
    return { title: 'Query failed' }
  }

  const newlineIndex = trimmed.indexOf('\n')

  if (newlineIndex === -1) {
    return { title: trimmed }
  }

  const detail = trimmed.slice(newlineIndex + 1).trim()

  return {
    detail: detail === '' ? undefined : detail,
    title: trimmed.slice(0, newlineIndex).trim()
  }
}
