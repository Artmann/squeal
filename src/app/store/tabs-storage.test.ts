import { beforeEach, describe, expect, it } from 'vitest'

import { initialTabsState } from './tabs-slice'
import { readStoredTabs, tabsStorageKey, writeStoredTabs } from './tabs-storage'

function store(value: unknown): void {
  localStorage.setItem(
    tabsStorageKey,
    typeof value === 'string' ? value : JSON.stringify(value)
  )
}

describe('tabs storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the empty state when nothing is stored', () => {
    expect(readStoredTabs()).toEqual(initialTabsState)
  })

  // The status never round-trips — it is decided by what came back, not carried
  // in the payload. Writing 'restored' and reading 'reconciled' is the proof:
  // a readable payload is a decision the app already made.
  it('reads back what it wrote, as tabs it has already reconciled', () => {
    writeStoredTabs({
      activeWorksheetId: 'b',
      openWorksheetIds: ['a', 'b'],
      status: 'restored'
    })

    expect(readStoredTabs()).toEqual({
      activeWorksheetId: 'b',
      openWorksheetIds: ['a', 'b'],
      status: 'reconciled'
    })
  })

  // Closing every tab is a decision too, and it has to survive a restart —
  // otherwise the worksheet is back on the next launch, which is the same bug
  // with a longer fuse.
  it('remembers that every tab was closed deliberately', () => {
    writeStoredTabs({ openWorksheetIds: [], status: 'reconciled' })

    expect(readStoredTabs()).toEqual({
      activeWorksheetId: undefined,
      openWorksheetIds: [],
      status: 'reconciled'
    })
  })

  it('falls back to the empty state for malformed JSON', () => {
    store('{ not json')

    expect(readStoredTabs()).toEqual(initialTabsState)
  })

  it('falls back to the empty state when the payload is not an object', () => {
    store(['a', 'b'])

    expect(readStoredTabs()).toEqual(initialTabsState)
  })

  it('falls back to the empty state when the ids are not strings', () => {
    store({ activeWorksheetId: 'a', openWorksheetIds: [1, 2] })

    expect(readStoredTabs()).toEqual(initialTabsState)
  })

  it('falls back to the empty state when the ids are missing', () => {
    store({ activeWorksheetId: 'a' })

    expect(readStoredTabs()).toEqual(initialTabsState)
  })

  it('repairs an active id that is not among the open tabs', () => {
    store({ activeWorksheetId: 'gone', openWorksheetIds: ['a', 'b'] })

    expect(readStoredTabs()).toEqual({
      activeWorksheetId: 'b',
      openWorksheetIds: ['a', 'b'],
      status: 'reconciled'
    })
  })

  it('leaves nothing active when no tabs are open', () => {
    store({ activeWorksheetId: 'a', openWorksheetIds: [] })

    expect(readStoredTabs()).toEqual({
      activeWorksheetId: undefined,
      openWorksheetIds: [],
      status: 'reconciled'
    })
  })
})
