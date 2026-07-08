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

function hasSignificantContent(tokens: Token[]): boolean {
  return tokens.some((t) => t.type !== 'whitespace' && t.type !== 'comment')
}

function isPunctuation(token: Token, value: string): boolean {
  return token.type === 'punctuation' && token.value === value
}

function createStatement(tokens: Token[], sql: string): Statement | null {
  const trimmed = trimTokens(tokens)

  if (trimmed.length === 0) {
    return null
  }

  if (!hasSignificantContent(trimmed)) {
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

interface ParserState {
  currentTokens: Token[]
  parenDepth: number
  statements: Statement[]
}

// Closes the statement collected so far and starts a new one.
function finishStatement(state: ParserState, sql: string): void {
  const statement = createStatement(state.currentTokens, sql)

  if (statement) {
    state.statements.push(statement)
  }

  state.currentTokens = []
}

// Statements are split on semicolons and on top-level statement keywords
// (SELECT/INSERT/UPDATE/DELETE outside parentheses).
function consumeToken(state: ParserState, token: Token, sql: string): void {
  if (isPunctuation(token, '(')) {
    state.parenDepth++
    state.currentTokens.push(token)

    return
  }

  if (isPunctuation(token, ')')) {
    state.parenDepth = Math.max(0, state.parenDepth - 1)
    state.currentTokens.push(token)

    return
  }

  if (isPunctuation(token, ';')) {
    state.currentTokens.push(token)
    finishStatement(state, sql)
    state.parenDepth = 0

    return
  }

  const startsNewStatement =
    state.parenDepth === 0 &&
    isStatementKeyword(token) &&
    hasSignificantContent(state.currentTokens)

  if (startsNewStatement) {
    finishStatement(state, sql)
  }

  state.currentTokens.push(token)
}

export function createAstFromSql(sql: string): Script {
  const state: ParserState = {
    currentTokens: [],
    parenDepth: 0,
    statements: []
  }

  for (const token of tokenize(sql)) {
    consumeToken(state, token, sql)
  }

  finishStatement(state, sql)

  return { statements: state.statements }
}
