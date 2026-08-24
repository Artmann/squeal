// The find-in-results session and every move it can make, as plain functions.
//
// Kept out of the hook so each transition can be read and tested on its own:
// what a close keeps, what a new query resets, and where a step lands at either
// end of the match list.

export interface FindSession {
  // An ordinal into the match list. Stored rather than clamped so a re-run that
  // returns fewer rows does not lose the user's place, and read through a clamp
  // so it can never point past the end.
  activeIndex: number
  isFiltering: boolean
  isOpen: boolean
  // What the user typed, untrimmed: this is the input's value.
  query: string
}

export const closedSession: FindSession = {
  activeIndex: 0,
  isFiltering: false,
  isOpen: false,
  query: ''
}

export function opened(session: FindSession): FindSession {
  return { ...session, isOpen: true }
}

/**
 * The query survives a close, the way a browser's does. Only `isOpen` goes,
 * which is also what lifts the filter off the grid.
 */
export function closed(session: FindSession): FindSession {
  return { ...session, isOpen: false }
}

/**
 * Back to the first match on every edit, like Chrome. An ordinal that survived
 * a query change would leave the user on "match 4" of a set with nothing to do
 * with the one they were walking.
 */
export function withQuery(session: FindSession, query: string): FindSession {
  return { ...session, activeIndex: 0, query }
}

export function withFilteringToggled(session: FindSession): FindSession {
  return { ...session, isFiltering: !session.isFiltering }
}

/**
 * The next or previous match, wrapping at both ends. Steps from the clamped
 * ordinal rather than the stored one, so a step after the match list shrank
 * moves from where the user could actually see the highlight.
 */
export function stepped(
  session: FindSession,
  { delta, matchCount }: { delta: number; matchCount: number }
): FindSession {
  if (matchCount === 0) {
    return session
  }

  const from = Math.min(session.activeIndex, matchCount - 1)

  return { ...session, activeIndex: (from + delta + matchCount) % matchCount }
}

/**
 * The ordinal to paint, which is not always the one stored: a re-run, a
 * narrowed query or a shorter result all shrink the match list. Clamping on
 * read rather than in an effect keeps it from costing a second render pass to
 * fix state that was only ever wrong in between. `-1` is nothing to jump to.
 */
export function activeIndexWithin(
  session: FindSession,
  matchCount: number
): number {
  return matchCount === 0 ? -1 : Math.min(session.activeIndex, matchCount - 1)
}
