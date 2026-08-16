import { autocompletion } from '@codemirror/autocomplete'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import {
  acceptGhostText,
  acceptGhostTextWord,
  dismissGhostText,
  firstSuggestionWord,
  ghostTextField,
  setGhostText,
  shouldRequestSuggestion,
  type GhostTextTarget
} from './worksheet-editor-ghost-text'

// The commands only read the state and dispatch, so a state+dispatch pair
// exercises the real transactions without a DOM jsdom cannot measure.
function createView(doc: string, cursor = doc.length): GhostTextTarget {
  const target: GhostTextTarget = {
    dispatch: (spec: TransactionSpec) => {
      target.state = target.state.update(spec).state
    },
    state: EditorState.create({
      doc,
      extensions: [autocompletion(), ghostTextField],
      selection: { anchor: cursor }
    })
  }

  return target
}

function suggest(view: GhostTextTarget, text: string): void {
  view.dispatch({
    effects: setGhostText.of({ from: view.state.selection.main.head, text })
  })
}

describe('firstSuggestionWord', () => {
  it('takes one word at a time', () => {
    expect(firstSuggestionWord('title, rental_rate')).toEqual('title')
  })

  it('keeps the line break in front of the word it takes', () => {
    expect(firstSuggestionWord('\nfrom film')).toEqual('\nfrom')
  })

  it('takes punctuation on its own', () => {
    expect(firstSuggestionWord(', rating')).toEqual(',')
  })

  it('takes all of a single word', () => {
    expect(firstSuggestionWord('film')).toEqual('film')
  })
})

describe('acceptGhostText', () => {
  it('writes the whole suggestion and leaves the cursor after it', () => {
    const view = createView('select ')

    suggest(view, 'title\nfrom film')

    expect(acceptGhostText(view)).toEqual(true)
    expect(view.state.doc.toString()).toEqual('select title\nfrom film')
    expect(view.state.selection.main.head).toEqual(22)
    expect(view.state.field(ghostTextField)).toEqual(null)
  })

  it('falls through when there is nothing to accept, so Tab still indents', () => {
    const view = createView('select ')

    expect(acceptGhostText(view)).toEqual(false)
    expect(view.state.doc.toString()).toEqual('select ')
  })
})

describe('acceptGhostTextWord', () => {
  it('writes one word and keeps showing the rest', () => {
    const view = createView('select ')

    suggest(view, 'title, rental_rate from film')

    expect(acceptGhostTextWord(view)).toEqual(true)
    expect(view.state.doc.toString()).toEqual('select title')
    expect(view.state.field(ghostTextField)).toEqual({
      from: 12,
      text: ', rental_rate from film'
    })
  })

  it('clears the suggestion once its last word is taken', () => {
    const view = createView('select ')

    suggest(view, 'title')

    expect(acceptGhostTextWord(view)).toEqual(true)
    expect(view.state.doc.toString()).toEqual('select title')
    expect(view.state.field(ghostTextField)).toEqual(null)
  })

  it('falls through when there is nothing to accept', () => {
    const view = createView('select ')

    expect(acceptGhostTextWord(view)).toEqual(false)
  })
})

describe('dismissGhostText', () => {
  it('takes the suggestion away without touching the document', () => {
    const view = createView('select ')

    suggest(view, 'title from film')

    expect(dismissGhostText(view)).toEqual(true)
    expect(view.state.doc.toString()).toEqual('select ')
    expect(view.state.field(ghostTextField)).toEqual(null)
  })

  it('falls through when nothing is showing, so Esc still closes the dropdown', () => {
    const view = createView('select ')

    expect(dismissGhostText(view)).toEqual(false)
  })
})

describe('ghostTextField', () => {
  it('drops the suggestion as soon as the user types', () => {
    const view = createView('select ')

    suggest(view, 'title from film')

    view.dispatch({
      changes: { from: view.state.doc.length, insert: 't' },
      userEvent: 'input.type'
    })

    expect(view.state.field(ghostTextField)).toEqual(null)
  })

  it('drops the suggestion when the cursor moves away from it', () => {
    const view = createView('select ')

    suggest(view, 'title from film')

    view.dispatch({ selection: { anchor: 0 } })

    expect(view.state.field(ghostTextField)).toEqual(null)
  })
})

describe('shouldRequestSuggestion', () => {
  it('asks at the end of a statement being typed', () => {
    expect(shouldRequestSuggestion(createView('select ').state)).toEqual(true)
  })

  it('stays quiet in an empty worksheet', () => {
    expect(shouldRequestSuggestion(createView('  \n ').state)).toEqual(false)
  })

  it('stays quiet while text is selected', () => {
    const view = createView('select title')

    view.dispatch({ selection: { anchor: 0, head: 6 } })

    expect(shouldRequestSuggestion(view.state)).toEqual(false)
  })

  it('stays quiet in the middle of a line', () => {
    expect(
      shouldRequestSuggestion(createView('select from film', 7).state)
    ).toEqual(false)
  })

  it('asks at the end of a line that has more lines under it', () => {
    const view = createView('select title\nfrom film', 12)

    expect(shouldRequestSuggestion(view.state)).toEqual(true)
  })
})
