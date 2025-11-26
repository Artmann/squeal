import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export const catppuccinTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-base)',
    color: 'var(--color-text)'
  },
  '.cm-content': {
    caretColor: 'var(--color-text)'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-text)'
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'color-mix(in srgb, var(--color-mauve) 30%, transparent)'
    },
  '.cm-activeLine': {
    backgroundColor: 'transparent'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-mantle)',
    color: 'var(--color-overlay-0)',
    borderRight: 'none'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-surface-0)'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'var(--color-overlay-0)'
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--color-surface-2)',
    outline: '1px solid var(--color-overlay-0)'
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--color-yellow)',
    color: 'var(--color-base)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--color-peach)'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface-0)',
    border: '1px solid var(--color-surface-2)',
    color: 'var(--color-text)'
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-surface-1)',
      color: 'var(--color-text)'
    }
  }
})

const catppuccinHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--color-mauve)' },
  { tag: tags.operator, color: 'var(--color-sky)' },
  { tag: tags.special(tags.string), color: 'var(--color-green)' },
  { tag: tags.string, color: 'var(--color-green)' },
  { tag: tags.number, color: 'var(--color-peach)' },
  { tag: tags.comment, color: 'var(--color-overlay-1)', fontStyle: 'italic' },
  { tag: tags.function(tags.variableName), color: 'var(--color-blue)' },
  { tag: tags.variableName, color: 'var(--color-text)' },
  { tag: tags.typeName, color: 'var(--color-yellow)' },
  { tag: tags.propertyName, color: 'var(--color-blue)' },
  { tag: tags.punctuation, color: 'var(--color-overlay-2)' },
  { tag: tags.bracket, color: 'var(--color-overlay-2)' },
  { tag: tags.null, color: 'var(--color-peach)' },
  { tag: tags.bool, color: 'var(--color-peach)' },
  { tag: tags.className, color: 'var(--color-yellow)' },
  { tag: tags.definition(tags.variableName), color: 'var(--color-flamingo)' },
  { tag: tags.labelName, color: 'var(--color-blue)' }
])

export const catppuccinHighlighting = syntaxHighlighting(catppuccinHighlightStyle)
