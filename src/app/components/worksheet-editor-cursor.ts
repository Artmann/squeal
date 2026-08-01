export interface CursorPosition {
  // 1-based, like every editor status bar.
  column: number
  line: number
  // Character offset into the document — what statement lookup uses.
  offset: number
}

// The shape of a CodeMirror `Line`, narrowed to what the status bar needs so
// this stays testable without an editor instance.
interface DocumentLine {
  from: number
  number: number
}

export function isSameCursorPosition(
  first: CursorPosition | null,
  second: CursorPosition
): boolean {
  if (!first) {
    return false
  }

  return (
    first.column === second.column &&
    first.line === second.line &&
    first.offset === second.offset
  )
}

// Derives the status bar payload from `state.doc.lineAt(head)` and the head
// offset itself.
export function toCursorPosition(
  line: DocumentLine,
  offset: number
): CursorPosition {
  return {
    column: offset - line.from + 1,
    line: line.number,
    offset
  }
}
