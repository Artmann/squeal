// How a canceled query is stored: the `queries` table has no status column, so
// a cancel is written to `error` as this message, and the server's row
// transform reads it back as `status: 'canceled'`. Nothing outside that
// mapping should compare against it — the renderer switches on `status`.
export const canceledQueryMessage = 'Query canceled.'
