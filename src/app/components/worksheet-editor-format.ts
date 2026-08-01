import type { EditorState, TransactionSpec } from '@codemirror/state'

import type { DatabaseType } from '@/glue/api/schemas'

import { formatSql, SqlFormatError, toSqlDialect } from './sql-format'

export type FormatOutcome =
  | 'formatted'
  | 'parse-error'
  | 'unchanged'
  | 'empty'

// Only the two things formatting actually needs. `EditorView` satisfies this,
// and so does a bare state+dispatch pair, which keeps the tests off the DOM —
// jsdom cannot measure a real view.
export interface FormatTarget {
  dispatch: (spec: TransactionSpec) => void
  state: EditorState
}

/**
 * Formats the selection when there is one, otherwise the whole document, and
 * applies it as a single transaction so one `mod+z` restores the original.
 * `input.format` is deliberately not a joinable user event, so the history
 * never folds this into the surrounding typing.
 *
 * Returns what happened so the caller can surface the parse error. Nothing is
 * dispatched unless the formatter succeeded and actually changed something —
 * the document is never left holding partial output, and a no-op never adds an
 * undo step.
 */
export function formatEditorContent(
  view: FormatTarget,
  databaseType: DatabaseType | undefined
): FormatOutcome {
  const selection = view.state.selection.main
  const from = selection.empty ? 0 : selection.from
  const to = selection.empty ? view.state.doc.length : selection.to
  const source = view.state.sliceDoc(from, to)

  if (source.trim().length === 0) {
    return 'empty'
  }

  let formatted: string

  try {
    formatted = formatSql(source, toSqlDialect(databaseType))
  } catch (error) {
    if (!(error instanceof SqlFormatError)) {
      throw error
    }

    return 'parse-error'
  }

  if (formatted === source) {
    return 'unchanged'
  }

  view.dispatch({
    changes: { from, insert: formatted, to },
    scrollIntoView: true,
    selection: selection.empty
      ? { anchor: Math.min(selection.head, from + formatted.length) }
      : { anchor: from, head: from + formatted.length },
    userEvent: 'input.format'
  })

  return 'formatted'
}
