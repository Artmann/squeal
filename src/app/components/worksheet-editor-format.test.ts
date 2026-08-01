import { history, undo } from '@codemirror/commands'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import {
  formatEditorContent,
  type FormatTarget
} from './worksheet-editor-format'

// A state+dispatch pair standing in for the editor. Formatting only reads the
// state and dispatches, so this exercises the real transactions without a DOM
// that jsdom cannot measure.
function createView(doc: string): FormatTarget {
  const target: FormatTarget = {
    dispatch: (spec: TransactionSpec) => {
      target.state = target.state.update(spec).state
    },
    state: EditorState.create({ doc, extensions: [history()] })
  }

  return target
}

/** Types character by character, the way real keystrokes arrive. */
function type(view: FormatTarget, text: string): void {
  for (const character of text) {
    view.dispatch({
      changes: { from: view.state.doc.length, insert: character },
      userEvent: 'input.type'
    })
  }
}

function undoOnce(view: FormatTarget): void {
  undo({ dispatch: (tr) => view.dispatch(tr), state: view.state })
}

describe('formatEditorContent', () => {
  it('formats the whole document when nothing is selected', () => {
    const view = createView('select a,b from t')

    expect(formatEditorContent(view, 'postgres')).toEqual('formatted')
    // sql-formatter re-indents; it preserves keyword case by default.
    expect(view.state.doc.toString()).toEqual('select\n  a,\n  b\nfrom\n  t')
  })

  it('is undone by a single undo, without swallowing the typing before it', () => {
    const view = createView('')

    type(view, 'select a,b from t where x=1')

    const beforeFormat = view.state.doc.toString()

    expect(formatEditorContent(view, 'postgres')).toEqual('formatted')
    expect(view.state.doc.toString()).not.toEqual(beforeFormat)

    undoOnce(view)

    // One undo restores exactly the pre-format text — the format must not fold
    // into the typing group, or undo would eat the user's keystrokes too.
    expect(view.state.doc.toString()).toEqual(beforeFormat)
  })

  it('formats only the selection and leaves the rest of the document alone', () => {
    const view = createView('select 1;\nselect   a,b   from t;')

    view.dispatch({
      selection: { anchor: 10, head: view.state.doc.length }
    })

    expect(formatEditorContent(view, 'postgres')).toEqual('formatted')
    expect(view.state.doc.toString().startsWith('select 1;')).toEqual(true)
  })

  it('leaves the caret inside the document after formatting', () => {
    const view = createView('select a,b from t where x = 1 and y = 2')

    view.dispatch({ selection: { anchor: view.state.doc.length } })
    formatEditorContent(view, 'postgres')

    expect(view.state.selection.main.head).toBeLessThanOrEqual(
      view.state.doc.length
    )
  })

  it('leaves the document untouched when the statement will not parse', () => {
    const view = createView('SELECT * FROM (')
    const before = view.state.doc.toString()

    expect(formatEditorContent(view, 'postgres')).toEqual('parse-error')
    expect(view.state.doc.toString()).toEqual(before)
  })

  it('adds no undo step when the document is already formatted', () => {
    const view = createView('')

    type(view, 'x')
    formatEditorContent(view, 'postgres')

    const formatted = view.state.doc.toString()

    // Running it a second time must be a no-op rather than an empty history
    // entry the user has to undo twice.
    expect(formatEditorContent(view, 'postgres')).toEqual('unchanged')

    undoOnce(view)

    expect(view.state.doc.toString()).not.toEqual(formatted)
  })

  it('does nothing for an empty document', () => {
    const view = createView('   \n  ')

    expect(formatEditorContent(view, 'postgres')).toEqual('empty')
  })

  it('formats with the dialect of the worksheet database', () => {
    const view = createView('select `a` from `t`')

    expect(formatEditorContent(view, 'mysql')).toEqual('formatted')
    expect(view.state.doc.toString()).toContain('`a`')
  })
})
