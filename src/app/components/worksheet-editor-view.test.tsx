import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import invariant from 'tiny-invariant'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import { WorksheetEditor } from './WorksheetEditor'
import {
  editorViewsStorageKey,
  readStoredEditorViews
} from './worksheet-editor-view-storage'

// The real editor rather than the mock in `WorksheetEditor.test.tsx`: what is
// under test is how the memory rides along with `@uiw/react-codemirror`
// swapping the document when the worksheet changes, and that only happens with
// the library itself in the loop. jsdom does no layout, so the scroll position
// is only covered where it passes through without being measured.

function editor(worksheetId: string, content: string): ReactElement {
  return (
    <WorksheetEditor
      activeStatementIndex={null}
      content={content}
      schemaStatus={{ state: 'no-database' }}
      statements={[]}
      worksheetId={worksheetId}
    />
  )
}

function select(view: EditorView, selection: EditorSelection): void {
  act(() => {
    view.dispatch({ selection })
  })
}

function selectionOf(view: EditorView): unknown {
  return view.state.selection.toJSON()
}

function viewIn(container: HTMLElement): EditorView {
  const element = container.querySelector('.cm-editor')

  invariant(element instanceof HTMLElement, 'The editor did not render')

  const view = EditorView.findFromDOM(element)

  invariant(view, 'The editor has no view')

  return view
}

const firstContent = 'select 1;\nselect 2;\nselect 3;'
const secondContent = 'select * from film;'

describe('worksheet editor view memory', () => {
  beforeAll(() => {
    // CodeMirror measures text through `Range`, and jsdom leaves both of these
    // out. Empty rectangles are enough: nothing here depends on layout.
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
    Range.prototype.getClientRects ??= () =>
      Object.assign([], { item: () => null }) as unknown as DOMRectList
  })

  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('gives each worksheet its own selection across a tab switch', () => {
    const { container, rerender } = render(editor('first', firstContent))
    const view = viewIn(container)

    select(view, EditorSelection.single(10, 18))

    rerender(editor('second', secondContent))

    // Nothing is stored for the second worksheet, so it opens at the top
    // rather than with the first one's selection mapped onto its text.
    expect(selectionOf(view)).toEqual({
      main: 0,
      ranges: [{ anchor: 0, head: 0 }]
    })

    select(view, EditorSelection.single(7))

    rerender(editor('first', firstContent))

    expect(selectionOf(view)).toEqual({
      main: 0,
      ranges: [{ anchor: 10, head: 18 }]
    })

    rerender(editor('second', secondContent))

    expect(selectionOf(view)).toEqual({
      main: 0,
      ranges: [{ anchor: 7, head: 7 }]
    })
  })

  it('keeps every cursor of a multiple selection, and which one is main', () => {
    const { container, rerender } = render(editor('first', firstContent))
    const view = viewIn(container)

    select(
      view,
      EditorSelection.create(
        [
          EditorSelection.cursor(1),
          EditorSelection.range(11, 14),
          EditorSelection.cursor(25)
        ],
        1
      )
    )

    rerender(editor('second', secondContent))
    rerender(editor('first', firstContent))

    expect(selectionOf(view)).toEqual({
      main: 1,
      ranges: [
        { anchor: 1, head: 1 },
        { anchor: 11, head: 14 },
        { anchor: 25, head: 25 }
      ]
    })
  })

  // The library only swaps the document when the text differs, so two
  // worksheets with the same content -- two empty ones, most often -- have to
  // be told apart some other way.
  it('tells apart two worksheets with the same content', () => {
    const { container, rerender } = render(editor('first', secondContent))
    const view = viewIn(container)

    select(view, EditorSelection.single(2, 6))

    rerender(editor('second', secondContent))

    expect(selectionOf(view)).toEqual({
      main: 0,
      ranges: [{ anchor: 0, head: 0 }]
    })

    select(view, EditorSelection.single(9))

    rerender(editor('first', secondContent))

    expect(selectionOf(view)).toEqual({
      main: 0,
      ranges: [{ anchor: 2, head: 6 }]
    })
  })

  it('restores the selection after a restart', () => {
    const first = render(editor('first', firstContent))

    select(viewIn(first.container), EditorSelection.single(12, 4))

    first.unmount()

    const second = render(editor('first', firstContent))

    expect(selectionOf(viewIn(second.container))).toEqual({
      main: 0,
      ranges: [{ anchor: 12, head: 4 }]
    })
  })

  it('fits a stored selection to content that got shorter', () => {
    const first = render(editor('first', firstContent))

    select(viewIn(first.container), EditorSelection.single(15, 25))

    first.unmount()

    const second = render(editor('first', 'select 1;'))

    expect(selectionOf(viewIn(second.container))).toEqual({
      main: 0,
      ranges: [{ anchor: 9, head: 9 }]
    })
  })

  // Scrolling waits for CodeMirror to measure the restored document, which
  // jsdom never lets it do. A save before then must write down the position it
  // is about to scroll to, not the editor's own `scrollTop`, which still
  // describes wherever it was before.
  it('does not overwrite a restored scroll position it has not applied yet', () => {
    localStorage.setItem(
      editorViewsStorageKey,
      JSON.stringify([
        {
          main: 0,
          ranges: [{ anchor: 20, head: 20 }],
          scroll: { offset: 7, position: 10 },
          worksheetId: 'first'
        }
      ])
    )

    const { unmount } = render(editor('first', firstContent))

    unmount()

    expect(readStoredEditorViews()).toEqual(
      new Map([
        [
          'first',
          {
            main: 0,
            ranges: [{ anchor: 20, head: 20 }],
            scroll: { offset: 7, position: 10 }
          }
        ]
      ])
    )
  })

  it('opens normally when what is stored is unreadable', () => {
    localStorage.setItem(editorViewsStorageKey, '{ not json')

    const { container } = render(editor('first', firstContent))

    expect(selectionOf(viewIn(container))).toEqual({
      main: 0,
      ranges: [{ anchor: 0, head: 0 }]
    })
  })
})
