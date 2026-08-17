import invariant from 'tiny-invariant'

export type TokenType =
  | 'comment'
  | 'identifier'
  | 'keyword'
  | 'number'
  | 'operator'
  | 'punctuation'
  | 'string'
  | 'whitespace'

export interface Token {
  end: number
  start: number
  type: TokenType
  value: string
}

type TokenReader = (sql: string, position: number) => Token | null

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let position = 0

  while (position < sql.length) {
    const token = readToken(sql, position)

    if (!token) {
      // Unknown character - skip it
      position++
      continue
    }

    // Every reader must consume at least one character. A zero-width token
    // would leave `position` where it is and spin here forever, freezing the
    // renderer with no error — and this runs on every keystroke, so the loop
    // says so rather than trusting it.
    invariant(
      token.end > position,
      `Tokenizer made no progress at position ${position}.`
    )

    tokens.push(token)
    position = token.end
  }

  return tokens
}

// The readers that consume a closing delimiter step past it unconditionally, so
// on unterminated input they ask for an `end` beyond the string. Deriving `end`
// from the slice clamps it here — the one place every token is built — instead
// of leaving each consumer to defend against a token that points past its own
// input.
//
// This has to stay a clamp and never a decrement: `tokenize` advances by
// `token.end`, so a token ending at or before its start would loop forever. It
// is a clamp because `position < sql.length` on entry guarantees the slice keeps
// at least one character, and `tokenize` asserts the progress it depends on.
function createToken(
  sql: string,
  start: number,
  end: number,
  type: TokenType
): Token {
  const value = sql.slice(start, end)

  return { end: start + value.length, start, type, value }
}

function readBlockComment(sql: string, position: number): Token | null {
  if (sql[position] !== '/' || sql[position + 1] !== '*') {
    return null
  }

  let end = position + 2

  while (end < sql.length && !(sql[end - 1] === '*' && sql[end] === '/')) {
    end++
  }
  end++

  return createToken(sql, position, end, 'comment')
}

function readLineComment(sql: string, position: number): Token | null {
  if (sql[position] !== '-' || sql[position + 1] !== '-') {
    return null
  }

  let end = position

  while (end < sql.length && sql[end] !== '\n') {
    end++
  }

  return createToken(sql, position, end, 'comment')
}

function readNumber(sql: string, position: number): Token | null {
  const char = sql[position]
  const startsNumber =
    /\d/.test(char) || (char === '.' && /\d/.test(sql[position + 1]))

  if (!startsNumber) {
    return null
  }

  return createToken(sql, position, scanWhile(sql, position, /[\d.]/), 'number')
}

function readOperator(sql: string, position: number): Token | null {
  if (multiCharacterOperators.has(sql.slice(position, position + 2))) {
    return createToken(sql, position, position + 2, 'operator')
  }

  if ('=<>+-*/%'.includes(sql[position])) {
    return createToken(sql, position, position + 1, 'operator')
  }

  return null
}

function readPunctuation(sql: string, position: number): Token | null {
  if (!'(),;.'.includes(sql[position])) {
    return null
  }

  return createToken(sql, position, position + 1, 'punctuation')
}

// Quoted identifier (double quotes or backticks).
function readQuotedIdentifier(sql: string, position: number): Token | null {
  const quote = sql[position]

  if (quote !== '"' && quote !== '`') {
    return null
  }

  let end = position + 1

  while (end < sql.length && sql[end] !== quote) {
    end++
  }
  end++

  return createToken(sql, position, end, 'identifier')
}

// String (single quotes, with '' as the escape for a literal quote).
function readString(sql: string, position: number): Token | null {
  if (sql[position] !== "'") {
    return null
  }

  let end = position + 1

  while (end < sql.length && (sql[end] !== "'" || sql[end + 1] === "'")) {
    end += sql[end] === "'" && sql[end + 1] === "'" ? 2 : 1
  }
  end++

  return createToken(sql, position, end, 'string')
}

function readToken(sql: string, position: number): Token | null {
  for (const read of tokenReaders) {
    const token = read(sql, position)

    if (token) {
      return token
    }
  }

  return null
}

function readWhitespace(sql: string, position: number): Token | null {
  if (!/\s/.test(sql[position])) {
    return null
  }

  return createToken(
    sql,
    position,
    scanWhile(sql, position, /\s/),
    'whitespace'
  )
}

// Identifier or keyword.
function readWord(sql: string, position: number): Token | null {
  if (!/[a-zA-Z_]/.test(sql[position])) {
    return null
  }

  const end = scanWhile(sql, position, /[a-zA-Z0-9_]/)
  const type = keywords.has(sql.slice(position, end).toUpperCase())
    ? 'keyword'
    : 'identifier'

  return createToken(sql, position, end, type)
}

function scanWhile(sql: string, position: number, pattern: RegExp): number {
  let end = position

  while (end < sql.length && pattern.test(sql[end])) {
    end++
  }

  return end
}

// Order matters: comments before operators ('--', '/*'), numbers before
// punctuation ('.5'), multi-character operators before single ones.
const tokenReaders: TokenReader[] = [
  readWhitespace,
  readLineComment,
  readBlockComment,
  readString,
  readQuotedIdentifier,
  readNumber,
  readOperator,
  readPunctuation,
  readWord
]

const multiCharacterOperators = new Set(['<>', '<=', '>=', '!=', '||'])

const keywords = new Set([
  'AND',
  'AS',
  'ASC',
  'BETWEEN',
  'BY',
  'CASE',
  'DELETE',
  'DESC',
  'DISTINCT',
  'ELSE',
  'END',
  'FALSE',
  'FROM',
  'GROUP',
  'HAVING',
  'IN',
  'INSERT',
  'INTO',
  'IS',
  'JOIN',
  'LEFT',
  'LIKE',
  'LIMIT',
  'NOT',
  'NULL',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'RIGHT',
  'SELECT',
  'SET',
  'THEN',
  'TRUE',
  'UPDATE',
  'VALUES',
  'WHEN',
  'WHERE'
])
