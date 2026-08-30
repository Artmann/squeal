import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `@uiw/react-codemirror` dispatches a full `StateEffect.reconfigure` whenever
// `extensions`, `basicSetup`, `onChange` or `onUpdate` changes identity — all
// four are in the deps of its reconfigure effect. Every reconfigure re-runs
// `EditorView.theme`, which allocates a new class name and a new StyleModule,
// and style-mod appends that module to the document and never removes it while
// re-serializing the whole stylesheet. So an unstable prop here does not just
// cost a reconfigure: it leaks CSS rules and re-parses the entire stylesheet on
// every keystroke, which is what made typing slower the longer the app stayed
// open. Capturing the props is how we assert no reconfigure can happen.
const { capturedProps } = vi.hoisted(() => ({
  capturedProps: [] as Record<string, unknown>[]
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: Record<string, unknown>): ReactElement => {
    capturedProps.push(props)

    return <div data-testid="code-mirror" />
  }
}))

import { createAstFromSql } from '../sql-parser'
import { WorksheetEditor } from './WorksheetEditor'

function editor(content: string): ReactElement {
  return (
    <WorksheetEditor
      activeStatementIndex={0}
      content={content}
      statements={createAstFromSql(content).statements}
      // Deliberately unstable, the way a parent that forgot to memoise would
      // be: the component owes CodeMirror a stable callback regardless.
      onChange={() => undefined}
      onCursorChange={() => undefined}
      onCursorPositionChange={() => undefined}
      onRunQuery={() => undefined}
    />
  )
}

describe('WorksheetEditor', () => {
  beforeEach(() => {
    capturedProps.length = 0
  })

  it('keeps the editor configuration stable while the document changes', () => {
    const { rerender } = render(editor('select 1'))

    // Three keystrokes: each one changes `content`, and with it the parsed
    // statements and the active statement the gutter is computed from.
    rerender(editor('select 12'))
    rerender(editor('select 123'))
    rerender(editor('select 1234'))

    const identityCounts = {
      basicSetup: new Set(capturedProps.map((props) => props.basicSetup)).size,
      extensions: new Set(capturedProps.map((props) => props.extensions)).size,
      onChange: new Set(capturedProps.map((props) => props.onChange)).size,
      onUpdate: new Set(capturedProps.map((props) => props.onUpdate)).size
    }

    // A `Set` of the values rather than a `toBe` per prop, because identity is
    // the whole point: a deep comparison passes happily on freshly allocated
    // objects that would each trigger their own reconfigure.
    expect(identityCounts).toEqual({
      basicSetup: 1,
      extensions: 1,
      onChange: 1,
      onUpdate: 1
    })
  })

  // The whole object, not the three interesting keys. `basicSetup` opts in to
  // every option it is not handed a literal `false` for, so a key missing from
  // what the editor passes is not a feature it lacks -- it is one it silently
  // has. Asserting the whole object is what makes that visible here: dropping
  // `searchKeymap` would hand Mod-f back to CodeMirror's own search panel, and
  // nothing in the extension list would show it happening.
  it('names every option basicSetup reads, so none is opted into silently', () => {
    render(editor('select 1'))

    expect(capturedProps[0].basicSetup).toEqual({
      allowMultipleSelections: true,
      autocompletion: false,
      bracketMatching: true,
      closeBrackets: true,
      closeBracketsKeymap: true,
      completionKeymap: true,
      crosshairCursor: false,
      defaultKeymap: true,
      drawSelection: true,
      dropCursor: true,
      foldGutter: true,
      foldKeymap: true,
      highlightActiveLine: true,
      highlightActiveLineGutter: true,
      highlightSelectionMatches: true,
      highlightSpecialChars: true,
      history: true,
      historyKeymap: true,
      indentOnInput: true,
      lineNumbers: true,
      lintKeymap: false,
      rectangularSelection: true,
      searchKeymap: false,
      syntaxHighlighting: true
    })
  })

  it('still passes the current content through to the editor', () => {
    const { rerender } = render(editor('select 1'))

    rerender(editor('select 1234'))

    const lastProps = capturedProps[capturedProps.length - 1]

    expect(lastProps.value).toEqual('select 1234')
  })
})
