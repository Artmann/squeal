import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export const squealEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--panel)',
    color: 'var(--text)'
  },
  '.cm-scroller': {
    fontFamily: 'var(--mono)',
    fontSize: 'var(--code-size)',
    lineHeight: 'var(--code-lh)'
  },
  '.cm-content': {
    caretColor: 'var(--text)',
    padding: '12px 0'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--text)'
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'var(--sel)'
    },
  '.cm-activeLine': {
    backgroundColor: 'transparent'
  },
  // The gutter sits on the editor background — no fill, no divider.
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--text3)',
    fontSize: '11.5px',
    userSelect: 'none'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'var(--text3)',
    minWidth: '46px',
    padding: '0 16px 0 0',
    textAlign: 'right'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent'
  },
  '.cm-activeStatementGutter': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 20%, transparent)'
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--hover)',
    outline: '1px solid var(--text3)'
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--sel)',
    color: 'var(--text)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--accent)',
    color: '#fff'
  },
  // Matches the connection popover in the toolbar.
  '.cm-tooltip': {
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14)',
    color: 'var(--text)'
  },
  '.cm-tooltip-autocomplete': {
    padding: '4px',
    '& > ul': {
      fontFamily: 'var(--mono)',
      fontSize: '12px'
    },
    '& > ul > li': {
      borderRadius: '5px',
      padding: '5px 8px'
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--hover)',
      color: 'var(--text)'
    }
  }
})

const squealHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-kw)' },
  { tag: tags.operator, color: 'var(--syn-op)' },
  { tag: tags.special(tags.string), color: 'var(--syn-str)' },
  { tag: tags.string, color: 'var(--syn-str)' },
  { tag: tags.number, color: 'var(--syn-num)' },
  { tag: tags.comment, color: 'var(--text3)', fontStyle: 'italic' },
  { tag: tags.function(tags.variableName), color: 'var(--syn-fn)' },
  { tag: tags.variableName, color: 'var(--text)' },
  { tag: tags.typeName, color: 'var(--text)' },
  { tag: tags.propertyName, color: 'var(--text)' },
  { tag: tags.punctuation, color: 'var(--syn-op)' },
  { tag: tags.bracket, color: 'var(--syn-op)' },
  { tag: tags.null, color: 'var(--syn-num)' },
  { tag: tags.bool, color: 'var(--syn-num)' },
  { tag: tags.className, color: 'var(--text)' },
  { tag: tags.definition(tags.variableName), color: 'var(--text)' },
  { tag: tags.labelName, color: 'var(--text)' }
])

export const squealHighlighting = syntaxHighlighting(squealHighlightStyle)
