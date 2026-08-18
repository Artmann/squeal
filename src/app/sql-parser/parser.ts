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

// One table drives both decisions below: whether a keyword starts a new
// statement, and what type that statement is. Keeping them in one place is
// what stops them drifting apart -- a keyword that splits but has no type
// would parse into a statement classified 'unknown'.
export const statementTypes = new Map<string, StatementType>([
  ['DELETE', 'delete'],
  ['INSERT', 'insert'],
  ['SELECT', 'select'],
  ['UPDATE', 'update']
])

function isStatementKeyword(token: Token): boolean {
  return (
    token.type === 'keyword' && statementTypes.has(token.value.toUpperCase())
  )
}

function getStatementType(tokens: Token[]): StatementType {
  const firstSignificant = tokens.find(
    (t) => t.type !== 'whitespace' && t.type !== 'comment'
  )

  // Only a bare word is ever tokenized as a keyword -- a quoted SELECT keeps
  // its quotes in token.value and so misses the table anyway -- which makes
  // this guard defence-in-depth against a future tokenizer change.
  if (!firstSignificant || firstSignificant.type !== 'keyword') {
    return 'unknown'
  }

  return statementTypes.get(firstSignificant.value.toUpperCase()) ?? 'unknown'
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

// Statements are split on semicolons and on the top-level keywords in
// statementTypes (outside parentheses).
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
