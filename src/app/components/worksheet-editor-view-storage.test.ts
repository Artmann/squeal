import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clampEditorView,
  editorViewsStorageKey,
  maximumStoredEditorViews,
  maximumStoredSelectionRanges,
  readStoredEditorViews,
  rememberEditorView,
  type StoredEditorView,
  type StoredEditorViews,
  writeStoredEditorViews
} from './worksheet-editor-view-storage'

const caretAtFive: StoredEditorView = {
  main: 0,
  ranges: [{ anchor: 5, head: 5 }],
  scroll: { offset: 0, position: 0 }
}

function store(value: unknown): void {
  localStorage.setItem(
    editorViewsStorageKey,
    typeof value === 'string' ? value : JSON.stringify(value)
  )
}

describe('editor view storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('returns nothing when nothing is stored', () => {
    expect(readStoredEditorViews()).toEqual(new Map())
  })

  it('reads back what it wrote, in the same order', () => {
    const views: StoredEditorViews = new Map([
      [
        'b',
        {
          main: 1,
          ranges: [
            { anchor: 0, head: 3 },
            { anchor: 10, head: 7 }
          ],
          scroll: { offset: 12, position: 40 }
        }
      ],
      ['a', caretAtFive]
    ])

    writeStoredEditorViews(views)

    const read = readStoredEditorViews()

    expect(read).toEqual(views)
    expect([...read.keys()]).toEqual(['b', 'a'])
  })

  it('comes back empty for malformed JSON', () => {
    store('[{ not json')

    expect(readStoredEditorViews()).toEqual(new Map())
  })

  it('comes back empty when the payload is not a list', () => {
    store({ a: caretAtFive })

    expect(readStoredEditorViews()).toEqual(new Map())
  })

  it('drops the entries that are malformed and keeps the rest', () => {
    store([
      { ...caretAtFive, worksheetId: 'kept' },
      { ...caretAtFive, worksheetId: 7 },
      { ...caretAtFive, ranges: [], worksheetId: 'no-ranges' },
      { ...caretAtFive, main: 1, worksheetId: 'main-out-of-range' },
      {
        ...caretAtFive,
        ranges: [{ anchor: -1, head: 2 }],
        worksheetId: 'negative'
      },
      {
        ...caretAtFive,
        ranges: [{ anchor: 1.5, head: 2 }],
        worksheetId: 'fractional'
      },
      { ...caretAtFive, scroll: null, worksheetId: 'no-scroll' },
      {
        ...caretAtFive,
        scroll: { offset: 'far', position: 0 },
        worksheetId: 'bad-offset'
      },
      null,
      'a string'
    ])

    expect(readStoredEditorViews()).toEqual(new Map([['kept', caretAtFive]]))
  })

  it('reads no more than the cap from a payload that exceeds it', () => {
    const entries = Array.from(
      { length: maximumStoredEditorViews + 5 },
      (_, index) => ({ ...caretAtFive, worksheetId: `worksheet-${index}` })
    )

    store(entries)

    const read = readStoredEditorViews()

    expect(read.size).toEqual(maximumStoredEditorViews)
    expect(read.has('worksheet-0')).toEqual(false)
    expect(read.has(`worksheet-${maximumStoredEditorViews + 4}`)).toEqual(true)
  })

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota')
    })

    expect(readStoredEditorViews()).toEqual(new Map())
    expect(() => {
      writeStoredEditorViews(new Map([['a', caretAtFive]]))
    }).not.toThrow()
  })
})

describe('rememberEditorView', () => {
  it('moves a worksheet it already knows to the most recent end', () => {
    const views: StoredEditorViews = new Map([
      ['a', caretAtFive],
      ['b', caretAtFive]
    ])

    rememberEditorView(views, 'a', caretAtFive)

    expect([...views.keys()]).toEqual(['b', 'a'])
  })

  it('drops the least recently touched worksheet beyond the cap', () => {
    const views: StoredEditorViews = new Map()

    for (let index = 0; index <= maximumStoredEditorViews; index++) {
      rememberEditorView(views, `worksheet-${index}`, caretAtFive)
    }

    expect(views.size).toEqual(maximumStoredEditorViews)
    expect(views.has('worksheet-0')).toEqual(false)
    expect(views.has('worksheet-1')).toEqual(true)
  })

  it('keeps only the main cursor of a very large selection', () => {
    const views: StoredEditorViews = new Map()
    const ranges = Array.from(
      { length: maximumStoredSelectionRanges + 1 },
      (_, index) => ({ anchor: index, head: index })
    )

    rememberEditorView(views, 'a', {
      main: 3,
      ranges,
      scroll: { offset: 4, position: 2 }
    })

    expect(views.get('a')).toEqual({
      main: 0,
      ranges: [{ anchor: 3, head: 3 }],
      scroll: { offset: 4, position: 2 }
    })
  })
})

describe('clampEditorView', () => {
  it('leaves a view that fits the document alone', () => {
    const view: StoredEditorView = {
      main: 1,
      ranges: [
        { anchor: 0, head: 2 },
        { anchor: 8, head: 4 }
      ],
      scroll: { offset: 3, position: 6 }
    }

    expect(clampEditorView(view, 10)).toEqual(view)
  })

  // The worksheet was shortened since the view was saved -- in another
  // session, or by a save that failed halfway.
  it('holds every offset to a document that got shorter', () => {
    expect(
      clampEditorView(
        {
          main: 0,
          ranges: [
            { anchor: 2, head: 40 },
            { anchor: 30, head: 35 }
          ],
          scroll: { offset: 15, position: 25 }
        },
        10
      )
    ).toEqual({
      main: 0,
      ranges: [
        { anchor: 2, head: 10 },
        { anchor: 10, head: 10 }
      ],
      scroll: { offset: 0, position: 10 }
    })
  })

  it('handles an empty document', () => {
    expect(clampEditorView(caretAtFive, 0)).toEqual({
      main: 0,
      ranges: [{ anchor: 0, head: 0 }],
      scroll: { offset: 0, position: 0 }
    })
  })
})
