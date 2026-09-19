import { tokenize, type Token } from '../sql-parser/tokenizer'

function isSignificant(token: Token): boolean {
  return token.type !== 'whitespace' && token.type !== 'comment'
}

function isSemicolon(token: Token): boolean {
  return token.type === 'punctuation' && token.value === ';'
}

/**
 * The significant tokens of the statement the offset sits in, bounded by the
 * semicolons on either side of it.
 *
 * Deliberately not `createAstFromSql`. That splitter also breaks on a
 * top-level `SELECT`, which is what makes "run the statement under the cursor"
 * work on a script written without semicolons — but it puts `WITH recent AS
 * (...)` and the `SELECT` that uses it in two different statements, and a CTE
 * is only ever in scope for the select that follows it. Semicolons are the
 * boundary the scoping rules actually use.
 *
 * Tokenizing rather than splitting on the character means a semicolon inside a
 * string literal or a comment is not a boundary.
 */
export function listStatementTokens(
  documentText: string,
  offset: number
): Token[] {
  const tokens = tokenize(documentText)

  let start = 0
  let end = tokens.length

  for (let index = 0; index < tokens.length; index++) {
    if (!isSemicolon(tokens[index])) {
      continue
    }

    if (tokens[index].end <= offset) {
      start = index + 1
    } else {
      end = index

      break
    }
  }

  return tokens.slice(start, end).filter(isSignificant)
}
