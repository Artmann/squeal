import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  columnWidthsStorageKey,
  maximumStoredResults,
  readColumnWidths,
  writeColumnWidths
} from './result-column-widths-storage'

function store(value: unknown): void {
  localStorage.setItem(
    columnWidthsStorageKey,
    typeof value === 'string' ? value : JSON.stringify(value)
  )
}

describe('result column width storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('returns nothing when nothing is stored', () => {
    expect(readColumnWidths('query-1')).toEqual({})
  })

  it('reads back what it wrote for each result', () => {
    writeColumnWidths('query-1', { '0:id': 120 })
    writeColumnWidths('query-2', { '1:name': 300 })

    expect(readColumnWidths('query-1')).toEqual({ '0:id': 120 })
    expect(readColumnWidths('query-2')).toEqual({ '1:name': 300 })
  })

  it('replaces the widths of a result written twice', () => {
    writeColumnWidths('query-1', { '0:id': 120 })
    writeColumnWidths('query-1', { '0:id': 150, '1:name': 90 })

    expect(readColumnWidths('query-1')).toEqual({ '0:id': 150, '1:name': 90 })
  })

  it('comes back empty for malformed JSON', () => {
    store('[{ not json')

    expect(readColumnWidths('query-1')).toEqual({})
  })

  it('comes back empty when the payload is not a list', () => {
    store({ 'query-1': { '0:id': 120 } })

    expect(readColumnWidths('query-1')).toEqual({})
  })

  it('drops malformed entries and widths and keeps the rest', () => {
    store([
      { queryId: 7, widths: { '0:id': 120 } },
      { queryId: 'no-widths' },
      {
        queryId: 'query-1',
        widths: { '0:id': 120, '1:name': 'wide', '2:email': -5 }
      }
    ])

    expect(readColumnWidths('no-widths')).toEqual({})
    expect(readColumnWidths('query-1')).toEqual({ '0:id': 120 })
  })

  it('drops the least recently resized result beyond the cap', () => {
    for (let index = 0; index <= maximumStoredResults; index++) {
      writeColumnWidths(`query-${index}`, { '0:id': 100 })
    }

    expect(readColumnWidths('query-0')).toEqual({})
    expect(readColumnWidths('query-1')).toEqual({ '0:id': 100 })
    expect(readColumnWidths(`query-${maximumStoredResults}`)).toEqual({
      '0:id': 100
    })
  })

  it('keeps a result it resized again from being dropped', () => {
    writeColumnWidths('query-0', { '0:id': 100 })

    for (let index = 1; index < maximumStoredResults; index++) {
      writeColumnWidths(`query-${index}`, { '0:id': 100 })
    }

    writeColumnWidths('query-0', { '0:id': 200 })
    writeColumnWidths('query-new', { '0:id': 100 })

    expect(readColumnWidths('query-0')).toEqual({ '0:id': 200 })
    expect(readColumnWidths('query-1')).toEqual({})
  })

  it('does not throw when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => writeColumnWidths('query-1', { '0:id': 120 })).not.toThrow()
  })
})
