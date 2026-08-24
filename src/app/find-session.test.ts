import { describe, expect, it } from 'vitest'

import {
  activeIndexWithin,
  closed,
  closedSession,
  opened,
  stepped,
  withFilteringToggled,
  withQuery
} from './find-session'

describe('find session', () => {
  const open = { activeIndex: 2, isFiltering: true, isOpen: true, query: 'mia' }

  it('starts closed, empty and unfiltered', () => {
    expect(closedSession).toEqual({
      activeIndex: 0,
      isFiltering: false,
      isOpen: false,
      query: ''
    })
  })

  it('opens without disturbing anything else', () => {
    expect(opened(closedSession)).toEqual({
      activeIndex: 0,
      isFiltering: false,
      isOpen: true,
      query: ''
    })
  })

  // Closing keeps the query the way a browser's find does, so reopening does
  // not mean retyping. Only `isOpen` goes, which is also what lifts the filter.
  it('keeps the query and the filter when it closes', () => {
    expect(closed(open)).toEqual({
      activeIndex: 2,
      isFiltering: true,
      isOpen: false,
      query: 'mia'
    })
  })

  it('goes back to the first match when the query changes', () => {
    expect(withQuery(open, 'leo')).toEqual({
      activeIndex: 0,
      isFiltering: true,
      isOpen: true,
      query: 'leo'
    })
  })

  it('toggles the filter both ways', () => {
    expect(withFilteringToggled(open).isFiltering).toEqual(false)
    expect(withFilteringToggled(withFilteringToggled(open))).toEqual(open)
  })

  describe('stepping', () => {
    it('moves forward and back', () => {
      expect(stepped(open, { delta: 1, matchCount: 5 }).activeIndex).toEqual(3)
      expect(stepped(open, { delta: -1, matchCount: 5 }).activeIndex).toEqual(1)
    })

    it('wraps at both ends', () => {
      const last = { ...open, activeIndex: 4 }
      const first = { ...open, activeIndex: 0 }

      expect(stepped(last, { delta: 1, matchCount: 5 }).activeIndex).toEqual(0)
      expect(stepped(first, { delta: -1, matchCount: 5 }).activeIndex).toEqual(
        4
      )
    })

    // Returning the session itself is what lets the caller skip a state write,
    // so pressing Enter with nothing found does not re-render the grid.
    it('answers the same session when there is nothing to step through', () => {
      expect(stepped(open, { delta: 1, matchCount: 0 })).toBe(open)
    })

    // The stored ordinal can be past the end after a re-run returned fewer
    // rows; a step has to move from where the highlight actually is.
    it('steps from the clamped ordinal when the match list shrank', () => {
      const stale = { ...open, activeIndex: 9 }

      expect(stepped(stale, { delta: 1, matchCount: 3 }).activeIndex).toEqual(0)
    })
  })

  describe('activeIndexWithin', () => {
    it('answers -1 when there is nothing to jump to', () => {
      expect(activeIndexWithin(open, 0)).toEqual(-1)
    })

    it('passes an in-range ordinal through', () => {
      expect(activeIndexWithin(open, 5)).toEqual(2)
    })

    it('clamps an ordinal left over from a longer match list', () => {
      expect(activeIndexWithin({ ...open, activeIndex: 9 }, 3)).toEqual(2)
    })
  })
})
