import { tokenize, type Token } from './tokenizer'

export type StatementType =
  | 'delete'
  | 'insert'
  | 'select'
  | 'unknown'
  | 'update'

export interface Statement {
  end: number
  start: number
  text: string
  type: StatementType
}

export interface Script {
  statements: Statement[]
}

const statementKeywords = new Set(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])

function isStatementKeyword(token: Token): boolean {
  return (
    token.type === 'keyword' && statementKeywords.has(token.value.toUpperCase())
  )
}

function getStatementType(tokens: Token[]): StatementType {
  const firstSignificant = tokens.find(
    (t) => t.type !== 'whitespace' && t.type !== 'comment'
  )

  if (!firstSignificant) {
    return 'unknown'
  }

  if (firstSignificant.type === 'keyword') {
    const keyword = firstSignificant.value.toUpperCase()

    if (keyword === 'SELECT') return 'select'
    if (keyword === 'INSERT') return 'insert'
    if (keyword === 'UPDATE') return 'update'
    if (keyword === 'DELETE') return 'delete'
  }

  return 'unknown'
}

function trimTokens(tokens: Token[]): Token[] {
  let start = 0
  let end = tokens.length

  while (start < end && tokens[start].type === 'whitespace') {
    start++
  }

  while (end > start && tokens[end - 1].type === 'whitespace') {
    end--
  }

  return tokens.slice(start, end)
}

function createStatement(tokens: Token[], sql: string): Statement | null {
  const trimmed = trimTokens(tokens)

  if (trimmed.length === 0) {
    return null
  }

  const hasSignificantContent = trimmed.some(
    (t) => t.type !== 'whitespace' && t.type !== 'comment'
  )

  if (!hasSignificantContent) {
    return null
  }

  const start = trimmed[0].start
  const end = trimmed[trimmed.length - 1].end

  return {
    end,
    start,
    text: sql.slice(start, end),
    type: getStatementType(trimmed)
  }
}

export function createAstFromSql(sql: string): Script {
  const tokens = tokenize(sql)
  const statements: Statement[] = []
  let currentTokens: Token[] = []
  let parenDepth = 0

  for (const token of tokens) {
    if (token.type === 'punctuation' && token.value === '(') {
      parenDepth++
      currentTokens.push(token)
      continue
    }

    if (token.type === 'punctuation' && token.value === ')') {
      parenDepth = Math.max(0, parenDepth - 1)
      currentTokens.push(token)
      continue
    }

    if (token.type === 'punctuation' && token.value === ';') {
      currentTokens.push(token)
      const statement = createStatement(currentTokens, sql)

      if (statement) {
        statements.push(statement)
      }

      currentTokens = []
      parenDepth = 0
      continue
    }

    if (parenDepth === 0 && isStatementKeyword(token)) {
      const hasContent = currentTokens.some(
        (t) => t.type !== 'whitespace' && t.type !== 'comment'
      )

      if (hasContent) {
        const statement = createStatement(currentTokens, sql)

        if (statement) {
          statements.push(statement)
        }

        currentTokens = []
      }
    }

    currentTokens.push(token)
  }

  const statement = createStatement(currentTokens, sql)

  if (statement) {
    statements.push(statement)
  }

  return { statements }
}
