import type { Statement } from './parser'

// The active statement is the one under the cursor, or the closest one
// before the cursor when the cursor sits between statements.
export function findActiveStatementIndex(
  statements: Statement[],
  cursorPosition: number
): number | null {
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]

    if (cursorPosition >= statement.start && cursorPosition <= statement.end) {
      return i
    }
  }

  for (let i = statements.length - 1; i >= 0; i--) {
    if (cursorPosition >= statements[i].end) {
      return i
    }
  }

  return null
}
