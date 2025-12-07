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

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let pos = 0

  while (pos < sql.length) {
    const start = pos
    const char = sql[pos]

    // Whitespace
    if (/\s/.test(char)) {
      while (pos < sql.length && /\s/.test(sql[pos])) {
        pos++
      }
      tokens.push({
        end: pos,
        start,
        type: 'whitespace',
        value: sql.slice(start, pos)
      })
      continue
    }

    // Single-line comment
    if (char === '-' && sql[pos + 1] === '-') {
      while (pos < sql.length && sql[pos] !== '\n') {
        pos++
      }
      tokens.push({
        end: pos,
        start,
        type: 'comment',
        value: sql.slice(start, pos)
      })
      continue
    }

    // Block comment
    if (char === '/' && sql[pos + 1] === '*') {
      pos += 2
      while (pos < sql.length && !(sql[pos - 1] === '*' && sql[pos] === '/')) {
        pos++
      }
      pos++
      tokens.push({
        end: pos,
        start,
        type: 'comment',
        value: sql.slice(start, pos)
      })
      continue
    }

    // String (single quotes)
    if (char === "'") {
      pos++
      while (pos < sql.length && (sql[pos] !== "'" || sql[pos + 1] === "'")) {
        if (sql[pos] === "'" && sql[pos + 1] === "'") {
          pos += 2
        } else {
          pos++
        }
      }
      pos++
      tokens.push({
        end: pos,
        start,
        type: 'string',
        value: sql.slice(start, pos)
      })
      continue
    }

    // Quoted identifier (double quotes or backticks)
    if (char === '"' || char === '`') {
      const quote = char
      pos++
      while (pos < sql.length && sql[pos] !== quote) {
        pos++
      }
      pos++
      tokens.push({
        end: pos,
        start,
        type: 'identifier',
        value: sql.slice(start, pos)
      })
      continue
    }

    // Number
    if (/\d/.test(char) || (char === '.' && /\d/.test(sql[pos + 1]))) {
      while (pos < sql.length && /[\d.]/.test(sql[pos])) {
        pos++
      }
      tokens.push({
        end: pos,
        start,
        type: 'number',
        value: sql.slice(start, pos)
      })
      continue
    }

    // Multi-character operators
    if (['<>', '<=', '>=', '!=', '||'].includes(sql.slice(pos, pos + 2))) {
      pos += 2
      tokens.push({
        end: pos,
        start,
        type: 'operator',
        value: sql.slice(start, pos)
      })
      continue
    }

    // Single-character operators
    if ('=<>+-*/%'.includes(char)) {
      pos++
      tokens.push({ end: pos, start, type: 'operator', value: char })
      continue
    }

    // Punctuation
    if ('(),;.'.includes(char)) {
      pos++
      tokens.push({ end: pos, start, type: 'punctuation', value: char })
      continue
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(char)) {
      while (pos < sql.length && /[a-zA-Z0-9_]/.test(sql[pos])) {
        pos++
      }
      const value = sql.slice(start, pos)
      const type = keywords.has(value.toUpperCase()) ? 'keyword' : 'identifier'
      tokens.push({ end: pos, start, type, value })
      continue
    }

    // Unknown character - skip it
    pos++
  }

  return tokens
}

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
