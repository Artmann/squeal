import { Effect } from 'effect'

import { orDieInternal } from './internal-errors'

/**
 * Both delete routes answer the same way once the row is gone. The service's own
 * not-found error stays in the typed channel — only the internal errors become
 * defects, exactly as the other handlers do it. The error type is left to
 * `orDieInternal` to work out, since it is the one narrowing the channel.
 */
export function answerRemoved<E, R>(remove: Effect.Effect<void, E, R>) {
  return remove.pipe(Effect.as({ success: true as const }), orDieInternal)
}
