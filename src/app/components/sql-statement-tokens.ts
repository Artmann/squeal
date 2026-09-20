import { tokenize, type Token } from '../sql-parser/tokenizer'

/**
 * Words that can follow a table reference without being its alias: the ones
 * that continue the `FROM` clause, and the ones that end it. Without this,
 * `FROM (SELECT 1) WHERE x` reads `WHERE` as the subquery's name.
 */
export const notATableAlias = new Set([
  'AS',
  'CROSS',
  'EXCEPT',
  'FULL',
  'GROUP',
  'HAVING',
  'INNER',
  'INTERSECT',
  'JOIN',
  'LEFT',
  'LIMIT',
  'NATURAL',
  'OFFSET',
  'ON',
  'ORDER',
  'OUTER',
  'RETURNING',
  'RIGHT',
  'SET',
  'UNION',
  'USING',
  'WHERE',
  'WINDOW'
])

function isSignificant(token: Token): boolean {
  return token.type !== 'whitespace' && token.type !== 'comment'
}

function isSemicolon(token: Token): boolean {
  return token.type === 'punctuation' && token.value === ';'
}

/**
 * Whether a token is the given word, matched on what it says rather than on
 * its type.
 *
 * The tokenizer's keyword set covers what statement splitting needs and no
 * more — `WITH`, `USING` and `INNER` all arrive as identifiers — so asking
 * what a token *says* is the only question that answers reliably.
 */
export function isWord(token: Token | undefined, word: string): boolean {
  if (!token) {
    return false
  }

  return (
    (token.type === 'identifier' || token.type === 'keyword') &&
    token.value.toUpperCase() === word
  )
}

/**
 * Whether a token can name something. The tokenizer types a quoted identifier
 * as an `identifier` and keeps the quotes in its value, so this one check
 * covers both spellings.
 */
export function isNameToken(token: Token | undefined): boolean {
  return token?.type === 'identifier'
}

/** The name a token carries, with the quotes taken off a quoted identifier. */
export function toName(token: Token): string {
  const quoted = /^([`"[])(.*)([`"\]])$/.exec(token.value)

  return quoted ? quoted[2] : token.value
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
